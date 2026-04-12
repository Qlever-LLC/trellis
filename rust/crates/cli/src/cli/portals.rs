use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct PortalsCommand {
    #[command(subcommand)]
    pub command: PortalsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsSubcommand {
    List,
    Create(PortalsCreateArgs),
    Disable(PortalsDisableArgs),
    Logins(PortalsLoginsCommand),
    Devices(PortalsDevicesCommand),
}

#[derive(Debug, Args)]
pub struct PortalsLoginsCommand {
    #[command(subcommand)]
    pub command: PortalsLoginsSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsLoginsSubcommand {
    Default(PortalsDefaultCommand),
    List,
    Set(PortalsLoginsSetArgs),
    Clear(PortalsLoginsClearArgs),
}

#[derive(Debug, Args)]
pub struct PortalsDevicesCommand {
    #[command(subcommand)]
    pub command: PortalsDevicesSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsDevicesSubcommand {
    Default(PortalsDefaultCommand),
    List,
    Set(PortalsDevicesSetArgs),
    Clear(PortalsDevicesClearArgs),
}

#[derive(Debug, Args)]
pub struct PortalsDefaultCommand {
    #[command(subcommand)]
    pub command: PortalsDefaultSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum PortalsDefaultSubcommand {
    Show,
    Set(PortalsDefaultSetArgs),
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
pub struct PortalTargetArgs {
    #[arg(long)]
    pub builtin: bool,

    #[arg(long = "portal")]
    pub portal_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct PortalsCreateArgs {
    #[arg(value_name = "PORTAL")]
    pub portal_id: String,

    #[arg(value_name = "ENTRY_URL")]
    pub entry_url: String,

    #[arg(long = "app-contract-id")]
    pub app_contract_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct PortalsDisableArgs {
    #[arg(value_name = "PORTAL")]
    pub portal_id: String,
}

#[derive(Debug, Args)]
pub struct PortalsDefaultSetArgs {
    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsLoginsSetArgs {
    #[arg(value_name = "CONTRACT_ID")]
    pub contract_id: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsLoginsClearArgs {
    #[arg(value_name = "CONTRACT_ID")]
    pub contract_id: String,
}

#[derive(Debug, Args)]
pub struct PortalsDevicesSetArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
pub struct PortalsDevicesClearArgs {
    #[arg(value_name = "PROFILE")]
    pub profile: String,
}
