use std::fs;
use std::path::Path;
use std::process::Command;

fn write_ts_contract(path: &Path, id: &str, display_name: &str, kind: &str) {
    fs::write(
        path,
        format!(
            "export const CONTRACT = {{\n  format: \"trellis.contract.v1\",\n  id: \"{id}\",\n  displayName: \"{display_name}\",\n  description: \"Fixture contract\",\n  kind: \"{kind}\",\n}};\n"
        ),
    )
    .unwrap();
}

fn write_rust_contract(path: &Path, manifest_name: &str) {
    fs::write(
        path,
        format!("pub const CONTRACT_JSON: &str = include_str!(\"{manifest_name}\");\n"),
    )
    .unwrap();
}

#[test]
fn explicit_generate_all_emits_buildable_sdk_packages() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
    let manifest_path = temp.path().join("trellis.orders@v1.json");
    let ts_out = temp.path().join("ts");
    let rust_out = temp.path().join("rust");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::write(
        project.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &project.join("contracts/orders.ts"),
        "trellis.orders@v1",
        "Orders",
        "service",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .args([
            "generate",
            "all",
            "--source",
            project.join("contracts/orders.ts").to_str().unwrap(),
            "--out-manifest",
            manifest_path.to_str().unwrap(),
            "--ts-out",
            ts_out.to_str().unwrap(),
            "--rust-out",
            rust_out.to_str().unwrap(),
            "--package-name",
            "@qlever-llc/trellis-sdk-orders-test",
            "--crate-name",
            "trellis-sdk-orders-test",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(manifest_path.exists());
    assert!(ts_out.join("mod.ts").exists());
    assert!(rust_out.join("Cargo.toml").exists());
}

#[test]
fn prepare_bootstraps_repo_without_discover_summary() {
    let temp = tempfile::tempdir().unwrap();
    let services = temp.path().join("services/orders");
    let apps = temp.path().join("apps/dashboard");
    fs::create_dir_all(services.join("contracts")).unwrap();
    fs::create_dir_all(apps.join("contracts")).unwrap();
    fs::write(
        services.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    fs::write(apps.join("deno.json"), "{\n  \"version\": \"0.4.0\"\n}\n").unwrap();
    write_ts_contract(
        &services.join("contracts/orders.ts"),
        "trellis.orders@v1",
        "Orders",
        "service",
    );
    write_ts_contract(
        &apps.join("contracts/dashboard.ts"),
        "trellis.dashboard@v1",
        "Dashboard",
        "app",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .args(["prepare", temp.path().to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(!stdout.contains("Plan"));
    assert!(temp
        .path()
        .join("generated/contracts/manifests/trellis.orders@v1.json")
        .exists());
}

#[test]
fn local_mode_generates_service_artifacts_from_nearest_project_root() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::create_dir_all(project.join("src/nested")).unwrap();
    fs::write(
        project.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &project.join("contracts/orders.ts"),
        "trellis.orders@v1",
        "Orders",
        "service",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .current_dir(project.join("src/nested"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(project
        .join("generated/contracts/manifests/trellis.orders@v1.json")
        .exists());
    assert!(project.join("generated/js/sdks/orders/mod.ts").exists());
    assert!(project
        .join("generated/rust/sdks/orders/Cargo.toml")
        .exists());
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("Trellis Generate"));
}

#[test]
fn discover_mode_summarizes_actions_and_verifies_non_service_contracts() {
    let temp = tempfile::tempdir().unwrap();
    let services = temp.path().join("services/orders");
    let apps = temp.path().join("apps/dashboard");
    fs::create_dir_all(services.join("contracts")).unwrap();
    fs::create_dir_all(apps.join("contracts")).unwrap();
    fs::write(
        services.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    fs::write(apps.join("deno.json"), "{\n  \"version\": \"0.4.0\"\n}\n").unwrap();
    write_ts_contract(
        &services.join("contracts/orders.ts"),
        "trellis.orders@v1",
        "Orders",
        "service",
    );
    write_ts_contract(
        &apps.join("contracts/dashboard.ts"),
        "trellis.dashboard@v1",
        "Dashboard",
        "app",
    );

    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .args(["discover", temp.path().to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("Plan"));
    assert!(stdout.contains("trellis.orders@v1"));
    assert!(stdout.contains("generate"));
    assert!(stdout.contains("trellis.dashboard@v1"));
    assert!(stdout.contains("verify"));
    assert!(temp
        .path()
        .join("generated/contracts/manifests/trellis.orders@v1.json")
        .exists());
    assert!(!apps.join("generated").exists());
}

#[test]
fn local_mode_generates_service_artifacts_from_rust_contract_sources() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("rust-service");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"rust-service\"\nversion = \"0.4.0\"\nedition = \"2021\"\n\n[dependencies]\n",
    )
    .unwrap();
    write_rust_contract(
        &project.join("contracts/service.rs"),
        "service.manifest.json",
    );
    fs::write(
        project.join("contracts/service.manifest.json"),
        concat!(
            "{\n",
            "  \"format\": \"trellis.contract.v1\",\n",
            "  \"id\": \"trellis.rust-service@v1\",\n",
            "  \"displayName\": \"Rust Service\",\n",
            "  \"description\": \"Fixture contract\",\n",
            "  \"kind\": \"service\"\n",
            "}\n"
        ),
    )
    .unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
        .current_dir(&project)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(project
        .join("generated/contracts/manifests/trellis.rust-service@v1.json")
        .exists());
    assert!(project
        .join("generated/js/sdks/rust-service/mod.ts")
        .exists());
    assert!(project
        .join("generated/rust/sdks/rust-service/Cargo.toml")
        .exists());
}
