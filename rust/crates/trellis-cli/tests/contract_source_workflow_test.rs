use std::process::Command;

fn write_contract_source_fixture() -> tempfile::TempDir {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    std::fs::write(
        temp_dir.path().join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .expect("write fixture deno manifest");
    std::fs::write(
        temp_dir.path().join("contract.ts"),
        format!(
            "export const CONTRACT = {}\n",
            trellis_cli::cli_contract::cli_contract_json()
        ),
    )
    .expect("write fixture contract source");
    temp_dir
}

#[test]
fn contracts_verify_accepts_source_modules() {
    let temp_dir = write_contract_source_fixture();
    let source_path = temp_dir.path().join("contract.ts");

    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "contracts",
            "verify",
            "--format",
            "json",
            "--source",
            source_path.to_str().expect("source path"),
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
    assert!(stdout.contains("trellis.cli@v1"));
}

#[test]
fn contracts_build_emits_generated_manifest_from_source() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let manifest_path = temp_dir.path().join("trellis.activity@v1.json");
    let source_fixture = write_contract_source_fixture();
    let source_path = source_fixture.path().join("contract.ts");

    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "contracts",
            "build",
            "--source",
            source_path.to_str().expect("source path"),
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
    assert!(emitted.contains("trellis.cli@v1"));
}

#[test]
fn generate_all_emits_buildable_sdk_packages() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let source_path = temp_dir.path().join("contract.ts");
    let manifest_path = temp_dir.path().join("trellis.cli@v1.json");
    let ts_out = temp_dir.path().join("ts");
    let rust_out = temp_dir.path().join("rust");

    std::fs::write(
        temp_dir.path().join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .expect("write fixture deno manifest");
    std::fs::write(
        &source_path,
        format!(
            "export const CONTRACT = {}\n",
            trellis_cli::cli_contract::cli_contract_json()
        ),
    )
    .expect("write fixture contract source");

    let output = Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args([
            "generate",
            "all",
            "--source",
            source_path.to_str().expect("source path"),
            "--out-manifest",
            manifest_path.to_str().expect("manifest path"),
            "--ts-out",
            ts_out.to_str().expect("ts out path"),
            "--rust-out",
            rust_out.to_str().expect("rust out path"),
            "--package-name",
            "@qlever-llc/trellis-sdk-cli-test",
            "--crate-name",
            "trellis-sdk-cli-test",
        ])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run trellis generate all");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    for relative in ["mod.ts", "api.ts", "contract.ts", "schemas.ts", "types.ts"] {
        assert!(ts_out.join(relative).exists(), "missing {relative}");
    }

    for relative in [
        "Cargo.toml",
        "src/lib.rs",
        "src/contract.rs",
        "src/client.rs",
        "src/server.rs",
        "src/rpc.rs",
        "src/events.rs",
        "src/subjects.rs",
        "src/types.rs",
    ] {
        assert!(rust_out.join(relative).exists(), "missing {relative}");
    }

    let emitted = std::fs::read_to_string(&manifest_path).expect("read emitted manifest");
    assert!(emitted.contains("trellis.cli@v1"));
}
