use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use miette::IntoDiagnostic;
use notify::{EventKind, RecursiveMode, Watcher};

use crate::cli::PrepareArgs;
use crate::discovery::discover_contracts;
use crate::output;
use crate::planning::{build_auto_plan, execute_auto_plan, AutoPlanEntry};

pub fn run(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    if args.watch {
        return watch(args, force);
    }

    run_once(args, force)
}

fn run_once(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    let plan = build_prepare_plan(args)?;
    execute_prepare_plan(&plan, force, Some(&args.root), &args.prefix)
}

fn build_prepare_plan(args: &PrepareArgs) -> miette::Result<Vec<AutoPlanEntry>> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let output_root = match &args.out {
        Some(out) => absolute_path(out)?,
        None => canonical_root,
    };
    build_auto_plan(discover_contracts(&args.root)?, Some(&output_root))
}

fn absolute_path(path: &Path) -> miette::Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }

    Ok(std::env::current_dir().into_diagnostic()?.join(path))
}

fn execute_prepare_plan(
    plan: &[AutoPlanEntry],
    force: bool,
    root: Option<&Path>,
    prefix: &str,
) -> miette::Result<()> {
    if plan.is_empty() {
        output::print_title("Trellis Prepare");
        if let Some(root) = root {
            output::print_detail("root", root.display().to_string());
        }
        output::print_info("No contracts found.");
        return Ok(());
    }
    execute_auto_plan(plan, Some("Trellis Prepare"), false, force, prefix).map(|_| ())
}

fn watch(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let mut current_plan = match run_full_watch_prepare(args, force) {
        Ok(plan) => Some(plan),
        Err(error) => {
            eprintln!("prepare failed: {error:?}");
            None
        }
    };
    let filter = WatchPathFilter::new(&canonical_root).into_diagnostic()?;

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |result| {
        let _ = tx.send(result);
    })
    .into_diagnostic()?;

    watcher
        .watch(&canonical_root, RecursiveMode::Recursive)
        .into_diagnostic()?;
    output::print_info(&format!("Watching {}", canonical_root.display()));

    loop {
        let event = rx.recv().into_diagnostic()?.into_diagnostic()?;
        let mut changes = relevant_watch_changes(
            &filter,
            &event.kind,
            event.paths.iter().map(PathBuf::as_path),
        );

        while let Ok(event) = rx.recv_timeout(Duration::from_millis(250)) {
            let event = event.into_diagnostic()?;
            changes.extend(relevant_watch_changes(
                &filter,
                &event.kind,
                event.paths.iter().map(PathBuf::as_path),
            ));
        }

        if !changes.is_empty() {
            let decision = current_plan
                .as_ref()
                .map(|plan| decide_watch_prepare_in_root(plan, &changes, &canonical_root))
                .unwrap_or_else(|| decide_watch_prepare_without_plan(&changes));

            if args.changes {
                print_watch_changes(&changes, &decision);
            }

            match decision {
                WatchPrepareDecision::Ignored => {}
                WatchPrepareDecision::Affected(_) => {
                    let fresh_plan = match build_prepare_plan(args) {
                        Ok(plan) => plan,
                        Err(error) => {
                            eprintln!("prepare failed: {error:?}");
                            continue;
                        }
                    };

                    let update_current_plan = match decide_watch_prepare_in_root(
                        &fresh_plan,
                        &changes,
                        &canonical_root,
                    ) {
                        WatchPrepareDecision::Ignored => true,
                        WatchPrepareDecision::Affected(entries) => {
                            let selected_plan: Vec<AutoPlanEntry> =
                                entries.into_iter().cloned().collect();
                            execute_watch_prepare(&selected_plan, force, None, &args.prefix).is_ok()
                        }
                        WatchPrepareDecision::Full => execute_watch_prepare(
                            &fresh_plan,
                            force,
                            Some(&args.root),
                            &args.prefix,
                        )
                        .is_ok(),
                        WatchPrepareDecision::RestartRequired => {
                            print_watch_restart_required();
                            return Ok(());
                        }
                    };
                    if update_current_plan {
                        current_plan = Some(fresh_plan);
                    }
                }
                WatchPrepareDecision::Full => match run_full_watch_prepare(args, force) {
                    Ok(plan) => current_plan = Some(plan),
                    Err(error) => eprintln!("prepare failed: {error:?}"),
                },
                WatchPrepareDecision::RestartRequired => {
                    print_watch_restart_required();
                    return Ok(());
                }
            }
        }
    }
}

fn run_full_watch_prepare(args: &PrepareArgs, force: bool) -> miette::Result<Vec<AutoPlanEntry>> {
    let plan = build_prepare_plan(args)?;
    execute_prepare_plan(&plan, force, Some(&args.root), &args.prefix)?;
    Ok(plan)
}

fn execute_watch_prepare(
    plan: &[AutoPlanEntry],
    force: bool,
    root: Option<&Path>,
    prefix: &str,
) -> miette::Result<()> {
    if let Err(error) = execute_prepare_plan(plan, force, root, prefix) {
        eprintln!("prepare failed: {error:?}");
        return Err(error);
    }

    Ok(())
}

fn print_watch_restart_required() {
    eprintln!("prepare --watch must be restarted because generator or tooling code changed.");
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct WatchChange {
    kind: String,
    path: PathBuf,
}

fn relevant_watch_changes<'a>(
    filter: &WatchPathFilter,
    kind: &EventKind,
    paths: impl IntoIterator<Item = &'a Path>,
) -> Vec<WatchChange> {
    if !is_relevant_watch_kind(kind) {
        return Vec::new();
    }

    paths
        .into_iter()
        .filter(|path| filter.is_relevant(path))
        .map(|path| WatchChange {
            kind: format!("{kind:?}"),
            path: filter.display_path(path).to_path_buf(),
        })
        .collect()
}

fn is_relevant_watch_kind(kind: &EventKind) -> bool {
    match kind {
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => true,
        EventKind::Access(notify::event::AccessKind::Close(notify::event::AccessMode::Write)) => {
            true
        }
        EventKind::Any | EventKind::Other | EventKind::Access(_) => false,
    }
}

fn print_watch_changes(changes: &[WatchChange], decision: &WatchPrepareDecision<'_>) {
    const MAX_LOGGED_CHANGES: usize = 8;

    output::print_info("Change detected.");
    output::print_detail("decision", watch_decision_reason(decision));
    for change in changes.iter().take(MAX_LOGGED_CHANGES) {
        output::print_detail(
            "change",
            format!("{} {}", change.kind, change.path.display()),
        );
    }
    if changes.len() > MAX_LOGGED_CHANGES {
        output::print_detail(
            "change",
            format!("... {} more", changes.len() - MAX_LOGGED_CHANGES),
        );
    }
}

#[derive(Debug)]
enum WatchPrepareDecision<'a> {
    Ignored,
    Full,
    RestartRequired,
    Affected(Vec<&'a AutoPlanEntry>),
}

impl PartialEq for WatchPrepareDecision<'_> {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Ignored, Self::Ignored)
            | (Self::Full, Self::Full)
            | (Self::RestartRequired, Self::RestartRequired) => true,
            (Self::Affected(left), Self::Affected(right)) => {
                left.len() == right.len()
                    && left.iter().zip(right).all(|(left, right)| {
                        left.contract_id == right.contract_id
                            && paths_match(
                                &left.discovered.source_path,
                                &right.discovered.source_path,
                            )
                    })
            }
            _ => false,
        }
    }
}

#[cfg(test)]
fn decide_watch_prepare<'a>(
    plan: &'a [AutoPlanEntry],
    changes: &[WatchChange],
) -> WatchPrepareDecision<'a> {
    decide_watch_prepare_in_root(plan, changes, Path::new(""))
}

fn decide_watch_prepare_in_root<'a>(
    plan: &'a [AutoPlanEntry],
    changes: &[WatchChange],
    root: &Path,
) -> WatchPrepareDecision<'a> {
    let mut selected = vec![false; plan.len()];

    for change in changes {
        let path = change.path.as_path();
        let relative_path = path.strip_prefix(root).unwrap_or(path);
        let absolute_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        };

        if is_generator_or_tooling_path(relative_path) {
            return WatchPrepareDecision::RestartRequired;
        }

        if is_project_manifest_path(relative_path) || is_removal_change(change) {
            return WatchPrepareDecision::Full;
        }

        if let Some(index) = plan.iter().position(|entry| {
            paths_match(&entry.discovered.source_path, path)
                || paths_match(&entry.discovered.source_path, relative_path)
                || paths_match(&entry.discovered.source_path, &absolute_path)
        }) {
            selected[index] = true;
            continue;
        }

        if is_discovery_shape_path(relative_path) {
            return WatchPrepareDecision::Full;
        }

        if !is_source_like_path(relative_path) {
            continue;
        }

        for (index, entry) in plan.iter().enumerate() {
            if path_has_prefix(path, &entry.discovered.project_root)
                || path_has_prefix(relative_path, &entry.discovered.project_root)
                || path_has_prefix(&absolute_path, &entry.discovered.project_root)
            {
                selected[index] = true;
            }
        }
    }

    let affected: Vec<&AutoPlanEntry> = plan
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| selected[index].then_some(entry))
        .collect();

    if affected.is_empty() {
        WatchPrepareDecision::Ignored
    } else {
        WatchPrepareDecision::Affected(affected)
    }
}

fn decide_watch_prepare_without_plan(changes: &[WatchChange]) -> WatchPrepareDecision<'static> {
    for change in changes {
        let path = change.path.as_path();
        if is_generator_or_tooling_path(path) {
            return WatchPrepareDecision::RestartRequired;
        }

        if is_project_manifest_path(path)
            || is_removal_change(change)
            || is_discovery_shape_path(path)
            || is_source_like_path(path)
        {
            return WatchPrepareDecision::Full;
        }
    }

    WatchPrepareDecision::Ignored
}

fn watch_decision_reason(decision: &WatchPrepareDecision<'_>) -> String {
    match decision {
        WatchPrepareDecision::Ignored => "ignored: no affected contracts".to_owned(),
        WatchPrepareDecision::Full => {
            "full prepare: fallback required for this change batch".to_owned()
        }
        WatchPrepareDecision::RestartRequired => {
            "restart required: generator or tooling code changed".to_owned()
        }
        WatchPrepareDecision::Affected(entries) => {
            format!("affected prepare: {} contract(s)", entries.len())
        }
    }
}

fn is_removal_change(change: &WatchChange) -> bool {
    change.kind.starts_with("Remove(")
}

fn is_generator_or_tooling_path(path: &Path) -> bool {
    let mut components = path.components();
    let is_codegen_crate = components
        .next()
        .is_some_and(|component| component.as_os_str() == "rust")
        && components
            .next()
            .is_some_and(|component| component.as_os_str() == "crates")
        && components.next().is_some_and(|component| {
            component
                .as_os_str()
                .to_string_lossy()
                .starts_with("codegen-")
        });

    path_has_prefix(path, Path::new("rust/tools/generate"))
        || path_has_prefix(path, Path::new("rust/crates/contracts"))
        || is_codegen_crate
}

fn is_project_manifest_path(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("deno.json" | "deno.jsonc" | "package.json" | "Cargo.toml")
    )
}

fn is_discovery_shape_path(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    if matches!(file_name, "contract.ts" | "contract.js") {
        return true;
    }

    matches!(
        path.parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str()),
        Some("contracts")
    ) && matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "js" | "rs")
    )
}

fn is_source_like_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("ts" | "tsx" | "js" | "jsx" | "mts" | "mjs" | "cjs" | "rs")
    )
}

fn paths_match(left: &Path, right: &Path) -> bool {
    left.components().eq(right.components())
}

fn path_has_prefix(path: &Path, prefix: &Path) -> bool {
    let mut path_components = path.components();
    for prefix_component in prefix.components() {
        if path_components.next() != Some(prefix_component) {
            return false;
        }
    }
    true
}

struct WatchPathFilter {
    root: std::path::PathBuf,
    gitignore: Gitignore,
}

impl WatchPathFilter {
    fn new(root: &Path) -> Result<Self, ignore::Error> {
        let mut builder = GitignoreBuilder::new(root);
        builder.add(root.join(".gitignore"));
        let gitignore = builder.build()?;
        Ok(Self {
            root: root.to_path_buf(),
            gitignore,
        })
    }

    #[cfg(test)]
    fn empty(root: &Path) -> Self {
        Self {
            root: root.to_path_buf(),
            gitignore: Gitignore::empty(),
        }
    }

    fn is_relevant(&self, path: &Path) -> bool {
        let relative = path.strip_prefix(&self.root).unwrap_or(path);
        if relative.components().any(|component| {
            component.as_os_str() == "generated"
                || component.as_os_str() == ".worktrees"
                || component.as_os_str() == ".git"
        }) {
            return false;
        }

        !self
            .gitignore
            .matched_path_or_any_parents(relative, false)
            .is_ignore()
    }

    fn display_path<'a>(&self, path: &'a Path) -> &'a Path {
        path.strip_prefix(&self.root).unwrap_or(path)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RemoveKind};
    use notify::EventKind;
    use trellis_contracts::ContractKind;

    use crate::cli::RuntimeSource;
    use crate::discovery::{DiscoveredContractSource, SourceLanguage};
    use crate::planning::{AutoAction, AutoPlanEntry};

    #[test]
    fn prepare_watch_filter_ignores_generated_outputs_and_worktrees() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);

        assert!(!filter.is_relevant(Path::new(
            "/repo/generated/contracts/manifests/trellis.orders@v1.json"
        )));
        assert!(!filter.is_relevant(Path::new(
            "/repo/services/orders/generated/js/sdks/orders/mod.ts"
        )));
        assert!(!filter.is_relevant(Path::new(
            "/repo/.worktrees/prepare-watch/contracts/orders.ts"
        )));
        assert!(!filter.is_relevant(Path::new("/repo/.git/objects/6e/example")));
    }

    #[test]
    fn prepare_watch_filter_accepts_source_paths() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);

        assert!(filter.is_relevant(Path::new("/repo/services/orders/contracts/orders.ts")));
        assert!(filter.is_relevant(Path::new("/repo/js/apps/console/contract.ts")));
    }

    #[test]
    fn prepare_watch_filter_respects_gitignore() {
        let temp = tempfile::tempdir().expect("create tempdir");
        fs::write(temp.path().join(".gitignore"), "target/\n*.log\n").expect("write gitignore");
        let filter = super::WatchPathFilter::new(temp.path()).expect("build watch filter");

        assert!(!filter.is_relevant(&temp.path().join("target/debug/trellis-generate")));
        assert!(!filter.is_relevant(&temp.path().join("service/debug.log")));
        assert!(filter.is_relevant(&temp.path().join("service/contracts/orders.ts")));
    }

    #[test]
    fn prepare_watch_changes_include_kind_and_relative_path() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);
        let paths = vec![
            Path::new("/repo/generated/contracts/manifests/trellis.orders@v1.json").to_path_buf(),
            Path::new("/repo/services/orders/contracts/orders.ts").to_path_buf(),
        ];

        assert_eq!(
            super::relevant_watch_changes(
                &filter,
                &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
                paths.iter().map(PathBuf::as_path),
            ),
            vec![super::WatchChange {
                kind: "Modify(Data(Content))".to_owned(),
                path: PathBuf::from("services/orders/contracts/orders.ts"),
            }]
        );
    }

    #[test]
    fn prepare_watch_changes_skip_ignored_paths() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);
        let paths = vec![
            Path::new("/repo/generated/js/sdks/orders/mod.ts").to_path_buf(),
            Path::new("/repo/.worktrees/prepare-watch/contracts/orders.ts").to_path_buf(),
        ];

        assert!(super::relevant_watch_changes(
            &filter,
            &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            paths.iter().map(PathBuf::as_path),
        )
        .is_empty());
    }

    #[test]
    fn prepare_watch_changes_use_absolute_path_outside_root() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);
        let outside = Path::new("/tmp/orders.ts").to_path_buf();

        assert_eq!(
            super::relevant_watch_changes(
                &filter,
                &EventKind::Create(CreateKind::File),
                [outside.as_path()],
            ),
            vec![super::WatchChange {
                kind: "Create(File)".to_owned(),
                path: outside,
            }]
        );
    }

    #[test]
    fn prepare_watch_changes_ignore_access_open_events() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);
        let path = Path::new("/repo/services/orders/contracts/orders.ts").to_path_buf();

        assert!(super::relevant_watch_changes(
            &filter,
            &EventKind::Access(AccessKind::Open(AccessMode::Any)),
            [path.as_path()],
        )
        .is_empty());
    }

    #[test]
    fn prepare_watch_changes_accept_write_close_events() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);
        let path = Path::new("/repo/services/orders/contracts/orders.ts").to_path_buf();

        assert_eq!(
            super::relevant_watch_changes(
                &filter,
                &EventKind::Access(AccessKind::Close(AccessMode::Write)),
                [path.as_path()],
            ),
            vec![super::WatchChange {
                kind: "Access(Close(Write))".to_owned(),
                path: PathBuf::from("services/orders/contracts/orders.ts"),
            }]
        );
    }

    #[test]
    fn prepare_watch_changes_accept_create_modify_and_remove_events() {
        let root = Path::new("/repo");
        let filter = super::WatchPathFilter::empty(root);
        let path = Path::new("/repo/services/orders/contracts/orders.ts").to_path_buf();

        assert_eq!(
            super::relevant_watch_changes(
                &filter,
                &EventKind::Create(CreateKind::File),
                [path.as_path()],
            )
            .len(),
            1
        );
        assert_eq!(
            super::relevant_watch_changes(
                &filter,
                &EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
                [path.as_path()],
            )
            .len(),
            1
        );
        assert_eq!(
            super::relevant_watch_changes(
                &filter,
                &EventKind::Remove(RemoveKind::File),
                [path.as_path()],
            )
            .len(),
            1
        );
    }

    #[test]
    fn watch_decision_ignores_non_source_extensions() {
        let plan = watch_decision_plan_fixture();

        assert_watch_decision_ignored(&plan, &["README.md"]);
        assert_watch_decision_ignored(&plan, &["apps/console/src/routes/+page.svelte"]);
        assert_watch_decision_ignored(&plan, &["apps/console/src/content/guide.svx"]);
        assert_watch_decision_ignored(&plan, &["services/orders/src/config.json"]);
        assert_watch_decision_ignored(&plan, &["services/orders/src/config.jsonc"]);
        assert_watch_decision_ignored(&plan, &["services/orders/Trellis.toml"]);
    }

    #[test]
    fn watch_decision_treats_svelte_modules_as_typescript_or_javascript_source() {
        let plan = watch_decision_plan_fixture();

        assert_watch_decision_affected(
            &plan,
            &["apps/console/src/lib/page-state.svelte.ts"],
            &["trellis.console@v1"],
        );
        assert_watch_decision_affected(
            &plan,
            &["apps/console/src/lib/page-state.svelte.js"],
            &["trellis.console@v1"],
        );
    }

    #[test]
    fn watch_decision_exact_contract_source_selects_only_that_entry() {
        let plan = watch_decision_plan_fixture();

        assert_watch_decision_affected(
            &plan,
            &["services/orders/contracts/orders.ts"],
            &["trellis.orders@v1"],
        );
    }

    #[test]
    fn watch_decision_source_like_file_inside_known_project_selects_project_entries() {
        let plan = watch_decision_plan_fixture();

        for changed_path in [
            "services/orders/src/helper.ts",
            "services/orders/src/helper.tsx",
            "services/orders/src/helper.js",
            "services/orders/src/helper.jsx",
            "services/orders/src/helper.mts",
            "services/orders/src/helper.mjs",
            "services/orders/src/helper.cjs",
            "services/orders/src/lib.rs",
        ] {
            assert_watch_decision_affected(
                &plan,
                &[changed_path],
                &["trellis.orders@v1", "trellis.billing@v1"],
            );
        }
    }

    #[test]
    fn watch_decision_project_manifest_changes_request_full_prepare() {
        let plan = watch_decision_plan_fixture();

        for changed_path in [
            "services/orders/deno.json",
            "services/orders/deno.jsonc",
            "services/orders/package.json",
            "devices/sensor/Cargo.toml",
        ] {
            assert_watch_decision_full(&plan, &[changed_path]);
        }
    }

    #[test]
    fn watch_decision_discovery_shape_create_or_remove_requests_full_prepare() {
        let plan = watch_decision_plan_fixture();

        for changed_path in [
            "services/orders/contract.ts",
            "services/orders/contract.js",
            "services/orders/contracts/new-contract.ts",
            "devices/sensor/contracts/new-contract.rs",
        ] {
            assert_watch_decision_full(&plan, &[changed_path]);
        }
    }

    #[test]
    fn watch_decision_treats_any_contract_ts_or_js_as_discovery_shape() {
        assert!(super::is_discovery_shape_path(Path::new(
            "services/orders/src/lib/contract.ts"
        )));
        assert!(super::is_discovery_shape_path(Path::new(
            "services/orders/src/lib/contract.js"
        )));
    }

    #[test]
    fn watch_decision_removed_exact_contract_source_requests_full_prepare() {
        let plan = watch_decision_plan_fixture();

        assert_eq!(
            super::decide_watch_prepare(
                &plan,
                &[super::WatchChange {
                    kind: "Remove(File)".to_owned(),
                    path: PathBuf::from("services/orders/contracts/orders.ts"),
                }],
            ),
            super::WatchPrepareDecision::Full
        );
    }

    #[test]
    fn watch_decision_multiple_changes_dedupe_and_preserve_plan_order() {
        let plan = watch_decision_plan_fixture();

        assert_watch_decision_affected(
            &plan,
            &[
                "apps/console/src/routes/+page.svelte",
                "services/orders/src/helper.ts",
                "services/orders/contracts/billing.ts",
                "services/orders/contracts/orders.ts",
            ],
            &["trellis.orders@v1", "trellis.billing@v1"],
        );
    }

    #[test]
    fn watch_decision_generator_and_tooling_paths_request_restart() {
        let plan = watch_decision_plan_fixture();

        for changed_path in [
            "rust/tools/generate/src/commands/prepare.rs",
            "rust/crates/codegen-rust/src/lib.rs",
            "rust/crates/codegen-typescript/src/lib.rs",
            "rust/crates/contracts/src/model.rs",
        ] {
            assert_watch_decision_restart_required(&plan, &[changed_path]);
        }
    }

    #[test]
    fn watch_decision_in_root_matches_relative_changes_to_absolute_plan() {
        let root = Path::new("/repo");
        let plan = absolute_watch_decision_plan_fixture(root);

        let super::WatchPrepareDecision::Affected(entries) = super::decide_watch_prepare_in_root(
            &plan,
            &watch_changes(&["services/orders/contracts/orders.ts"]),
            root,
        ) else {
            panic!("expected affected prepare decision");
        };

        assert_eq!(entries[0].contract_id, "trellis.orders@v1");
    }

    #[test]
    fn watch_decision_in_root_selects_absolute_project_entries() {
        let root = Path::new("/repo");
        let plan = absolute_watch_decision_plan_fixture(root);

        let super::WatchPrepareDecision::Affected(entries) = super::decide_watch_prepare_in_root(
            &plan,
            &watch_changes(&["services/orders/src/helper.ts"]),
            root,
        ) else {
            panic!("expected affected prepare decision");
        };
        let actual_contract_ids: Vec<&str> = entries
            .iter()
            .map(|entry| entry.contract_id.as_str())
            .collect();

        assert_eq!(
            actual_contract_ids,
            ["trellis.orders@v1", "trellis.billing@v1"]
        );
    }

    #[test]
    fn watch_decision_without_plan_retries_full_only_for_source_like_changes() {
        assert_eq!(
            super::decide_watch_prepare_without_plan(&watch_changes(&["README.md"])),
            super::WatchPrepareDecision::Ignored
        );
        assert_eq!(
            super::decide_watch_prepare_without_plan(&watch_changes(&[
                "services/orders/src/helper.ts"
            ])),
            super::WatchPrepareDecision::Full
        );
        assert_eq!(
            super::decide_watch_prepare_without_plan(&watch_changes(&[
                "rust/tools/generate/src/commands/prepare.rs"
            ])),
            super::WatchPrepareDecision::RestartRequired
        );
    }

    fn assert_watch_decision_ignored(plan: &[AutoPlanEntry], changes: &[&str]) {
        assert_eq!(
            super::decide_watch_prepare(plan, &watch_changes(changes)),
            super::WatchPrepareDecision::Ignored
        );
    }

    fn assert_watch_decision_full(plan: &[AutoPlanEntry], changes: &[&str]) {
        assert_eq!(
            super::decide_watch_prepare(plan, &watch_changes(changes)),
            super::WatchPrepareDecision::Full
        );
    }

    fn assert_watch_decision_restart_required(plan: &[AutoPlanEntry], changes: &[&str]) {
        assert_eq!(
            super::decide_watch_prepare(plan, &watch_changes(changes)),
            super::WatchPrepareDecision::RestartRequired
        );
    }

    fn assert_watch_decision_affected(
        plan: &[AutoPlanEntry],
        changes: &[&str],
        expected_contract_ids: &[&str],
    ) {
        let super::WatchPrepareDecision::Affected(entries) =
            super::decide_watch_prepare(plan, &watch_changes(changes))
        else {
            panic!("expected affected prepare decision");
        };
        let actual_contract_ids: Vec<&str> = entries
            .iter()
            .map(|entry| entry.contract_id.as_str())
            .collect();

        assert_eq!(actual_contract_ids, expected_contract_ids);
    }

    fn watch_changes(paths: &[&str]) -> Vec<super::WatchChange> {
        paths
            .iter()
            .map(|path| super::WatchChange {
                kind: "Modify(Data(Content))".to_owned(),
                path: PathBuf::from(path),
            })
            .collect()
    }

    fn watch_decision_plan_fixture() -> Vec<AutoPlanEntry> {
        vec![
            plan_entry(
                "services/orders",
                "services/orders/deno.json",
                SourceLanguage::TypeScript,
                "services/orders/contracts/orders.ts",
                "trellis.orders@v1",
                ContractKind::Service,
            ),
            plan_entry(
                "services/orders",
                "services/orders/deno.json",
                SourceLanguage::TypeScript,
                "services/orders/contracts/billing.ts",
                "trellis.billing@v1",
                ContractKind::Service,
            ),
            plan_entry(
                "devices/sensor",
                "devices/sensor/Cargo.toml",
                SourceLanguage::Rust,
                "devices/sensor/contracts/sensor.rs",
                "trellis.sensor@v1",
                ContractKind::Device,
            ),
            plan_entry(
                "apps/console",
                "apps/console/package.json",
                SourceLanguage::TypeScript,
                "apps/console/contract.ts",
                "trellis.console@v1",
                ContractKind::App,
            ),
        ]
    }

    fn absolute_watch_decision_plan_fixture(root: &Path) -> Vec<AutoPlanEntry> {
        watch_decision_plan_fixture()
            .into_iter()
            .map(|mut entry| {
                entry.discovered.project_root = root.join(&entry.discovered.project_root);
                entry.discovered.manifest_path = root.join(&entry.discovered.manifest_path);
                entry.discovered.source_path = root.join(&entry.discovered.source_path);
                entry
            })
            .collect()
    }

    fn plan_entry(
        project_root: &str,
        manifest_path: &str,
        language: SourceLanguage,
        source_path: &str,
        contract_id: &str,
        contract_kind: ContractKind,
    ) -> AutoPlanEntry {
        AutoPlanEntry {
            discovered: DiscoveredContractSource {
                project_root: PathBuf::from(project_root),
                manifest_path: PathBuf::from(manifest_path),
                language,
                source_path: PathBuf::from(source_path),
            },
            contract_id: contract_id.to_owned(),
            contract_kind,
            action: AutoAction::Generate,
            out_manifest: None,
            ts_out: None,
            rust_out: None,
            runtime_source: RuntimeSource::Local,
            runtime_repo_root: Some(PathBuf::from(".")),
        }
    }
}
