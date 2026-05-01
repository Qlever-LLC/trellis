use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn main() {
    println!("cargo:rerun-if-env-changed=TRELLIS_OFFICIAL_BUILD");
    println!("cargo:rerun-if-env-changed=TRELLIS_BUILD_SHA");

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("../../.git/HEAD").display()
    );

    let inputs = fingerprint_inputs(&manifest_dir);

    for path in &inputs {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    let fingerprint = compute_fingerprint(&manifest_dir, &inputs);
    println!("cargo:rustc-env=TRELLIS_GENERATE_FINGERPRINT={fingerprint}");

    let package_version = std::env::var("CARGO_PKG_VERSION").expect("package version");
    let build_version = build_version(&manifest_dir, &package_version);
    println!("cargo:rustc-env=TRELLIS_BUILD_VERSION={build_version}");
}

fn build_version(manifest_dir: &Path, package_version: &str) -> String {
    if std::env::var("TRELLIS_OFFICIAL_BUILD").as_deref() == Ok("1") {
        return package_version.to_string();
    }

    let sha = std::env::var("TRELLIS_BUILD_SHA")
        .ok()
        .map(|value| short_sha(&value))
        .or_else(|| git_output(manifest_dir, &["rev-parse", "--short=12", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_string());

    let dirty = if is_dirty(manifest_dir) { ".dirty" } else { "" };
    format!("{package_version}+local.{sha}{dirty}")
}

fn short_sha(value: &str) -> String {
    value.chars().take(12).collect()
}

fn is_dirty(manifest_dir: &Path) -> bool {
    git_output(manifest_dir, &["status", "--porcelain"]).is_some_and(|output| !output.is_empty())
}

fn git_output(manifest_dir: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(manifest_dir)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn fingerprint_inputs(manifest_dir: &Path) -> Vec<PathBuf> {
    let mut paths = vec![
        manifest_dir.join("Cargo.toml"),
        manifest_dir.join("build.rs"),
    ];
    paths.extend(collect_rust_files(&manifest_dir.join("src")));
    paths.extend(collect_rust_files(
        &manifest_dir.join("../../crates/codegen-ts/src"),
    ));
    paths.extend(collect_rust_files(
        &manifest_dir.join("../../crates/codegen-rust/src"),
    ));
    paths.extend(collect_rust_files(
        &manifest_dir.join("../../crates/contracts/src"),
    ));
    paths.sort();
    paths.dedup();
    paths
}

fn collect_rust_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect_rust_files_into(root, &mut out);
    out
}

fn collect_rust_files_into(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    let mut entries = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    entries.sort();

    for path in entries {
        if path.is_dir() {
            collect_rust_files_into(&path, out);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

fn compute_fingerprint(manifest_dir: &Path, inputs: &[PathBuf]) -> String {
    let mut state = FNV_OFFSET_BASIS;
    for path in inputs {
        let relative = path.strip_prefix(manifest_dir).unwrap_or(path);
        hash_bytes(&mut state, relative.to_string_lossy().as_bytes());
        hash_bytes(&mut state, &[0]);
        hash_bytes(
            &mut state,
            &fs::read(path)
                .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display())),
        );
        hash_bytes(&mut state, &[0xff]);
    }
    format!("{state:016x}")
}

fn hash_bytes(state: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *state ^= u64::from(*byte);
        *state = state.wrapping_mul(FNV_PRIME);
    }
}
