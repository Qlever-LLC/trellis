use std::process::Command;

use trellis_contracts::load_manifest;

fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root")
}

fn generate_manifest(source: &str, out: &std::path::Path) {
    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .args(["generate", "manifest", "--source", source, "--out"])
        .arg(out)
        .output()
        .expect("run trellis-generate manifest");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn generate_demo_service_jsr_package(root: &std::path::Path) {
    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .args([
            "generate",
            "jsr",
            "--source",
            root.join("demos/js/service/contract.ts").to_str().unwrap(),
            "--out",
            root.join("demos/js/generated/packages/jsr/demo-service")
                .to_str()
                .unwrap(),
        ])
        .output()
        .expect("run trellis-generate jsr");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn assert_manifest_parity(js_source: &str, rust_source: &str) {
    let temp = tempfile::tempdir().expect("temp dir");
    let js_out = temp.path().join("js.json");
    let rust_out = temp.path().join("rust.json");

    generate_manifest(js_source, &js_out);
    generate_manifest(rust_source, &rust_out);

    let js = load_manifest(&js_out).expect("load js manifest");
    let rust = load_manifest(&rust_out).expect("load rust manifest");

    assert_eq!(rust.canonical, js.canonical);
    assert_eq!(rust.digest, js.digest);
}

#[test]
fn rust_authored_demo_service_contract_matches_js_contract() {
    let root = repo_root();
    assert_manifest_parity(
        root.join("demos/js/service/contract.ts").to_str().unwrap(),
        root.join("demos/rust/contracts/service.rs")
            .to_str()
            .unwrap(),
    );
}

#[test]
fn rust_authored_demo_device_contract_matches_js_contract() {
    let root = repo_root();
    generate_demo_service_jsr_package(&root);
    assert_manifest_parity(
        root.join("demos/js/device/contract.ts").to_str().unwrap(),
        root.join("demos/rust/contracts/device.rs")
            .to_str()
            .unwrap(),
    );
}
