use std::fs;
use std::path::{Path, PathBuf};

const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let inputs = fingerprint_inputs(&manifest_dir);

    for path in &inputs {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    let fingerprint = compute_fingerprint(&manifest_dir, &inputs);
    println!("cargo:rustc-env=TRELLIS_GENERATE_FINGERPRINT={fingerprint}");
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
