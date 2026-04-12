use clap::Parser;

use crate::cli::{Cli, GenerateSubcommand, TopLevelCommand};
use crate::commands::{discover, generate, prepare};

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
        None => discover::local_generate(cli.force),
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
