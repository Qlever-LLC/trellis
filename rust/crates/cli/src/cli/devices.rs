use clap::{Args, Subcommand, ValueEnum};

use super::service::ContractInputArgs;

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
/// Manage device profiles, instances, and activations.
pub struct DeviceCommand {
    #[command(subcommand)]
    pub command: DeviceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Device lifecycle surfaces exposed through Trellis auth/admin RPCs.
pub enum DeviceSubcommand {
    /// Manage device profiles.
    Profile(DeviceProfileCommand),
    /// Manage device instances.
    Instance(DeviceInstanceCommand),
    /// Manage device activations.
    Activation(DeviceActivationCommand),
}

#[derive(Debug, Args)]
/// Manage device profiles.
pub struct DeviceProfileCommand {
    #[command(subcommand)]
    pub command: DeviceProfileSubcommand,
}

#[derive(Debug, Subcommand)]
/// Manage device profiles.
pub enum DeviceProfileSubcommand {
    /// List configured device profiles.
    List(DeviceProfileListArgs),
    /// Create one device profile.
    Create(DeviceProfileCreateArgs),
    /// Apply one contract lineage or digest set to a device profile.
    Apply(DeviceProfileApplyArgs),
    /// Unapply one contract lineage or digest set from a device profile.
    Unapply(DeviceProfileUnapplyArgs),
    /// Disable one device profile.
    Disable(DeviceProfileToggleArgs),
    /// Enable one device profile.
    Enable(DeviceProfileToggleArgs),
    /// Remove one device profile.
    Remove(DeviceProfileRemoveArgs),
}

#[derive(Debug, Args)]
/// Manage device instances.
pub struct DeviceInstanceCommand {
    #[command(subcommand)]
    pub command: DeviceInstanceSubcommand,
}

#[derive(Debug, Subcommand)]
/// Manage device instances.
pub enum DeviceInstanceSubcommand {
    /// Provision one new device instance from a profile.
    Provision(DeviceProvisionArgs),
    /// List device instances.
    List(DeviceInstanceListArgs),
    /// Disable one device instance.
    Disable(DeviceInstanceToggleArgs),
    /// Enable one device instance.
    Enable(DeviceInstanceToggleArgs),
    /// Remove one device instance.
    Remove(DeviceInstanceRemoveArgs),
}

#[derive(Debug, Args)]
/// Manage device activations.
pub struct DeviceActivationCommand {
    #[command(subcommand)]
    pub command: DeviceActivationSubcommand,
}

#[derive(Debug, Subcommand)]
/// Manage device activations.
pub enum DeviceActivationSubcommand {
    /// List device activations.
    List(DeviceActivationListArgs),
    /// Revoke one device activation.
    Revoke(DeviceActivationRevokeArgs),
    /// Manage device activation reviews.
    Review(DeviceReviewCommand),
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
    after_help = "Examples:\n  trellis device profile create reader.standard\n  trellis device profile create reader.standard --review-mode required"
)]
/// Create one device profile.
pub struct DeviceProfileCreateArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to create.
    pub profile: String,

    #[arg(long = "review-mode", default_value = "none")]
    /// Review policy applied when devices in this profile activate.
    pub review_mode: DeviceReviewMode,
}

#[derive(Debug, Args)]
#[command(
    after_help = "Examples:\n  trellis device profile apply reader.standard --source ./contracts/reader.ts\n  trellis device profile apply reader.standard --manifest ./contracts/reader.json\n  trellis device profile apply reader.standard --image ghcr.io/acme/reader:latest"
)]
/// Apply one contract lineage or digest set to a device profile.
pub struct DeviceProfileApplyArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to update.
    pub profile: String,

    #[command(flatten)]
    pub contract: ContractInputArgs,
}

#[derive(Debug, Args)]
/// Unapply one contract lineage or digest set from a device profile.
pub struct DeviceProfileUnapplyArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to update.
    pub profile: String,

    #[arg(value_name = "CONTRACT")]
    /// Contract identifier to remove from the profile.
    pub contract_id: String,

    #[arg(long = "digest", value_delimiter = ',')]
    /// Optional digest subset to remove from the contract lineage.
    pub digests: Vec<String>,
}

#[derive(Debug, Args)]
/// Disable or enable one device profile.
pub struct DeviceProfileToggleArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to update.
    pub profile: String,
}

#[derive(Debug, Args)]
/// Remove one device profile.
pub struct DeviceProfileRemoveArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to remove.
    pub profile: String,

    #[arg(short = 'f', long)]
    pub force: bool,
}

#[derive(Debug, Args)]
#[command(
    after_help = "Examples:\n  trellis device instance provision reader.standard --name \"Front Desk Reader\" --serial-number SN-123 --model-number MX-10\n  trellis device instance provision reader.standard --metadata site=lab-a --metadata assetTag=42"
)]
/// Provision one new device instance from a profile.
pub struct DeviceProvisionArgs {
    #[arg(value_name = "PROFILE")]
    /// Device profile identifier to provision against.
    pub profile: String,

    #[arg(long)]
    /// Human-friendly device name stored in device metadata.
    pub name: Option<String>,

    #[arg(long = "serial-number")]
    /// Serial number stored in device metadata.
    pub serial_number: Option<String>,

    #[arg(long = "model-number")]
    /// Model number stored in device metadata.
    pub model_number: Option<String>,

    #[arg(long = "metadata", value_name = "KEY=VALUE")]
    /// Additional opaque metadata entry. Repeat to set multiple values.
    pub metadata: Vec<String>,
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

    #[arg(long = "show-metadata")]
    /// Include opaque metadata entries beyond the default name, serial, and model columns.
    pub show_metadata: bool,
}

#[derive(Debug, Args)]
/// Disable or enable one device instance.
pub struct DeviceInstanceToggleArgs {
    #[arg(value_name = "INSTANCE")]
    /// Device instance identifier to update.
    pub instance: String,
}

#[derive(Debug, Args)]
/// Remove one device instance.
pub struct DeviceInstanceRemoveArgs {
    #[arg(value_name = "INSTANCE")]
    /// Device instance identifier to remove.
    pub instance: String,

    #[arg(short = 'f', long)]
    pub force: bool,
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
