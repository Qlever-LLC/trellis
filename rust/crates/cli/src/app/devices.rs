use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use miette::IntoDiagnostic;
use serde_json::json;
use trellis_auth as authlib;

use crate::app::{json_value_label, resolve_device_profile_contract};
use crate::cli::*;
use crate::output;

#[derive(Debug, serde::Serialize)]
struct DeviceProvisionOutput {
    #[serde(rename = "profileId")]
    profile_id: String,
    #[serde(rename = "instanceId")]
    instance_id: String,
    #[serde(rename = "publicIdentityKey")]
    public_identity_key: String,
    #[serde(rename = "rootSecret")]
    root_secret: String,
}

pub(super) async fn run(format: OutputFormat, command: DevicesCommand) -> miette::Result<()> {
    match command.command {
        DevicesSubcommand::Provision(args) => provision_command(format, &args).await,
        DevicesSubcommand::Profiles(profiles) => match profiles.command {
            DevicesProfilesSubcommand::List(args) => profiles_list_command(format, &args).await,
            DevicesProfilesSubcommand::Create(args) => profiles_create_command(format, &args).await,
            DevicesProfilesSubcommand::Disable(args) => {
                profiles_disable_command(format, &args).await
            }
        },
        DevicesSubcommand::Instances(instances) => match instances.command {
            DevicesInstancesSubcommand::List(args) => instances_list_command(format, &args).await,
            DevicesInstancesSubcommand::Disable(args) => {
                instances_disable_command(format, &args).await
            }
        },
        DevicesSubcommand::Activations(activations) => match activations.command {
            DevicesActivationsSubcommand::List(args) => {
                activations_list_command(format, &args).await
            }
            DevicesActivationsSubcommand::Revoke(args) => {
                activations_revoke_command(format, &args).await
            }
        },
        DevicesSubcommand::Reviews(reviews) => match reviews.command {
            DevicesReviewsSubcommand::List(args) => reviews_list_command(format, &args).await,
            DevicesReviewsSubcommand::Approve(args) => {
                reviews_update_command(format, &args, "approve").await
            }
            DevicesReviewsSubcommand::Reject(args) => {
                reviews_update_command(format, &args, "reject").await
            }
        },
    }
}

async fn profiles_list_command(
    format: OutputFormat,
    args: &DevicesProfilesListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profiles = auth_client
        .list_device_profiles(args.contract.as_deref(), args.disabled)
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profiles": profiles }))?;
        return Ok(());
    }
    if profiles.is_empty() {
        output::print_info("no device profiles configured");
        return Ok(());
    }
    let rows = profiles
        .into_iter()
        .map(|profile| {
            vec![
                profile.profile_id,
                profile.contract_id,
                profile.allowed_digests.len().to_string(),
                profile
                    .review_mode
                    .as_ref()
                    .map(json_value_label)
                    .unwrap_or_else(|| "none".to_string()),
            ]
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        output::table(&["profile", "contract", "digests", "review"], rows)
    );
    Ok(())
}

async fn profiles_create_command(
    format: OutputFormat,
    args: &DevicesProfilesCreateArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let (contract_id, allowed_digests, contract) =
        resolve_device_profile_contract(&connected, &args.contract).await?;
    let profile = auth_client
        .create_device_profile(
            &args.profile,
            &contract_id,
            &allowed_digests,
            args.review_mode.as_deref(),
            contract,
        )
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profile": profile }))?;
        return Ok(());
    }
    output::print_success("device profile created");
    output::print_info(&format!("profileId={}", profile.profile_id));
    output::print_info(&format!("contractId={}", profile.contract_id));
    output::print_info(&format!("allowedDigests={}", profile.allowed_digests.len()));
    Ok(())
}

async fn profiles_disable_command(
    format: OutputFormat,
    args: &DevicesProfilesDisableArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .disable_device_profile(&args.profile)
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    Ok(())
}

async fn provision_command(
    format: OutputFormat,
    args: &DevicesProvisionArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);

    let seed: [u8; 32] = rand::random();
    let root_secret = URL_SAFE_NO_PAD.encode(seed);
    let identity = authlib::derive_device_identity(&seed).into_diagnostic()?;
    let instance = auth_client
        .provision_device_instance(
            &args.profile,
            &identity.public_identity_key,
            &identity.activation_key_base64url,
        )
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    let bundle = DeviceProvisionOutput {
        profile_id: args.profile.clone(),
        instance_id: instance.instance_id.clone(),
        public_identity_key: identity.public_identity_key,
        root_secret,
    };

    if output::is_json(format) {
        output::print_json(&bundle)?;
        return Ok(());
    }

    output::print_success("device provisioned");
    output::print_info(&format!("profileId={}", bundle.profile_id));
    output::print_info(&format!("instanceId={}", bundle.instance_id));
    output::print_info(&format!("publicIdentityKey={}", bundle.public_identity_key));
    output::print_info(&format!("rootSecret={}", bundle.root_secret));
    output::print_info("store the root secret securely; it will not be shown again");
    Ok(())
}

async fn instances_list_command(
    format: OutputFormat,
    args: &DevicesInstancesListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instances = auth_client
        .list_device_instances(args.profile.as_deref(), args.state.as_deref())
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "instances": instances }))?;
        return Ok(());
    }
    let rows = instances
        .into_iter()
        .map(|instance| {
            vec![
                instance.instance_id,
                instance.profile_id,
                json_value_label(&instance.state),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["instance", "profile", "state"], rows));
    Ok(())
}

async fn instances_disable_command(
    format: OutputFormat,
    args: &DevicesInstancesDisableArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .disable_device_instance(&args.instance)
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    Ok(())
}

async fn activations_list_command(
    format: OutputFormat,
    args: &DevicesActivationsListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let activations = auth_client
        .list_device_activations(
            args.instance.as_deref(),
            args.profile.as_deref(),
            args.state.as_deref(),
        )
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "activations": activations }))?;
        return Ok(());
    }
    let rows = activations
        .into_iter()
        .map(|activation| {
            vec![
                activation.instance_id,
                activation.profile_id,
                json_value_label(&activation.state),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["instance", "profile", "state"], rows));
    Ok(())
}

async fn activations_revoke_command(
    format: OutputFormat,
    args: &DevicesActivationsRevokeArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_device_activation(&args.instance)
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    Ok(())
}

async fn reviews_list_command(
    format: OutputFormat,
    args: &DevicesReviewsListArgs,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let reviews = auth_client
        .list_device_activation_reviews(
            args.instance.as_deref(),
            args.profile.as_deref(),
            args.state.as_deref(),
        )
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "reviews": reviews }))?;
        return Ok(());
    }
    if reviews.is_empty() {
        output::print_info("no device reviews pending");
        return Ok(());
    }
    let rows = reviews
        .into_iter()
        .map(|review| {
            vec![
                review.review_id,
                review.instance_id,
                review.profile_id,
                json_value_label(&review.state),
            ]
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        output::table(&["review", "instance", "profile", "state"], rows)
    );
    Ok(())
}

async fn reviews_update_command(
    format: OutputFormat,
    args: &DevicesReviewDecisionArgs,
    decision: &str,
) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .decide_device_activation_review(&args.review, decision, args.reason.as_deref())
        .await
        .into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&response)?;
        return Ok(());
    }
    output::print_success("device review updated");
    output::print_info(&format!("reviewId={}", response.review.review_id));
    output::print_info(&format!(
        "state={}",
        json_value_label(&response.review.state)
    ));
    if let Some(code) = response.confirmation_code.as_deref() {
        output::print_info(&format!("confirmationCode={code}"));
    }
    Ok(())
}
