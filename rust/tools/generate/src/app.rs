use clap::Parser;

use crate::cli::{Cli, GenerateSubcommand, SelfCommand, SelfSubcommand, TopLevelCommand};
use crate::commands::{discover, generate, prepare};
use crate::output;
use crate::self_update::{
    check_for_update, install_update, ReleaseChannel, SelfUpdateTarget, UpdateResult,
};

const SELF_UPDATE_TARGET: SelfUpdateTarget = SelfUpdateTarget::new(
    "qlever-llc",
    "trellis",
    "trellis-generate",
    env!("CARGO_PKG_VERSION"),
);

pub fn run() -> miette::Result<()> {
    run_cli(Cli::parse())
}

fn run_cli(cli: Cli) -> miette::Result<()> {
    match cli.command {
        Some(TopLevelCommand::Prepare(args)) => prepare::run(&args, cli.force),
        Some(TopLevelCommand::Discover(args)) => discover::discover(&args, cli.force),
        Some(TopLevelCommand::Generate(command)) => match command.command {
            GenerateSubcommand::Manifest(args) => generate::manifest(&args),
            GenerateSubcommand::Ts(args) => generate::ts_sdk(&args),
            GenerateSubcommand::Rust(args) => generate::rust_sdk(&args),
            GenerateSubcommand::All(args) => generate::all(&args, cli.force),
        },
        Some(TopLevelCommand::Self_(command)) => self_command(command),
        None => discover::local_generate(cli.force),
    }
}

fn self_command(command: SelfCommand) -> miette::Result<()> {
    match command.command {
        SelfSubcommand::Check(args) => {
            let check = check_for_update(
                SELF_UPDATE_TARGET,
                ReleaseChannel::from_prerelease_flag(args.prerelease),
            )?;
            if check.needs_update {
                output::print_info(&format!(
                    "update available: {} -> {}",
                    check.current_version, check.latest_version
                ));
            } else {
                output::print_info(&format!("up to date: {}", check.current_version));
            }
            Ok(())
        }
        SelfSubcommand::Update(args) => {
            let result = install_update(
                SELF_UPDATE_TARGET,
                ReleaseChannel::from_prerelease_flag(args.prerelease),
            )?;
            match result {
                UpdateResult::UpToDate { version } => {
                    output::print_info(&format!("up to date: {version}"));
                }
                UpdateResult::Updated { version } => {
                    output::print_success(&format!("updated trellis-generate to {version}"));
                }
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use trellis_contracts::ContractKind;

    use crate::planning::{action_for_kind, contract_kind_label, AutoAction};

    #[test]
    fn device_kind_uses_device_string_and_verifies() {
        assert_eq!(
            crate::discovery::parse_contract_kind("device").unwrap(),
            ContractKind::Device
        );
        assert_eq!(contract_kind_label(&ContractKind::Device), "device");
        assert_eq!(action_for_kind(&ContractKind::Device), AutoAction::Verify);
    }
}
