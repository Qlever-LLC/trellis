use std::process::Command;

#[test]
fn contracts_verify_accepts_source_modules() {
    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "contracts",
            "verify",
            "--format",
            "json",
            "--source",
            "../../../js/services/activity/contracts/trellis_activity.ts",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run trellis contracts verify --source");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("trellis.activity@v1"));
}

#[test]
fn contracts_build_emits_generated_manifest_from_source() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("trellis.activity@v1.json");

    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "contracts",
            "build",
            "--source",
            "../../../js/services/activity/contracts/trellis_activity.ts",
            "--out-manifest",
            manifest_path.to_str().expect("manifest path"),
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run trellis contracts build");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let emitted = std::fs::read_to_string(&manifest_path).expect("read emitted manifest");
    assert!(emitted.contains("trellis.activity@v1"));
}

#[test]
fn sdk_generate_facade_emits_buildable_participant_crate() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let out_dir = temp_dir.path().join("participant");

    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "sdk",
            "generate",
            "facade",
            "--manifest",
            "../trellis-cli-participant/trellis.cli@v1.json",
            "--out",
            out_dir.to_str().expect("out dir"),
            "--use-sdk",
            "auth=trellis-sdk-auth=../trellis-sdk-auth/trellis.auth@v1.json",
            "--use-sdk",
            "core=trellis-sdk-core=../trellis-sdk-trellis-core/trellis.core@v1.json",
            "--runtime-source",
            "local",
            "--runtime-version",
            env!("CARGO_PKG_VERSION"),
            "--runtime-repo-root",
            "../../..",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run trellis sdk generate facade");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    for relative in [
        "build.rs",
        "src/lib.rs",
        "src/connect.rs",
        "src/contract.rs",
        "trellis.cli@v1.json",
        "contracts/auth.json",
        "contracts/core.json",
    ] {
        assert!(out_dir.join(relative).exists(), "missing {relative}");
    }

    let cargo = Command::new("cargo")
        .args(["check"])
        .current_dir(&out_dir)
        .output()
        .expect("run cargo check for generated facade");

    assert!(
        cargo.status.success(),
        "{}",
        String::from_utf8_lossy(&cargo.stderr)
    );
}
