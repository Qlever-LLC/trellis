use std::fs;
use std::path::Path;
use std::process::Command;

use trellis_generate::artifacts::trellis_package_version;

fn write_ts_contract(path: &Path, id: &str, display_name: &str, kind: &str) {
    fs::write(
        path,
        format!(
            "const contract = {{\n  format: \"trellis.contract.v1\",\n  id: \"{id}\",\n  displayName: \"{display_name}\",\n  description: \"Fixture contract\",\n  kind: \"{kind}\",\n}};\n\nexport default contract;\n"
        ),
    )
    .unwrap();
}

fn write_rust_contract(path: &Path, manifest_name: &str) {
    fs::write(
        path,
        format!(
            r#"pub fn contract_manifest() -> trellis_contracts::ContractManifest {{
    serde_json::from_str(include_str!("{manifest_name}")).expect("fixture manifest")
}}
"#
        ),
    )
    .unwrap();
}

fn write_rust_manifest(path: &Path, version: &str) {
    fs::write(
        path,
        format!("[package]\nname = \"fixture\"\nversion = \"{version}\"\nedition = \"2021\"\n"),
    )
    .unwrap();
}

fn run_prepare(root: &Path) -> std::process::Output {
    trellis_generate()
        .args(["prepare", root.to_str().unwrap()])
        .output()
        .unwrap()
}

fn trellis_generate() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_trellis-generate"));
    command.env("TRELLIS_TSC_BIN", fake_tsc_path());
    command
}

fn fake_tsc_path() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "trellis-generate-fake-tsc-{}.sh",
        std::process::id()
    ));
    if !path.exists() {
        write_executable(
            &path,
            r#"#!/bin/sh
set -eu
if [ "${1:-}" = "--version" ]; then
  printf 'Version 0.0.0-test\n'
  exit 0
fi
config=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-p" ]; then
    shift
    config="$1"
  fi
  shift || true
done
if [ -z "$config" ]; then
  config="tsconfig.json"
fi
out=$(awk -F'"' '/"outDir"/ { print $4; exit }' "$config")
mkdir -p "$out"
for f in *.ts; do
  base=$(basename "$f" .ts)
  cp "$f" "$out/$base.js"
  cp "$f" "$out/$base.d.ts"
done
"#,
        );
    }
    path
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

    let output = trellis_generate()
        .args([
            "generate",
            "all",
            "--source",
            project.join("contracts/orders.ts").to_str().unwrap(),
            "--out-manifest",
            manifest_path.to_str().unwrap(),
            "--jsr-out",
            ts_out.to_str().unwrap(),
            "--cargo-out",
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
fn explicit_generate_all_defaults_out_of_tree_package_to_trellis_sdk_scope() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
    let manifest_path = temp.path().join("krishi.cloud@v1.json");
    let ts_out = temp.path().join("ts");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::write(
        project.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &project.join("contracts/cloud.ts"),
        "krishi.cloud@v1",
        "Cloud",
        "service",
    );

    let output = trellis_generate()
        .args([
            "generate",
            "all",
            "--source",
            project.join("contracts/cloud.ts").to_str().unwrap(),
            "--out-manifest",
            manifest_path.to_str().unwrap(),
            "--jsr-out",
            ts_out.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let deno = fs::read_to_string(ts_out.join("deno.json")).unwrap();
    assert!(deno.contains("\"name\": \"@trellis-sdk/krishi-cloud\""));
    assert!(deno.contains(&format!(
        "npm:@qlever-llc/trellis@^{}",
        trellis_package_version()
    )));
    assert!(!deno.contains("jsr:@qlever-llc/trellis"));
    assert!(!deno.contains("@qlever-llc/trellis-generated-krishi-cloud"));
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
    fs::write(
        services.join("contracts/orders.ts"),
        r#"const contract = {
  format: "trellis.contract.v1",
  id: "trellis.orders@v1",
  displayName: "Orders",
  description: "Fixture contract",
  kind: "service",
  schemas: {
    Empty: {
      type: "object",
      properties: {},
      required: [],
    },
    Order: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  rpc: {
    "Orders.Get": {
      version: "v1",
      subject: "rpc.v1.Orders.Get",
      input: { schema: "Empty" },
      output: { schema: "Order" },
    },
  },
  operations: {},
  events: {},
};

export default contract;
"#,
    )
    .unwrap();
    fs::write(
        apps.join("contracts/dashboard.ts"),
        r#"const contract = {
  format: "trellis.contract.v1",
  id: "trellis.dashboard@v1",
  displayName: "Dashboard",
  description: "Fixture contract",
  kind: "app",
  schemas: {},
  rpc: {},
  operations: {},
  events: {},
  uses: {
    required: {
      orders: {
        contract: "trellis.orders@v1",
        rpc: { call: ["Orders.Get"] },
      },
    },
  },
};

export default contract;
"#,
    )
    .unwrap();

    let output = trellis_generate()
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
    assert!(temp
        .path()
        .join("generated/contracts/manifests/trellis.dashboard@v1.json")
        .exists());
    assert!(temp
        .path()
        .join("generated/packages/jsr/dashboard/client.ts")
        .exists());
    let client = fs::read_to_string(
        temp.path()
            .join("generated/packages/jsr/dashboard/client.ts"),
    )
    .unwrap();
    assert!(client.contains(
        "request(method: \"Orders.Get\", input: OrdersSdk.OrdersGetInput, opts?: RequestOpts): AsyncResult<OrdersSdk.OrdersGetOutput, BaseError>;"
    ));
    let api =
        fs::read_to_string(temp.path().join("generated/packages/jsr/dashboard/api.ts")).unwrap();
    assert!(api.contains("export const USED_API: UsedApi = {"));
    assert!(api.contains("import { OWNED_API as OrdersApi } from \"../orders/owned_api.ts\";"));
    assert!(api.contains("\"Orders.Get\"() { return OrdersApi.rpc[\"Orders.Get\"]"));
    assert!(!temp
        .path()
        .join("generated/packages/cargo/dashboard/Cargo.toml")
        .exists());
}

#[test]
fn prepare_generates_rust_participant_facade_for_local_device_uses() {
    let temp = tempfile::tempdir().unwrap();
    let service = temp.path().join("service");
    let inventory = temp.path().join("inventory");
    let device = temp.path().join("device");
    fs::create_dir_all(service.join("contracts")).unwrap();
    fs::create_dir_all(inventory.join("contracts")).unwrap();
    fs::create_dir_all(device.join("contracts")).unwrap();
    write_rust_manifest(&service.join("Cargo.toml"), "0.4.0");
    write_rust_manifest(&inventory.join("Cargo.toml"), "0.4.0");
    write_rust_manifest(&device.join("Cargo.toml"), "0.4.0");
    fs::write(
        service.join("contracts/orders.json"),
        r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.orders@v1",
  "displayName": "Orders",
  "description": "Fixture service contract",
  "kind": "service",
  "schemas": {
    "Empty": { "type": "object", "properties": {}, "required": [] },
    "Order": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
  },
  "rpc": {
    "Orders.Get": {
      "version": "v1",
      "subject": "rpc.v1.Orders.Get",
      "input": { "schema": "Empty" },
      "output": { "schema": "Order" }
    }
  }
}
"#,
    )
    .unwrap();
    fs::write(
        inventory.join("contracts/inventory.json"),
        r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.inventory@v1",
  "displayName": "Inventory",
  "description": "Fixture inventory contract",
  "kind": "service",
  "schemas": {
    "Empty": { "type": "object", "properties": {}, "required": [] },
    "Stock": { "type": "object", "properties": { "sku": { "type": "string" } }, "required": ["sku"] }
  },
  "rpc": {
    "Inventory.Get": {
      "version": "v1",
      "subject": "rpc.v1.Inventory.Get",
      "input": { "schema": "Empty" },
      "output": { "schema": "Stock" }
    }
  }
}
"#,
    )
    .unwrap();
    fs::write(
        device.join("contracts/device.json"),
        r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.device@v1",
  "displayName": "Device",
  "description": "Fixture device contract",
  "kind": "device",
  "uses": {
    "required": {
      "orders": {
        "contract": "trellis.orders@v1",
        "rpc": { "call": ["Orders.Get"] }
      },
      "inventory": {
        "contract": "trellis.inventory@v1",
        "rpc": { "call": ["Inventory.Get"] }
      }
    }
  }
}
"#,
    )
    .unwrap();
    write_rust_contract(&service.join("contracts/orders.rs"), "orders.json");
    write_rust_contract(&inventory.join("contracts/inventory.rs"), "inventory.json");
    write_rust_contract(&device.join("contracts/device.rs"), "device.json");

    let output = run_prepare(temp.path());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(temp
        .path()
        .join("generated/packages/cargo/orders/Cargo.toml")
        .exists());
    let participant = temp
        .path()
        .join("generated/packages/cargo-participants/device");
    assert!(participant.join("Cargo.toml").exists());
    assert!(participant.join("src/lib.rs").exists());
    assert!(participant.join("contracts/orders.json").exists());
    assert!(participant.join("contracts/inventory.json").exists());
    assert!(!temp
        .path()
        .join("generated/packages/cargo/device/Cargo.toml")
        .exists());

    let cargo_toml = fs::read_to_string(participant.join("Cargo.toml")).unwrap();
    assert!(cargo_toml.contains("name = \"trellis-participant-device\""));
    assert!(cargo_toml.contains("trellis-sdk-orders = { path = "));
    assert!(cargo_toml.contains("trellis-sdk-inventory = { path = "));
    assert!(!cargo_toml.contains("trellis-sdk-auth"));

    let build_rs = fs::read_to_string(participant.join("build.rs")).unwrap();
    assert!(build_rs.contains("contracts/orders.json"));
    assert!(build_rs.contains("contracts/inventory.json"));
    assert!(!build_rs.contains("contracts/auth.json"));

    fs::write(
        device.join("contracts/device.json"),
        r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.device@v1",
  "displayName": "Device",
  "description": "Fixture device contract",
  "kind": "device",
  "uses": {
    "required": {
      "orders": {
        "contract": "trellis.orders-remote@v1",
        "rpc": { "call": ["Orders.Get"] }
      },
      "inventory": {
        "contract": "trellis.inventory@v1",
        "rpc": { "call": ["Inventory.Get"] }
      }
    }
  }
}
"#,
    )
    .unwrap();

    let output = run_prepare(temp.path());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!participant.exists());

    fs::write(
        device.join("contracts/device.json"),
        r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.device@v1",
  "displayName": "Device",
  "description": "Fixture device contract",
  "kind": "device",
  "uses": {
    "required": {
      "orders": {
        "contract": "trellis.orders-remote@v1",
        "rpc": { "call": ["Orders.Get"] }
      },
      "inventory": {
        "contract": "trellis.inventory-remote@v1",
        "rpc": { "call": ["Inventory.Get"] }
      }
    }
  }
}
"#,
    )
    .unwrap();

    let output = run_prepare(temp.path());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!participant.exists());
}

#[test]
fn prepare_skips_rust_participant_facade_without_local_uses_mappings() {
    let temp = tempfile::tempdir().unwrap();
    let device = temp.path().join("device");
    fs::create_dir_all(device.join("contracts")).unwrap();
    write_rust_manifest(&device.join("Cargo.toml"), "0.4.0");
    fs::write(
        device.join("contracts/device.json"),
        r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.device@v1",
  "displayName": "Device",
  "description": "Fixture device contract",
  "kind": "device"
}
"#,
    )
    .unwrap();
    write_rust_contract(&device.join("contracts/device.rs"), "device.json");

    let output = run_prepare(temp.path());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!temp
        .path()
        .join("generated/packages/cargo-participants/device/Cargo.toml")
        .exists());
}

#[test]
fn prepare_accepts_custom_output_root() {
    let temp = tempfile::tempdir().unwrap();
    let service = temp.path().join("service");
    let out = temp.path().join("artifacts");
    fs::create_dir_all(service.join("contracts")).unwrap();
    fs::write(
        service.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &service.join("contracts/orders.ts"),
        "trellis.orders@v1",
        "Orders",
        "service",
    );

    let output = trellis_generate()
        .args([
            "prepare",
            service.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(out
        .join("generated/contracts/manifests/trellis.orders@v1.json")
        .exists());
    assert!(out.join("generated/packages/jsr/orders/mod.ts").exists());
    assert!(out
        .join("generated/packages/npm/orders/package.json")
        .exists());
    assert!(out
        .join("generated/packages/cargo/orders/Cargo.toml")
        .exists());
    assert!(!service.join("generated").exists());
}

#[test]
fn prepare_ignores_sveltekit_lib_contract() {
    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("js/apps/console");
    fs::create_dir_all(app.join("src/lib")).unwrap();
    fs::write(
        temp.path().join("js/deno.json"),
        "{\n  \"version\": \"0.4.0\",\n  \"workspace\": [\"./apps/console\"]\n}\n",
    )
    .unwrap();
    fs::write(
        app.join("package.json"),
        "{\n  \"name\": \"console\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &app.join("src/lib/contract.ts"),
        "trellis.console@v1",
        "Console",
        "app",
    );

    let output = trellis_generate()
        .args(["prepare", temp.path().to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("No contracts found."));
    assert!(!temp
        .path()
        .join("generated/contracts/manifests/trellis.console@v1.json")
        .exists());
    assert!(!temp
        .path()
        .join("js/generated/packages/jsr/console")
        .exists());
    assert!(!temp
        .path()
        .join("generated/packages/cargo/console/Cargo.toml")
        .exists());
}

#[test]
fn prepare_writes_demo_typescript_sdks_inside_demos_js_workspace() {
    let temp = tempfile::tempdir().unwrap();
    let demos_root = temp.path().join("demos");
    let js_workspace = demos_root.join("js");
    let service = js_workspace.join("rpc/service");
    fs::create_dir_all(service.join("contracts")).unwrap();
    fs::write(
        js_workspace.join("deno.json"),
        "{\n  \"version\": \"0.4.0\",\n  \"workspace\": [\"./rpc/service\"]\n}\n",
    )
    .unwrap();
    fs::write(
        service.join("deno.json"),
        "{\n  \"version\": \"0.4.0\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &service.join("contracts/demo_rpc_service.ts"),
        "trellis.demo-rpc-service@v1",
        "Demo RPC Service",
        "service",
    );

    let output = trellis_generate()
        .args(["prepare", demos_root.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(demos_root
        .join("generated/contracts/manifests/trellis.demo-rpc-service@v1.json")
        .exists());
    assert!(demos_root
        .join("js/generated/packages/jsr/demo-rpc-service/mod.ts")
        .exists());
    assert!(demos_root
        .join("js/generated/packages/jsr/demo-rpc-service/client.ts")
        .exists());
    assert!(demos_root
        .join("generated/packages/cargo/demo-rpc-service/Cargo.toml")
        .exists());
}

#[test]
fn prepare_in_local_runtime_repo_keeps_typescript_package_specifiers() {
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path();
    let app = repo.join("apps/dashboard");
    fs::create_dir_all(app.join("contracts")).unwrap();
    fs::create_dir_all(repo.join("js/packages/trellis")).unwrap();
    fs::create_dir_all(repo.join("rust")).unwrap();
    fs::write(repo.join("js/deno.json"), "{}\n").unwrap();
    fs::write(
        repo.join("rust/Cargo.toml"),
        "[workspace]\nmembers = []\nresolver = \"2\"\n",
    )
    .unwrap();
    fs::write(app.join("deno.json"), "{\n  \"version\": \"0.4.0\"\n}\n").unwrap();
    fs::write(
        app.join("contracts/dashboard.ts"),
        r#"const contract = {
  format: "trellis.contract.v1",
  id: "trellis.dashboard@v1",
  displayName: "Dashboard",
  description: "Fixture contract",
  kind: "app",
  schemas: {
    Empty: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  rpc: {
    "Dashboard.Ping": {
      version: "v1",
      subject: "rpc.v1.Dashboard.Ping",
      input: { schema: "Empty" },
      output: { schema: "Empty" },
    },
  },
  operations: {},
  events: {},
};

export default contract;
"#,
    )
    .unwrap();

    let output = trellis_generate()
        .args(["prepare", repo.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let sdk = repo.join("generated/packages/jsr/dashboard");
    let api = fs::read_to_string(sdk.join("api.ts")).unwrap();
    let owned_api = fs::read_to_string(sdk.join("owned_api.ts")).unwrap();
    let contract = fs::read_to_string(sdk.join("contract.ts")).unwrap();
    let types = fs::read_to_string(sdk.join("types.ts")).unwrap();
    let deno = fs::read_to_string(sdk.join("deno.json")).unwrap();
    let combined = format!("{api}\n{owned_api}\n{contract}\n{types}\n{deno}");

    assert!(owned_api.contains("@qlever-llc/trellis/contracts"));
    assert!(contract.contains("@qlever-llc/trellis"));
    assert!(types.contains("@qlever-llc/trellis"));
    assert!(!sdk.join("scripts/build_npm.ts").exists());
    assert!(!deno.contains("build:npm"));
    assert!(!combined.contains("js/packages/trellis"));
    assert!(!combined.contains("file:"));
}

#[test]
fn local_mode_generates_app_typescript_client_without_rust_sdk() {
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
    assert!(stdout.contains("generate trellis.dashboard@v1"));
    assert!(stdout.contains("generated contract artifacts for trellis.dashboard@v1"));
    assert!(project
        .join("generated/contracts/manifests/trellis.dashboard@v1.json")
        .exists());
    assert!(project
        .join("generated/packages/jsr/dashboard/client.ts")
        .exists());
    assert!(project
        .join("generated/packages/jsr/dashboard/mod.ts")
        .exists());
    assert!(project
        .join("generated/packages/npm/dashboard/package.json")
        .exists());
    assert!(!project.join("generated/packages/cargo/dashboard").exists());
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

    let output = trellis_generate()
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
    assert!(project
        .join("generated/packages/jsr/orders/mod.ts")
        .exists());
    assert!(project
        .join("generated/packages/npm/orders/package.json")
        .exists());
    assert!(project
        .join("generated/packages/cargo/orders/Cargo.toml")
        .exists());
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("Trellis Generate"));
}

#[test]
fn local_mode_generates_service_artifacts_from_top_level_contract_ts() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
    fs::create_dir_all(project.join("src/nested")).unwrap();
    fs::write(
        project.join("package.json"),
        "{\n  \"name\": \"service\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &project.join("contract.ts"),
        "trellis.top-level-orders@v1",
        "Top Level Orders",
        "service",
    );

    let output = trellis_generate()
        .current_dir(project.join("src/nested"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(project
        .join("generated/contracts/manifests/trellis.top-level-orders@v1.json")
        .exists());
    assert!(project
        .join("generated/packages/jsr/top-level-orders/mod.ts")
        .exists());
    assert!(project
        .join("generated/packages/cargo/top-level-orders/Cargo.toml")
        .exists());
}

#[test]
fn local_mode_generates_service_artifacts_from_node_project_contracts() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("node-service");
    let tsx_path = temp.path().join("fake-tsx.sh");
    let tsc_path = temp.path().join("fake-tsc.sh");
    let npm_out = project.join("generated/packages/npm/node-orders");
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
    write_executable(
        &tsc_path,
        &format!(
            "#!/bin/sh
set -eu
if [ \"${{1:-}}\" = \"--version\" ]; then
  printf 'Version 0.0.0-test\\n'
  exit 0
fi
out={}
mkdir -p \"$out/esm\"
for f in *.ts; do
  base=$(basename \"$f\" .ts)
  cp \"$f\" \"$out/esm/$base.js\"
  cp \"$f\" \"$out/esm/$base.d.ts\"
done
",
            npm_out.to_string_lossy()
        ),
    );

    let output = trellis_generate()
        .current_dir(&project)
        .env("TRELLIS_TSX_BIN", &tsx_path)
        .env("TRELLIS_TSC_BIN", &tsc_path)
        .env("TRELLIS_DENO_BIN", "disabled")
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
        .join("generated/packages/jsr/node-orders/mod.ts")
        .exists());
    assert!(npm_out.join("package.json").exists());
    assert!(npm_out.join("README.md").exists());
    assert!(npm_out.join("esm/mod.js").exists());
    assert!(npm_out.join("esm/mod.d.ts").exists());
    assert!(project
        .join("generated/packages/cargo/node-orders/Cargo.toml")
        .exists());
}

#[test]
fn discover_mode_summarizes_generation_actions_for_service_and_app_contracts() {
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

    let output = trellis_generate()
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
    assert!(stdout.contains("generate"));
    assert!(temp
        .path()
        .join("generated/contracts/manifests/trellis.orders@v1.json")
        .exists());
    assert!(!apps.join("generated").exists());
}

#[test]
fn discover_mode_supports_top_level_contract_js() {
    let temp = tempfile::tempdir().unwrap();
    let app = temp.path().join("apps/dashboard");
    fs::create_dir_all(&app).unwrap();
    fs::write(
        app.join("package.json"),
        "{\n  \"name\": \"dashboard\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &app.join("contract.js"),
        "trellis.dashboard-js@v1",
        "Dashboard JS",
        "app",
    );

    let output = trellis_generate()
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
    assert!(stdout.contains("trellis.dashboard-js@v1"));
    assert!(stdout.contains("generate"));
}

#[test]
fn prepare_mode_supports_top_level_contract_js() {
    let temp = tempfile::tempdir().unwrap();
    let service = temp.path().join("services/orders");
    fs::create_dir_all(&service).unwrap();
    fs::write(
        service.join("package.json"),
        "{\n  \"name\": \"orders\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &service.join("contract.js"),
        "trellis.orders-js@v1",
        "Orders JS",
        "service",
    );

    let output = trellis_generate()
        .args(["prepare", temp.path().to_str().unwrap()])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(temp
        .path()
        .join("generated/contracts/manifests/trellis.orders-js@v1.json")
        .exists());
    assert!(temp
        .path()
        .join("generated/packages/jsr/orders-js/mod.ts")
        .exists());
    assert!(temp
        .path()
        .join("generated/packages/cargo/orders-js/Cargo.toml")
        .exists());
}

#[test]
fn local_mode_fails_for_duplicate_contract_layouts() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("service");
    fs::create_dir_all(project.join("contracts")).unwrap();
    fs::write(
        project.join("package.json"),
        "{\n  \"name\": \"service\",\n  \"version\": \"0.4.0\",\n  \"type\": \"module\"\n}\n",
    )
    .unwrap();
    write_ts_contract(
        &project.join("contracts/orders.ts"),
        "trellis.orders@v1",
        "Orders",
        "service",
    );
    write_ts_contract(
        &project.join("contract.ts"),
        "trellis.orders-top-level@v1",
        "Orders Top Level",
        "service",
    );

    let output = trellis_generate().current_dir(&project).output().unwrap();
    assert!(!output.status.success());

    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("has both contracts/"));
    assert!(stderr.contains("choose one layout"));
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

    let output = trellis_generate().current_dir(&project).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    assert!(project
        .join("generated/contracts/manifests/trellis.rust-service@v1.json")
        .exists());
    assert!(project
        .join("generated/packages/jsr/rust-service/mod.ts")
        .exists());
    assert!(project
        .join("generated/packages/cargo/rust-service/Cargo.toml")
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

    fs::remove_file(project.join("generated/packages/jsr/orders/contract.ts")).unwrap();

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

    let cargo_toml = project.join("generated/packages/cargo/orders/Cargo.toml");
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
    assert!(repaired.contains("trellis-service = \"0.4.0\""));
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
            "--jsr-out",
            ts_out.to_str().unwrap(),
            "--cargo-out",
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
            "--jsr-out",
            ts_out.to_str().unwrap(),
            "--cargo-out",
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
