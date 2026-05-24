use std::fs;
use std::path::{Path, PathBuf};

#[test]
fn harness_uses_public_trellis_api_only() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let source_dir = manifest_dir.join("src");

    let source_patterns = [
        joined(&["trellis", "_auth_adapters"]),
        joined(&["trellis", "_core_bootstrap"]),
        joined(&["trellis", "_sdk_auth"]),
        joined(&["trellis", "_sdk_core"]),
        joined(&["trellis", "_sdk_health"]),
        joined(&["trellis", "_sdk_jobs"]),
        joined(&["trellis", "_sdk_state"]),
        joined(&["trellis", "_service::"]),
        joined(&["bootstrap", "_service_host"]),
        joined(&["run", "_multi_subject_service"]),
        joined(&["AuthRequest", "ValidatorAdapter"]),
        joined(&["Ro", "uter"]),
    ];
    assert_no_patterns_in_tree(&source_dir, &source_patterns);

    let manifest_patterns = [
        joined(&["trellis", "-auth-adapters"]),
        joined(&["trellis", "-core-bootstrap"]),
        joined(&["trellis", "-sdk-auth"]),
        joined(&["trellis", "-sdk-core"]),
        joined(&["trellis", "-sdk-health"]),
        joined(&["trellis", "-sdk-jobs"]),
        joined(&["trellis", "-sdk-state"]),
        joined(&["trellis", "-service ="]),
        joined(&["trellis", "-service-jobs"]),
    ];
    assert_no_patterns_in_file(&manifest_dir.join("Cargo.toml"), &manifest_patterns);
}

fn joined(parts: &[&str]) -> String {
    parts.concat()
}

fn assert_no_patterns_in_tree(root: &Path, patterns: &[String]) {
    for path in rust_source_files(root) {
        assert_no_patterns_in_file(&path, patterns);
    }
}

fn assert_no_patterns_in_file(path: &Path, patterns: &[String]) {
    let contents = fs::read_to_string(path).expect("read guard input");
    for pattern in patterns {
        assert!(
            !contents.contains(pattern),
            "{} contains forbidden integration-harness dependency or symbol `{}`",
            path.display(),
            pattern
        );
    }
}

fn rust_source_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_rust_source_files(root, &mut files);
    files.sort();
    files
}

fn collect_rust_source_files(dir: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read guard source dir") {
        let entry = entry.expect("read guard source dir entry");
        let path = entry.path();
        if path.is_dir() {
            collect_rust_source_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}
