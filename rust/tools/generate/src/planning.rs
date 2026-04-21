use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use trellis_contracts::ContractKind;

use crate::artifacts::{
    current_generator_fingerprint, default_rust_crate_name_from_id,
    default_ts_package_name_from_id, detect_output_root, detect_runtime_source,
    generated_artifacts_are_fresh, generated_artifacts_metadata, required_owner_version,
    sdk_output_stem, write_contract_outputs,
};
use crate::cli::RuntimeSource;
use crate::contract_input;
use crate::discovery::{discover_contract_metadata, DiscoveredContractSource};
use crate::output;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoAction {
    Generate,
    Verify,
}

#[derive(Debug)]
pub struct AutoPlanEntry {
    pub discovered: DiscoveredContractSource,
    pub contract_id: String,
    pub contract_kind: ContractKind,
    pub action: AutoAction,
    pub out_manifest: Option<PathBuf>,
    pub ts_out: Option<PathBuf>,
    pub rust_out: Option<PathBuf>,
    pub runtime_source: RuntimeSource,
    pub runtime_repo_root: Option<PathBuf>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AutoExecutionSummary {
    pub generated: usize,
    pub verified: usize,
    pub skipped: usize,
}

pub fn build_auto_plan(
    discovered: Vec<DiscoveredContractSource>,
    shared_output_root: Option<&Path>,
) -> miette::Result<Vec<AutoPlanEntry>> {
    let mut plan = Vec::new();
    for contract in discovered {
        let (contract_id, contract_kind) = discover_contract_metadata(&contract)?;
        let action = action_for_kind(&contract_kind);
        let output_root = shared_output_root
            .map(Path::to_path_buf)
            .unwrap_or_else(|| detect_output_root(&contract.project_root));
        let runtime_repo_root = detect_runtime_repo_root(&output_root);
        let runtime_source = if runtime_repo_root.is_some() {
            RuntimeSource::Local
        } else {
            RuntimeSource::Registry
        };
        let (out_manifest, ts_out, rust_out) = match action {
            AutoAction::Generate => {
                let sdk_stem = sdk_output_stem(&contract_id);
                let ts_sdk_root = resolve_typescript_sdk_root(
                    &output_root,
                    &contract.project_root,
                    runtime_repo_root.as_deref(),
                );
                (
                    Some(
                        output_root
                            .join("generated/contracts/manifests")
                            .join(format!("{}.json", &contract_id)),
                    ),
                    Some(ts_sdk_root.join(&sdk_stem)),
                    Some(output_root.join("generated/rust/sdks").join(&sdk_stem)),
                )
            }
            AutoAction::Verify => (None, None, None),
        };
        plan.push(AutoPlanEntry {
            discovered: contract,
            contract_id,
            contract_kind,
            action,
            out_manifest,
            ts_out,
            rust_out,
            runtime_source,
            runtime_repo_root,
        });
    }
    plan.sort_by(|left, right| {
        auto_action_rank(left.action)
            .cmp(&auto_action_rank(right.action))
            .then_with(|| {
                left.discovered
                    .source_path
                    .cmp(&right.discovered.source_path)
            })
    });
    Ok(plan)
}

fn resolve_typescript_sdk_root(
    output_root: &Path,
    project_root: &Path,
    runtime_repo_root: Option<&Path>,
) -> PathBuf {
    if runtime_repo_root == Some(output_root) {
        return output_root.join("generated/js/sdks");
    }

    find_nested_workspace_root(project_root, output_root)
        .map(|workspace_root| workspace_root.join("generated/js/sdks"))
        .unwrap_or_else(|| output_root.join("generated/js/sdks"))
}

fn detect_runtime_repo_root(output_root: &Path) -> Option<PathBuf> {
    if matches!(detect_runtime_source(output_root), RuntimeSource::Local) {
        return Some(output_root.to_path_buf());
    }

    let mut current = output_root.parent();
    while let Some(dir) = current {
        if matches!(detect_runtime_source(dir), RuntimeSource::Local) {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

fn find_nested_workspace_root(project_root: &Path, output_root: &Path) -> Option<PathBuf> {
    let mut current = Some(project_root);
    while let Some(dir) = current {
        if !dir.starts_with(output_root) {
            break;
        }
        if dir != output_root && has_workspace_manifest(dir) {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

fn has_workspace_manifest(dir: &Path) -> bool {
    ["deno.json", "deno.jsonc", "package.json"]
        .into_iter()
        .any(|name| manifest_declares_workspace(&dir.join(name)))
}

fn manifest_declares_workspace(path: &Path) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&contents) else {
        return false;
    };

    value
        .get("workspace")
        .map(Value::is_array)
        .unwrap_or(false)
        || value
            .get("workspaces")
            .map(|workspaces| workspaces.is_array() || workspaces.is_object())
            .unwrap_or(false)
}

pub fn execute_auto_plan(
    plan: &[AutoPlanEntry],
    title: Option<&str>,
    show_title: bool,
    force: bool,
) -> miette::Result<AutoExecutionSummary> {
    if show_title {
        output::print_section("Run");
    } else if let Some(title) = title {
        output::print_title(title);
    }

    let generator_fingerprint = current_generator_fingerprint();
    let mut summary = AutoExecutionSummary::default();
    for entry in plan {
        let resolved = contract_input::resolve_contract_input(
            None,
            Some(entry.discovered.source_path.as_path()),
            None,
            "CONTRACT",
            contract_input::default_image_contract_path(),
        )?;
        match entry.action {
            AutoAction::Generate => {
                let artifact_version = required_owner_version(
                    &resolved,
                    "generate service artifacts from local discovery",
                )?;
                let package_name = default_ts_package_name_from_id(&resolved.loaded.manifest.id);
                let crate_name = default_rust_crate_name_from_id(&resolved.loaded.manifest.id);
                let out_manifest = entry.out_manifest.as_ref().ok_or_else(|| {
                    miette::miette!("missing manifest output for generated contract")
                })?;
                let metadata = generated_artifacts_metadata(
                    &resolved,
                    &artifact_version,
                    entry.runtime_source,
                    entry.ts_out.is_some(),
                    entry.rust_out.is_some(),
                    &package_name,
                    &crate_name,
                    generator_fingerprint,
                );
                if !force
                    && generated_artifacts_are_fresh(
                        &metadata,
                        out_manifest,
                        entry.ts_out.as_deref(),
                        entry.rust_out.as_deref(),
                    )
                {
                    output::print_success(&format!(
                        "artifacts already up to date for {}",
                        resolved.loaded.manifest.id
                    ));
                    summary.skipped += 1;
                    continue;
                }
                print_auto_entry(entry);
                write_contract_outputs(
                    &resolved,
                    artifact_version,
                    out_manifest,
                    entry.ts_out.as_deref(),
                    entry.rust_out.as_deref(),
                    &package_name,
                    &crate_name,
                    entry.runtime_source,
                    entry.runtime_repo_root.clone(),
                    generator_fingerprint,
                    "generated contract artifacts",
                )?;
                summary.generated += 1;
            }
            AutoAction::Verify => {
                if show_title {
                    print_auto_entry(entry);
                }
                output::print_success(&format!("verified {}", resolved.loaded.manifest.id));
                summary.verified += 1;
            }
        }
    }
    Ok(summary)
}

pub fn discover_summary_lines(plan: &[AutoPlanEntry]) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current_project_root: Option<&Path> = None;
    for entry in plan {
        let project_root = entry.discovered.project_root.as_path();
        if current_project_root != Some(project_root) {
            current_project_root = Some(project_root);
            lines.push(project_root.display().to_string());
        }
        lines.push(format!(
            "  {}  {}  {}",
            entry.contract_id,
            contract_kind_label(&entry.contract_kind),
            action_label(entry.action)
        ));
    }
    lines
}

pub fn action_for_kind(kind: &ContractKind) -> AutoAction {
    match kind {
        ContractKind::Service => AutoAction::Generate,
        ContractKind::App | ContractKind::Portal | ContractKind::Device | ContractKind::Agent => {
            AutoAction::Verify
        }
    }
}

pub fn contract_kind_label(kind: &ContractKind) -> &'static str {
    match kind {
        ContractKind::Service => "service",
        ContractKind::App => "app",
        ContractKind::Portal => "portal",
        ContractKind::Device => "device",
        ContractKind::Agent => "agent",
    }
}

fn print_auto_entry(entry: &AutoPlanEntry) {
    output::print_section(&format!(
        "{} {}",
        action_label(entry.action),
        entry.contract_id
    ));
    output::print_detail("kind", contract_kind_label(&entry.contract_kind));
    output::print_detail("source", entry.discovered.source_path.display().to_string());
    if let Some(out_manifest) = &entry.out_manifest {
        output::print_detail("manifest", out_manifest.display().to_string());
    }
    if let Some(ts_out) = &entry.ts_out {
        output::print_detail("ts sdk", ts_out.display().to_string());
    }
    if let Some(rust_out) = &entry.rust_out {
        output::print_detail("rust sdk", rust_out.display().to_string());
    }
}

fn action_label(action: AutoAction) -> &'static str {
    match action {
        AutoAction::Generate => "generate",
        AutoAction::Verify => "verify",
    }
}

fn auto_action_rank(action: AutoAction) -> u8 {
    match action {
        AutoAction::Generate => 0,
        AutoAction::Verify => 1,
    }
}
