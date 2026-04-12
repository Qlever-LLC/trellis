use clap::{Args, Subcommand};

#[derive(Debug, Args)]
/// Manage custom portal applications used for Trellis login and device flows.
pub struct PortalCommand {
    #[command(subcommand)]
    pub command: PortalSubcommand,
}

#[derive(Debug, Subcommand)]
/// Portal registration plus login and device portal policy.
pub enum PortalSubcommand {
    /// List all registered custom portals.
    List,
    /// Register a custom portal application.
    Create(PortalCreateArgs),
    /// Disable one registered custom portal.
    Disable(PortalDisableArgs),
    /// Manage login portal defaults and contract-specific selections.
    Login(PortalLoginCommand),
    /// Manage device portal defaults and profile-specific selections.
    Device(PortalDeviceCommand),
}

#[derive(Debug, Args)]
/// Manage portal policy for browser login flows.
pub struct PortalLoginCommand {
    #[command(subcommand)]
    pub command: PortalLoginSubcommand,
}

#[derive(Debug, Subcommand)]
/// Read and update login portal defaults and selections.
pub enum PortalLoginSubcommand {
    /// Show the deployment-wide login portal default.
    Default,
    /// Update the deployment-wide login portal default.
    SetDefault(PortalDefaultSetArgs),
    /// List contract-specific login portal selections.
    List,
    /// Set the login portal for one browser contract.
    Set(PortalLoginSetArgs),
    /// Clear the login portal selection for one browser contract.
    Clear(PortalLoginClearArgs),
}

#[derive(Debug, Args)]
/// Manage portal policy for device flows.
pub struct PortalDeviceCommand {
    #[command(subcommand)]
    pub command: PortalDeviceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Read and update device portal defaults and selections.
pub enum PortalDeviceSubcommand {
    /// Show the deployment-wide device portal default.
    Default,
    /// Update the deployment-wide device portal default.
    SetDefault(PortalDefaultSetArgs),
    /// List profile-specific device portal selections.
    List,
    /// Set the device portal for one device profile.
    Set(PortalDeviceSetArgs),
    /// Clear the device portal selection for one device profile.
    Clear(PortalDeviceClearArgs),
}

#[derive(Debug, Args, Clone)]
#[group(required = true, multiple = false)]
/// Select either the built-in Trellis portal or one registered custom portal.
pub struct PortalTargetArgs {
    #[arg(long)]
    /// Use the built-in Trellis portal instead of a registered custom portal.
    pub builtin: bool,

    #[arg(long = "portal", value_name = "PORTAL")]
    /// Use one registered custom portal by portal identifier.
    pub portal_id: Option<String>,
}

#[derive(Debug, Args)]
/// Register a custom portal application.
pub struct PortalCreateArgs {
    #[arg(value_name = "PORTAL")]
    /// Stable identifier for the custom portal.
    pub portal_id: String,

    #[arg(value_name = "ENTRY_URL")]
    /// Browser entry URL for the portal application.
    pub entry_url: String,

    #[arg(long = "app-contract-id")]
    /// Optional browser app contract attached to this portal.
    pub app_contract_id: Option<String>,
}

#[derive(Debug, Args)]
/// Disable a registered custom portal.
pub struct PortalDisableArgs {
    #[arg(value_name = "PORTAL")]
    /// Portal identifier to disable.
    pub portal_id: String,
}

#[derive(Debug, Args)]
/// Update one deployment-wide portal default.
pub struct PortalDefaultSetArgs {
    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
/// Set the login portal selection for one browser contract.
pub struct PortalLoginSetArgs {
    #[arg(value_name = "CONTRACT_ID")]
    /// Browser contract identifier to map to a portal.
    pub contract_id: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
/// Clear the login portal selection for one browser contract.
pub struct PortalLoginClearArgs {
    #[arg(value_name = "CONTRACT_ID")]
    /// Browser contract identifier whose portal selection should be removed.
    pub contract_id: String,
}

#[derive(Debug, Args)]
/// Set the device portal selection for one device profile.
pub struct PortalDeviceSetArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to map to a portal.
    pub profile: String,

    #[command(flatten)]
    pub target: PortalTargetArgs,
}

#[derive(Debug, Args)]
/// Clear the device portal selection for one device profile.
pub struct PortalDeviceClearArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier whose portal selection should be removed.
    pub profile: String,
}
