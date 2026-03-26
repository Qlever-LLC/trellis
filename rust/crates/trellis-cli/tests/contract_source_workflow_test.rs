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
    let cli_manifest = temp_dir.path().join("trellis.cli@v1.json");
    let auth_manifest = temp_dir.path().join("trellis.auth@v1.json");
    let core_manifest = temp_dir.path().join("trellis.core@v1.json");
    let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");

    std::fs::write(
        temp_dir.path().join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .expect("write fixture deno manifest");

    std::fs::write(
        &cli_manifest,
        format!("{}\n", trellis_cli::cli_contract::cli_contract_json()),
    )
    .expect("write cli manifest");
    std::fs::write(
        &auth_manifest,
        format!("{}\n", trellis_sdk_auth::contract::CONTRACT_JSON),
    )
    .expect("write auth manifest");
    std::fs::write(
        &core_manifest,
        format!("{}\n", trellis_sdk_core::contract::CONTRACT_JSON),
    )
    .expect("write core manifest");
    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "sdk",
            "generate",
            "facade",
            "--manifest",
            cli_manifest.to_str().expect("cli manifest path"),
            "--out",
            out_dir.to_str().expect("out dir"),
            "--use-sdk",
            &format!(
                "auth=trellis-sdk-auth={}={}",
                auth_manifest.to_str().expect("auth manifest path"),
                repo_root
                    .join("rust/crates/trellis-sdk-auth")
                    .to_str()
                    .expect("auth crate path")
            ),
            "--use-sdk",
            &format!(
                "core=trellis-sdk-core={}={}",
                core_manifest.to_str().expect("core manifest path"),
                repo_root
                    .join("rust/crates/trellis-sdk-core")
                    .to_str()
                    .expect("core crate path")
            ),
            "--runtime-source",
            "local",
            "--runtime-repo-root",
            repo_root.to_str().expect("repo root path"),
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
