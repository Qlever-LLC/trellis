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
fn contracts_build_is_rejected() {
    let output = run_cli(&["contracts", "build"]);
    assert!(!output.status.success(), "contracts build should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'build'"));
}

#[test]
fn contracts_verify_is_rejected() {
    let output = run_cli(&["contracts", "verify"]);
    assert!(!output.status.success(), "contracts verify should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'verify'"));
}

#[test]
fn sdk_generate_is_rejected() {
    let output = run_cli(&["sdk", "generate", "rust"]);
    assert!(!output.status.success(), "sdk generate should fail");
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'sdk'"));
}

#[test]
fn devices_help_remains_available() {
    let output = run_cli(&["devices", "--help"]);
    assert!(output.status.success(), "devices help should succeed");
}

#[test]
fn portals_devices_help_remains_available() {
    let output = run_cli(&["portals", "devices", "--help"]);
    assert!(
        output.status.success(),
        "portals devices help should succeed"
    );
}

#[test]
fn self_help_remains_available() {
    let output = run_cli(&["self", "--help"]);
    assert!(output.status.success(), "self help should succeed");
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
fn legacy_devices_reviews_decide_command_is_rejected() {
    let output = run_cli(&["devices", "reviews", "decide", "dar_123", "--approve"]);
    assert!(
        !output.status.success(),
        "legacy devices reviews decide command should fail"
    );
    let stderr = String::from_utf8(output.stderr).expect("utf8 stderr");
    assert!(stderr.contains("unrecognized subcommand 'decide'"));
}

#[test]
fn contracts_pack_remains_available() {
    let output = run_cli(&["contracts", "pack", "--help"]);
    assert!(
        output.status.success(),
        "contracts pack help should succeed"
    );
}

#[test]
fn contracts_verify_live_remains_available() {
    let output = run_cli(&["contracts", "verify-live", "--help"]);
    assert!(
        output.status.success(),
        "contracts verify-live help should succeed"
    );
}
