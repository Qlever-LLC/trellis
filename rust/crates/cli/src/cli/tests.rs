use super::*;
use clap::Parser;

#[test]
fn rejects_portal_command_tree() {
    let error = Cli::try_parse_from(["trellis", "portal", "list"])
        .expect_err("portal command tree should fail");

    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
}

#[test]
fn rejects_auth_grant_command() {
    let error = Cli::try_parse_from(["trellis", "auth", "grant", "list"])
        .expect_err("auth grant command should fail");

    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    assert!(error.to_string().contains("grant"));
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
fn parses_bootstrap_local_nats_defaults() {
    let cli = Cli::parse_from([
        "trellis",
        "bootstrap",
        "local-nats",
        "--out",
        "./local-nats",
    ]);

    match cli.command {
        TopLevelCommand::Bootstrap(command) => match command.command {
            BootstrapSubcommand::LocalNats(args) => {
                assert_eq!(args.out, std::path::PathBuf::from("./local-nats"));
                assert!(!args.force);
                assert_eq!(args.container_runtime, LocalNatsContainerRuntimeArg::Auto);
                assert_eq!(args.nats_box_image, "docker.io/natsio/nats-box:latest");
                assert_eq!(args.operator_name, "Qlever");
                assert_eq!(args.system_account, "SYS");
                assert_eq!(args.auth_account, "AUTH");
                assert_eq!(args.trellis_account, "TRELLIS");
                assert_eq!(args.server_name, "trellis-local");
            }
            other => panic!("unexpected bootstrap command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_bootstrap_local_nats_overrides() {
    let cli = Cli::parse_from([
        "trellis",
        "bootstrap",
        "local-nats",
        "--out",
        "./nats",
        "--force",
        "--container-runtime",
        "podman",
        "--nats-box-image",
        "example/nats-box:dev",
        "--operator-name",
        "Acme",
        "--system-account",
        "SYSTEM",
        "--auth-account",
        "LOGIN",
        "--trellis-account",
        "APP",
        "--server-name",
        "dev-nats",
    ]);

    match cli.command {
        TopLevelCommand::Bootstrap(command) => match command.command {
            BootstrapSubcommand::LocalNats(args) => {
                assert_eq!(args.out, std::path::PathBuf::from("./nats"));
                assert!(args.force);
                assert_eq!(args.container_runtime, LocalNatsContainerRuntimeArg::Podman);
                assert_eq!(args.nats_box_image, "example/nats-box:dev");
                assert_eq!(args.operator_name, "Acme");
                assert_eq!(args.system_account, "SYSTEM");
                assert_eq!(args.auth_account, "LOGIN");
                assert_eq!(args.trellis_account, "APP");
                assert_eq!(args.server_name, "dev-nats");
            }
            other => panic!("unexpected bootstrap command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_bootstrap_admin_account_identity() {
    let cli = Cli::parse_from([
        "trellis",
        "bootstrap",
        "admin",
        "--provider",
        "github",
        "--subject",
        "ada",
        "--capabilities",
        "admin,trellis.core::trellis.catalog.read",
        "--db-path",
        "/tmp/trellis.sqlite",
    ]);

    match cli.command {
        TopLevelCommand::Bootstrap(command) => match command.command {
            BootstrapSubcommand::Admin(args) => {
                assert_eq!(args.provider, "github");
                assert_eq!(args.subject, "ada");
                assert_eq!(
                    args.capabilities,
                    vec![
                        "admin".to_string(),
                        "trellis.core::trellis.catalog.read".to_string()
                    ]
                );
                assert_eq!(
                    args.db_path,
                    std::path::PathBuf::from("/tmp/trellis.sqlite")
                );
            }
            other => panic!("unexpected bootstrap command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
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
fn parses_deploy_remove_force_and_cascade_separately() {
    let cli = Cli::parse_from([
        "trellis",
        "deploy",
        "remove",
        "svc/api",
        "-f",
        "--cascade",
        "--purge-unused-contracts",
    ]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Remove(args) => {
                assert_eq!(args.reference.kind, DeployKind::Service);
                assert_eq!(args.reference.id, "api");
                assert!(args.force);
                assert!(args.cascade);
                assert!(args.purge_unused_contracts);
                args.validate().expect("service purge flags are valid");
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from(["trellis", "deploy", "remove", "dev/reader", "--cascade"]);
    match cli.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Remove(args) => {
                assert_eq!(args.reference.kind, DeployKind::Device);
                assert_eq!(args.reference.id, "reader");
                assert!(!args.force);
                assert!(args.cascade);
                assert!(!args.purge);
                assert!(!args.purge_unused_contracts);
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn rejects_deploy_remove_purge_flags_without_cascade() {
    let contracts_error = Cli::try_parse_from([
        "trellis",
        "deploy",
        "remove",
        "svc/api",
        "--purge-unused-contracts",
    ])
    .expect_err("unused contract purge should require cascade");
    assert_eq!(
        contracts_error.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );
    assert!(contracts_error.to_string().contains("--cascade"));

    let purge_error = Cli::try_parse_from(["trellis", "deploy", "remove", "svc/api", "--purge"])
        .expect_err("purge should require cascade");
    assert_eq!(
        purge_error.kind(),
        clap::error::ErrorKind::MissingRequiredArgument
    );
    assert!(purge_error.to_string().contains("--cascade"));
}

#[test]
fn deploy_remove_purge_expands_to_unused_contract_purge() {
    let service = Cli::parse_from([
        "trellis",
        "deploy",
        "remove",
        "svc/api",
        "--cascade",
        "--purge",
    ]);
    match service.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Remove(args) => {
                assert_eq!(args.reference.kind, DeployKind::Service);
                assert!(args.purge);
                assert!(args.should_purge_unused_contracts());
                args.validate().expect("service --purge is valid");
            }
            other => panic!("unexpected deploy command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let device = Cli::parse_from([
        "trellis",
        "deploy",
        "remove",
        "dev/reader",
        "--cascade",
        "--purge",
    ]);
    match device.command {
        TopLevelCommand::Deploy(command) => match command.command {
            DeploySubcommand::Remove(args) => {
                assert_eq!(args.reference.kind, DeployKind::Device);
                assert!(args.purge);
                assert!(args.should_purge_unused_contracts());
                args.validate().expect("device --purge is valid");
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
fn parses_auth_approval_revoke_identity_envelope_id_positional() {
    let cli = Cli::parse_from([
        "trellis",
        "auth",
        "approval",
        "revoke",
        "ienv_123",
        "--user",
        "acme.alice",
    ]);
    match cli.command {
        TopLevelCommand::Auth(command) => match command.command {
            AuthSubcommand::Approval(command) => match command.command {
                AuthApprovalSubcommand::Revoke(args) => {
                    assert_eq!(args.identity_envelope_id, "ienv_123");
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
    assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
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
