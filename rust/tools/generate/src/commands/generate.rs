use std::fs;

use miette::IntoDiagnostic;

use crate::artifacts::{
    build_npm_package_from_jsr, current_generator_fingerprint, default_rust_crate_name_from_id,
    generated_artifacts_are_fresh, generated_artifacts_metadata, infer_artifact_version,
    resolve_contract, rust_runtime_deps, stage_jsr_package_for_npm, trellis_package_version,
    ts_package_name_from_id, ts_runtime_deps, write_contract_outputs,
};
use crate::cli::{
    GenerateAllArgs, GenerateCargoPackageArgs, GenerateJsrPackageArgs, GenerateManifestArgs,
    GenerateNpmPackageArgs,
};
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

pub fn jsr_package(args: &GenerateJsrPackageArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| ts_package_name_from_id(&resolved.loaded.manifest.id, &args.prefix));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate a JSR package",
    )?;
    trellis_codegen_ts::generate_ts_sdk(&GenerateTsSdkOpts {
        manifest_path: resolved.manifest_path.clone(),
        out_dir: args.out.clone(),
        package_name,
        package_version: artifact_version.clone(),
        runtime_deps: ts_runtime_deps(
            args.runtime_source,
            trellis_package_version(),
            args.runtime_repo_root.clone(),
        ),
    })
    .into_diagnostic()?;
    output::print_success(&format!("generated JSR package at {}", args.out.display()));
    Ok(())
}

pub fn npm_package(args: &GenerateNpmPackageArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let package_name = args
        .package_name
        .clone()
        .unwrap_or_else(|| ts_package_name_from_id(&resolved.loaded.manifest.id, &args.prefix));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate an npm package",
    )?;
    let staging = tempfile::tempdir().into_diagnostic()?;
    let jsr_out = stage_jsr_package_for_npm(
        &resolved.loaded.manifest.id,
        &resolved.manifest_path,
        staging.path(),
        &package_name,
        &artifact_version,
    )?;
    build_npm_package_from_jsr(
        &jsr_out,
        &args.out,
        &package_name,
        &artifact_version,
        &trellis_package_version(),
        &resolved.loaded.manifest.id,
    )?;
    output::print_success(&format!("generated npm package at {}", args.out.display()));
    Ok(())
}

pub fn cargo_package(args: &GenerateCargoPackageArgs) -> miette::Result<()> {
    let resolved = resolve_contract(&args.contract)?;
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let artifact_version = infer_artifact_version(
        &resolved,
        args.artifact_version.clone(),
        "generate a Cargo package",
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
    output::print_success(&format!(
        "generated Cargo package at {}",
        args.out.display()
    ));
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
        .unwrap_or_else(|| ts_package_name_from_id(&resolved.loaded.manifest.id, &args.prefix));
    let crate_name = args
        .crate_name
        .clone()
        .unwrap_or_else(|| default_rust_crate_name_from_id(&resolved.loaded.manifest.id));
    let generator_fingerprint = current_generator_fingerprint();
    let metadata = generated_artifacts_metadata(
        &resolved,
        &artifact_version,
        args.runtime_source,
        &trellis_package_version(),
        args.jsr_out.is_some(),
        args.npm_out.is_some(),
        args.cargo_out.is_some(),
        &package_name,
        &crate_name,
        generator_fingerprint,
    );
    if !force
        && generated_artifacts_are_fresh(
            &metadata,
            &args.out_manifest,
            args.jsr_out.as_deref(),
            args.npm_out.as_deref(),
            args.cargo_out.as_deref(),
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
        args.jsr_out.as_deref(),
        args.npm_out.as_deref(),
        args.cargo_out.as_deref(),
        &package_name,
        &crate_name,
        args.runtime_source,
        args.runtime_repo_root.clone(),
        generator_fingerprint,
        "generated contract artifacts",
    )
}
