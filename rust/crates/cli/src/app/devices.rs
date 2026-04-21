use std::collections::BTreeMap;
use std::io::{self, Write};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis_auth as authlib;

use crate::app::{
    connect_authenticated_cli_client, contract_review_rows, json_value_label,
    prompt_for_confirmation,
};
use crate::cli::*;
use crate::contract_input::resolve_contract_input;
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
    #[serde(rename = "metadata", skip_serializing_if = "Option::is_none")]
    metadata: Option<BTreeMap<String, String>>,
}

const DEVICE_NAME_METADATA_KEY: &str = "name";
const DEVICE_SERIAL_METADATA_KEY: &str = "serialNumber";
const DEVICE_MODEL_METADATA_KEY: &str = "modelNumber";
const KNOWN_DEVICE_METADATA_KEYS: [&str; 3] = [
    DEVICE_NAME_METADATA_KEY,
    DEVICE_SERIAL_METADATA_KEY,
    DEVICE_MODEL_METADATA_KEY,
];

pub(super) async fn run(format: OutputFormat, command: DeviceCommand) -> miette::Result<()> {
    match command.command {
        DeviceSubcommand::Profile(profile) => match profile.command {
            DeviceProfileSubcommand::List(args) => profiles_list_command(format, &args).await,
            DeviceProfileSubcommand::Create(args) => profiles_create_command(format, &args).await,
            DeviceProfileSubcommand::Apply(args) => profiles_apply_command(format, &args).await,
            DeviceProfileSubcommand::Unapply(args) => profiles_unapply_command(format, &args).await,
            DeviceProfileSubcommand::Disable(args) => profiles_disable_command(format, &args).await,
            DeviceProfileSubcommand::Enable(args) => profiles_enable_command(format, &args).await,
            DeviceProfileSubcommand::Remove(args) => profiles_remove_command(format, &args).await,
        },
        DeviceSubcommand::Instance(instance) => match instance.command {
            DeviceInstanceSubcommand::Provision(args) => {
                instances_provision_command(format, &args).await
            }
            DeviceInstanceSubcommand::List(args) => instances_list_command(format, &args).await,
            DeviceInstanceSubcommand::Disable(args) => {
                instances_disable_command(format, &args).await
            }
            DeviceInstanceSubcommand::Enable(args) => instances_enable_command(format, &args).await,
            DeviceInstanceSubcommand::Remove(args) => instances_remove_command(format, &args).await,
        },
        DeviceSubcommand::Activation(activation) => match activation.command {
            DeviceActivationSubcommand::List(args) => activations_list_command(format, &args).await,
            DeviceActivationSubcommand::Revoke(args) => {
                activations_revoke_command(format, &args).await
            }
            DeviceActivationSubcommand::Review(review) => match review.command {
                DeviceReviewSubcommand::List(args) => reviews_list_command(format, &args).await,
                DeviceReviewSubcommand::Approve(args) => {
                    reviews_update_command(format, &args, "approve").await
                }
                DeviceReviewSubcommand::Reject(args) => {
                    reviews_update_command(format, &args, "reject").await
                }
            },
        },
    }
}

fn prompt_for_typed_identifier(identifier: &str) -> miette::Result<bool> {
    print!("Type {identifier} to confirm: ");
    io::stdout().flush().into_diagnostic()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).into_diagnostic()?;
    Ok(line.trim() == identifier)
}

async fn profiles_list_command(
    format: OutputFormat,
    args: &DeviceProfileListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profiles = auth_client
        .list_device_profiles(args.contract.as_deref(), args.disabled)
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
            let contracts = profile
                .applied_contracts
                .iter()
                .map(|contract| contract.contract_id.clone())
                .collect::<Vec<_>>()
                .join(", ");
            let digest_count = profile
                .applied_contracts
                .iter()
                .map(|contract| contract.allowed_digests.len())
                .sum::<usize>();
            vec![
                profile.profile_id,
                contracts,
                digest_count.to_string(),
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
    args: &DeviceProfileCreateArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profile = auth_client
        .create_device_profile(&args.profile, Some(args.review_mode.as_wire_value()), None)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profile": profile }))?;
        return Ok(());
    }
    output::print_success("device profile created");
    output::print_info(&format!("profileId={}", profile.profile_id));
    output::print_info(&format!(
        "reviewMode={}",
        profile
            .review_mode
            .as_ref()
            .map(json_value_label)
            .unwrap_or_else(|| "none".to_string())
    ));
    Ok(())
}

async fn profiles_apply_command(
    format: OutputFormat,
    args: &DeviceProfileApplyArgs,
) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let loaded = &resolved.loaded;
    let contract = loaded
        .value
        .as_object()
        .cloned()
        .map(|contract| contract.into_iter().collect::<BTreeMap<String, Value>>())
        .ok_or_else(|| miette::miette!("device contract payload must be a JSON object"))?;

    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive apply review"
    );
    if !output::is_json(format) {
        output::print_info("Apply review");
        let mut rows = contract_review_rows(loaded);
        rows.push(vec!["profile".to_string(), args.profile.clone()]);
        println!("{}", output::table(&["field", "value"], rows));
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with applying digest {} to profile {}?",
                loaded.digest, args.profile
            ))?
        {
            return Err(miette::miette!("device profile apply cancelled"));
        }
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .apply_device_profile_contract(&authlib::AuthApplyDeviceProfileContractRequest {
            profile_id: args.profile.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&response)?;
        return Ok(());
    }
    output::print_success("device profile contract applied");
    output::print_info(&format!("profileId={}", response.profile.profile_id));
    output::print_info(&format!("contractId={}", response.contract.id));
    output::print_info(&format!("digest={}", response.contract.digest));
    Ok(())
}

async fn profiles_unapply_command(
    format: OutputFormat,
    args: &DeviceProfileUnapplyArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .unapply_device_profile_contract(&authlib::AuthUnapplyDeviceProfileContractRequest {
            profile_id: args.profile.clone(),
            contract_id: args.contract_id.clone(),
            digests: (!args.digests.is_empty()).then_some(args.digests.clone()),
        })
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&response)?;
        return Ok(());
    }
    output::print_success("device profile contract unapplied");
    output::print_info(&format!("profileId={}", response.profile.profile_id));
    output::print_info(&format!(
        "remainingContracts={}",
        response.profile.applied_contracts.len()
    ));
    Ok(())
}

async fn profiles_disable_command(
    format: OutputFormat,
    args: &DeviceProfileToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .disable_device_profile(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    if success {
        output::print_success("device profile disabled");
        output::print_info(&format!("profileId={}", args.profile));
    }
    Ok(())
}

async fn profiles_enable_command(
    format: OutputFormat,
    args: &DeviceProfileToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .enable_device_profile(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    if success {
        output::print_success("device profile enabled");
        output::print_info(&format!("profileId={}", args.profile));
    }
    Ok(())
}

async fn profiles_remove_command(
    format: OutputFormat,
    args: &DeviceProfileRemoveArgs,
) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );
    if !output::is_json(format) && !args.force && !prompt_for_typed_identifier(&args.profile)? {
        return Err(miette::miette!("device profile removal cancelled"));
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .remove_device_profile(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
        return Ok(());
    }
    if success {
        output::print_success("device profile removed");
        output::print_info(&format!("profileId={}", args.profile));
    }
    Ok(())
}

async fn instances_provision_command(
    format: OutputFormat,
    args: &DeviceProvisionArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);

    let seed: [u8; 32] = rand::random();
    let root_secret = URL_SAFE_NO_PAD.encode(seed);
    let identity = authlib::derive_device_identity(&seed).into_diagnostic()?;
    let metadata = build_device_metadata(args)?;
    let instance = auth_client
        .provision_device_instance(
            &args.profile,
            &identity.public_identity_key,
            &identity.activation_key_base64url,
            metadata.clone(),
        )
        .await
        .into_diagnostic()?;
    let bundle = DeviceProvisionOutput {
        profile_id: args.profile.clone(),
        instance_id: instance.instance_id.clone(),
        public_identity_key: identity.public_identity_key,
        root_secret,
        metadata,
    };

    if output::is_json(format) {
        output::print_json(&bundle)?;
        return Ok(());
    }

    output::print_success("device provisioned");
    output::print_info(&format!("profileId={}", bundle.profile_id));
    output::print_info(&format!("instanceId={}", bundle.instance_id));
    output::print_info(&format!("publicIdentityKey={}", bundle.public_identity_key));
    if let Some(name) = metadata_value(bundle.metadata.as_ref(), DEVICE_NAME_METADATA_KEY) {
        output::print_info(&format!("name={name}"));
    }
    if let Some(serial_number) =
        metadata_value(bundle.metadata.as_ref(), DEVICE_SERIAL_METADATA_KEY)
    {
        output::print_info(&format!("serialNumber={serial_number}"));
    }
    if let Some(model_number) = metadata_value(bundle.metadata.as_ref(), DEVICE_MODEL_METADATA_KEY)
    {
        output::print_info(&format!("modelNumber={model_number}"));
    }
    output::print_info(&format!("rootSecret={}", bundle.root_secret));
    output::print_info("store the root secret securely; it will not be shown again");
    Ok(())
}

async fn instances_list_command(
    format: OutputFormat,
    args: &DeviceInstanceListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instances = auth_client
        .list_device_instances(
            args.profile.as_deref(),
            args.state.map(DeviceInstanceState::as_wire_value),
        )
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "instances": instances }))?;
        return Ok(());
    }
    let rows = instances
        .into_iter()
        .map(|instance| {
            let mut row = vec![
                instance.instance_id,
                instance.profile_id,
                metadata_value_or_dash(instance.metadata.as_ref(), DEVICE_NAME_METADATA_KEY),
                metadata_value_or_dash(instance.metadata.as_ref(), DEVICE_SERIAL_METADATA_KEY),
                metadata_value_or_dash(instance.metadata.as_ref(), DEVICE_MODEL_METADATA_KEY),
                json_value_label(&instance.state),
            ];
            if args.show_metadata {
                row.push(opaque_metadata_or_dash(instance.metadata.as_ref()));
            }
            row
        })
        .collect::<Vec<_>>();
    let mut headers = vec!["instance", "profile", "name", "serial", "model", "state"];
    if args.show_metadata {
        headers.push("metadata");
    }
    println!("{}", output::table(&headers, rows));
    Ok(())
}

fn build_device_metadata(
    args: &DeviceProvisionArgs,
) -> miette::Result<Option<BTreeMap<String, String>>> {
    let mut metadata = BTreeMap::new();
    insert_metadata_value(
        &mut metadata,
        DEVICE_NAME_METADATA_KEY,
        args.name.as_deref(),
    )?;
    insert_metadata_value(
        &mut metadata,
        DEVICE_SERIAL_METADATA_KEY,
        args.serial_number.as_deref(),
    )?;
    insert_metadata_value(
        &mut metadata,
        DEVICE_MODEL_METADATA_KEY,
        args.model_number.as_deref(),
    )?;

    for entry in &args.metadata {
        let (key, value) = parse_metadata_entry(entry)?;
        if metadata.insert(key.clone(), value).is_some() {
            return Err(miette::miette!(format!(
                "duplicate device metadata key: {key}"
            )));
        }
    }

    Ok((!metadata.is_empty()).then_some(metadata))
}

fn insert_metadata_value(
    metadata: &mut BTreeMap<String, String>,
    key: &str,
    value: Option<&str>,
) -> miette::Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.is_empty() {
        return Err(miette::miette!(format!(
            "device metadata value for {key} cannot be empty"
        )));
    }
    if metadata
        .insert(key.to_string(), value.to_string())
        .is_some()
    {
        return Err(miette::miette!(format!(
            "duplicate device metadata key: {key}"
        )));
    }
    Ok(())
}

fn parse_metadata_entry(entry: &str) -> miette::Result<(String, String)> {
    let Some((key, value)) = entry.split_once('=') else {
        return Err(miette::miette!(format!(
            "invalid metadata entry '{entry}'; expected KEY=VALUE"
        )));
    };
    if key.is_empty() || value.is_empty() {
        return Err(miette::miette!(format!(
            "invalid metadata entry '{entry}'; key and value must be non-empty"
        )));
    }
    Ok((key.to_string(), value.to_string()))
}

fn metadata_value(metadata: Option<&BTreeMap<String, String>>, key: &str) -> Option<String> {
    metadata.and_then(|metadata| metadata.get(key).cloned())
}

fn metadata_value_or_dash(metadata: Option<&BTreeMap<String, String>>, key: &str) -> String {
    metadata_value(metadata, key).unwrap_or_else(|| "-".to_string())
}

fn opaque_metadata_or_dash(metadata: Option<&BTreeMap<String, String>>) -> String {
    let Some(metadata) = metadata else {
        return "-".to_string();
    };
    let opaque = metadata
        .iter()
        .filter(|(key, _)| !KNOWN_DEVICE_METADATA_KEYS.contains(&key.as_str()))
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>();
    if opaque.is_empty() {
        "-".to_string()
    } else {
        opaque.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_device_metadata, opaque_metadata_or_dash, parse_metadata_entry,
        DEVICE_MODEL_METADATA_KEY, DEVICE_NAME_METADATA_KEY, DEVICE_SERIAL_METADATA_KEY,
    };
    use crate::cli::DeviceProvisionArgs;
    use std::collections::BTreeMap;

    #[test]
    fn build_device_metadata_merges_known_and_opaque_entries() {
        let metadata = build_device_metadata(&DeviceProvisionArgs {
            profile: "reader.standard".to_string(),
            name: Some("Front Desk Reader".to_string()),
            serial_number: Some("SN-123".to_string()),
            model_number: Some("MX-10".to_string()),
            metadata: vec!["assetTag=42".to_string(), "site=lab-a".to_string()],
        })
        .expect("metadata should build")
        .expect("metadata should be present");

        let expected = BTreeMap::from([
            ("assetTag".to_string(), "42".to_string()),
            (DEVICE_MODEL_METADATA_KEY.to_string(), "MX-10".to_string()),
            (
                DEVICE_NAME_METADATA_KEY.to_string(),
                "Front Desk Reader".to_string(),
            ),
            (DEVICE_SERIAL_METADATA_KEY.to_string(), "SN-123".to_string()),
            ("site".to_string(), "lab-a".to_string()),
        ]);
        assert_eq!(metadata, expected);
    }

    #[test]
    fn build_device_metadata_rejects_duplicate_keys() {
        let error = build_device_metadata(&DeviceProvisionArgs {
            profile: "reader.standard".to_string(),
            name: Some("Front Desk Reader".to_string()),
            serial_number: None,
            model_number: None,
            metadata: vec!["name=Replacement".to_string()],
        })
        .expect_err("duplicate metadata key should fail");

        assert!(error
            .to_string()
            .contains("duplicate device metadata key: name"));
    }

    #[test]
    fn parse_metadata_entry_requires_key_value_syntax() {
        let error = parse_metadata_entry("assetTag").expect_err("missing separator should fail");
        assert!(error
            .to_string()
            .contains("invalid metadata entry 'assetTag'; expected KEY=VALUE"));
    }

    #[test]
    fn opaque_metadata_output_hides_known_keys() {
        let metadata = BTreeMap::from([
            ("assetTag".to_string(), "42".to_string()),
            (DEVICE_MODEL_METADATA_KEY.to_string(), "MX-10".to_string()),
            (
                DEVICE_NAME_METADATA_KEY.to_string(),
                "Front Desk Reader".to_string(),
            ),
            (DEVICE_SERIAL_METADATA_KEY.to_string(), "SN-123".to_string()),
            ("site".to_string(), "lab-a".to_string()),
        ]);

        assert_eq!(
            opaque_metadata_or_dash(Some(&metadata)),
            "assetTag=42, site=lab-a"
        );
    }
}

async fn instances_disable_command(
    format: OutputFormat,
    args: &DeviceInstanceToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .disable_device_instance(&args.instance)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    if success {
        output::print_success("device instance disabled");
        output::print_info(&format!("instanceId={}", args.instance));
    }
    Ok(())
}

async fn instances_enable_command(
    format: OutputFormat,
    args: &DeviceInstanceToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .enable_device_instance(&args.instance)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    if success {
        output::print_success("device instance enabled");
        output::print_info(&format!("instanceId={}", args.instance));
    }
    Ok(())
}

async fn instances_remove_command(
    format: OutputFormat,
    args: &DeviceInstanceRemoveArgs,
) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );
    if !output::is_json(format) && !args.force && !prompt_for_typed_identifier(&args.instance)? {
        return Err(miette::miette!("device instance removal cancelled"));
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .remove_device_instance(&args.instance)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
        return Ok(());
    }
    if success {
        output::print_success("device instance removed");
        output::print_info(&format!("instanceId={}", args.instance));
    }
    Ok(())
}

async fn activations_list_command(
    format: OutputFormat,
    args: &DeviceActivationListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let activations = auth_client
        .list_device_activations(
            args.instance.as_deref(),
            args.profile.as_deref(),
            args.state.map(DeviceActivationState::as_wire_value),
        )
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
    args: &DeviceActivationRevokeArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_device_activation(&args.instance)
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
    args: &DeviceReviewListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let reviews = auth_client
        .list_device_activation_reviews(
            args.instance.as_deref(),
            args.profile.as_deref(),
            args.state.map(DeviceReviewState::as_wire_value),
        )
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "reviews": reviews }))?;
        return Ok(());
    }
    if reviews.is_empty() {
        output::print_info("no device activation reviews found");
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
    args: &DeviceReviewDecisionArgs,
    decision: &str,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .decide_device_activation_review(&args.review, decision, args.reason.as_deref())
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
