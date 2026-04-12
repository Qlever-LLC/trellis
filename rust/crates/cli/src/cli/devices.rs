use clap::{Args, Subcommand, ValueEnum};

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Review mode enforced for newly activated devices in a profile.
pub enum DeviceReviewMode {
    None,
    Required,
}

impl DeviceReviewMode {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Required => "required",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Allowed device instance state filters.
pub enum DeviceInstanceState {
    Registered,
    Activated,
    Revoked,
    Disabled,
}

impl DeviceInstanceState {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Activated => "activated",
            Self::Revoked => "revoked",
            Self::Disabled => "disabled",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Allowed device activation state filters.
pub enum DeviceActivationState {
    Activated,
    Revoked,
}

impl DeviceActivationState {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::Activated => "activated",
            Self::Revoked => "revoked",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Allowed device review state filters.
pub enum DeviceReviewState {
    Pending,
    Approved,
    Rejected,
}

impl DeviceReviewState {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Debug, Args)]
/// Manage device profiles, instances, activations, and reviews.
pub struct DeviceCommand {
    #[command(subcommand)]
    pub command: DeviceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Device lifecycle surfaces exposed through Trellis auth/admin RPCs.
pub enum DeviceSubcommand {
    /// Provision one new device instance from a device profile.
    Provision(DeviceProvisionArgs),
    /// Manage device profiles.
    Profile(DeviceProfileCommand),
    /// Inspect or disable device instances.
    Instance(DeviceInstanceCommand),
    /// Inspect or revoke device activations.
    Activation(DeviceActivationCommand),
    /// List and decide device activation reviews.
    Review(DeviceReviewCommand),
}

#[derive(Debug, Args)]
/// Manage device profiles.
pub struct DeviceProfileCommand {
    #[command(subcommand)]
    pub command: DeviceProfileSubcommand,
}

#[derive(Debug, Subcommand)]
/// List, create, and disable device profiles.
pub enum DeviceProfileSubcommand {
    /// List configured device profiles.
    List(DeviceProfileListArgs),
    /// Create one device profile and optionally attach its contract.
    Create(DeviceProfileCreateArgs),
    /// Disable one device profile.
    Disable(DeviceProfileDisableArgs),
}

#[derive(Debug, Args)]
/// Manage device instances.
pub struct DeviceInstanceCommand {
    #[command(subcommand)]
    pub command: DeviceInstanceSubcommand,
}

#[derive(Debug, Subcommand)]
/// List and disable device instances.
pub enum DeviceInstanceSubcommand {
    /// List device instances.
    List(DeviceInstanceListArgs),
    /// Disable one device instance.
    Disable(DeviceInstanceDisableArgs),
}

#[derive(Debug, Args)]
/// Manage device activations.
pub struct DeviceActivationCommand {
    #[command(subcommand)]
    pub command: DeviceActivationSubcommand,
}

#[derive(Debug, Subcommand)]
/// List and revoke device activations.
pub enum DeviceActivationSubcommand {
    /// List device activations.
    List(DeviceActivationListArgs),
    /// Revoke one device activation.
    Revoke(DeviceActivationRevokeArgs),
}

#[derive(Debug, Args)]
/// Manage device activation reviews.
pub struct DeviceReviewCommand {
    #[command(subcommand)]
    pub command: DeviceReviewSubcommand,
}

#[derive(Debug, Subcommand)]
/// List, approve, or reject device activation reviews.
pub enum DeviceReviewSubcommand {
    /// List device activation reviews.
    List(DeviceReviewListArgs),
    /// Approve one pending device activation review.
    Approve(DeviceReviewDecisionArgs),
    /// Reject one pending device activation review.
    Reject(DeviceReviewDecisionArgs),
}

#[derive(Debug, Args)]
/// Filter and list device profiles.
pub struct DeviceProfileListArgs {
    #[arg(long = "contract")]
    /// Restrict the list to profiles bound to one contract identifier.
    pub contract: Option<String>,

    #[arg(long)]
    /// Include disabled profiles in the result set.
    pub disabled: bool,
}

#[derive(Debug, Args)]
#[command(
    after_help = "Examples:\n  trellis device profile create reader.standard acme.reader@v1\n  trellis device profile create reader.standard ./contracts/reader.ts --review-mode required"
)]
/// Create one device profile and attach its contract digest policy.
pub struct DeviceProfileCreateArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to create.
    pub profile: String,

    #[arg(value_name = "CONTRACT")]
    /// Contract identifier, source path, manifest path, or embedded contract reference.
    pub contract: String,

    #[arg(long = "review-mode", default_value = "none")]
    /// Review policy applied when devices in this profile activate.
    pub review_mode: DeviceReviewMode,
}

#[derive(Debug, Args)]
/// Disable one device profile.
pub struct DeviceProfileDisableArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to disable.
    pub profile: String,
}

#[derive(Debug, Args)]
/// Provision one new device instance from a profile.
pub struct DeviceProvisionArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to provision against.
    pub profile: String,
}

#[derive(Debug, Args)]
/// List device instances.
pub struct DeviceInstanceListArgs {
    #[arg(long = "profile")]
    /// Restrict the list to one device profile.
    pub profile: Option<String>,

    #[arg(long)]
    /// Restrict the list to one device instance state.
    pub state: Option<DeviceInstanceState>,
}

#[derive(Debug, Args)]
/// Disable one device instance.
pub struct DeviceInstanceDisableArgs {
    #[arg(value_name = "INSTANCE")]
    /// Device instance identifier to disable.
    pub instance: String,
}

#[derive(Debug, Args)]
/// List device activations.
pub struct DeviceActivationListArgs {
    #[arg(long = "instance")]
    /// Restrict the list to one device instance.
    pub instance: Option<String>,

    #[arg(long = "profile")]
    /// Restrict the list to one device profile.
    pub profile: Option<String>,

    #[arg(long)]
    /// Restrict the list to one activation state.
    pub state: Option<DeviceActivationState>,
}

#[derive(Debug, Args)]
/// Revoke one device activation.
pub struct DeviceActivationRevokeArgs {
    #[arg(value_name = "INSTANCE")]
    /// Device instance identifier whose activation should be revoked.
    pub instance: String,
}

#[derive(Debug, Args)]
/// List device activation reviews.
pub struct DeviceReviewListArgs {
    #[arg(long = "instance")]
    /// Restrict the list to one device instance.
    pub instance: Option<String>,

    #[arg(long = "profile")]
    /// Restrict the list to one device profile.
    pub profile: Option<String>,

    #[arg(long)]
    /// Restrict the list to one review state.
    pub state: Option<DeviceReviewState>,
}

#[derive(Debug, Args)]
/// Approve or reject one device activation review.
pub struct DeviceReviewDecisionArgs {
    #[arg(value_name = "REVIEW")]
    /// Device activation review identifier.
    pub review: String,

    #[arg(long)]
    /// Optional reason code to attach to the review decision.
    pub reason: Option<String>,
}
