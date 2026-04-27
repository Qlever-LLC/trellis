use super::*;
use clap::Parser;

#[test]
fn parses_portal_create_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
    ]);
    match cli.command {
        TopLevelCommand::Portal(command) => match command.command {
            PortalSubcommand::Create(args) => {
                assert_eq!(args.portal_id, "main");
                assert_eq!(args.entry_url, "https://portal.example.com/auth");
            }
            other => panic!("unexpected portal command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn rejects_portal_create_contract_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--contract",
        "./js/apps/portal/contracts/trellis_app.ts",
    ])
    .unwrap_err();

    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
    assert!(error.to_string().contains("--contract"));
}

#[test]
fn rejects_portal_create_capability_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--capability",
        "portal.login",
    ])
    .unwrap_err();

    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
    assert!(error.to_string().contains("--capability"));
}

#[test]
fn rejects_portal_create_allow_origin_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--allow-origin",
        "https://portal.example.com",
    ])
    .unwrap_err();

    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
    assert!(error.to_string().contains("--allow-origin"));
}

#[test]
fn parses_portal_profile_set_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portal",
        "profile",
        "set",
        "main",
        "https://portal.example.com/auth",
        "./js/apps/portal/contracts/trellis_app.ts",
        "--allow-origin",
        "https://portal.example.com",
    ]);
    match cli.command {
        TopLevelCommand::Portal(command) => match command.command {
            PortalSubcommand::Profile(profile) => match profile.command {
                PortalProfileSubcommand::Set(args) => {
                    assert_eq!(args.portal_id, "main");
                    assert_eq!(args.entry_url, "https://portal.example.com/auth");
                    assert_eq!(args.contract, "./js/apps/portal/contracts/trellis_app.ts");
                    assert_eq!(args.allowed_origins, vec!["https://portal.example.com"]);
                }
                other => panic!("unexpected portal profile command: {other:?}"),
            },
            other => panic!("unexpected portal command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_portal_profile_disable_command() {
    let cli = Cli::parse_from(["trellis", "portal", "profile", "disable", "main"]);
    match cli.command {
        TopLevelCommand::Portal(command) => match command.command {
            PortalSubcommand::Profile(profile) => match profile.command {
                PortalProfileSubcommand::Disable(args) => {
                    assert_eq!(args.portal_id, "main");
                }
                other => panic!("unexpected portal profile command: {other:?}"),
            },
            other => panic!("unexpected portal command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn rejects_removed_portal_create_app_contract_id_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--app-contract-id",
        "trellis.portal@v1",
    ])
    .unwrap_err();

    assert!(error.to_string().contains("--app-contract-id"));
}

#[test]
fn rejects_removed_portal_create_manifest_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--manifest",
        "./contracts/portal-app.json",
    ])
    .unwrap_err();

    assert!(error.to_string().contains("--manifest"));
}

#[test]
fn rejects_removed_portal_create_source_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--source",
        "./contracts/portal-app.ts",
    ])
    .unwrap_err();

    assert!(error.to_string().contains("--source"));
}

#[test]
fn rejects_removed_portal_create_image_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "portal",
        "create",
        "main",
        "https://portal.example.com/auth",
        "--image",
        "ghcr.io/acme/portal-app:latest",
    ])
    .unwrap_err();

    assert!(error.to_string().contains("--image"));
}

#[test]
fn parses_portal_login_set_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portal",
        "login",
        "set",
        "trellis.console@v1",
        "--portal",
        "main",
    ]);
    match cli.command {
        TopLevelCommand::Portal(command) => match command.command {
            PortalSubcommand::Login(login) => match login.command {
                PortalLoginSubcommand::Set(args) => {
                    assert_eq!(args.contract_id, "trellis.console@v1");
                    assert_eq!(args.target.portal_id.as_deref(), Some("main"));
                    assert!(!args.target.builtin);
                }
                other => panic!("unexpected portal login command: {other:?}"),
            },
            other => panic!("unexpected portal command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_portal_device_set_command() {
    let cli = Cli::parse_from([
        "trellis",
        "portal",
        "device",
        "set",
        "reader.standard",
        "--portal",
        "main",
    ]);
    match cli.command {
        TopLevelCommand::Portal(command) => match command.command {
            PortalSubcommand::Device(device) => match device.command {
                PortalDeviceSubcommand::Set(args) => {
                    assert_eq!(args.deployment, "reader.standard");
                    assert_eq!(args.target.portal_id.as_deref(), Some("main"));
                    assert!(!args.target.builtin);
                }
                other => panic!("unexpected portal device command: {other:?}"),
            },
            other => panic!("unexpected portal command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_portal_device_set_default_builtin_command() {
    let cli = Cli::parse_from(["trellis", "portal", "device", "set-default", "--builtin"]);
    match cli.command {
        TopLevelCommand::Portal(command) => match command.command {
            PortalSubcommand::Device(device) => match device.command {
                PortalDeviceSubcommand::SetDefault(args) => {
                    assert!(args.target.builtin);
                    assert!(args.target.portal_id.is_none());
                }
                other => panic!("unexpected portal device command: {other:?}"),
            },
            other => panic!("unexpected portal command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_auth_grant_set_command() {
    let cli = Cli::parse_from([
        "trellis",
        "auth",
        "grant",
        "set",
        "trellis.console@v1",
        "--capability",
        "admin",
        "--allow-origin",
        "https://console.example.com",
    ]);
    match cli.command {
        TopLevelCommand::Auth(command) => match command.command {
            AuthSubcommand::Grant(grant) => match grant.command {
                AuthGrantSubcommand::Set(args) => {
                    assert_eq!(args.contract, "trellis.console@v1");
                    assert_eq!(args.capabilities, vec!["admin"]);
                    assert_eq!(args.allowed_origins, vec!["https://console.example.com"]);
                }
                other => panic!("unexpected auth grant command: {other:?}"),
            },
            other => panic!("unexpected auth command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_auth_login_command_with_positional_trellis_url() {
    let cli = Cli::parse_from(["trellis", "auth", "login", "https://auth.example.com"]);
    match cli.command {
        TopLevelCommand::Auth(command) => match command.command {
            AuthSubcommand::Login(args) => {
                assert_eq!(args.trellis_url, "https://auth.example.com");
            }
            other => panic!("unexpected auth command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn rejects_auth_login_without_trellis_url() {
    let error = Cli::try_parse_from(["trellis", "auth", "login"]).unwrap_err();

    assert_eq!(
        error.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );
    assert!(error.to_string().contains("<TRELLIS_URL>"));
}

#[test]
fn rejects_legacy_auth_login_auth_url_flag() {
    let error = Cli::try_parse_from([
        "trellis",
        "auth",
        "login",
        "--auth-url",
        "https://auth.example.com",
    ])
    .unwrap_err();

    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
    assert!(error.to_string().contains("--auth-url"));
}

#[test]
fn rejects_legacy_auth_login_listen_flag() {
    let error =
        Cli::try_parse_from(["trellis", "auth", "login", "--listen", "127.0.0.1:0"]).unwrap_err();

    assert!(error.to_string().contains("--listen"));
}

#[test]
fn parses_deploy_device_create_command() {
    let cli = Cli::parse_from([
        "trellis",
        "deploy",
        "create",
        "dev/reader.standard",
        "--review-mode",
        "required",
    ]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Create(args) => {
                assert_eq!(args.reference.kind, DeployKind::Device);
                assert_eq!(args.reference.id, "reader.standard");
                assert_eq!(args.review_mode, DeviceReviewMode::Required);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_create_service_ref() {
    let cli = Cli::parse_from([
        "trellis",
        "deploy",
        "create",
        "svc/api",
        "--namespace",
        "prod,workers",
    ]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Create(args) => {
                assert_eq!(args.reference.kind, DeployKind::Service);
                assert_eq!(args.reference.id, "api");
                assert_eq!(args.namespaces, vec!["prod", "workers"]);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_alias_and_device_ref() {
    let cli = Cli::parse_from(["trellis", "d", "disable", "dev/reader.default"]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Disable(args) => {
                assert_eq!(args.reference.kind, DeployKind::Device);
                assert_eq!(args.reference.id, "reader.default");
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_friendly_explicit_ref() {
    let cli = Cli::parse_from(["trellis", "deployment", "show", "service/api"]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Show(args) => {
                assert_eq!(args.reference.kind, DeployKind::Service);
                assert_eq!(args.reference.id, "api");
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn deploy_device_create_defaults_review_mode_to_none() {
    let cli = Cli::parse_from(["trellis", "deploy", "create", "dev/reader.standard"]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Create(args) => {
                assert_eq!(args.reference.kind, DeployKind::Device);
                assert_eq!(args.review_mode, DeviceReviewMode::None);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_device_provision_command() {
    let cli = Cli::parse_from([
        "trellis",
        "deploy",
        "provision",
        "dev/reader.standard",
        "--name",
        "Front Desk Reader",
        "--serial-number",
        "SN-123",
        "--model-number",
        "MX-10",
        "--metadata",
        "site=lab-a",
        "--metadata",
        "assetTag=42",
    ]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Provision(args) => {
                assert_eq!(args.reference.kind, DeployKind::Device);
                assert_eq!(args.reference.id, "reader.standard");
                assert_eq!(args.name.as_deref(), Some("Front Desk Reader"));
                assert_eq!(args.serial_number.as_deref(), Some("SN-123"));
                assert_eq!(args.model_number.as_deref(), Some("MX-10"));
                assert_eq!(args.metadata, vec!["site=lab-a", "assetTag=42"]);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_device_instances_with_enum_state() {
    let cli = Cli::parse_from([
        "trellis",
        "deploy",
        "instances",
        "dev/reader.standard",
        "--state",
        "activated",
    ]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Instances(args) => {
                assert_eq!(
                    args.target,
                    DeployInstancesTarget::Ref(DeployRef {
                        kind: DeployKind::Device,
                        id: "reader.standard".to_string(),
                    })
                );
                assert_eq!(args.state, Some(DeviceInstanceState::Activated));
                assert!(!args.show_metadata);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_instances_show_metadata_flag() {
    let cli = Cli::parse_from(["trellis", "deploy", "instances", "dev", "--show-metadata"]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Instances(args) => {
                assert_eq!(args.target, DeployInstancesTarget::Kind(DeployKind::Device));
                assert!(args.show_metadata);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_deploy_review_approve_command() {
    let cli = Cli::parse_from([
        "trellis",
        "deploy",
        "review",
        "approve",
        "dar_123",
        "--reason",
        "approved_by_policy",
    ]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Review(review) => match review.command {
                DeployReviewSubcommand::Approve(args) => {
                    assert_eq!(args.review, "dar_123");
                    assert_eq!(args.reason.as_deref(), Some("approved_by_policy"));
                }
                other => panic!("unexpected deploy review command: {other:?}"),
            },
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_auth_approval_revoke_contract_digest_positional() {
    let cli = Cli::parse_from([
        "trellis",
        "auth",
        "approval",
        "revoke",
        "sha256:deadbeef",
        "--user",
        "acme.alice",
    ]);
    match cli.command {
        TopLevelCommand::Auth(command) => match command.command {
            AuthSubcommand::Approval(command) => match command.command {
                AuthApprovalSubcommand::Revoke(args) => {
                    assert_eq!(args.digest, "sha256:deadbeef");
                    assert_eq!(args.user.as_deref(), Some("acme.alice"));
                }
                other => panic!("unexpected approval command: {other:?}"),
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
fn rejects_plural_portal_command() {
    let error = Cli::try_parse_from(["trellis", "portals", "list"])
        .expect_err("plural portal tree should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_plural_device_command() {
    let error = Cli::try_parse_from(["trellis", "devices", "provision", "reader.standard"])
        .expect_err("plural device tree should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_legacy_portal_device_default_nested_set_command() {
    let error = Cli::try_parse_from(["trellis", "portal", "device", "default", "set", "--builtin"])
        .expect_err("nested default set syntax should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn rejects_contract_command_tree() {
    let error = Cli::try_parse_from(["trellis", "contract"])
        .expect_err("contract command tree should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_contracts_command_tree() {
    let error = Cli::try_parse_from(["trellis", "contracts"])
        .expect_err("contracts command tree should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_legacy_device_review_decide_command() {
    let error = Cli::try_parse_from([
        "trellis",
        "device",
        "review",
        "decide",
        "dar_123",
        "--approve",
    ])
    .expect_err("legacy device review decide syntax should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_invalid_device_review_mode() {
    let error = Cli::try_parse_from([
        "trellis",
        "deploy",
        "create",
        "dev/reader.standard",
        "--review-mode",
        "manual",
    ])
    .expect_err("invalid review mode should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidValue);
}

#[test]
fn rejects_invalid_device_instance_state() {
    let error = Cli::try_parse_from([
        "trellis",
        "deploy",
        "instances",
        "dev/reader.standard",
        "--state",
        "pending",
    ])
    .expect_err("invalid instance state should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidValue);
}

#[test]
fn rejects_generate_command_tree() {
    let error = Cli::try_parse_from(["trellis", "generate"]).expect_err("generate should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_sdk_generate_command() {
    let error = Cli::try_parse_from(["trellis", "sdk", "generate", "rust"])
        .expect_err("sdk generate should fail");
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    assert!(error.to_string().contains("sdk"));
}
