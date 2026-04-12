use std::fs;

use miette::IntoDiagnostic;

use crate::artifacts::{
    current_generator_fingerprint, default_rust_crate_name_from_id,
    default_ts_package_name_from_id, generated_artifacts_are_fresh, generated_artifacts_metadata,
    infer_artifact_version, resolve_contract, rust_runtime_deps, ts_runtime_deps,
    write_contract_outputs,
};
use crate::cli::{GenerateAllArgs, GenerateManifestArgs, GenerateRustSdkArgs, GenerateTsSdkArgs};
use crate::output;
use trellis_codegen_rust::GenerateRustSdkOpts;
use trellis_codegen_ts::GenerateTsSdkOpts;

pub fn manifest(args: &GenerateManifestArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    if let Some(parent) = args.out.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    fs::write(&args.out, format!("{}\n", resolved.loaded.canonical)).into_diagnostic()?;
    output::print_success(&format!(
        "generated canonical manifest for {}",
        resolved.loaded.manifest.id
    ));
    output::print_detail("manifest", args.out.display().to_string());
    output::print_detail("digest", &resolved.loaded.digest);
    Ok(())
}

pub fn ts_sdk(args: &GenerateTsSdkArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate a TypeScript SDK",
    )?;
    trellis_codegen_ts::generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        package_name,
        package_version: artifact_version.clone(),
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            artifact_version,
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success(&format!(
        "generated TypeScript SDK at {}",
        args.out.display()
    ));
    Ok(())
}

pub fn rust_sdk(args: &GenerateRustSdkArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate a Rust SDK",
    )?;
    trellis_codegen_rust::generate_rust_sdk(&GenerateRustSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        crate_name,
        crate_version: artifact_version.clone(),
        runtime_deps: rust_runtime_deps(
            args.runtime_source,
            artifact_version,
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success(&format!("generated Rust SDK at {}", args.out.display()));
    Ok(())
}

pub fn all(args: &GenerateAllArgs, force: bool) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate all artifacts",
    )?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| default_ts_package_name_from_id(&resolved.loaded.manifest.id));
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let generator_fingerprint = current_generator_fingerprint();
    let metadata = generated_artifacts_metadata(
        &resolved,
        &artifact_version,
        args.runtime_source,
        args.ts_out.is_some(),
        args.rust_out.is_some(),
        &package_name,
        &crate_name,
        generator_fingerprint,
    );
    if !force
        && generated_artifacts_are_fresh(
            &metadata,
            &args.out_manifest,
            args.ts_out.as_deref(),
            args.rust_out.as_deref(),
        )
    {
        output::print_success(&format!(
            "artifacts already up to date for {}",
            resolved.loaded.manifest.id
        ));
        return Ok(());
    }
    write_contract_outputs(
        &resolved,
        artifact_version,
        &args.out_manifest,
        args.ts_out.as_deref(),
        args.rust_out.as_deref(),
        &package_name,
        &crate_name,
        args.runtime_source,
        args.runtime_repo_root.clone(),
        generator_fingerprint,
        "generated contract artifacts",
    )
}
