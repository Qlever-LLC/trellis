use std::process::Command;

fn run_cli(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_trellis"))
        .args(args)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("run trellis")
}

#[test]
fn generate_commands_are_rejected() {
    let output = run_cli(&["generate"]);
    assert!(!output.status.success(), "generate command should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'generate'"));
}

#[test]
fn plural_portal_command_is_rejected() {
    let output = run_cli(&["portals", "list"]);
    assert!(
        !output.status.success(),
        "plural portal command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'portals'"));
}

#[test]
fn plural_device_command_is_rejected() {
    let output = run_cli(&["devices", "provision", "reader.standard"]);
    assert!(
        !output.status.success(),
        "plural device command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'devices'"));
}

#[test]
fn contract_command_is_rejected() {
    let output = run_cli(&["contract", "verify-live"]);
    assert!(!output.status.success(), "contract command should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'contract'"));
}

#[test]
fn contracts_command_is_rejected() {
    let output = run_cli(&["contracts", "pack"]);
    assert!(!output.status.success(), "contracts command should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'contracts'"));
}

#[test]
fn sdk_generate_is_rejected() {
    let output = run_cli(&["sdk", "generate", "rust"]);
    assert!(!output.status.success(), "sdk generate should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'sdk'"));
}

#[test]
fn portal_help_is_rejected() {
    let output = run_cli(&["portal", "--help"]);
    assert!(!output.status.success(), "portal help should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'portal'"));
}

#[test]
fn deploy_help_remains_available_with_aliases() {
    let output = run_cli(&["deploy", "--help"]);
    assert!(output.status.success(), "deploy help should succeed");

    let alias_output = run_cli(&["d", "--help"]);
    assert!(
        alias_output.status.success(),
        "deploy alias help should succeed"
    );

    for alias in ["deployment", "deployments", "dep"] {
        let output = run_cli(&[alias, "--help"]);
        assert!(output.status.success(), "{alias} alias help should succeed");
    }
}

#[test]
fn top_level_help_hides_transport_flags() {
    let output = run_cli(&["--help"]);
    assert!(output.status.success(), "top-level help should succeed");
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(!stdout.contains("--nats-servers"));
    assert!(!stdout.contains("--servers <SERVERS>"));
    assert!(!stdout.contains("--creds <CREDS>"));
}

#[test]
fn portal_device_help_is_rejected() {
    let output = run_cli(&["portal", "device", "--help"]);
    assert!(!output.status.success(), "portal device help should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'portal'"));
}

#[test]
fn top_level_device_command_is_rejected() {
    let output = run_cli(&["device", "--help"]);
    assert!(!output.status.success(), "device command should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'device'"));
}

#[test]
fn auth_approval_help_remains_available() {
    let output = run_cli(&["auth", "approval", "--help"]);
    assert!(output.status.success(), "auth approval help should succeed");
}

#[test]
fn self_help_remains_available() {
    let output = run_cli(&["self", "--help"]);
    assert!(output.status.success(), "self help should succeed");
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(!stdout.contains("--nats-servers"));
    assert!(!stdout.contains("--creds <CREDS>"));
}

#[test]
fn completion_help_remains_available() {
    let output = run_cli(&["completion", "--help"]);
    assert!(output.status.success(), "completion help should succeed");
}

#[test]
fn version_command_remains_available() {
    let output = run_cli(&["version"]);
    assert!(output.status.success(), "version should succeed");
}

#[test]
fn auth_login_help_hides_transport_flags() {
    let output = run_cli(&["auth", "login", "--help"]);
    assert!(output.status.success(), "auth login help should succeed");
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("<TRELLIS_URL>"));
    assert!(!stdout.contains("--auth-url"));
    assert!(!stdout.contains("--nats-servers"));
    assert!(!stdout.contains("--servers <SERVERS>"));
    assert!(!stdout.contains("--creds <CREDS>"));
    assert!(!stdout.contains("--listen"));
}

#[test]
fn bootstrap_admin_help_uses_storage_path() {
    let output = run_cli(&["bootstrap", "admin", "--help"]);
    assert!(
        output.status.success(),
        "bootstrap admin help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--db-path <DB_PATH>"));
    assert!(!stdout.contains("--servers <SERVERS>"));
    assert!(!stdout.contains("--creds <CREDS>"));
}

#[test]
fn legacy_completions_command_is_rejected() {
    let output = run_cli(&["completions", "bash"]);
    assert!(
        !output.status.success(),
        "legacy completions command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'completions'"));
}

#[test]
fn legacy_device_review_decide_command_is_rejected() {
    let output = run_cli(&[
        "device",
        "activation",
        "review",
        "decide",
        "dar_123",
        "--approve",
    ]);
    assert!(
        !output.status.success(),
        "legacy device review decide command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'device'"));
}

#[test]
fn legacy_device_review_command_is_rejected() {
    let output = run_cli(&["device", "review", "list"]);
    assert!(
        !output.status.success(),
        "legacy top-level device review command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'device'"));
}

#[test]
fn legacy_device_provision_command_is_rejected() {
    let output = run_cli(&["device", "provision", "reader.standard"]);
    assert!(
        !output.status.success(),
        "legacy top-level device provision command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'device'"));
}

#[test]
fn portal_login_set_help_is_rejected() {
    let output = run_cli(&["portal", "login", "set", "--help"]);
    assert!(
        !output.status.success(),
        "portal login set help should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'portal'"));
}

#[test]
fn portal_device_set_help_is_rejected() {
    let output = run_cli(&["portal", "device", "set", "--help"]);
    assert!(
        !output.status.success(),
        "portal device set help should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'portal'"));
}

#[test]
fn deploy_create_help_shows_review_mode_enum_values() {
    let output = run_cli(&["deploy", "create", "dev/example", "--help"]);
    assert!(output.status.success(), "deploy create help should succeed");
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--review-mode <REVIEW_MODE>"));
    assert!(stdout.contains("possible values: none, required"));
}

#[test]
fn deploy_instances_help_shows_state_enum_values() {
    let output = run_cli(&["deploy", "instances", "dev/example", "--help"]);
    assert!(
        output.status.success(),
        "deploy instances help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--state <STATE>"));
    assert!(stdout.contains("activated"));
    assert!(stdout.contains("revoked"));
}

#[test]
fn deploy_service_apply_command_is_rejected() {
    let output = run_cli(&["deploy", "apply", "svc/example", "--help"]);
    assert!(!output.status.success(), "deploy apply should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'apply'"));
}

#[test]
fn deploy_device_unapply_command_is_rejected() {
    let output = run_cli(&["deploy", "unapply", "dev/example", "trellis.app@v1"]);
    assert!(!output.status.success(), "deploy unapply should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'unapply'"));
}

#[test]
fn deploy_apply_json_command_is_rejected() {
    let output = run_cli(&["--format", "json", "deploy", "apply", "svc/default"]);
    assert!(!output.status.success(), "deploy apply should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'apply'"));
}

#[test]
fn top_level_service_command_is_rejected() {
    let output = run_cli(&["service", "profile", "create", "--help"]);
    assert!(!output.status.success(), "service command should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'service'"));
}

#[test]
fn deploy_review_help_remains_available() {
    let output = run_cli(&["deploy", "review", "--help"]);
    assert!(output.status.success(), "deploy review help should succeed");
}
