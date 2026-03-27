//! TypeScript SDK generation from canonical Trellis contract manifests.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use trellis_contracts::{load_manifest, LoadedManifest};

/// Errors returned while generating a TypeScript SDK package.
#[derive(thiserror::Error, Debug)]
pub enum CodegenTsError {
    #[error("contracts error: {0}")]
    Contracts(#[from] trellis_contracts::ContractsError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("missing manifest path file name")]
    MissingManifestFileName,

    #[error("missing runtime repo root for local runtime source")]
    MissingRuntimeRepoRoot,

    #[error("could not find a Deno config under runtime repo root")]
    MissingRuntimeConfig,
}

/// Options for generating one TypeScript SDK package.
#[derive(Debug, Clone)]
pub struct GenerateTsSdkOpts {
    pub manifest_path: PathBuf,
    pub out_dir: PathBuf,
    pub package_name: String,
    pub package_version: String,
    pub runtime_deps: TsRuntimeDeps,
}

/// Runtime dependency configuration for generated TypeScript SDKs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TsRuntimeDeps {
    pub source: TsRuntimeSource,
    pub version: String,
    pub repo_root: Option<PathBuf>,
}

/// Where generated SDKs should resolve Trellis runtime packages from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsRuntimeSource {
    Registry,
    Local,
}

/// Generate a TypeScript SDK package for one manifest.
pub fn generate_ts_sdk(opts: &GenerateTsSdkOpts) -> Result<(), CodegenTsError> {
    let loaded = load_manifest(&opts.manifest_path)?;
    fs::create_dir_all(&opts.out_dir)?;

    write_if_changed(
        &opts.out_dir.join("deno.json"),
        &format!("{}\n", serde_json::to_string_pretty(&deno_json(opts)?)?),
    )?;
    write_if_changed(
        &opts.out_dir.join("contract.ts"),
        &render_contract_ts(opts, &loaded),
    )?;
    write_if_changed(
        &opts.out_dir.join("types.ts"),
        &render_types_ts(opts, &loaded),
    )?;
    write_if_changed(
        &opts.out_dir.join("schemas.ts"),
        &render_schemas_ts(opts, &loaded),
    )?;
    write_if_changed(&opts.out_dir.join("api.ts"), &render_api_ts(opts, &loaded))?;
    write_if_changed(&opts.out_dir.join("mod.ts"), &render_mod_ts(opts))?;

    fs::create_dir_all(opts.out_dir.join("scripts"))?;
    write_if_changed(
        &opts.out_dir.join("scripts").join("build_npm.ts"),
        &render_build_npm_ts(opts, &loaded),
    )?;
    write_if_changed(
        &opts.out_dir.join("README.md"),
        &render_readme(opts, &loaded),
    )?;

    Ok(())
}

fn deno_json(opts: &GenerateTsSdkOpts) -> Result<serde_json::Map<String, Value>, CodegenTsError> {
    let mut root = serde_json::Map::new();
    let extends = resolved_extends(opts)?;

    if let Some(extends) = &extends {
        root.insert("extends".to_string(), Value::String(extends.clone()));
    }
    root.insert("name".to_string(), Value::String(opts.package_name.clone()));
    root.insert(
        "version".to_string(),
        Value::String(opts.package_version.clone()),
    );
    root.insert(
        "exports".to_string(),
        serde_json::json!({
            ".": "./mod.ts",
            "./api": "./api.ts",
            "./types": "./types.ts",
            "./schemas": "./schemas.ts",
            "./contract": "./contract.ts"
        }),
    );
    root.insert(
        "tasks".to_string(),
        serde_json::json!({
            "build:npm": "deno run -A scripts/build_npm.ts"
        }),
    );
    if extends.is_none() {
        root.insert(
            "imports".to_string(),
            serde_json::json!({
                "@qlever-llc/trellis-contracts": format!("jsr:@qlever-llc/trellis-contracts@^{}", opts.runtime_deps.version)
            }),
        );
    }
    root.insert(
        "compilerOptions".to_string(),
        serde_json::json!({
            "strict": true,
            "verbatimModuleSyntax": true
        }),
    );

    Ok(root)
}

fn render_contract_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let module_export = sdk_module_export_name(&opts.package_name);
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    format!(
        "// Generated from {}\nimport type {{ SdkContractModule, TrellisContractV1, UseSpec }} from \"@qlever-llc/trellis-contracts\";\nimport {{ API }} from \"./api.ts\";\n\nconst CONTRACT_MODULE_METADATA = Symbol.for(\"@qlever-llc/trellis-contracts/contract-module\");\n\nexport const CONTRACT_ID = {} as const;\nexport const CONTRACT_DIGEST = {} as const;\nexport const CONTRACT = {} as TrellisContractV1;\n\nfunction assertSelectedKeysExist(\n  kind: \"rpc\" | \"events\" | \"subjects\",\n  keys: readonly string[] | undefined,\n  api: Record<string, unknown>,\n) {{\n  if (!keys) {{\n    return;\n  }}\n\n  for (const key of keys) {{\n    if (!Object.hasOwn(api, key)) {{\n      throw new Error(`Contract '${{CONTRACT_ID}}' does not expose ${{kind}} key '${{key}}'`);\n    }}\n  }}\n}}\n\nfunction assertValidUseSpec(spec: UseSpec<typeof API.owned>) {{\n  assertSelectedKeysExist(\"rpc\", spec.rpc?.call, API.owned.rpc);\n  assertSelectedKeysExist(\"events\", spec.events?.publish, API.owned.events);\n  assertSelectedKeysExist(\"events\", spec.events?.subscribe, API.owned.events);\n  assertSelectedKeysExist(\"subjects\", spec.subjects?.publish, API.owned.subjects);\n  assertSelectedKeysExist(\"subjects\", spec.subjects?.subscribe, API.owned.subjects);\n}}\n\nexport const {}: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {{\n  CONTRACT_ID,\n  CONTRACT_DIGEST,\n  CONTRACT,\n  API,\n  use: ((spec) => {{\n    assertValidUseSpec(spec);\n\n    const dependencyUse = {{\n      contract: CONTRACT_ID,\n      ...(spec.rpc?.call ? {{ rpc: {{ call: [...spec.rpc.call] }} }} : {{}}),\n      ...((spec.events?.publish || spec.events?.subscribe)\n        ? {{\n          events: {{\n            ...(spec.events.publish ? {{ publish: [...spec.events.publish] }} : {{}}),\n            ...(spec.events.subscribe ? {{ subscribe: [...spec.events.subscribe] }} : {{}}),\n          }},\n        }}\n        : {{}}),\n      ...((spec.subjects?.publish || spec.subjects?.subscribe)\n        ? {{\n          subjects: {{\n            ...(spec.subjects.publish ? {{ publish: [...spec.subjects.publish] }} : {{}}),\n            ...(spec.subjects.subscribe ? {{ subscribe: [...spec.subjects.subscribe] }} : {{}}),\n          }},\n        }}\n        : {{}}),\n    }};\n\n    Object.defineProperty(dependencyUse, CONTRACT_MODULE_METADATA, {{\n      value: {},\n      enumerable: false,\n    }});\n\n    return dependencyUse;\n  }}) as SdkContractModule<typeof CONTRACT_ID, typeof API.owned>[\"use\"],\n}};\n\nexport const use = {}.use;\n",
        escape_js_string(&source_reference),
        js_string(&loaded.manifest.id),
        js_string(&loaded.digest),
        loaded.canonical,
        module_export,
        module_export,
        module_export,
    )
}

fn render_types_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let mut lines = vec![
        format!("// Generated from {}", escape_js_string(&source_reference)),
        format!(
            "export const CONTRACT_ID = {} as const;",
            js_string(&loaded.manifest.id)
        ),
        format!(
            "export const CONTRACT_DIGEST = {} as const;",
            js_string(&loaded.digest)
        ),
        String::new(),
    ];

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        lines.push(format!(
            "export type {base}Input = {};",
            schema_to_ts(resolve_schema_ref(loaded, &rpc.input.schema))
        ));
        lines.push(format!(
            "export type {base}Output = {};",
            schema_to_ts(resolve_schema_ref(loaded, &rpc.output.schema))
        ));
        lines.push(String::new());
    }

    for (key, event) in &loaded.manifest.events {
        let base = key_to_pascal(key);
        lines.push(format!(
            "export type {base}Event = {};",
            schema_to_ts(resolve_schema_ref(loaded, &event.event.schema))
        ));
        lines.push(String::new());
    }

    for (key, subject) in &loaded.manifest.subjects {
        if let Some(message) = &subject.message {
            let base = key_to_pascal(key);
            lines.push(format!(
                "export type {base}Message = {};",
                schema_to_ts(resolve_schema_ref(loaded, &message.schema))
            ));
            lines.push(String::new());
        }
    }

    lines.push("export interface RpcMap {".to_string());
    for key in loaded.manifest.rpc.keys() {
        let base = key_to_pascal(key);
        lines.push(format!(
            "  {}: {{ input: {base}Input; output: {base}Output; }};",
            js_string(key)
        ));
    }
    lines.push("}".to_string());
    lines.push(String::new());

    lines.push("export interface EventMap {".to_string());
    for key in loaded.manifest.events.keys() {
        let base = key_to_pascal(key);
        lines.push(format!("  {}: {{ event: {base}Event; }};", js_string(key)));
    }
    lines.push("}".to_string());
    lines.push(String::new());

    lines.push("export interface SubjectMap {".to_string());
    for (key, subject) in &loaded.manifest.subjects {
        let message_type = if subject.message.is_some() {
            format!("{}Message", key_to_pascal(key))
        } else {
            "unknown".to_string()
        };
        lines.push(format!(
            "  {}: {{ message: {message_type}; }};",
            js_string(key)
        ));
    }
    lines.push("}".to_string());
    lines.push(String::new());

    format!("{}\n", lines.join("\n"))
}

fn render_schemas_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let mut lines = vec![
        format!("// Generated from {}", escape_js_string(&source_reference)),
        "export const SCHEMAS = {".to_string(),
        "  schemas: {".to_string(),
    ];
    for (key, schema) in &loaded.manifest.schemas {
        lines.push(format!(
            "    {}: {} as const,",
            js_string(key),
            serde_json::to_string(schema).unwrap()
        ));
    }
    lines.extend(["  },".to_string(), "  rpc: {".to_string()]);
    for (key, rpc) in &loaded.manifest.rpc {
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!(
            "      input: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &rpc.input.schema)).unwrap()
        ));
        lines.push(format!(
            "      output: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &rpc.output.schema)).unwrap()
        ));
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("  events: {".to_string());
    for (key, event) in &loaded.manifest.events {
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!(
            "      event: {} as const,",
            serde_json::to_string(resolve_schema_ref(loaded, &event.event.schema)).unwrap()
        ));
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("  subjects: {".to_string());
    for (key, subject) in &loaded.manifest.subjects {
        lines.push(format!("    {}: {{", js_string(key)));
        if let Some(message) = &subject.message {
            lines.push(format!(
                "      schema: {} as const,",
                serde_json::to_string(resolve_schema_ref(loaded, &message.schema)).unwrap()
            ));
        }
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("} as const;".to_string());
    lines.push(String::new());

    format!("{}\n", lines.join("\n"))
}

fn render_api_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let mut lines = vec![
        format!("// Generated from {}", escape_js_string(&source_reference)),
        "import type { TrellisAPI } from \"@qlever-llc/trellis-contracts\";".to_string(),
        "import { schema } from \"@qlever-llc/trellis-contracts\";".to_string(),
        "import * as Types from \"./types.ts\";".to_string(),
        "import { SCHEMAS } from \"./schemas.ts\";".to_string(),
        String::new(),
        "export const OWNED_API = {".to_string(),
        "  rpc: {".to_string(),
    ];

    for (key, rpc) in &loaded.manifest.rpc {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&rpc.subject)));
        lines.push(format!(
            "      input: schema<Types.{base}Input>(SCHEMAS.rpc[{}].input),",
            js_string(key)
        ));
        lines.push(format!(
            "      output: schema<Types.{base}Output>(SCHEMAS.rpc[{}].output),",
            js_string(key)
        ));
        let capabilities = rpc
            .capabilities
            .as_ref()
            .and_then(|caps| caps.call.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      callerCapabilities: {},",
            serde_json::to_string(&capabilities).unwrap()
        ));
        if let Some(errors) = &rpc.errors {
            if !errors.is_empty() {
                lines.push(format!(
                    "      errors: {} as const,",
                    serde_json::to_string(
                        &errors
                            .iter()
                            .map(|error| error.error_type.clone())
                            .collect::<Vec<_>>()
                    )
                    .unwrap()
                ));
            }
        }
        lines.push("    },".to_string());
    }

    lines.push("  },".to_string());
    lines.push("  events: {".to_string());
    for (key, event) in &loaded.manifest.events {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&event.subject)));
        if let Some(params) = &event.params {
            if !params.is_empty() {
                lines.push(format!(
                    "      params: {} as const,",
                    serde_json::to_string(params).unwrap()
                ));
            }
        }
        lines.push(format!(
            "      event: schema<Types.{base}Event>(SCHEMAS.events[{}].event),",
            js_string(key)
        ));
        let publish = event
            .capabilities
            .as_ref()
            .and_then(|caps| caps.publish.clone())
            .unwrap_or_default();
        let subscribe = event
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      publishCapabilities: {},",
            serde_json::to_string(&publish).unwrap()
        ));
        lines.push(format!(
            "      subscribeCapabilities: {},",
            serde_json::to_string(&subscribe).unwrap()
        ));
        lines.push("    },".to_string());
    }

    lines.push("  },".to_string());
    lines.push("  subjects: {".to_string());
    for (key, subject) in &loaded.manifest.subjects {
        let base = key_to_pascal(key);
        lines.push(format!("    {}: {{", js_string(key)));
        lines.push(format!("      subject: {},", js_string(&subject.subject)));
        if subject.message.is_some() {
            lines.push(format!(
                "      schema: schema<Types.{base}Message>(SCHEMAS.subjects[{}].schema),",
                js_string(key)
            ));
        }
        let publish = subject
            .capabilities
            .as_ref()
            .and_then(|caps| caps.publish.clone())
            .unwrap_or_default();
        let subscribe = subject
            .capabilities
            .as_ref()
            .and_then(|caps| caps.subscribe.clone())
            .unwrap_or_default();
        lines.push(format!(
            "      publishCapabilities: {},",
            serde_json::to_string(&publish).unwrap()
        ));
        lines.push(format!(
            "      subscribeCapabilities: {},",
            serde_json::to_string(&subscribe).unwrap()
        ));
        lines.push("    },".to_string());
    }
    lines.push("  },".to_string());
    lines.push("} satisfies TrellisAPI;".to_string());
    lines.push(String::new());
    lines.push(
        "const EMPTY_API = { rpc: {}, events: {}, subjects: {} } as const satisfies TrellisAPI;"
            .to_string(),
    );
    lines.push(String::new());
    lines.push("export const API = {".to_string());
    lines.push("  owned: OWNED_API,".to_string());
    lines.push("  used: EMPTY_API,".to_string());
    lines.push("  trellis: OWNED_API,".to_string());
    lines.push("} as const;".to_string());
    lines.push(String::new());
    lines.push("export type OwnedApi = typeof API.owned;".to_string());
    lines.push("export type Api = typeof API.trellis;".to_string());
    lines.push("export type ApiViews = typeof API;".to_string());
    lines.push(String::new());

    format!("{}\n", lines.join("\n"))
}

fn render_build_npm_ts(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let source_reference =
        manifest_source_reference(&opts.manifest_path, opts.runtime_deps.repo_root.as_deref());
    let contracts_dependency = match opts.runtime_deps.source {
        TsRuntimeSource::Registry => format!("^{}", opts.runtime_deps.version),
        TsRuntimeSource::Local => opts
            .runtime_deps
            .repo_root
            .as_ref()
            .map(|repo_root| {
                format!(
                    "file:{}",
                    relative_path_string(
                        &opts.out_dir,
                        &repo_root.join("js/packages/contracts/npm")
                    )
                )
            })
            .unwrap_or_else(|| format!("^{}", opts.runtime_deps.version)),
    };
    let publish_contracts_dependency = format!("^{}", opts.runtime_deps.version);

    format!(
        "// Generated from {}\nimport {{ build, emptyDir }} from \"jsr:@deno/dnt@^0.41.3\";\n\nawait emptyDir(new URL(\"../npm\", import.meta.url));\n\nawait build({{\n  entryPoints: [\"./mod.ts\"],\n  outDir: \"./npm\",\n  shims: {{\n    deno: true,\n  }},\n  test: false,\n  typeCheck: false,\n  package: {{\n    name: {},\n    version: {},\n    description: \"Generated Trellis SDK for contract {}\",\n    license: \"Apache-2.0\",\n    homepage: \"https://github.com/Qlever-LLC/trellis#readme\",\n    bugs: {{\n      url: \"https://github.com/Qlever-LLC/trellis/issues\",\n    }},\n    repository: {{\n      type: \"git\",\n      url: \"https://github.com/Qlever-LLC/trellis\",\n    }},\n    publishConfig: {{\n      access: \"public\",\n    }},\n    dependencies: {{\n      \"@qlever-llc/trellis-contracts\": {},\n    }},\n  }},\n}});\n\nconst packageJsonPath = new URL(\"../npm/package.json\", import.meta.url);\nconst packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));\npackageJson.dependencies = {{\n  ...(packageJson.dependencies ?? {{}}),\n  \"@qlever-llc/trellis-contracts\": {},\n}};\nawait Deno.writeTextFile(packageJsonPath, `${{JSON.stringify(packageJson, null, 2)}}\n`);\n",
        escape_js_string(&source_reference),
        js_string(&opts.package_name),
        js_string(&opts.package_version),
        escape_js_string(&loaded.manifest.id),
        js_string(&contracts_dependency),
        js_string(&publish_contracts_dependency),
    )
}

fn resolved_extends(opts: &GenerateTsSdkOpts) -> Result<Option<String>, CodegenTsError> {
    match opts.runtime_deps.source {
        TsRuntimeSource::Registry => Ok(None),
        TsRuntimeSource::Local => {
            let repo_root = opts
                .runtime_deps
                .repo_root
                .as_ref()
                .ok_or(CodegenTsError::MissingRuntimeRepoRoot)?;
            let repo_root = repo_root.canonicalize()?;
            let runtime_config = runtime_config_path(&repo_root)?;
            let out_dir = opts
                .out_dir
                .canonicalize()
                .unwrap_or_else(|_| opts.out_dir.clone());
            Ok(Some(relative_path_string(&out_dir, &runtime_config)))
        }
    }
}

fn runtime_config_path(repo_root: &Path) -> Result<PathBuf, CodegenTsError> {
    let js_deno = repo_root.join("js/deno.json");
    if js_deno.exists() {
        return Ok(js_deno);
    }

    let root_deno = repo_root.join("deno.json");
    if root_deno.exists() {
        return Ok(root_deno);
    }

    Err(CodegenTsError::MissingRuntimeConfig)
}

fn relative_path_string(from_dir: &Path, to_path: &Path) -> String {
    let from_components = from_dir.components().collect::<Vec<_>>();
    let to_components = to_path.components().collect::<Vec<_>>();
    let common_len = from_components
        .iter()
        .zip(&to_components)
        .take_while(|(left, right)| left == right)
        .count();

    let mut relative = PathBuf::new();
    for _ in common_len..from_components.len() {
        relative.push("..");
    }
    for component in &to_components[common_len..] {
        relative.push(component.as_os_str());
    }
    normalize_relative_path_string(relative.to_string_lossy().replace('\\', "/"))
}

fn manifest_source_reference(manifest_path: &Path, repo_root: Option<&Path>) -> String {
    let manifest_path = manifest_path
        .canonicalize()
        .unwrap_or_else(|_| manifest_path.to_path_buf());

    if let Some(repo_root) = repo_root {
        let repo_root = repo_root
            .canonicalize()
            .unwrap_or_else(|_| repo_root.to_path_buf());
        if let Ok(relative) = manifest_path.strip_prefix(&repo_root) {
            return normalize_relative_path_string(relative.to_string_lossy().replace('\\', "/"));
        }
    }

    normalize_relative_path_string(manifest_path.to_string_lossy().replace('\\', "/"))
}

fn normalize_relative_path_string(path: String) -> String {
    if path.is_empty() || path.starts_with("../") || path.starts_with("./") || path.starts_with('/')
    {
        return path;
    }
    format!("./{path}")
}

fn render_readme(opts: &GenerateTsSdkOpts, loaded: &LoadedManifest) -> String {
    let module_export = sdk_module_export_name(&opts.package_name);
    let use_example = example_use_block(&module_export, loaded);
    format!(
        "# {}\n\nGenerated Trellis SDK for contract `{}`.\n\n## Usage\n\n```ts\nimport {{ defineContract }} from \"@qlever-llc/trellis\";\nimport {{ {} }} from \"{}\";\n\nconst app = defineContract({{\n  id: \"example.app@v1\",\n  displayName: \"Example App\",\n  description: \"User-facing app for the example deployment.\",\n  kind: \"app\",\n  uses: {{\n{}\n  }},\n}});\n\nconst client = app.createClient(nc, authSession);\n```\n\n## Contents\n\n- `{}`: generated contract module with `CONTRACT_ID`, `CONTRACT_DIGEST`, `CONTRACT`, `API`, and `use(...)`\n- `API`: nested contract API views with `API.owned`, `API.used`, and `API.trellis`\n- `types.ts`: TypeScript types derived from JSON Schemas\n- `schemas.ts`: Raw JSON Schemas (as `as const` objects)\n- `contract.ts`: embedded contract metadata and typed `use(...)` helper\n",
        opts.package_name, loaded.manifest.id, module_export, opts.package_name, use_example, module_export
    )
}

fn write_if_changed(path: &Path, contents: &str) -> Result<(), CodegenTsError> {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}

fn js_string(value: &str) -> String {
    serde_json::to_string(value).expect("js string")
}

fn escape_js_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace('$', "\\$")
}

fn resolve_schema_ref<'a>(loaded: &'a LoadedManifest, schema_name: &str) -> &'a Value {
    loaded
        .manifest
        .schemas
        .get(schema_name)
        .unwrap_or_else(|| panic!("missing schema '{schema_name}' in manifest"))
}

#[cfg(test)]
mod path_tests {
    use super::{manifest_source_reference, relative_path_string};
    use std::path::Path;

    #[test]
    fn manifest_source_reference_uses_repo_relative_path() {
        assert_eq!(
            manifest_source_reference(
                Path::new("/repo/generated/contracts/manifests/trellis.core@v1.json"),
                Some(Path::new("/repo")),
            ),
            "./generated/contracts/manifests/trellis.core@v1.json"
        );
    }

    #[test]
    fn relative_path_string_is_normalized_without_dot_segments() {
        assert_eq!(
            relative_path_string(
                Path::new("/repo/generated/js/sdks/trellis-core"),
                Path::new("/repo/js/packages/contracts/npm"),
            ),
            "../../../../js/packages/contracts/npm"
        );
    }
}

fn key_to_pascal(value: &str) -> String {
    value
        .split('.')
        .map(to_pascal_case_token)
        .collect::<Vec<_>>()
        .join("")
}

fn sdk_module_export_name(package_name: &str) -> String {
    let trimmed = package_name
        .strip_prefix("@qlever-llc/trellis-sdk-")
        .unwrap_or(package_name);
    kebab_to_camel(trimmed)
}

fn kebab_to_camel(value: &str) -> String {
    let mut out = String::new();
    let mut uppercase_next = false;

    for ch in value.chars() {
        if ch == '-' {
            uppercase_next = true;
            continue;
        }

        if out.is_empty() {
            out.push(ch.to_ascii_lowercase());
            uppercase_next = false;
            continue;
        }

        if uppercase_next {
            out.push(ch.to_ascii_uppercase());
            uppercase_next = false;
        } else {
            out.push(ch);
        }
    }

    out
}

fn example_use_block(module_export: &str, loaded: &LoadedManifest) -> String {
    if let Some(key) = loaded.manifest.rpc.keys().next() {
        return format!(
            "    dependency: {}.use({{\n      rpc: {{ call: [{}] }},\n    }}),",
            module_export,
            js_string(key),
        );
    }

    if let Some(key) = loaded.manifest.events.keys().next() {
        return format!(
            "    dependency: {}.use({{\n      events: {{ subscribe: [{}] }},\n    }}),",
            module_export,
            js_string(key),
        );
    }

    if let Some(key) = loaded.manifest.subjects.keys().next() {
        return format!(
            "    dependency: {}.use({{\n      subjects: {{ subscribe: [{}] }},\n    }}),",
            module_export,
            js_string(key),
        );
    }

    format!("    dependency: {}.use({{}}),", module_export)
}

fn to_pascal_case_token(value: &str) -> String {
    value
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<String>()
}

fn schema_to_ts(schema: &Value) -> String {
    match schema {
        Value::Bool(true) => "unknown".to_string(),
        Value::Bool(false) => "never".to_string(),
        Value::Object(object) => {
            if let Some(value) = object.get("const") {
                return serde_json::to_string(value).unwrap_or_else(|_| "unknown".to_string());
            }

            if let Some(Value::Array(values)) = object.get("enum") {
                if !values.is_empty() {
                    return values
                        .iter()
                        .map(|value| {
                            serde_json::to_string(value).unwrap_or_else(|_| "unknown".to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(" | ");
                }
            }

            for (key, operator) in [("allOf", "&"), ("oneOf", "|"), ("anyOf", "|")] {
                if let Some(Value::Array(values)) = object.get(key) {
                    if !values.is_empty() {
                        return format!(
                            "({})",
                            values
                                .iter()
                                .map(schema_to_ts)
                                .collect::<Vec<_>>()
                                .join(&format!(" {operator} "))
                        );
                    }
                }
            }

            if let Some(Value::Array(types)) = object.get("type") {
                if !types.is_empty() {
                    return format!(
                        "({})",
                        types
                            .iter()
                            .map(|value| match value {
                                Value::String(type_name) => {
                                    let mut clone = object.clone();
                                    clone.insert(
                                        "type".to_string(),
                                        Value::String(type_name.clone()),
                                    );
                                    schema_to_ts(&Value::Object(clone))
                                }
                                _ => "unknown".to_string(),
                            })
                            .collect::<Vec<_>>()
                            .join(" | ")
                    );
                }
            }

            match object.get("type").and_then(Value::as_str) {
                Some("string") => "string".to_string(),
                Some("number") | Some("integer") => "number".to_string(),
                Some("boolean") => "boolean".to_string(),
                Some("null") => "null".to_string(),
                Some("array") => render_array_ts(object),
                Some("object") => render_object_ts(object),
                _ => {
                    if object.contains_key("properties") {
                        render_object_ts(object)
                    } else {
                        "unknown".to_string()
                    }
                }
            }
        }
        Value::Null | Value::Number(_) | Value::String(_) | Value::Array(_) => {
            "unknown".to_string()
        }
    }
}

fn render_array_ts(object: &serde_json::Map<String, Value>) -> String {
    match object.get("items") {
        Some(Value::Array(values)) => format!(
            "[{}]",
            values
                .iter()
                .map(schema_to_ts)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Some(value) => format!("Array<{}>", schema_to_ts(value)),
        None => "unknown[]".to_string(),
    }
}

fn render_object_ts(object: &serde_json::Map<String, Value>) -> String {
    let required = object
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut lines = Vec::new();
    if let Some(Value::Object(properties)) = object.get("properties") {
        for (key, value) in properties {
            let optional = if required.iter().any(|required_key| required_key == key) {
                ""
            } else {
                "?"
            };
            let safe_key = if is_safe_js_ident(key) {
                key.clone()
            } else {
                js_string(key)
            };
            lines.push(format!("{safe_key}{optional}: {};", schema_to_ts(value)));
        }
    }

    match object.get("additionalProperties") {
        Some(Value::Bool(true)) => lines.push("[k: string]: unknown;".to_string()),
        Some(value @ Value::Object(_)) => {
            lines.push(format!("[k: string]: {};", schema_to_ts(value)));
        }
        _ => {}
    }

    format!("{{ {} }}", lines.join(" "))
}

fn is_safe_js_ident(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first == '_' || first == '$' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn render_mod_ts(opts: &GenerateTsSdkOpts) -> String {
    let module_export = sdk_module_export_name(&opts.package_name);
    format!(
        "export {{ API, OWNED_API }} from \"./api.ts\";\nexport type {{ Api, ApiViews, OwnedApi }} from \"./api.ts\";\nexport * from \"./types.ts\";\nexport {{ SCHEMAS }} from \"./schemas.ts\";\nexport {{ CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, {} }} from \"./contract.ts\";\n",
        module_export,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("trellis-codegen-ts-{label}-{nanos}"))
    }

    fn sample_opts_and_loaded(
        package_name: &str,
        contract_id: &str,
    ) -> (GenerateTsSdkOpts, LoadedManifest, PathBuf) {
        let root = unique_temp_dir("manifest");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = root.join("contract.json");
        fs::write(
            &manifest_path,
            serde_json::to_string(&json!({
                "format": "trellis.contract.v1",
                "id": contract_id,
                "displayName": "Example Contract",
                "description": "Example contract for SDK generation tests.",
                "kind": "service",
                "schemas": {
                    "PingInput": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": false
                    },
                    "PingOutput": {
                        "type": "object",
                        "properties": {
                            "ok": { "type": "boolean" }
                        },
                        "required": ["ok"],
                        "additionalProperties": false
                    }
                },
                "rpc": {
                    "Example.Ping": {
                        "version": "v1",
                        "subject": "rpc.v1.Example.Ping",
                        "input": { "schema": "PingInput" },
                        "output": { "schema": "PingOutput" }
                    }
                },
                "events": {},
                "subjects": {}
            }))
            .unwrap(),
        )
        .unwrap();

        let opts = GenerateTsSdkOpts {
            manifest_path: manifest_path.clone(),
            out_dir: root.join("out"),
            package_name: package_name.to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.4.0".to_string(),
                repo_root: None,
            },
        };
        let loaded = load_manifest(&manifest_path).unwrap();
        (opts, loaded, root)
    }

    #[test]
    fn registry_mode_emits_jsr_imports() {
        let deno = deno_json(&GenerateTsSdkOpts {
            manifest_path: PathBuf::from("generated/contracts/manifests/trellis.core@v1.json"),
            out_dir: PathBuf::from("generated/js/sdks/trellis-core"),
            package_name: "@qlever-llc/trellis-sdk-core".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Registry,
                version: "0.2.3".to_string(),
                repo_root: None,
            },
        })
        .unwrap();

        let imports = deno.get("imports").and_then(Value::as_object).unwrap();
        assert_eq!(
            imports.get("@qlever-llc/trellis-contracts").unwrap(),
            "jsr:@qlever-llc/trellis-contracts@^0.2.3"
        );
        assert!(deno.get("extends").is_none());
    }

    #[test]
    fn local_mode_derives_extends_from_repo_root() {
        let repo_root = unique_temp_dir("repo-root");
        let out_dir = repo_root.join("generated/js/sdks/auth");
        fs::create_dir_all(repo_root.join("js")).unwrap();
        fs::create_dir_all(&out_dir).unwrap();
        fs::write(repo_root.join("js/deno.json"), "{}\n").unwrap();

        let deno = deno_json(&GenerateTsSdkOpts {
            manifest_path: repo_root.join("generated/contracts/manifests/trellis.auth@v1.json"),
            out_dir: out_dir.clone(),
            package_name: "@qlever-llc/trellis-sdk-auth".to_string(),
            package_version: "0.4.0".to_string(),
            runtime_deps: TsRuntimeDeps {
                source: TsRuntimeSource::Local,
                version: "0.4.0".to_string(),
                repo_root: Some(repo_root.clone()),
            },
        })
        .unwrap();

        assert_eq!(
            deno.get("extends").and_then(Value::as_str),
            Some("../../../../js/deno.json")
        );
        assert!(deno.get("imports").is_none());

        fs::remove_dir_all(repo_root).unwrap();
    }

    #[test]
    fn generated_api_uses_contract_api_views_shape() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-auth", "trellis.auth@v1");
        let api = render_api_ts(&opts, &loaded);

        assert!(api.contains("export const OWNED_API = {"));
        assert!(api.contains("export const API = {"));
        assert!(api.contains("owned: OWNED_API"));
        assert!(api.contains("used: EMPTY_API"));
        assert!(api.contains("trellis: OWNED_API"));
        assert!(api.contains("export type Api = typeof API.trellis;"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_contract_emits_named_module_and_typed_use_helper() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-core", "trellis.core@v1");
        let contract = render_contract_ts(&opts, &loaded);
        let mod_ts = render_mod_ts(&opts);

        assert!(contract.contains(
            "import type { SdkContractModule, TrellisContractV1, UseSpec } from \"@qlever-llc/trellis-contracts\";"
        ));
        assert!(contract.contains(
            "export const core: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {"
        ));
        assert!(contract.contains("export const use = core.use;"));
        assert!(contract.contains("does not expose ${kind} key '${key}'"));
        assert!(mod_ts.contains(
            "export { CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use, core } from \"./contract.ts\";"
        ));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generated_readme_uses_contract_first_example() {
        let (opts, loaded, root) =
            sample_opts_and_loaded("@qlever-llc/trellis-sdk-activity", "trellis.activity@v1");
        let readme = render_readme(&opts, &loaded);

        assert!(readme.contains("import { defineContract } from \"@qlever-llc/trellis\";"));
        assert!(readme.contains("import { activity } from \"@qlever-llc/trellis-sdk-activity\";"));
        assert!(readme.contains("displayName: \"Example App\""));
        assert!(readme.contains("description: \"User-facing app for the example deployment.\""));
        assert!(readme.contains("kind: \"app\""));
        assert!(readme.contains("dependency: activity.use({"));
        assert!(readme.contains("const client = app.createClient(nc, authSession);"));
        assert!(!readme.contains("mergeApis"));
        assert!(!readme.contains("createClient(nc, auth, [api] as const)"));

        fs::remove_dir_all(root).unwrap();
    }
}
