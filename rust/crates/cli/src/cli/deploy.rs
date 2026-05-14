use clap::{Args, Subcommand, ValueEnum};

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Review mode enforced for newly activated devices in a deployment.
pub enum DeviceReviewMode {
    None,
    Required,
}

impl DeviceReviewMode {
    pub fn as_optional_wire_value(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Required => Some("required"),
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

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Allowed deployment envelope expansion request state filters.
pub enum EnvelopeExpansionRequestState {
    Pending,
    Approved,
    Rejected,
}

impl EnvelopeExpansionRequestState {
    pub fn as_wire_value(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
        }
    }
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
/// Manage service deployments.
pub struct SvcCommand {
    #[command(subcommand)]
    pub command: SvcSubcommand,
}

#[derive(Debug, Subcommand)]
/// Service deployment operations.
pub enum SvcSubcommand {
    /// List service deployments.
    List(SvcListArgs),
    /// Operate on one service deployment ID.
    #[command(external_subcommand)]
    Resource(Vec<String>),
}

#[derive(Debug, Args)]
/// List service deployments.
pub struct SvcListArgs {
    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
/// Manage device deployments.
pub struct DevCommand {
    #[command(subcommand)]
    pub command: DevSubcommand,
}

#[derive(Debug, Subcommand)]
/// Device deployment operations.
pub enum DevSubcommand {
    /// List device deployments.
    List(DevListArgs),
    /// Operate on one device deployment ID.
    #[command(external_subcommand)]
    Resource(Vec<String>),
}

#[derive(Debug, Args)]
/// List device deployments.
pub struct DevListArgs {
    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
/// Parsed target-first service deployment command.
pub struct SvcResourceCommand {
    pub id: String,
    pub action: SvcResourceAction,
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
/// Actions available for one service deployment.
pub enum SvcResourceAction {
    Show,
    Create(SvcCreateArgs),
    Apply(ApplyArgs),
    Disable,
    Enable,
    Remove(RemoveArgs),
    Instances(SvcInstancesArgs),
    Provision(SvcProvisionArgs),
    #[command(subcommand)]
    Expansions(SvcExpansionsCommand),
}

#[derive(Debug, Clone, Eq, PartialEq)]
/// Parsed target-first device deployment command.
pub struct DevResourceCommand {
    pub id: String,
    pub action: DevResourceAction,
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
/// Actions available for one device deployment.
pub enum DevResourceAction {
    Show,
    Create(DevCreateArgs),
    Apply(ApplyArgs),
    Disable,
    Enable,
    Remove(RemoveArgs),
    Instances(DevInstancesArgs),
    Provision(DevProvisionArgs),
    #[command(subcommand)]
    Activations(DevActivationsCommand),
    #[command(subcommand)]
    Reviews(DevReviewsCommand),
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Create one service deployment.
pub struct SvcCreateArgs {
    #[arg(long = "namespace", value_delimiter = ',')]
    pub namespaces: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Create one device deployment.
pub struct DevCreateArgs {
    #[arg(long = "review-mode", default_value = "none")]
    pub review_mode: DeviceReviewMode,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
#[command(group(
    clap::ArgGroup::new("contract_input")
        .args(["source", "manifest", "image"])
        .required(true)
        .multiple(false)
))]
/// Apply service or device contract input.
pub struct ApplyArgs {
    #[arg(long)]
    pub source: Option<String>,

    #[arg(long)]
    pub manifest: Option<String>,

    #[arg(long)]
    pub image: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Remove one service or device deployment.
pub struct RemoveArgs {
    #[arg(short = 'f', long)]
    pub force: bool,

    #[arg(long)]
    pub cascade: bool,

    #[arg(long, requires = "cascade")]
    pub purge: bool,

    #[arg(long = "purge-unused-contracts", requires = "cascade")]
    pub purge_unused_contracts: bool,
}

impl RemoveArgs {
    /// Returns whether unused deployment contract records should be purged.
    pub fn should_purge_unused_contracts(&self) -> bool {
        self.purge || self.purge_unused_contracts
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// List service instances.
pub struct SvcInstancesArgs {
    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// List device instances.
pub struct DevInstancesArgs {
    #[arg(long)]
    pub state: Option<DeviceInstanceState>,

    #[arg(long = "show-metadata")]
    pub show_metadata: bool,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Provision one service instance.
pub struct SvcProvisionArgs {
    #[arg(long = "instance-seed")]
    pub instance_seed: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
/// Manage pending service deployment envelope expansion requests.
pub enum SvcExpansionsCommand {
    List(SvcExpansionsListArgs),
    Approve(SvcExpansionDecisionArgs),
    Reject(SvcExpansionDecisionArgs),
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// List service deployment envelope expansion requests.
pub struct SvcExpansionsListArgs {
    #[arg(long, default_value = "pending")]
    pub state: EnvelopeExpansionRequestState,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Decide one service deployment envelope expansion request.
pub struct SvcExpansionDecisionArgs {
    #[arg(value_name = "REQUEST_ID")]
    pub request_id: String,

    #[arg(long)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Provision one device instance.
pub struct DevProvisionArgs {
    #[arg(long)]
    pub name: Option<String>,

    #[arg(long = "serial-number")]
    pub serial_number: Option<String>,

    #[arg(long = "model-number")]
    pub model_number: Option<String>,

    #[arg(long = "metadata", value_name = "KEY=VALUE")]
    pub metadata: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
/// Device activation operations for one device deployment.
pub enum DevActivationsCommand {
    List(DevActivationsListArgs),
    Revoke(DevActivationRevokeArgs),
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// List device activations.
pub struct DevActivationsListArgs {
    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long)]
    pub state: Option<DeviceActivationState>,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Revoke one device activation.
pub struct DevActivationRevokeArgs {
    #[arg(value_name = "INSTANCE_ID")]
    pub instance_id: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
/// Device activation review operations for one device deployment.
pub enum DevReviewsCommand {
    List(DevReviewsListArgs),
    Approve(DevReviewDecisionArgs),
    Reject(DevReviewDecisionArgs),
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// List device activation reviews.
pub struct DevReviewsListArgs {
    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long)]
    pub state: Option<DeviceReviewState>,
}

#[derive(Debug, Clone, Eq, PartialEq, Args)]
/// Decide one device activation review.
pub struct DevReviewDecisionArgs {
    #[arg(value_name = "REVIEW_ID")]
    pub review_id: String,

    #[arg(long)]
    pub reason: Option<String>,
}
