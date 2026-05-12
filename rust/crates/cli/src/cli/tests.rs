use super::*;
use clap::Parser;

#[test]
fn parses_login_logout_and_whoami_top_level_commands() {
    let cli = Cli::parse_from(["trellis", "login", "https://trellis.example.com"]);
    match cli.command {
        TopLevelCommand::Login(args) => {
            assert_eq!(args.trellis_url, "https://trellis.example.com");
        }
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from(["trellis", "logout"]);
    assert!(matches!(cli.command, TopLevelCommand::Logout));

    let cli = Cli::parse_from(["trellis", "whoami"]);
    assert!(matches!(cli.command, TopLevelCommand::Whoami));
}

#[test]
fn parses_approvals_revoke_identity_envelope_id_positional() {
    let cli = Cli::parse_from([
        "trellis",
        "approvals",
        "revoke",
        "ienv_123",
        "--user",
        "user_123",
    ]);

    match cli.command {
        TopLevelCommand::Approvals(command) => match command.command {
            ApprovalsSubcommand::Revoke(args) => {
                assert_eq!(args.identity_envelope_id, "ienv_123");
                assert_eq!(args.user.as_deref(), Some("user_123"));
            }
            other => panic!("unexpected approvals command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_users_create_and_edit_options() {
    let cli = Cli::parse_from([
        "trellis",
        "users",
        "create",
        "--name",
        "Ada Lovelace",
        "--email",
        "ada@example.com",
        "--username",
        "ada",
        "--inactive",
        "--capability",
        "trellis.core::trellis.catalog.read",
        "--group",
        "admin",
    ]);

    match cli.command {
        TopLevelCommand::Users(command) => match command.command {
            UsersSubcommand::Create(args) => {
                assert_eq!(args.name.as_deref(), Some("Ada Lovelace"));
                assert_eq!(args.email.as_deref(), Some("ada@example.com"));
                assert_eq!(args.username.as_deref(), Some("ada"));
                assert!(args.inactive);
                assert_eq!(
                    args.capabilities,
                    vec!["trellis.core::trellis.catalog.read".to_string()]
                );
                assert_eq!(args.groups, vec!["admin".to_string()]);
            }
            other => panic!("unexpected users command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from([
        "trellis",
        "users",
        "edit",
        "user_123",
        "--active",
        "--add-group",
        "operators",
        "--clear-capabilities",
    ]);
    match cli.command {
        TopLevelCommand::Users(command) => match command.command {
            UsersSubcommand::Edit(args) => {
                assert_eq!(args.user_id, "user_123");
                assert!(args.active);
                assert_eq!(args.add_groups, vec!["operators".to_string()]);
                assert!(args.clear_capabilities);
            }
            other => panic!("unexpected users command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn rejects_users_edit_conflicting_active_flags() {
    let error = Cli::try_parse_from([
        "trellis",
        "users",
        "edit",
        "user_123",
        "--active",
        "--inactive",
    ])
    .expect_err("active flags conflict");

    assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
}

#[test]
fn parses_service_and_device_list_commands() {
    let cli = Cli::parse_from(["trellis", "svc", "list", "--disabled"]);
    match cli.command {
        TopLevelCommand::Svc(command) => match command.command {
            SvcSubcommand::List(args) => assert!(args.disabled),
            other => panic!("unexpected svc command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from(["trellis", "dev", "list"]);
    match cli.command {
        TopLevelCommand::Dev(command) => match command.command {
            DevSubcommand::List(args) => assert!(!args.disabled),
            other => panic!("unexpected dev command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_target_first_service_and_device_resource_tokens() {
    let cli = Cli::parse_from([
        "trellis",
        "svc",
        "api",
        "apply",
        "--manifest",
        "./trellis.contract.json",
    ]);
    match cli.command {
        TopLevelCommand::Svc(command) => match command.command {
            SvcSubcommand::Resource(raw) => {
                assert_eq!(
                    raw,
                    vec!["api", "apply", "--manifest", "./trellis.contract.json"]
                );
            }
            other => panic!("unexpected svc command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from([
        "trellis",
        "dev",
        "reader",
        "reviews",
        "approve",
        "review_123",
        "--reason",
        "approved_by_policy",
    ]);
    match cli.command {
        TopLevelCommand::Dev(command) => match command.command {
            DevSubcommand::Resource(raw) => assert_eq!(
                raw,
                vec![
                    "reader",
                    "reviews",
                    "approve",
                    "review_123",
                    "--reason",
                    "approved_by_policy"
                ]
            ),
            other => panic!("unexpected dev command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }
}

#[test]
fn parses_local_infra_init_keys_upgrade_version_and_completion() {
    let cli = Cli::parse_from(["trellis", "local", "init", "--out", "./local"]);
    match cli.command {
        TopLevelCommand::Local(command) => match command.command {
            LocalSubcommand::Init(args) => {
                assert_eq!(args.out, std::path::PathBuf::from("./local"));
                assert_eq!(args.container_runtime, LocalNatsContainerRuntimeArg::Auto);
                assert_eq!(args.trellis_port, 3000);
            }
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from([
        "trellis",
        "infra",
        "apply",
        "--trellis-creds",
        "./trellis.creds",
        "--auth-creds",
        "./auth.creds",
        "--jetstream-replicas",
        "3",
    ]);
    match cli.command {
        TopLevelCommand::Infra(command) => match command.command {
            InfraSubcommand::Apply(args) => {
                assert_eq!(
                    args.trellis_creds,
                    std::path::PathBuf::from("./trellis.creds")
                );
                assert_eq!(args.auth_creds, std::path::PathBuf::from("./auth.creds"));
                assert_eq!(args.jetstream_replicas, Some(3));
            }
            other => panic!("unexpected infra command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from([
        "trellis",
        "infra",
        "check",
        "--trellis-creds",
        "./trellis.creds",
        "--auth-creds",
        "./auth.creds",
    ]);
    match cli.command {
        TopLevelCommand::Infra(command) => match command.command {
            InfraSubcommand::Check(args) => {
                assert_eq!(
                    args.trellis_creds,
                    std::path::PathBuf::from("./trellis.creds")
                );
                assert_eq!(args.auth_creds, std::path::PathBuf::from("./auth.creds"));
            }
            other => panic!("unexpected infra command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from([
        "trellis",
        "init",
        "admin",
        "--identity",
        "github:ada",
        "--db-path",
        "/tmp/trellis.sqlite",
    ]);
    match cli.command {
        TopLevelCommand::Init(command) => match command.command {
            InitSubcommand::Admin(args) => {
                assert_eq!(args.identity, "github:ada");
                assert_eq!(
                    args.db_path,
                    std::path::PathBuf::from("/tmp/trellis.sqlite")
                );
            }
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from(["trellis", "keys", "new", "--seed", "abc"]);
    match cli.command {
        TopLevelCommand::Keys(command) => match command.command {
            KeysSubcommand::New(args) => assert_eq!(args.seed.as_deref(), Some("abc")),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from(["trellis", "upgrade", "install", "--prerelease"]);
    match cli.command {
        TopLevelCommand::Upgrade(command) => match command.command {
            UpgradeSubcommand::Install(args) => assert!(args.prerelease),
            other => panic!("unexpected upgrade command: {other:?}"),
        },
        other => panic!("unexpected top-level command: {other:?}"),
    }

    let cli = Cli::parse_from(["trellis", "version"]);
    assert!(matches!(cli.command, TopLevelCommand::Version));

    let cli = Cli::parse_from(["trellis", "completion", "bash"]);
    assert!(matches!(cli.command, TopLevelCommand::Completion { .. }));
}

#[test]
fn rejects_removed_top_level_command_trees_and_aliases() {
    for command in [
        "auth",
        "deploy",
        "deployment",
        "deployments",
        "dep",
        "d",
        "bootstrap",
        "self",
        "keygen",
    ] {
        let error = Cli::try_parse_from(["trellis", command, "--help"])
            .expect_err(&format!("{command} should be rejected"));
        assert_eq!(error.kind(), clap::error::ErrorKind::InvalidSubcommand);
    }
}

#[test]
fn rejects_legacy_auth_login_flags() {
    let error = Cli::try_parse_from(["trellis", "login", "--auth-url", "https://auth.example.com"])
        .unwrap_err();

    assert_eq!(error.kind(), clap::error::ErrorKind::UnknownArgument);
    assert!(error.to_string().contains("--auth-url"));
}
