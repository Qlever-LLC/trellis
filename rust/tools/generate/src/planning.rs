use std::fs;
use std::path::{Path, PathBuf};

use miette::IntoDiagnostic;
use serde_json::Value;
use trellis_contracts::ContractKind;

use crate::artifacts::{
    current_generator_fingerprint, default_rust_crate_name_from_id, detect_output_root,
    detect_runtime_source, generated_artifacts_are_fresh, generated_artifacts_metadata,
    generated_artifacts_metadata_path, required_owner_version, sdk_output_stem,
    trellis_package_version, ts_package_name_from_id, write_contract_outputs,
    write_contract_shell_outputs, write_participant_facade_outputs,
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

#[derive(Debug, Clone)]
pub struct AutoPlanEntry {
    pub discovered: DiscoveredContractSource,
    pub contract_id: String,
    pub contract_kind: ContractKind,
    pub action: AutoAction,
    pub out_manifest: Option<PathBuf>,
    pub ts_out: Option<PathBuf>,
    pub rust_out: Option<PathBuf>,
    pub rust_participant_out: Option<PathBuf>,
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
    prefix: &str,
) -> miette::Result<Vec<AutoPlanEntry>> {
    let mut plan = Vec::new();
    for contract in discovered {
        let (contract_id, contract_kind) = discover_contract_metadata(&contract)?;
        let action = action_for_discovered_kind(&contract, &contract_kind);
        let output_root = shared_output_root
            .map(Path::to_path_buf)
            .unwrap_or_else(|| detect_output_root(&contract.project_root));
        let runtime_repo_root = detect_runtime_repo_root(&output_root);
        let runtime_source = if runtime_repo_root.is_some() {
            RuntimeSource::Local
        } else {
            RuntimeSource::Registry
        };
        let (out_manifest, ts_out, rust_out, rust_participant_out) = match action {
            AutoAction::Generate => {
                let sdk_stem = sdk_output_stem(&contract_id);
                let ts_sdk_root = resolve_typescript_sdk_root(
                    &output_root,
                    &contract.project_root,
                    runtime_repo_root.as_deref(),
                );
                let out_manifest = output_root
                    .join("generated/contracts/manifests")
                    .join(format!("{}.json", &contract_id));
                let ts_out = if matches!(contract_kind, ContractKind::Service | ContractKind::App) {
                    Some(ts_sdk_root.join(&sdk_stem))
                } else {
                    None
                };
                let rust_out = if matches!(contract_kind, ContractKind::Service) {
                    Some(output_root.join("generated/rust/sdks").join(&sdk_stem))
                } else {
                    None
                };
                let rust_participant_out =
                    if matches!(contract_kind, ContractKind::Device | ContractKind::Agent)
                        && matches!(contract.language, crate::discovery::SourceLanguage::Rust)
                    {
                        Some(
                            output_root
                                .join("generated/rust/participants")
                                .join(&sdk_stem),
                        )
                    } else {
                        None
                    };
                (Some(out_manifest), ts_out, rust_out, rust_participant_out)
            }
            AutoAction::Verify => (None, None, None, None),
        };
        plan.push(AutoPlanEntry {
            discovered: contract,
            contract_id,
            contract_kind,
            action,
            out_manifest,
            ts_out,
            rust_out,
            rust_participant_out,
            runtime_source,
            runtime_repo_root,
        });
    }
    sort_auto_plan(&mut plan, prefix);
    Ok(plan)
}

fn sort_auto_plan(plan: &mut Vec<AutoPlanEntry>, prefix: &str) {
    let mut remaining = plan.clone();
    remaining.sort_by(compare_auto_plan_entries);

    let mut sorted = Vec::with_capacity(remaining.len());
    while !remaining.is_empty() {
        let next = remaining
            .iter()
            .position(|entry| {
                local_ts_sdk_dependencies(entry, plan, prefix)
                    .into_iter()
                    .all(|dependency| {
                        sorted
                            .iter()
                            .any(|candidate: &AutoPlanEntry| candidate.contract_id == dependency)
                            || !remaining
                                .iter()
                                .any(|candidate| candidate.contract_id == dependency)
                    })
            })
            .unwrap_or(0);
        sorted.push(remaining.remove(next));
    }

    *plan = sorted;
}

fn compare_auto_plan_entries(left: &AutoPlanEntry, right: &AutoPlanEntry) -> std::cmp::Ordering {
    auto_plan_rank(left)
        .cmp(&auto_plan_rank(right))
        .then_with(|| {
            left.discovered
                .source_path
                .cmp(&right.discovered.source_path)
        })
}

fn local_ts_sdk_dependencies(
    entry: &AutoPlanEntry,
    plan: &[AutoPlanEntry],
    prefix: &str,
) -> Vec<String> {
    if entry.discovered.language != crate::discovery::SourceLanguage::TypeScript {
        return Vec::new();
    }
    let Ok(source) = fs::read_to_string(&entry.discovered.source_path) else {
        return Vec::new();
    };

    plan.iter()
        .filter(|candidate| candidate.contract_id != entry.contract_id)
        .filter(|candidate| candidate.ts_out.is_some())
        .filter_map(|candidate| {
            let package_name = ts_package_name_from_id(&candidate.contract_id, prefix);
            source_imports_specifier(&source, &package_name).then(|| candidate.contract_id.clone())
        })
        .collect()
}

fn source_imports_specifier(source: &str, specifier: &str) -> bool {
    let double_quoted = format!("from \"{specifier}\"");
    let single_quoted = format!("from '{specifier}'");
    let dynamic_double_quoted = format!("import(\"{specifier}\")");
    let dynamic_single_quoted = format!("import('{specifier}')");
    source.contains(&double_quoted)
        || source.contains(&single_quoted)
        || source.contains(&dynamic_double_quoted)
        || source.contains(&dynamic_single_quoted)
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

    value.get("workspace").map(Value::is_array).unwrap_or(false)
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
    prefix: &str,
) -> miette::Result<AutoExecutionSummary> {
    if show_title {
        output::print_section("Run");
    } else if let Some(title) = title {
        output::print_title(title);
    }

    let generator_fingerprint = current_generator_fingerprint();
    let mut summary = AutoExecutionSummary::default();
    write_auto_plan_shells(plan, prefix, &generator_fingerprint)?;
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
                    "generate contract artifacts from local discovery",
                )?;
                let package_name = ts_package_name_from_id(&resolved.loaded.manifest.id, prefix);
                let crate_name = default_rust_crate_name_from_id(&resolved.loaded.manifest.id);
                let out_manifest = entry.out_manifest.as_ref().ok_or_else(|| {
                    miette::miette!("missing manifest output for generated contract")
                })?;
                let metadata = generated_artifacts_metadata(
                    &resolved,
                    &artifact_version,
                    entry.runtime_source,
                    &trellis_package_version(),
                    entry.ts_out.is_some(),
                    entry.rust_out.is_some(),
                    &package_name,
                    &crate_name,
                    generator_fingerprint,
                );
                if !force
                    && entry.rust_participant_out.is_none()
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
                    artifact_version.clone(),
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
                if let Some(rust_participant_out) = &entry.rust_participant_out {
                    if let Some(mappings) = participant_alias_mappings(entry, plan) {
                        write_participant_facade_outputs(
                            out_manifest,
                            rust_participant_out,
                            &format!(
                                "trellis-participant-{}",
                                sdk_output_stem(&resolved.loaded.manifest.id)
                            ),
                            &artifact_version,
                            entry.runtime_source,
                            entry.runtime_repo_root.clone(),
                            mappings,
                        )?;
                    } else {
                        remove_stale_participant_facade_outputs(rust_participant_out)?;
                        output::print_info(&format!(
                            "skipped Rust participant facade for {} because no uses aliases have local Rust SDK mappings",
                            resolved.loaded.manifest.id
                        ));
                    }
                }
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

fn write_auto_plan_shells(
    plan: &[AutoPlanEntry],
    prefix: &str,
    generator_fingerprint: &str,
) -> miette::Result<()> {
    for entry in plan {
        if !matches!(entry.action, AutoAction::Generate) {
            continue;
        }
        if shell_outputs_are_not_needed(entry, generator_fingerprint) {
            continue;
        }
        let package_name = ts_package_name_from_id(&entry.contract_id, prefix);
        let crate_name = default_rust_crate_name_from_id(&entry.contract_id);
        write_contract_shell_outputs(
            &entry.contract_id,
            "0.0.0-shell",
            entry.out_manifest.as_deref(),
            entry.ts_out.as_deref(),
            entry.rust_out.as_deref(),
            &package_name,
            &crate_name,
            entry.runtime_source,
            entry.runtime_repo_root.clone(),
        )?;
    }
    Ok(())
}

fn shell_outputs_are_not_needed(entry: &AutoPlanEntry, generator_fingerprint: &str) -> bool {
    let Some(out_manifest) = &entry.out_manifest else {
        return false;
    };
    generated_artifacts_metadata_matches_generator(out_manifest, generator_fingerprint)
        && ts_shell_key_outputs_exist(entry.ts_out.as_deref())
        && rust_shell_key_outputs_exist(entry.rust_out.as_deref())
}

fn generated_artifacts_metadata_matches_generator(
    out_manifest: &Path,
    generator_fingerprint: &str,
) -> bool {
    let Ok(contents) = fs::read_to_string(generated_artifacts_metadata_path(out_manifest)) else {
        return false;
    };
    let Ok(metadata) = serde_json::from_str::<Value>(&contents) else {
        return false;
    };
    metadata
        .get("generator_fingerprint")
        .and_then(Value::as_str)
        == Some(generator_fingerprint)
}

fn ts_shell_key_outputs_exist(ts_out: Option<&Path>) -> bool {
    let Some(ts_out) = ts_out else {
        return true;
    };
    ts_out.join("mod.ts").exists()
        && ts_out.join("api.ts").exists()
        && ts_out.join("owned_api.ts").exists()
        && ts_out.join("contract.ts").exists()
        && ts_out.join("client.ts").exists()
}

fn rust_shell_key_outputs_exist(rust_out: Option<&Path>) -> bool {
    let Some(rust_out) = rust_out else {
        return true;
    };
    rust_out.join("Cargo.toml").exists() && rust_out.join("src/lib.rs").exists()
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
    #[allow(unreachable_patterns)]
    match kind {
        ContractKind::Service | ContractKind::App => AutoAction::Generate,
        ContractKind::Device | ContractKind::Agent => AutoAction::Verify,
        _ => unreachable!("portal contract kind has been removed"),
    }
}

fn action_for_discovered_kind(
    contract: &DiscoveredContractSource,
    kind: &ContractKind,
) -> AutoAction {
    if matches!(contract.language, crate::discovery::SourceLanguage::Rust)
        && matches!(kind, ContractKind::Device | ContractKind::Agent)
    {
        AutoAction::Generate
    } else {
        action_for_kind(kind)
    }
}

fn participant_alias_mappings(
    entry: &AutoPlanEntry,
    plan: &[AutoPlanEntry],
) -> Option<Vec<trellis_codegen_rust::ParticipantAliasMapping>> {
    let local_manifest = entry.out_manifest.as_ref()?;
    let loaded = trellis_contracts::load_manifest(local_manifest).ok()?;
    let mut mappings = Vec::new();
    for (alias, use_ref) in loaded.manifest.uses.iter() {
        if let Some(mapped) = plan.iter().find(|candidate| {
            candidate.contract_id == use_ref.contract && candidate.rust_out.is_some()
        }) {
            let manifest_path = mapped.out_manifest.as_ref()?.clone();
            mappings.push(trellis_codegen_rust::ParticipantAliasMapping {
                alias: alias.clone(),
                crate_name: default_rust_crate_name_from_id(&mapped.contract_id),
                manifest_path,
                crate_path: mapped.rust_out.clone(),
            });
            continue;
        }

        if !trellis_codegen_rust::participant_use_requires_mapping(&loaded, alias, use_ref) {
            continue;
        }

        if let Some(mapping) = built_in_rust_alias_mapping(entry, alias, &use_ref.contract) {
            mappings.push(mapping);
            continue;
        }

        return None;
    }
    if mappings.is_empty() {
        return None;
    }
    Some(mappings)
}

fn built_in_rust_alias_mapping(
    entry: &AutoPlanEntry,
    alias: &str,
    contract_id: &str,
) -> Option<trellis_codegen_rust::ParticipantAliasMapping> {
    if !contract_id.starts_with("trellis.") {
        return None;
    }

    let repo_root = entry.runtime_repo_root.as_ref()?;
    let sdk_root = repo_root
        .join("generated/rust/sdks")
        .join(sdk_output_stem(contract_id));
    let manifest_path = repo_root
        .join("generated/contracts/manifests")
        .join(format!("{contract_id}.json"));
    if !sdk_root.join("Cargo.toml").exists() || !manifest_path.exists() {
        return None;
    }

    Some(trellis_codegen_rust::ParticipantAliasMapping {
        alias: alias.to_string(),
        crate_name: default_rust_crate_name_from_id(contract_id),
        manifest_path,
        crate_path: Some(sdk_root),
    })
}

fn remove_stale_participant_facade_outputs(out: &Path) -> miette::Result<()> {
    if out.exists() {
        fs::remove_dir_all(out).into_diagnostic()?;
    }
    Ok(())
}

pub fn contract_kind_label(kind: &ContractKind) -> &'static str {
    #[allow(unreachable_patterns)]
    match kind {
        ContractKind::Service => "service",
        ContractKind::App => "app",
        ContractKind::Device => "device",
        ContractKind::Agent => "agent",
        _ => unreachable!("portal contract kind has been removed"),
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
    if let Some(rust_participant_out) = &entry.rust_participant_out {
        output::print_detail(
            "rust participant",
            rust_participant_out.display().to_string(),
        );
    }
}

fn action_label(action: AutoAction) -> &'static str {
    match action {
        AutoAction::Generate => "generate",
        AutoAction::Verify => "verify",
    }
}

fn auto_plan_rank(entry: &AutoPlanEntry) -> u8 {
    match (entry.action, &entry.contract_kind) {
        (AutoAction::Generate, ContractKind::Service) => 0,
        (AutoAction::Generate, ContractKind::App) => 1,
        (AutoAction::Verify, _) => 2,
        #[allow(unreachable_patterns)]
        _ => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::SourceLanguage;

    #[test]
    fn auto_plan_orders_local_ts_sdk_imports_before_dependents() {
        let _env_lock = crate::contract_input::test_env_lock();
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let notifications = root.join("services/notifications/contracts");
        let sherpa = root.join("services/sherpa/contracts");
        fs::create_dir_all(&notifications).unwrap();
        fs::create_dir_all(&sherpa).unwrap();
        fs::write(root.join("deno.json"), "{}\n").unwrap();
        fs::write(
            notifications.join("notifications.ts"),
            concat!(
                "import * as krishiSherpa from \"@trellis-sdk/krishi-sherpa\";\n",
                "import { defineServiceContract } from \"@qlever-llc/trellis\";\n",
                "export const notifications = defineServiceContract(() => ({\n",
                "  id: \"krishi.notifications@v1\",\n",
                "  kind: \"service\",\n",
                "  displayName: \"Notifications\",\n",
                "  description: \"Notifications\",\n",
                "  uses: { sherpa: krishiSherpa.use({ events: { subscribe: [\"Sherpa.RunIngested\"] } }) },\n",
                "}));\n",
                "export default notifications;\n",
            ),
        )
        .unwrap();
        fs::write(
            sherpa.join("sherpa.ts"),
            concat!(
                "import { defineServiceContract } from \"@qlever-llc/trellis\";\n",
                "export const sherpa = defineServiceContract(() => ({\n",
                "  id: \"krishi.sherpa@v1\",\n",
                "  kind: \"service\",\n",
                "  displayName: \"Sherpa\",\n",
                "  description: \"Sherpa\",\n",
                "}));\n",
                "export default sherpa;\n",
            ),
        )
        .unwrap();

        let discovered = vec![
            DiscoveredContractSource {
                project_root: root.join("services/notifications"),
                manifest_path: root.join("deno.json"),
                language: SourceLanguage::TypeScript,
                source_path: notifications.join("notifications.ts"),
            },
            DiscoveredContractSource {
                project_root: root.join("services/sherpa"),
                manifest_path: root.join("deno.json"),
                language: SourceLanguage::TypeScript,
                source_path: sherpa.join("sherpa.ts"),
            },
        ];

        let plan = build_auto_plan(discovered, Some(root), "@trellis-sdk/").unwrap();

        assert_eq!(
            plan.iter()
                .map(|entry| entry.contract_id.as_str())
                .collect::<Vec<_>>(),
            vec!["krishi.sherpa@v1", "krishi.notifications@v1"]
        );
    }
}
