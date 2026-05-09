use std::str::FromStr;

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
/// Manage service and device deployments.
pub struct DeployCommand {
    #[command(subcommand)]
    pub command: DeploySubcommand,
}

#[derive(Debug, Subcommand)]
/// Deployment-centric operator workflows.
pub enum DeploySubcommand {
    /// List deployments by kind.
    List(DeployListArgs),
    /// Show one deployment by ref.
    Show(DeployRefArgs),
    /// Create one deployment.
    Create(DeployCreateArgs),
    /// Disable one deployment.
    Disable(DeployRefArgs),
    /// Enable one deployment.
    Enable(DeployRefArgs),
    /// Remove one deployment.
    Remove(DeployRemoveArgs),
    /// List instances for a deployment kind or ref.
    Instances(DeployInstancesArgs),
    /// Provision one service or device instance.
    Provision(DeployProvisionArgs),
    /// List or revoke device activations.
    Activation(DeployActivationCommand),
    /// List, approve, or reject device activation reviews.
    Review(DeployReviewCommand),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
/// Deployment kind filter.
pub enum DeployKindArg {
    Svc,
    Dev,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
/// Parsed deployment resource reference.
pub enum DeployKind {
    Service,
    Device,
}

#[derive(Debug, Clone, Eq, PartialEq)]
/// Service or device deployment reference such as `svc/api` or `dev/scanner`.
pub struct DeployRef {
    pub kind: DeployKind,
    pub id: String,
}

impl FromStr for DeployRef {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let Some((kind, id)) = value.split_once('/') else {
            return Err("expected deployment ref in the form svc/<id> or dev/<id>".to_string());
        };
        if id.is_empty() {
            return Err("deployment id must not be empty".to_string());
        }
        let kind = match kind {
            "svc" | "service" => DeployKind::Service,
            "dev" | "device" => DeployKind::Device,
            _ => return Err("deployment kind must be svc, service, dev, or device".to_string()),
        };
        Ok(Self {
            kind,
            id: id.to_string(),
        })
    }
}

#[derive(Debug, Args)]
pub struct DeployListArgs {
    #[arg(value_enum)]
    pub kind: DeployKindArg,

    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
pub struct DeployRefArgs {
    #[arg(value_name = "REF")]
    pub reference: DeployRef,
}

#[derive(Debug, Args)]
pub struct DeployCreateArgs {
    #[arg(value_name = "REF")]
    pub reference: DeployRef,

    #[arg(long = "namespace", value_delimiter = ',')]
    pub namespaces: Vec<String>,

    #[arg(long = "review-mode", default_value = "none")]
    pub review_mode: DeviceReviewMode,
}

#[derive(Debug, Args)]
pub struct DeployRemoveArgs {
    #[arg(value_name = "REF")]
    pub reference: DeployRef,

    #[arg(short = 'f', long)]
    pub force: bool,

    #[arg(long)]
    pub cascade: bool,

    #[arg(long, requires = "cascade")]
    pub purge: bool,

    #[arg(long = "purge-unused-contracts", requires = "cascade")]
    pub purge_unused_contracts: bool,
}

impl DeployRemoveArgs {
    /// Validate remove options that depend on the parsed deployment kind.
    pub fn validate(&self) -> Result<(), String> {
        if (self.purge || self.purge_unused_contracts) && !self.cascade {
            return Err("purge flags require --cascade".to_string());
        }
        Ok(())
    }

    /// Returns whether unused deployment contract records should be purged.
    pub fn should_purge_unused_contracts(&self) -> bool {
        self.purge || self.purge_unused_contracts
    }
}

#[derive(Debug, Args)]
pub struct DeployInstancesArgs {
    #[arg(value_name = "KIND_OR_REF")]
    pub target: DeployInstancesTarget,

    #[arg(long)]
    pub disabled: bool,

    #[arg(long)]
    pub state: Option<DeviceInstanceState>,

    #[arg(long = "show-metadata")]
    pub show_metadata: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum DeployInstancesTarget {
    Kind(DeployKind),
    Ref(DeployRef),
}

impl FromStr for DeployInstancesTarget {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "svc" | "service" => Ok(Self::Kind(DeployKind::Service)),
            "dev" | "device" => Ok(Self::Kind(DeployKind::Device)),
            _ => DeployRef::from_str(value).map(Self::Ref),
        }
    }
}

#[derive(Debug, Args)]
pub struct DeployProvisionArgs {
    #[arg(value_name = "REF")]
    pub reference: DeployRef,

    #[arg(long = "instance-seed")]
    pub instance_seed: Option<String>,

    #[arg(long)]
    pub name: Option<String>,

    #[arg(long = "serial-number")]
    pub serial_number: Option<String>,

    #[arg(long = "model-number")]
    pub model_number: Option<String>,

    #[arg(long = "metadata", value_name = "KEY=VALUE")]
    pub metadata: Vec<String>,
}

#[derive(Debug, Args)]
pub struct DeployActivationCommand {
    #[command(subcommand)]
    pub command: DeployActivationSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DeployActivationSubcommand {
    List(DeployActivationListArgs),
    Revoke(DeployActivationRevokeArgs),
}

#[derive(Debug, Args)]
pub struct DeployActivationListArgs {
    #[arg(long = "deployment")]
    pub deployment: Option<String>,

    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long)]
    pub state: Option<DeviceActivationState>,
}

#[derive(Debug, Args)]
pub struct DeployActivationRevokeArgs {
    #[arg(value_name = "INSTANCE")]
    pub instance: String,
}

#[derive(Debug, Args)]
pub struct DeployReviewCommand {
    #[command(subcommand)]
    pub command: DeployReviewSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum DeployReviewSubcommand {
    List(DeployReviewListArgs),
    Approve(DeployReviewDecisionArgs),
    Reject(DeployReviewDecisionArgs),
}

#[derive(Debug, Args)]
pub struct DeployReviewListArgs {
    #[arg(long = "deployment")]
    pub deployment: Option<String>,

    #[arg(long = "instance")]
    pub instance: Option<String>,

    #[arg(long)]
    pub state: Option<DeviceReviewState>,
}

#[derive(Debug, Args)]
pub struct DeployReviewDecisionArgs {
    #[arg(value_name = "REVIEW")]
    pub review: String,

    #[arg(long)]
    pub reason: Option<String>,
}
