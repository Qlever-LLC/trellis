use super::*;
use clap::Parser;

#[test]
fn parses_portals_create_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portals",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--app-contract-id",
        "trellis.portal@v1",
    ]);
    match cli.command {
        TopLevelCommand::Portals(command) => match command.command {
            PortalsSubcommand::Create(args) => {
                assert_eq!(args.portal_id, "main");
                assert_eq!(args.app_contract_id.as_deref(), Some("trellis.portal@v1"));
            }
            other => panic!("unexpected portals command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_portals_logins_set_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portals",
        "logins",
        "set",
        "trellis.console@v1",
        "--portal",
        "main",
    ]);
    match cli.command {
        TopLevelCommand::Portals(command) => match command.command {
            PortalsSubcommand::Logins(logins) => match logins.command {
                PortalsLoginsSubcommand::Set(args) => {
                    assert_eq!(args.contract_id, "trellis.console@v1");
                    assert_eq!(args.target.portal_id.as_deref(), Some("main"));
                    assert!(!args.target.builtin);
                }
                other => panic!("unexpected portal logins command: {other:?}"),
            },
            other => panic!("unexpected portals command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_portals_devices_set_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portals",
        "devices",
        "set",
        "reader.standard",
        "--portal",
        "main",
    ]);
    match cli.command {
        TopLevelCommand::Portals(command) => match command.command {
            PortalsSubcommand::Devices(devices) => match devices.command {
                PortalsDevicesSubcommand::Set(args) => {
                    assert_eq!(args.profile, "reader.standard");
                    assert_eq!(args.target.portal_id.as_deref(), Some("main"));
                    assert!(!args.target.builtin);
                }
                other => panic!("unexpected portal devices command: {other:?}"),
            },
            other => panic!("unexpected portals command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_portals_devices_default_set_builtin_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portals",
        "devices",
        "default",
        "set",
        "--builtin",
    ]);
    match cli.command {
        TopLevelCommand::Portals(command) => match command.command {
            PortalsSubcommand::Devices(devices) => match devices.command {
                PortalsDevicesSubcommand::Default(defaults) => match defaults.command {
                    PortalsDefaultSubcommand::Set(args) => {
                        assert!(args.target.builtin);
                        assert!(args.target.portal_id.is_none());
                    }
                    other => panic!("unexpected devices default command: {other:?}"),
                },
                other => panic!("unexpected portal devices command: {other:?}"),
            },
            other => panic!("unexpected portals command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_devices_profiles_create_command() {
    let cli = Cli::parse_from([
        "trellis",
        "devices",
        "profiles",
        "create",
        "reader.standard",
        "acme.reader@v1",
        "--review-mode",
        "required",
    ]);
    match cli.command {
        TopLevelCommand::Devices(command) => match command.command {
            DevicesSubcommand::Profiles(profiles) => match profiles.command {
                DevicesProfilesSubcommand::Create(args) => {
                    assert_eq!(args.profile, "reader.standard");
                    assert_eq!(args.contract, "acme.reader@v1");
                    assert_eq!(args.review_mode.as_deref(), Some("required"));
                }
                other => panic!("unexpected devices profiles command: {other:?}"),
            },
            other => panic!("unexpected devices command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_devices_provision_command() {
    let cli = Cli::parse_from(["trellis", "devices", "provision", "reader.standard"]);
    match cli.command {
        TopLevelCommand::Devices(command) => match command.command {
            DevicesSubcommand::Provision(args) => {
                assert_eq!(args.profile, "reader.standard");
            }
            other => panic!("unexpected devices command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_devices_reviews_approve_command() {
    let cli = Cli::parse_from([
        "trellis",
        "devices",
        "reviews",
        "approve",
        "dar_123",
        "--reason",
        "approved_by_policy",
    ]);
    match cli.command {
        TopLevelCommand::Devices(command) => match command.command {
            DevicesSubcommand::Reviews(reviews) => match reviews.command {
                DevicesReviewsSubcommand::Approve(args) => {
                    assert_eq!(args.review, "dar_123");
                    assert_eq!(args.reason.as_deref(), Some("approved_by_policy"));
                }
                other => panic!("unexpected devices reviews command: {other:?}"),
            },
            other => panic!("unexpected devices command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_auth_approval_revoke_digest_positional() {
    let cli = Cli::parse_from([
        "trellis",
        "auth",
        "approvals",
        "revoke",
        "sha256:deadbeef",
        "--user",
        "acme.alice",
    ]);
    match cli.command {
        TopLevelCommand::Auth(command) => match command.command {
            AuthSubcommand::Approvals(command) => match command.command {
                AuthApprovalsSubcommand::Revoke(args) => {
                    assert_eq!(args.digest, "sha256:deadbeef");
                    assert_eq!(args.user.as_deref(), Some("acme.alice"));
                }
                other => panic!("unexpected approvals command: {other:?}"),
            },
            other => panic!("unexpected auth command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_self_check_command() {
    let cli = Cli::parse_from(["trellis", "self", "check"]);
    match cli.command {
        TopLevelCommand::Self_(command) => match command.command {
            SelfSubcommand::Check(args) => {
                assert!(!args.prerelease);
            }
            other => panic!("unexpected self command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_self_update_command_with_prerelease() {
    let cli = Cli::parse_from(["trellis", "self", "update", "--prerelease"]);
    match cli.command {
        TopLevelCommand::Self_(command) => match command.command {
            SelfSubcommand::Update(args) => {
                assert!(args.prerelease);
            }
            other => panic!("unexpected self command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_version_command() {
    let cli = Cli::parse_from(["trellis", "version"]);
    assert!(matches!(cli.command, TopLevelCommand::Version));
}

#[test]
fn rejects_legacy_devices_provision_profile_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "devices",
        "provision",
        "--profile",
        "reader.standard",
    ])
    .expect_err("legacy devices provision syntax should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn rejects_legacy_portals_create_portal_id_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portals",
        "create",
        "--portal-id",
        "main",
        "https://portal.example.com/auth",
    ])
    .expect_err("legacy portals create syntax should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn rejects_legacy_devices_reviews_decide_command() {
    let error = Cli::try_parse_from([
        "trellis",
        "devices",
        "reviews",
        "decide",
        "dar_123",
        "--approve",
    ])
    .expect_err("legacy devices reviews decide syntax should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_generate_command_tree() {
    let error = Cli::try_parse_from(["trellis", "generate"]).expect_err("generate should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_contracts_build_command() {
    let error = Cli::try_parse_from(["trellis", "contracts", "build"])
        .expect_err("contracts build should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_contracts_verify_command() {
    let error = Cli::try_parse_from(["trellis", "contracts", "verify"])
        .expect_err("contracts verify should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_sdk_generate_command() {
    let error = Cli::try_parse_from(["trellis", "sdk", "generate", "rust"])
        .expect_err("sdk generate should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    assert!(error.to_string().contains("sdk"));
}
