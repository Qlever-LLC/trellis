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

fn trellis_generate() -> Command {
    Command::new(env!("CARGO_BIN_EXE_trellis-generate"))
}

fn write_executable(path: &Path, script: &str) {
    fs::write(path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }
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
fn local_mode_verifies_non_service_without_detail_block() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("app");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::write(
        project.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &project.join("contracts/dashboard.ts"),
        "trellis.dashboard@v1",
        "Dashboard",
        "app",
    );

    let output = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("verified trellis.dashboard@v1"));
    assert!(!stdout.contains("verify trellis.dashboard@v1"));
    assert!(!stdout.contains("kind: app"));
    assert!(!stdout.contains("source:"));
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
fn local_mode_generates_service_artifacts_from_node_project_contracts() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("node-service");
    let tsx_path = temp.path().join("fake-tsx.sh");
    let support = project.join("node_modules/contract-support");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::create_dir_all(&support).unwrap();
    fs::write(
        project.join("package.json"),
        "{\n  \"name\": \"node-service\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
    )
    .unwrap();
    fs::write(
        support.join("package.json"),
        "{\n  \"name\": \"contract-support\",\n  \"type\": \"module\",\n  \"exports\": \"./index.js\"\n}\n",
    )
    .unwrap();
    fs::write(
        support.join("index.js"),
        "export const CONTRACT_ID = 'trellis.node-orders@v1';\nexport const CONTRACT_KIND = 'service';\n",
    )
    .unwrap();
    fs::write(
        project.join("contracts/orders.ts"),
        concat!(
            "import { CONTRACT_ID, CONTRACT_KIND } from 'contract-support';\n",
            "export const CONTRACT = {\n",
            "  format: 'trellis.contract.v1',\n",
            "  id: CONTRACT_ID,\n",
            "  displayName: 'Node Orders',\n",
            "  description: 'Orders from node project',\n",
            "  kind: CONTRACT_KIND,\n",
            "};\n",
        ),
    )
    .unwrap();

    write_executable(
        &tsx_path,
        "#!/bin/sh
printf '{\"format\":\"trellis.contract.v1\",\"id\":\"trellis.node-orders@v1\",\"displayName\":\"Node Orders\",\"description\":\"Orders from node project\",\"kind\":\"service\"}'
",
    );

    let output = trellis_generate()
        .current_dir(&project)
        .env("TRELLIS_TSX_BIN", &tsx_path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(project
        .join("generated/contracts/manifests/trellis.node-orders@v1.json")
        .exists());
    assert!(project
        .join("generated/js/sdks/node-orders/mod.ts")
        .exists());
    assert!(project
        .join("generated/rust/sdks/node-orders/Cargo.toml")
        .exists());
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

#[test]
fn local_mode_skips_when_generated_artifacts_are_up_to_date() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
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

    let first = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );

    let metadata =
        project.join("generated/contracts/manifests/trellis.orders@v1.trellis-generate.json");
    assert!(metadata.exists());

    let second = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );

    let stdout = String::from_utf8(second.stdout).unwrap();
    assert!(stdout.contains("artifacts already up to date for trellis.orders@v1"));
    assert!(!stdout.contains("generated contract artifacts for trellis.orders@v1"));
}

#[test]
fn local_mode_force_regenerates_when_generated_artifacts_are_up_to_date() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
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

    let first = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );

    let second = trellis_generate()
        .current_dir(&project)
        .arg("--force")
        .output()
        .unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );

    let stdout = String::from_utf8(second.stdout).unwrap();
    assert!(stdout.contains("generated contract artifacts for trellis.orders@v1"));
    assert!(!stdout.contains("artifacts already up to date for trellis.orders@v1"));
}

#[test]
fn local_mode_regenerates_when_a_key_output_is_missing() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
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

    let first = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );

    fs::remove_file(project.join("generated/js/sdks/orders/contract.ts")).unwrap();

    let second = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );

    let stdout = String::from_utf8(second.stdout).unwrap();
    assert!(stdout.contains("generated contract artifacts for trellis.orders@v1"));
}

#[test]
fn local_mode_regenerates_when_rust_sdk_cargo_toml_is_invalid() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
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

    let first = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );

    let cargo_toml = project.join("generated/rust/sdks/orders/Cargo.toml");
    fs::write(
        &cargo_toml,
        concat!(
            "[package]\n",
            "name = \"trellis-sdk-orders\"\n",
            "version = \"0.4.0\"\n",
            "edition = \"2021\"\n\n",
            "[dependencies]\n",
            "trellis-client = \"0.4.0\"\n",
        ),
    )
    .unwrap();

    let second = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );

    let stdout = String::from_utf8(second.stdout).unwrap();
    assert!(stdout.contains("generated contract artifacts for trellis.orders@v1"));
    assert!(!stdout.contains("artifacts already up to date for trellis.orders@v1"));

    let repaired = fs::read_to_string(&cargo_toml).unwrap();
    assert!(repaired.contains("serde = { version = \"1.0\""));
    assert!(repaired.contains("serde_json = \"1.0\""));
    assert!(repaired.contains("trellis-client = \"0.4.0\""));
    assert!(repaired.contains("trellis-contracts = \"0.4.0\""));
    assert!(repaired.contains("trellis-server = \"0.4.0\""));
}

#[test]
fn generate_all_skips_when_metadata_matches_outputs() {
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

    let first = trellis_generate()
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
        ])
        .output()
        .unwrap();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );

    let second = trellis_generate()
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
        ])
        .output()
        .unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );

    let stdout = String::from_utf8(second.stdout).unwrap();
    assert!(stdout.contains("artifacts already up to date for trellis.orders@v1"));
}
