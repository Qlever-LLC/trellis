use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use miette::IntoDiagnostic;
use notify::{EventKind, RecursiveMode, Watcher};

use crate::cli::PrepareArgs;
use crate::discovery::discover_contracts;
use crate::output;
use crate::planning::{build_auto_plan, execute_auto_plan};

pub fn run(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    if args.watch {
        return watch(args, force);
    }

    run_once(args, force)
}

fn run_once(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    let plan = build_auto_plan(discover_contracts(&args.root)?, Some(&canonical_root))?;
    if plan.is_empty() {
        output::print_title("Trellis Prepare");
        output::print_detail("root", args.root.display().to_string());
        output::print_info("No contracts found.");
        return Ok(());
    }
    execute_auto_plan(&plan, Some("Trellis Prepare"), false, force).map(|_| ())
}

fn watch(args: &PrepareArgs, force: bool) -> miette::Result<()> {
    let canonical_root = args.root.canonicalize().into_diagnostic()?;
    run_watch_prepare(args, force);
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
            if args.changes {
                print_watch_changes(&changes);
            }
            run_watch_prepare(args, force);
        }
    }
}

fn run_watch_prepare(args: &PrepareArgs, force: bool) {
    if let Err(error) = run_once(args, force) {
        eprintln!("prepare failed: {error:?}");
    }
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

fn print_watch_changes(changes: &[WatchChange]) {
    const MAX_LOGGED_CHANGES: usize = 8;

    output::print_info("Change detected; rerunning prepare.");
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
        assert!(filter.is_relevant(Path::new("/repo/js/apps/console/src/lib/contract.ts")));
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
}
