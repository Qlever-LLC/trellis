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
fn portal_help_remains_available() {
    let output = run_cli(&["portal", "--help"]);
    assert!(output.status.success(), "portal help should succeed");
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
fn portal_device_help_remains_available() {
    let output = run_cli(&["portal", "device", "--help"]);
    assert!(output.status.success(), "portal device help should succeed");
}

#[test]
fn device_help_remains_available() {
    let output = run_cli(&["device", "--help"]);
    assert!(output.status.success(), "device help should succeed");
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
    assert!(!stdout.contains("--nats-servers"));
    assert!(!stdout.contains("--servers <SERVERS>"));
    assert!(!stdout.contains("--creds <CREDS>"));
}

#[test]
fn bootstrap_admin_help_keeps_explicit_transport_flags() {
    let output = run_cli(&["bootstrap", "admin", "--help"]);
    assert!(
        output.status.success(),
        "bootstrap admin help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--servers <SERVERS>"));
    assert!(stdout.contains("--creds <CREDS>"));
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
    let output = run_cli(&["device", "review", "decide", "dar_123", "--approve"]);
    assert!(
        !output.status.success(),
        "legacy device review decide command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'decide'"));
}

#[test]
fn portal_login_set_help_describes_target_flags() {
    let output = run_cli(&["portal", "login", "set", "--help"]);
    assert!(
        output.status.success(),
        "portal login set help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--builtin"));
    assert!(stdout.contains("--portal <PORTAL>"));
}

#[test]
fn device_profile_create_help_shows_review_mode_enum_values() {
    let output = run_cli(&["device", "profile", "create", "--help"]);
    assert!(
        output.status.success(),
        "device profile create help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--review-mode <REVIEW_MODE>"));
    assert!(stdout.contains("possible values: none, required"));
}

#[test]
fn device_instance_list_help_shows_state_enum_values() {
    let output = run_cli(&["device", "instance", "list", "--help"]);
    assert!(
        output.status.success(),
        "device instance list help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--state <STATE>"));
    assert!(stdout.contains("registered"));
    assert!(stdout.contains("activated"));
    assert!(stdout.contains("revoked"));
    assert!(stdout.contains("disabled"));
}

#[test]
fn service_install_help_does_not_treat_modifiers_as_primary_inputs() {
    let output = run_cli(&["service", "install", "--help"]);
    assert!(
        output.status.success(),
        "service install help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--manifest <CONTRACT_JSON>"));
    assert!(stdout.contains("--source <CONTRACT_SOURCE>"));
    assert!(stdout.contains("--image <OCI_IMAGE>"));
    assert!(stdout.contains("--source-export <SOURCE_EXPORT>"));
    assert!(stdout.contains("--image-contract-path <IMAGE_CONTRACT_PATH>"));
    assert!(!stdout.contains("--nats-servers"));
    assert!(!stdout.contains("--creds <CREDS>"));
    assert!(!stdout.contains("|--source-export <SOURCE_EXPORT>|"));
    assert!(!stdout.contains("|--image-contract-path <IMAGE_CONTRACT_PATH>|"));
}

#[test]
fn service_remove_help_shows_identity_flags_only() {
    let output = run_cli(&["service", "remove", "--help"]);
    assert!(
        output.status.success(),
        "service remove help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--service-key <SERVICE_KEY>"));
    assert!(stdout.contains("--seed <SEED>"));
    assert!(!stdout.contains("--manifest <CONTRACT_JSON>"));
    assert!(!stdout.contains("--source <CONTRACT_SOURCE>"));
    assert!(!stdout.contains("--image <OCI_IMAGE>"));
}

#[test]
fn service_roll_key_help_shows_identity_flags_only() {
    let output = run_cli(&["service", "roll-key", "--help"]);
    assert!(
        output.status.success(),
        "service roll-key help should succeed"
    );
    let stdout = String::from_utf8(output.stdout).expect("utf8 stdout");
    assert!(stdout.contains("--service-key <SERVICE_KEY>"));
    assert!(stdout.contains("--seed <SEED>"));
    assert!(!stdout.contains("--manifest <CONTRACT_JSON>"));
    assert!(!stdout.contains("--source <CONTRACT_SOURCE>"));
    assert!(!stdout.contains("--image <OCI_IMAGE>"));
}
