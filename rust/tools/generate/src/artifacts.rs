use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use miette::IntoDiagnostic;
use serde::{Deserialize, Serialize};
use trellis_contracts::LoadedManifest;
use trellis_codegen_rust::{
    default_sdk_stem, rust_sdk_cargo_manifest_is_valid, GenerateRustParticipantFacadeOpts,
    GenerateRustSdkOpts, ParticipantAliasMapping, RustRuntimeDeps,
    RustRuntimeSource as CodegenRustRuntimeSource,
};
use trellis_codegen_ts::{
    collect_ts_sdk_sources, GenerateTsSdkOpts, TsRuntimeDeps,
    TsRuntimeSource as CodegenTsRuntimeSource,
};

use crate::cli::{ContractInputArgs, RuntimeSource};
use crate::contract_input::{self, ResolvedContractInput};
use crate::output;

const TRELLIS_DENO_JSON: &str = include_str!("../../../../js/packages/trellis/deno.json");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GeneratedArtifactsMetadata {
    pub schema_version: u8,
    pub contract_id: String,
    pub contract_digest: String,
    pub artifact_version: String,
    pub runtime_source: RuntimeSource,
    pub jsr_runtime_version: String,
    pub has_jsr_package: bool,
    pub has_npm_package: bool,
    pub has_cargo_package: bool,
    pub package_name: String,
    pub crate_name: String,
    pub generator_fingerprint: String,
}

pub struct NpmTsSources {
    pub root_dir: PathBuf,
    pub dependency_packages: BTreeSet<String>,
}

impl GeneratedArtifactsMetadata {
    const SCHEMA_VERSION: u8 = 2;
}

pub fn detect_output_root(project_root: &Path) -> PathBuf {
    let mut current = Some(project_root);
    while let Some(dir) = current {
        if dir.join(".git").exists() {
            return dir.to_path_buf();
        }
        current = dir.parent();
    }
    project_root.to_path_buf()
}

pub fn detect_runtime_source(output_root: &Path) -> RuntimeSource {
    if output_root.join("rust/Cargo.toml").exists()
        && output_root.join("js/packages/trellis").exists()
    {
        RuntimeSource::Local
    } else {
        RuntimeSource::Registry
    }
}

pub fn sdk_output_stem(contract_id: &str) -> String {
    match contract_id {
        "trellis.core@v1" => "trellis-core".to_string(),
        _ => default_sdk_stem(contract_id),
    }
}

pub fn resolve_contract(args: &ContractInputArgs) -> miette::Result<ResolvedContractInput> {
    contract_input::resolve_contract_input(
        args.manifest.as_deref(),
        args.source.as_deref(),
        args.image.as_deref(),
        &args.source_export,
        &args.image_contract_path,
    )
}

pub fn write_contract_outputs(
    resolved: &ResolvedContractInput,
    artifact_version: String,
    out_manifest: &Path,
    ts_out: Option<&Path>,
    npm_out: Option<&Path>,
    rust_out: Option<&Path>,
    package_name: &str,
    crate_name: &str,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
    generator_fingerprint: &str,
    success_message: &str,
) -> miette::Result<()> {
    let metadata = generated_artifacts_metadata(
        resolved,
        &artifact_version,
        runtime_source,
        &trellis_package_version(),
        ts_out.is_some(),
        npm_out.is_some(),
        rust_out.is_some(),
        package_name,
        crate_name,
        generator_fingerprint,
    );
    if let Some(parent) = out_manifest.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    write_if_changed(out_manifest, &format!("{}\n", resolved.loaded.canonical))?;

    if let Some(ts_out) = ts_out {
        trellis_codegen_ts::generate_ts_sdk(&GenerateTsSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: ts_out.to_path_buf(),
            package_name: package_name.to_string(),
            package_version: artifact_version.clone(),
            runtime_deps: ts_runtime_deps(
                runtime_source,
                trellis_package_version(),
                runtime_repo_root.clone(),
            ),
        })
        .into_diagnostic()?;
    }

    if let Some(npm_out) = npm_out {
        let staging_dir = tempfile::tempdir().into_diagnostic()?;
        let npm_sources = stage_npm_ts_sources(
            &resolved.loaded.manifest.id,
            out_manifest,
            staging_dir.path(),
            package_name,
            &artifact_version,
        )?;
        build_npm_package_from_ts_sources(
            &npm_sources.root_dir,
            npm_out,
            package_name,
            &artifact_version,
            &trellis_package_version(),
            &resolved.loaded.manifest.id,
            &npm_sources.dependency_packages,
        )?;
    }

    if let Some(rust_out) = rust_out {
        trellis_codegen_rust::generate_rust_sdk(&GenerateRustSdkOpts {
            manifest_path: out_manifest.to_path_buf(),
            out_dir: rust_out.to_path_buf(),
            crate_name: crate_name.to_string(),
            crate_version: artifact_version.clone(),
            runtime_deps: rust_runtime_deps(
                runtime_source,
                artifact_version.clone(),
                runtime_repo_root,
            ),
        })
        .into_diagnostic()?;
    }

    write_generated_artifacts_metadata(out_manifest, &metadata)?;

    output::print_success(&format!(
        "{} for {}",
        success_message, resolved.loaded.manifest.id
    ));
    output::print_detail("manifest", out_manifest.display().to_string());
    output::print_detail("digest", &resolved.loaded.digest);
    Ok(())
}

pub fn write_contract_shell_outputs(
    contract_id: &str,
    artifact_version: &str,
    out_manifest: Option<&Path>,
    ts_out: Option<&Path>,
    npm_out: Option<&Path>,
    rust_out: Option<&Path>,
    package_name: &str,
    crate_name: &str,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
) -> miette::Result<()> {
    if let Some(ts_out) = ts_out {
        write_ts_sdk_shell(
            contract_id,
            artifact_version,
            ts_out,
            package_name,
            runtime_source,
            runtime_repo_root.clone(),
        )?;
    }

    if let Some(npm_out) = npm_out {
        write_npm_package_shell(npm_out, package_name, artifact_version)?;
    }

    if let Some(rust_out) = rust_out {
        write_rust_sdk_shell(
            contract_id,
            artifact_version,
            rust_out,
            crate_name,
            runtime_source,
            runtime_repo_root,
        )?;
    }

    if let Some(out_manifest) = out_manifest {
        if let Some(parent) = out_manifest.parent() {
            fs::create_dir_all(parent).into_diagnostic()?;
        }
        let metadata_path = generated_artifacts_metadata_path(out_manifest);
        if metadata_path.exists() {
            fs::remove_file(metadata_path).into_diagnostic()?;
        }
    }

    Ok(())
}

fn write_npm_package_shell(
    out: &Path,
    package_name: &str,
    package_version: &str,
) -> miette::Result<()> {
    fs::create_dir_all(out.join("esm")).into_diagnostic()?;
    write_if_changed(
        &out.join("package.json"),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&serde_json::json!({
                "name": package_name,
                "version": package_version,
                "type": "module",
                "exports": {
                    ".": {
                        "types": "./esm/mod.d.ts",
                        "import": "./esm/mod.js"
                    }
                },
                "types": "./esm/mod.d.ts"
            }))
            .into_diagnostic()?
        ),
    )?;
    write_if_changed(&out.join("esm/mod.js"), "export const CONTRACT_DIGEST = \"shell\";\n")?;
    write_if_changed(
        &out.join("esm/mod.d.ts"),
        "export declare const CONTRACT_DIGEST = \"shell\";\n",
    )
}

fn write_ts_sdk_shell(
    contract_id: &str,
    artifact_version: &str,
    out: &Path,
    package_name: &str,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
) -> miette::Result<()> {
    fs::create_dir_all(out).into_diagnostic()?;
    let runtime_deps =
        ts_runtime_deps(runtime_source, trellis_package_version(), runtime_repo_root);
    let deno = ts_shell_deno_json(package_name, artifact_version, &runtime_deps);

    write_if_changed(
        &out.join("deno.json"),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&deno).into_diagnostic()?
        ),
    )?;
    write_if_changed(
        &out.join("mod.ts"),
        "export { API, OWNED_API } from \"./api.ts\";\nexport type { Api, ApiViews, OwnedApi } from \"./api.ts\";\nexport * from \"./types.ts\";\nexport * from \"./schemas.ts\";\nexport type { Client } from \"./client.ts\";\nexport { CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, sdk } from \"./contract.ts\";\n",
    )?;
    write_if_changed(
        &out.join("contract.ts"),
        &render_ts_contract_shell(contract_id, &ts_shell_trellis_import(&runtime_deps)),
    )?;
    write_if_changed(
        &out.join("api.ts"),
        r#"type PermissiveApiRecord = Record<string, unknown>;

function permissiveApiRecord(): PermissiveApiRecord {
  return new Proxy({}, {
    get: () => ({}),
    has: () => true,
    getOwnPropertyDescriptor: (_target, property) => typeof property === "string"
      ? { configurable: true, enumerable: true, value: {} }
      : undefined,
  }) as PermissiveApiRecord;
}

export const OWNED_API = {
  rpc: permissiveApiRecord(),
  operations: permissiveApiRecord(),
  events: permissiveApiRecord(),
  feeds: permissiveApiRecord(),
  subjects: {},
  state: {},
  jobs: {},
  kv: {},
  store: {},
} as const;
export const API = { owned: OWNED_API, used: {}, merged: OWNED_API } as const;
export type OwnedApi = typeof OWNED_API;
export type Api = typeof API;
export type ApiViews = typeof API;
"#,
    )?;
    write_if_changed(
        &out.join("owned_api.ts"),
        r#"type PermissiveApiRecord = Record<string, unknown>;

function permissiveApiRecord(): PermissiveApiRecord {
  return new Proxy({}, {
    get: () => ({}),
    has: () => true,
    getOwnPropertyDescriptor: (_target, property) => typeof property === "string"
      ? { configurable: true, enumerable: true, value: {} }
      : undefined,
  }) as PermissiveApiRecord;
}

export const OWNED_API = {
  rpc: permissiveApiRecord(),
  operations: permissiveApiRecord(),
  events: permissiveApiRecord(),
  feeds: permissiveApiRecord(),
  subjects: {},
  state: {},
  jobs: {},
  kv: {},
  store: {},
} as const;
"#,
    )?;
    write_if_changed(&out.join("types.ts"), &format!("export const CONTRACT_ID = {} as const;\nexport const CONTRACT_DIGEST = \"shell\" as const;\n", js_string(contract_id)))?;
    write_if_changed(&out.join("schemas.ts"), "")?;
    write_if_changed(&out.join("client.ts"), "export type Client = never;\n")?;
    Ok(())
}

fn render_ts_contract_shell(contract_id: &str, trellis_import: &str) -> String {
    format!(
        "import type {{ ContractDependencyUse, SdkContractModule, UseSpec }} from {};\n\nconst CONTRACT_MODULE_METADATA = Symbol.for(\"@qlever-llc/trellis/contracts/contract-module\");\n\ntype PermissiveApiRecord = Record<string, unknown>;\n\nfunction permissiveApiRecord(): PermissiveApiRecord {{\n  return new Proxy({{}}, {{\n    get: () => ({{}}),\n    has: () => true,\n    getOwnPropertyDescriptor: (_target, property) => typeof property === \"string\"\n      ? {{ configurable: true, enumerable: true, value: {{}} }}\n      : undefined,\n  }}) as PermissiveApiRecord;\n}}\n\nexport const CONTRACT_ID = {} as const;\nexport const CONTRACT_DIGEST = \"shell\" as const;\nexport const CONTRACT = {{ format: \"trellis.contract.v1\", id: CONTRACT_ID }};\nexport const API = {{\n  owned: {{\n    rpc: permissiveApiRecord(),\n    operations: permissiveApiRecord(),\n    events: permissiveApiRecord(),\n    feeds: permissiveApiRecord(),\n    subjects: {{}},\n  }},\n}} as const;\n\nexport const sdk: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {{\n  CONTRACT_ID,\n  CONTRACT_DIGEST,\n  CONTRACT: CONTRACT as never,\n  API: API as never,\n  use: (<const TSpec extends UseSpec<typeof API.owned>>(spec: TSpec) => {{\n    const dependencyUse = {{\n      contract: CONTRACT_ID,\n      ...(spec.rpc?.call ? {{ rpc: {{ call: [...spec.rpc.call] }} }} : {{}}),\n      ...(spec.operations?.call ? {{ operations: {{ call: [...spec.operations.call] }} }} : {{}}),\n      ...((spec.events?.publish || spec.events?.subscribe) ? {{ events: {{ ...(spec.events.publish ? {{ publish: [...spec.events.publish] }} : {{}}), ...(spec.events.subscribe ? {{ subscribe: [...spec.events.subscribe] }} : {{}}) }} }} : {{}}),\n      ...(spec.feeds?.subscribe ? {{ feeds: {{ subscribe: [...spec.feeds.subscribe] }} }} : {{}}),\n    }};\n    Object.defineProperty(dependencyUse, CONTRACT_MODULE_METADATA, {{ value: sdk, enumerable: false }});\n    return dependencyUse as ContractDependencyUse<typeof CONTRACT_ID, typeof API.owned, TSpec>;\n  }}),\n}};\n\nexport const use = sdk.use;\n",
        js_string(trellis_import),
        js_string(contract_id)
    )
}

fn write_rust_sdk_shell(
    contract_id: &str,
    artifact_version: &str,
    out: &Path,
    crate_name: &str,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
) -> miette::Result<()> {
    fs::create_dir_all(out.join("src")).into_diagnostic()?;
    let deps = rust_runtime_deps(
        runtime_source,
        artifact_version.to_string(),
        runtime_repo_root,
    );
    let opts = GenerateRustSdkOpts {
        manifest_path: out.join("shell.contract.json"),
        out_dir: out.to_path_buf(),
        crate_name: crate_name.to_string(),
        crate_version: artifact_version.to_string(),
        runtime_deps: deps,
    };

    write_if_changed(
        &out.join("Cargo.toml"),
        &render_rust_shell_cargo_toml(&opts),
    )?;
    write_if_changed(
        &out.join("src/lib.rs"),
        &render_rust_shell_lib_rs(contract_id),
    )?;
    Ok(())
}

fn render_rust_shell_cargo_toml(opts: &GenerateRustSdkOpts) -> String {
    format!(
        "[package]\nname = \"{}\"\nversion = \"{}\"\nedition = \"2021\"\nlicense = \"Apache-2.0\"\n\n[dependencies]\nserde = {{ version = \"1.0\", features = [\"derive\"] }}\nserde_json = \"1.0\"\n{}\n",
        opts.crate_name,
        opts.crate_version,
        rust_runtime_deps_lines(&opts.runtime_deps).join("\n")
    )
}

fn rust_runtime_deps_lines(deps: &RustRuntimeDeps) -> Vec<String> {
    match deps.source {
        CodegenRustRuntimeSource::Registry => vec![
            format!("trellis-client = \"{}\"", deps.version),
            format!("trellis-contracts = \"{}\"", deps.version),
            format!("trellis-service = \"{}\"", deps.version),
        ],
        CodegenRustRuntimeSource::Local => {
            let repo_root = deps
                .repo_root
                .as_ref()
                .expect("local Rust SDK shell requires repo root");
            vec![
                format!(
                    "trellis-client = {{ path = {} }}",
                    string_literal(&repo_root.join("rust/crates/client").display().to_string())
                ),
                format!(
                    "trellis-contracts = {{ path = {} }}",
                    string_literal(
                        &repo_root
                            .join("rust/crates/contracts")
                            .display()
                            .to_string()
                    )
                ),
                format!(
                    "trellis-service = {{ path = {} }}",
                    string_literal(&repo_root.join("rust/crates/service").display().to_string())
                ),
            ]
        }
    }
}

fn render_rust_shell_lib_rs(contract_id: &str) -> String {
    format!(
        "//! Temporary generated Rust SDK shell used during `trellis-generate prepare`.\n\npub const CONTRACT_ID: &str = {};\npub const CONTRACT_DIGEST: &str = \"shell\";\npub const CONTRACT_NAME: &str = {};\npub const CONTRACT_JSON: &str = \"{{}}\";\n",
        string_literal(contract_id),
        string_literal(contract_id),
    )
}

fn ts_shell_deno_json(
    package_name: &str,
    package_version: &str,
    runtime_deps: &TsRuntimeDeps,
) -> serde_json::Map<String, serde_json::Value> {
    let mut root = serde_json::Map::new();
    if let Some(extends) = ts_shell_extends(runtime_deps) {
        root.insert("extends".to_string(), serde_json::Value::String(extends));
    } else {
        let mut imports = serde_json::Map::new();
        imports.insert(
            "@qlever-llc/trellis".to_string(),
            serde_json::Value::String(format!("npm:@qlever-llc/trellis@^{}", runtime_deps.version)),
        );
        root.insert("imports".to_string(), serde_json::Value::Object(imports));
    }
    root.insert(
        "name".to_string(),
        serde_json::Value::String(package_name.to_string()),
    );
    root.insert(
        "version".to_string(),
        serde_json::Value::String(package_version.to_string()),
    );
    root.insert(
        "exports".to_string(),
        serde_json::json!({ ".": "./mod.ts" }),
    );
    root.insert(
        "compilerOptions".to_string(),
        serde_json::json!({
            "strict": true,
            "verbatimModuleSyntax": true
        }),
    );
    root
}

fn ts_shell_extends(runtime_deps: &TsRuntimeDeps) -> Option<String> {
    let repo_root = runtime_deps.repo_root.as_ref()?;
    if !matches!(runtime_deps.source, CodegenTsRuntimeSource::Local) {
        return None;
    }
    Some(
        repo_root
            .join("js/deno.json")
            .to_string_lossy()
            .replace('\\', "/"),
    )
}

fn ts_shell_trellis_import(runtime_deps: &TsRuntimeDeps) -> String {
    match runtime_deps.source {
        CodegenTsRuntimeSource::Registry => "@qlever-llc/trellis".to_string(),
        CodegenTsRuntimeSource::Local => "@qlever-llc/trellis".to_string(),
    }
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).expect("serializing a string cannot fail")
}

fn string_literal(value: &str) -> String {
    serde_json::to_string(value).expect("serializing a string cannot fail")
}

pub fn write_participant_facade_outputs(
    manifest_path: &Path,
    rust_participant_out: &Path,
    crate_name: &str,
    crate_version: &str,
    runtime_source: RuntimeSource,
    runtime_repo_root: Option<PathBuf>,
    alias_mappings: Vec<ParticipantAliasMapping>,
) -> miette::Result<()> {
    trellis_codegen_rust::generate_rust_participant_facade(&GenerateRustParticipantFacadeOpts {
        manifest_path: manifest_path.to_path_buf(),
        out_dir: rust_participant_out.to_path_buf(),
        crate_name: crate_name.to_string(),
        crate_version: crate_version.to_string(),
        runtime_deps: rust_runtime_deps(
            runtime_source,
            crate_version.to_string(),
            runtime_repo_root,
        ),
        owned_sdk_crate_name: None,
        owned_sdk_path: None,
        alias_mappings,
    })
    .into_diagnostic()?;
    output::print_detail(
        "rust participant",
        rust_participant_out.display().to_string(),
    );
    Ok(())
}

pub fn build_npm_package_from_ts_sources(
    src_dir: &Path,
    npm_out: &Path,
    package_name: &str,
    package_version: &str,
    trellis_runtime_version: &str,
    contract_id: &str,
    dependency_packages: &BTreeSet<String>,
) -> miette::Result<()> {
    let npm_out = if npm_out.is_absolute() {
        npm_out.to_path_buf()
    } else {
        std::env::current_dir().into_diagnostic()?.join(npm_out)
    };
    if npm_out.exists() {
        fs::remove_dir_all(&npm_out).into_diagnostic()?;
    }
    fs::create_dir_all(&npm_out).into_diagnostic()?;
    let esm_dir = npm_out.join("esm");
    write_if_changed(
        &src_dir.join("tsconfig.json"),
        &render_npm_tsconfig(&npm_out),
    )?;
    write_if_changed(
        &src_dir.join("package.json"),
        "{\n  \"type\": \"module\"\n}\n",
    )?;
    let tsc = resolve_tsc_bin()?;
    let output = Command::new(&tsc)
        .arg("-p")
        .arg(src_dir.join("tsconfig.json"))
        .current_dir(src_dir)
        .output()
        .into_diagnostic()?;
    if !output.status.success() {
        return Err(miette::miette!(
            "npm package TypeScript build failed for {} using {:?}\nstdout:\n{}\nstderr:\n{}",
            package_name,
            tsc,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    write_npm_package_json(
        &npm_out,
        package_name,
        package_version,
        trellis_runtime_version,
        contract_id,
        dependency_packages,
    )?;
    if let Ok(readme) = fs::read_to_string(src_dir.join("README.md")) {
        write_if_changed(&npm_out.join("README.md"), &readme)?;
    }
    if !esm_dir.join("mod.js").exists() || !esm_dir.join("mod.d.ts").exists() {
        return Err(miette::miette!(
            "npm package TypeScript build for {} did not emit esm/mod.js and esm/mod.d.ts",
            package_name
        ));
    }
    Ok(())
}

pub fn stage_npm_ts_sources(
    contract_id: &str,
    manifest_path: &Path,
    staging_root: &Path,
    package_name: &str,
    package_version: &str,
) -> miette::Result<NpmTsSources> {
    let mut staged = BTreeSet::new();
    let mut dependency_packages = BTreeSet::new();
    let root_dir = stage_npm_manifest_ts_sources(
        contract_id,
        contract_id,
        manifest_path,
        staging_root,
        package_name,
        package_version,
        &mut staged,
        &mut dependency_packages,
    )?;
    Ok(NpmTsSources {
        root_dir,
        dependency_packages,
    })
}

fn stage_npm_manifest_ts_sources(
    root_contract_id: &str,
    contract_id: &str,
    manifest_path: &Path,
    staging_root: &Path,
    package_name: &str,
    package_version: &str,
    staged: &mut BTreeSet<String>,
    dependency_packages: &mut BTreeSet<String>,
) -> miette::Result<PathBuf> {
    if !staged.insert(contract_id.to_string()) {
        return Ok(staging_root.join(sdk_output_stem(contract_id)));
    }

    let loaded = trellis_contracts::load_manifest(manifest_path).into_diagnostic()?;
    let out_dir = staging_root.join(sdk_output_stem(contract_id));
    let generated_package_name = if contract_id == root_contract_id {
        package_name.to_string()
    } else {
        ts_package_name_from_id(contract_id, "@trellis-sdk/")
    };
    let opts = GenerateTsSdkOpts {
        manifest_path: manifest_path.to_path_buf(),
        out_dir: out_dir.clone(),
        package_name: generated_package_name,
        package_version: package_version.to_string(),
        runtime_deps: ts_runtime_deps(RuntimeSource::Registry, trellis_package_version(), None),
    };
    for source in collect_ts_sdk_sources(&opts).into_diagnostic()? {
        if source
            .path
            .extension()
            .is_some_and(|extension| extension == "ts")
        {
            write_if_changed(
                &out_dir.join(source.path),
                &rewrite_npm_ts_imports(&source.contents, &loaded),
            )?;
        } else if source.path == Path::new("README.md") {
            write_if_changed(&out_dir.join(source.path), &source.contents)?;
        }
    }

    if let Some(manifest_dir) = manifest_path.parent() {
        for (_alias, use_ref) in loaded.manifest.uses.iter() {
            let dependency_manifest = manifest_dir.join(format!("{}.json", use_ref.contract));
            if dependency_manifest.exists() {
                stage_npm_manifest_ts_sources(
                    root_contract_id,
                    &use_ref.contract,
                    &dependency_manifest,
                    staging_root,
                    &ts_package_name_from_id(&use_ref.contract, "@trellis-sdk/"),
                    package_version,
                    staged,
                    dependency_packages,
                )?;
            }
            if let Some(package_name) = npm_dependency_package_name(&use_ref.contract) {
                dependency_packages.insert(package_name);
            }
        }
    }

    Ok(out_dir)
}

fn render_npm_tsconfig(npm_out: &Path) -> String {
    let out_dir = npm_out.join("esm").to_string_lossy().replace('\\', "/");
    format!(
        "{}\n",
        serde_json::to_string_pretty(&serde_json::json!({
            "compilerOptions": {
                "declaration": true,
                "emitDeclarationOnly": false,
                "module": "NodeNext",
                "moduleResolution": "NodeNext",
                "noCheck": true,
                "outDir": out_dir,
                "rootDir": ".",
                "skipLibCheck": true,
                "strict": true,
                "target": "ES2022",
                "verbatimModuleSyntax": true
            },
            "include": ["./*.ts"]
        }))
        .expect("npm tsconfig json")
    )
}

fn write_npm_package_json(
    npm_out: &Path,
    package_name: &str,
    package_version: &str,
    trellis_runtime_version: &str,
    contract_id: &str,
    dependency_packages: &BTreeSet<String>,
) -> miette::Result<()> {
    let trellis_dependency = format!("^{}", trellis_runtime_version);
    let generated_dependency = format!("^{}", package_version);
    let mut peer_dependencies = serde_json::Map::new();
    peer_dependencies.insert(
        "@qlever-llc/trellis".to_string(),
        serde_json::Value::String(trellis_dependency.clone()),
    );
    for dependency in dependency_packages {
        if dependency != package_name {
            peer_dependencies.insert(
                dependency.clone(),
                serde_json::Value::String(generated_dependency.clone()),
            );
        }
    }
    write_if_changed(
        &npm_out.join("package.json"),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(&serde_json::json!({
                "name": package_name,
                "version": package_version,
                "description": format!("Generated Trellis SDK for contract {contract_id}"),
                "type": "module",
                "license": "Apache-2.0",
                "homepage": "https://github.com/Qlever-LLC/trellis#readme",
                "bugs": {
                    "url": "https://github.com/Qlever-LLC/trellis/issues"
                },
                "repository": {
                    "type": "git",
                    "url": "https://github.com/Qlever-LLC/trellis"
                },
                "publishConfig": {
                    "access": "public"
                },
                "exports": {
                    ".": {
                        "types": "./esm/mod.d.ts",
                        "import": "./esm/mod.js"
                    }
                },
                "types": "./esm/mod.d.ts",
                "peerDependencies": peer_dependencies,
                "devDependencies": peer_dependencies
            }))
            .into_diagnostic()?
        ),
    )
}

fn rewrite_npm_ts_imports(contents: &str, loaded: &LoadedManifest) -> String {
    let mut rewritten = contents.replace(".ts\"", ".js\"").replace(".ts'", ".js'");
    for (_alias, use_ref) in loaded.manifest.uses.iter() {
        let Some(package_name) = npm_dependency_package_name(&use_ref.contract) else {
            continue;
        };
        let stem = sdk_output_stem(&use_ref.contract);
        for file in ["types", "api", "owned_api"] {
            rewritten = rewritten.replace(&format!("\"../{stem}/{file}.js\""), &js_string(&package_name));
            rewritten = rewritten.replace(&format!("'../{stem}/{file}.js'"), &format!("'{package_name}'"));
        }
    }
    rewritten
}

fn npm_dependency_package_name(contract_id: &str) -> Option<String> {
    let package_name = ts_package_name_from_id(contract_id, "@trellis-sdk/");
    (!package_name.starts_with("@qlever-llc/trellis/sdk/")).then_some(package_name)
}

fn resolve_tsc_bin() -> miette::Result<OsString> {
    if let Some(bin) = std::env::var_os("TRELLIS_TSC_BIN") {
        if !bin.is_empty() {
            return binary_is_available(&bin).then_some(bin).ok_or_else(|| {
                miette::miette!(
                    "TRELLIS_TSC_BIN is set, but the configured TypeScript compiler is not available"
                )
            });
        }
    }

    let mut current = std::env::current_dir().into_diagnostic()?;
    loop {
        let candidate = current.join("node_modules/.bin/tsc");
        if candidate.exists() {
            return Ok(candidate.into_os_string());
        }
        if !current.pop() {
            break;
        }
    }

    let tsc = OsString::from("tsc");
    binary_is_available(&tsc).then_some(tsc).ok_or_else(|| {
        miette::miette!(
            "npm package generation requires the TypeScript compiler `tsc`; install TypeScript in the Node project, make `tsc` available on PATH, or set TRELLIS_TSC_BIN"
        )
    })
}

fn binary_is_available(binary: &OsString) -> bool {
    Command::new(binary).arg("--version").output().is_ok()
}

pub fn generated_artifacts_metadata(
    resolved: &ResolvedContractInput,
    artifact_version: &str,
    runtime_source: RuntimeSource,
    jsr_runtime_version: &str,
    has_jsr_package: bool,
    has_npm_package: bool,
    has_cargo_package: bool,
    package_name: &str,
    crate_name: &str,
    generator_fingerprint: &str,
) -> GeneratedArtifactsMetadata {
    GeneratedArtifactsMetadata {
        schema_version: GeneratedArtifactsMetadata::SCHEMA_VERSION,
        contract_id: resolved.loaded.manifest.id.clone(),
        contract_digest: resolved.loaded.digest.clone(),
        artifact_version: artifact_version.to_string(),
        runtime_source,
        jsr_runtime_version: jsr_runtime_version.to_string(),
        has_jsr_package,
        has_npm_package,
        has_cargo_package,
        package_name: package_name.to_string(),
        crate_name: crate_name.to_string(),
        generator_fingerprint: generator_fingerprint.to_string(),
    }
}

pub fn generated_artifacts_are_fresh(
    expected: &GeneratedArtifactsMetadata,
    out_manifest: &Path,
    ts_out: Option<&Path>,
    npm_out: Option<&Path>,
    rust_out: Option<&Path>,
) -> bool {
    let Some(existing) = read_generated_artifacts_metadata(out_manifest) else {
        return false;
    };
    existing == *expected
        && out_manifest.exists()
        && ts_key_outputs_exist(ts_out)
        && npm_key_outputs_exist(npm_out)
        && rust_key_outputs_exist(rust_out, expected)
}

fn read_generated_artifacts_metadata(out_manifest: &Path) -> Option<GeneratedArtifactsMetadata> {
    let contents = fs::read_to_string(generated_artifacts_metadata_path(out_manifest)).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_generated_artifacts_metadata(
    out_manifest: &Path,
    metadata: &GeneratedArtifactsMetadata,
) -> miette::Result<()> {
    write_if_changed(
        &generated_artifacts_metadata_path(out_manifest),
        &format!(
            "{}\n",
            serde_json::to_string_pretty(metadata).into_diagnostic()?
        ),
    )
}

pub fn generated_artifacts_metadata_path(out_manifest: &Path) -> PathBuf {
    out_manifest.with_extension("trellis-generate.json")
}

fn ts_key_outputs_exist(ts_out: Option<&Path>) -> bool {
    let Some(ts_out) = ts_out else {
        return true;
    };
    ts_out.join("mod.ts").exists()
        && ts_out.join("api.ts").exists()
        && ts_out.join("owned_api.ts").exists()
        && ts_out.join("contract.ts").exists()
        && ts_out.join("client.ts").exists()
}

fn npm_key_outputs_exist(npm_out: Option<&Path>) -> bool {
    let Some(npm_out) = npm_out else {
        return true;
    };
    npm_out.join("package.json").exists()
        && npm_out.join("esm/mod.js").exists()
        && npm_out.join("esm/mod.d.ts").exists()
}

fn rust_key_outputs_exist(rust_out: Option<&Path>, expected: &GeneratedArtifactsMetadata) -> bool {
    let Some(rust_out) = rust_out else {
        return true;
    };
    let cargo_toml = rust_out.join("Cargo.toml");
    cargo_toml.exists()
        && rust_out.join("src/contract.rs").exists()
        && rust_sdk_cargo_manifest_is_valid(
            &cargo_toml,
            &expected.crate_name,
            &expected.artifact_version,
        )
}

fn write_if_changed(path: &Path, contents: &str) -> miette::Result<()> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(path, contents).into_diagnostic()?;
    Ok(())
}

pub fn current_generator_fingerprint() -> &'static str {
    env!("TRELLIS_GENERATE_FINGERPRINT")
}

pub fn infer_artifact_version(
    resolved: &ResolvedContractInput,
    explicit: Option<String>,
    action: &str,
) -> miette::Result<String> {
    explicit.or(resolved.owner_version.clone()).ok_or_else(|| {
        miette::miette!(
            "cannot {action}: no version could be inferred; pass --artifact-version when using --manifest or --image"
        )
    })
}

pub fn required_owner_version(
    resolved: &ResolvedContractInput,
    action: &str,
) -> miette::Result<String> {
    resolved.owner_version.clone().ok_or_else(|| {
        miette::miette!(
            "cannot {action}: no owning workspace version could be inferred from the contract input; use a source file or a manifest located under a versioned workspace"
        )
    })
}

pub fn default_ts_package_name_from_id(contract_id: &str) -> String {
    ts_package_name_from_id(contract_id, "@trellis-sdk/")
}

pub fn ts_package_name_from_id(contract_id: &str, prefix: &str) -> String {
    let stem = contract_id
        .split('@')
        .next()
        .unwrap_or("trellis-sdk")
        .replace('.', "-");

    match stem.as_str() {
        "trellis-auth" => "@qlever-llc/trellis/sdk/auth".to_string(),
        "trellis-core" => "@qlever-llc/trellis/sdk/core".to_string(),
        "trellis-health" => "@qlever-llc/trellis/sdk/health".to_string(),
        "trellis-jobs" => "@qlever-llc/trellis/sdk/jobs".to_string(),
        "trellis-state" => "@qlever-llc/trellis/sdk/state".to_string(),
        other => format!("{prefix}{other}"),
    }
}

pub fn default_rust_crate_name_from_id(contract_id: &str) -> String {
    trellis_codegen_rust::default_sdk_crate_name(contract_id)
}

pub fn trellis_package_version() -> String {
    let manifest: serde_json::Value = serde_json::from_str(TRELLIS_DENO_JSON)
        .expect("bundled Trellis Deno package manifest must be valid JSON");
    manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .expect("bundled Trellis Deno package manifest must have a version")
        .to_string()
}

pub fn rust_runtime_deps(
    source: RuntimeSource,
    version: String,
    repo_root: Option<PathBuf>,
) -> RustRuntimeDeps {
    RustRuntimeDeps {
        source: match source {
            RuntimeSource::Registry => CodegenRustRuntimeSource::Registry,
            RuntimeSource::Local => CodegenRustRuntimeSource::Local,
        },
        version,
        repo_root,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::cli::RuntimeSource;

    use super::{
        generated_artifacts_metadata_path, render_npm_tsconfig, rewrite_npm_ts_imports,
        trellis_package_version, ts_package_name_from_id, write_contract_shell_outputs,
    };

    #[test]
    fn generated_ts_package_names_use_private_default_namespace() {
        assert_eq!(
            ts_package_name_from_id("trellis.demo-service@v1", "@trellis-sdk/"),
            "@trellis-sdk/trellis-demo-service",
        );
    }

    #[test]
    fn generated_ts_package_names_apply_prefix() {
        assert_eq!(
            ts_package_name_from_id("trellis.demo-service@v1", "@example/"),
            "@example/trellis-demo-service",
        );
        assert_eq!(
            ts_package_name_from_id("trellis.demo-service@v1", "example-sdk-"),
            "example-sdk-trellis-demo-service",
        );
    }

    #[test]
    fn generated_ts_package_names_keep_trellis_owned_contracts_canonical() {
        assert_eq!(
            ts_package_name_from_id("trellis.core@v1", "@example/"),
            "@qlever-llc/trellis/sdk/core",
        );
    }

    #[test]
    fn trellis_package_version_comes_from_bundled_package_metadata() {
        assert_ne!(trellis_package_version(), "0.0.0");
    }

    #[test]
    fn npm_tsconfig_uses_node_esm_declaration_output() {
        let tsconfig = render_npm_tsconfig(std::path::Path::new("/tmp/npm-out"));

        assert!(tsconfig.contains("\"module\": \"NodeNext\""));
        assert!(tsconfig.contains("\"declaration\": true"));
        assert!(tsconfig.contains("/tmp/npm-out/esm"));
        assert!(!tsconfig.contains("deno"));
        assert!(!tsconfig.contains("dnt"));
    }

    #[test]
    fn npm_source_rewrite_changes_local_ts_specifiers_to_js() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let manifest = temp.path().join("contract.json");
        fs::write(
            &manifest,
            r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.app@v1",
  "displayName": "App",
  "description": "App",
  "kind": "app",
  "uses": {
    "required": {
      "dep": { "contract": "trellis.dep@v1", "rpc": { "call": ["Dep.Get"] } }
    }
  }
}
"#,
        )
        .expect("write manifest");
        let loaded = trellis_contracts::load_manifest(&manifest).expect("load manifest");
        let source = "export * from \"./types.ts\";\nimport type { Api } from '../dep/api.ts';\nimport { sdk } from '@qlever-llc/trellis';\n";
        let rewritten = rewrite_npm_ts_imports(source, &loaded);

        assert!(rewritten.contains("./types.js"));
        assert!(rewritten.contains("@trellis-sdk/trellis-dep"));
        assert!(rewritten.contains("@qlever-llc/trellis"));
        assert!(!rewritten.contains(".ts\""));
        assert!(!rewritten.contains(".ts'"));
    }

    #[test]
    fn contract_shell_outputs_create_permissive_typescript_sdk() {
        let temp = tempfile::tempdir().expect("create tempdir");
        let manifest = temp
            .path()
            .join("generated/contracts/manifests/demo@v1.json");
        let metadata = generated_artifacts_metadata_path(&manifest);
        fs::create_dir_all(metadata.parent().expect("metadata parent"))
            .expect("create metadata dir");
        fs::write(&metadata, "{}\n").expect("write stale metadata");
        let ts_out = temp.path().join("generated/packages/jsr/demo");

        write_contract_shell_outputs(
            "demo@v1",
            "0.0.0-shell",
            Some(&manifest),
            Some(&ts_out),
            None,
            None,
            "@trellis-sdk/demo",
            "trellis_sdk_demo",
            RuntimeSource::Registry,
            None,
        )
        .expect("write shell outputs");

        let contract = fs::read_to_string(ts_out.join("contract.ts")).expect("read contract shell");
        let api = fs::read_to_string(ts_out.join("api.ts")).expect("read api shell");
        let owned_api =
            fs::read_to_string(ts_out.join("owned_api.ts")).expect("read owned api shell");
        assert!(contract.contains("export const sdk"));
        assert!(contract.contains("ContractDependencyUse"));
        assert!(contract.contains("permissiveApiRecord"));
        assert!(contract.contains("getOwnPropertyDescriptor"));
        assert!(api.contains("permissiveApiRecord"));
        assert!(api.contains("getOwnPropertyDescriptor"));
        assert!(owned_api.contains("export const OWNED_API"));
        assert!(owned_api.contains("permissiveApiRecord"));
        assert!(!contract.contains("assertSelectedKeysExist"));
        assert!(!metadata.exists());
    }

    #[test]
    fn contract_shell_outputs_create_rust_sdk_crate_shell() {
        let temp = tempfile::tempdir().expect("create tempdir");
        let rust_out = temp.path().join("generated/packages/cargo/demo");

        write_contract_shell_outputs(
            "demo@v1",
            "0.0.0-shell",
            None,
            None,
            None,
            Some(&rust_out),
            "@trellis-sdk/demo",
            "trellis_sdk_demo",
            RuntimeSource::Registry,
            None,
        )
        .expect("write shell outputs");

        let cargo = fs::read_to_string(rust_out.join("Cargo.toml")).expect("read cargo shell");
        let lib = fs::read_to_string(rust_out.join("src/lib.rs")).expect("read lib shell");
        assert!(cargo.contains("name = \"trellis_sdk_demo\""));
        assert!(cargo.contains("trellis-contracts"));
        assert!(lib.contains("pub const CONTRACT_ID: &str = \"demo@v1\""));
    }
}

pub fn ts_runtime_deps(
    source: RuntimeSource,
    version: String,
    repo_root: Option<PathBuf>,
) -> TsRuntimeDeps {
    TsRuntimeDeps {
        source: match source {
            RuntimeSource::Registry => CodegenTsRuntimeSource::Registry,
            RuntimeSource::Local => CodegenTsRuntimeSource::Local,
        },
        version,
        repo_root,
    }
}
