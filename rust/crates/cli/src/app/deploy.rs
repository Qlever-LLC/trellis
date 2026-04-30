use std::collections::BTreeMap;
use std::io::{self, Write};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis_auth as authlib;
use trellis_client::SessionAuth;

use crate::app::{
    connect_authenticated_cli_client, contract_review_rows, generate_session_keypair,
    json_value_label, prompt_for_confirmation,
};
use crate::cli::*;
use crate::contract_input::resolve_contract_input;
use crate::output;

const DEVICE_NAME_METADATA_KEY: &str = "name";
const DEVICE_SERIAL_METADATA_KEY: &str = "serialNumber";
const DEVICE_MODEL_METADATA_KEY: &str = "modelNumber";

pub(super) async fn run(format: OutputFormat, command: DeployCommand) -> miette::Result<()> {
    match command.command {
        DeploySubcommand::List(args) => list_command(format, &args).await,
        DeploySubcommand::Show(args) => show_command(format, &args.reference).await,
        DeploySubcommand::Create(args) => create_command(format, &args).await,
        DeploySubcommand::Apply(args) => apply_command(format, &args).await,
        DeploySubcommand::Unapply(args) => unapply_command(format, &args).await,
        DeploySubcommand::Disable(args) => toggle_command(format, &args.reference, false).await,
        DeploySubcommand::Enable(args) => toggle_command(format, &args.reference, true).await,
        DeploySubcommand::Remove(args) => remove_command(format, &args).await,
        DeploySubcommand::Instances(args) => instances_command(format, &args).await,
        DeploySubcommand::Provision(args) => provision_command(format, &args).await,
        DeploySubcommand::Activation(command) => match command.command {
            DeployActivationSubcommand::List(args) => activation_list_command(format, &args).await,
            DeployActivationSubcommand::Revoke(args) => {
                activation_revoke_command(format, &args).await
            }
        },
        DeploySubcommand::Review(command) => match command.command {
            DeployReviewSubcommand::List(args) => review_list_command(format, &args).await,
            DeployReviewSubcommand::Approve(args) => {
                review_decide_command(format, &args, "approve").await
            }
            DeployReviewSubcommand::Reject(args) => {
                review_decide_command(format, &args, "reject").await
            }
        },
    }
}

async fn list_command(format: OutputFormat, args: &DeployListArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match args.kind {
        DeployKindArg::Svc => {
            let deployments = auth_client
                .list_service_deployments(args.disabled)
                .await
                .into_diagnostic()?;
            if output::is_json(format) {
                output::print_json(&json!({ "deployments": deployments }))?;
                return Ok(());
            }
            let rows = deployments
                .into_iter()
                .map(|deployment| {
                    vec![
                        format!("svc/{}", deployment.deployment_id),
                        deployment.disabled.to_string(),
                        deployment.applied_contracts.len().to_string(),
                        deployment.namespaces.join(", "),
                    ]
                })
                .collect::<Vec<_>>();
            println!(
                "{}",
                output::table(&["ref", "disabled", "contracts", "namespaces"], rows)
            );
        }
        DeployKindArg::Dev => {
            let mut deployments = auth_client
                .list_device_deployments(args.contract.as_deref(), args.disabled)
                .await
                .into_diagnostic()?;
            if output::is_json(format) {
                output::print_json(&json!({ "deployments": deployments }))?;
                return Ok(());
            }
            deployments.sort_by(|left, right| left.deployment_id.cmp(&right.deployment_id));
            let rows = deployments
                .into_iter()
                .map(|deployment| {
                    vec![
                        format!("dev/{}", deployment.deployment_id),
                        deployment.disabled.to_string(),
                        deployment.applied_contracts.len().to_string(),
                        deployment
                            .review_mode
                            .as_ref()
                            .map(json_value_label)
                            .unwrap_or_else(|| "none".to_string()),
                    ]
                })
                .collect::<Vec<_>>();
            println!(
                "{}",
                output::table(&["ref", "disabled", "contracts", "review"], rows)
            );
        }
    }
    Ok(())
}

async fn show_command(format: OutputFormat, reference: &DeployRef) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match reference.kind {
        DeployKind::Service => {
            let deployment = auth_client
                .list_service_deployments(false)
                .await
                .into_diagnostic()?
                .into_iter()
                .find(|deployment| deployment.deployment_id == reference.id)
                .ok_or_else(|| miette::miette!("service deployment not found: {}", reference.id))?;
            output::print_json(&json!({ "deployment": deployment }))?;
        }
        DeployKind::Device => {
            let deployment = auth_client
                .list_device_deployments(None, false)
                .await
                .into_diagnostic()?
                .into_iter()
                .find(|deployment| deployment.deployment_id == reference.id)
                .ok_or_else(|| miette::miette!("device deployment not found: {}", reference.id))?;
            output::print_json(&json!({ "deployment": deployment }))?;
        }
    }
    Ok(())
}

async fn create_command(format: OutputFormat, args: &DeployCreateArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match args.reference.kind {
        DeployKind::Service => {
            let deployment = auth_client
                .create_service_deployment(&authlib::AuthCreateServiceDeploymentRequest {
                    deployment_id: args.reference.id.clone(),
                    namespaces: args.namespaces.clone(),
                })
                .await
                .into_diagnostic()?;
            print_deployment_result(format, "service deployment created", &deployment)?;
        }
        DeployKind::Device => {
            let deployment = auth_client
                .create_device_deployment(
                    &args.reference.id,
                    Some(args.review_mode.as_wire_value()),
                    None,
                )
                .await
                .into_diagnostic()?;
            print_deployment_result(format, "device deployment created", &deployment)?;
        }
    }
    Ok(())
}

async fn apply_command(format: OutputFormat, args: &DeployApplyArgs) -> miette::Result<()> {
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
        .ok_or_else(|| miette::miette!("contract payload must be a JSON object"))?;
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive apply review"
    );
    if !output::is_json(format) {
        output::print_info("Apply review");
        let mut rows = contract_review_rows(loaded);
        rows.push(vec!["deployment".to_string(), ref_label(&args.reference)]);
        println!("{}", output::table(&["field", "value"], rows));
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with applying digest {} to {}?",
                loaded.digest,
                ref_label(&args.reference)
            ))?
        {
            return Err(miette::miette!("deployment apply cancelled"));
        }
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match args.reference.kind {
        DeployKind::Service => {
            let response = auth_client
                .apply_service_deployment_contract(
                    &authlib::AuthApplyServiceDeploymentContractRequest {
                        deployment_id: args.reference.id.clone(),
                        contract,
                        expected_digest: loaded.digest.clone(),
                        replace_existing: args.replace.then_some(true),
                    },
                )
                .await
                .into_diagnostic()?;
            if output::is_json(format) {
                output::print_json(&response)?;
            } else {
                output::print_success("service contract applied");
                println!("deployment={}", ref_label(&args.reference));
                println!("contract={}", response.contract.id);
                println!("digest={}", response.contract.digest);
            }
        }
        DeployKind::Device => {
            let response = auth_client
                .apply_device_deployment_contract(
                    &authlib::AuthApplyDeviceDeploymentContractRequest {
                        deployment_id: args.reference.id.clone(),
                        contract,
                        expected_digest: loaded.digest.clone(),
                        replace_existing: args.replace.then_some(true),
                    },
                )
                .await
                .into_diagnostic()?;
            if output::is_json(format) {
                output::print_json(&response)?;
            } else {
                output::print_success("device contract applied");
                println!("deployment={}", ref_label(&args.reference));
                println!("contract={}", response.contract.id);
                println!("digest={}", response.contract.digest);
            }
        }
    }
    Ok(())
}

async fn unapply_command(format: OutputFormat, args: &DeployUnapplyArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match args.reference.kind {
        DeployKind::Service => {
            let response = auth_client
                .unapply_service_deployment_contract(
                    &authlib::AuthUnapplyServiceDeploymentContractRequest {
                        deployment_id: args.reference.id.clone(),
                        contract_id: args.contract_id.clone(),
                        digests: (!args.digests.is_empty()).then_some(args.digests.clone()),
                    },
                )
                .await
                .into_diagnostic()?;
            output::print_json(&response)?;
        }
        DeployKind::Device => {
            let response = auth_client
                .unapply_device_deployment_contract(
                    &authlib::AuthUnapplyDeviceDeploymentContractRequest {
                        deployment_id: args.reference.id.clone(),
                        contract_id: args.contract_id.clone(),
                        digests: (!args.digests.is_empty()).then_some(args.digests.clone()),
                    },
                )
                .await
                .into_diagnostic()?;
            output::print_json(&response)?;
        }
    }
    Ok(())
}

async fn toggle_command(
    format: OutputFormat,
    reference: &DeployRef,
    enable: bool,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match (reference.kind, enable) {
        (DeployKind::Service, true) => output::print_json(
            &json!({ "deployment": auth_client.enable_service_deployment(&reference.id).await.into_diagnostic()? }),
        )?,
        (DeployKind::Service, false) => output::print_json(
            &json!({ "deployment": auth_client.disable_service_deployment(&reference.id).await.into_diagnostic()? }),
        )?,
        (DeployKind::Device, true) => output::print_json(
            &json!({ "success": auth_client.enable_device_deployment(&reference.id).await.into_diagnostic()? }),
        )?,
        (DeployKind::Device, false) => output::print_json(
            &json!({ "success": auth_client.disable_device_deployment(&reference.id).await.into_diagnostic()? }),
        )?,
    }
    Ok(())
}

async fn remove_command(format: OutputFormat, args: &DeployRemoveArgs) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );
    if !output::is_json(format)
        && !args.force
        && !prompt_for_typed_identifier(&ref_label(&args.reference))?
    {
        return Err(miette::miette!("deployment removal cancelled"));
    }
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = match args.reference.kind {
        DeployKind::Service => {
            auth_client
                .remove_service_deployment(&args.reference.id)
                .await
        }
        DeployKind::Device => {
            auth_client
                .remove_device_deployment(&args.reference.id)
                .await
        }
    }
    .into_diagnostic()?;
    output::print_json(&json!({ "success": success, "deploymentId": args.reference.id }))?;
    Ok(())
}

async fn instances_command(format: OutputFormat, args: &DeployInstancesArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match &args.target {
        DeployInstancesTarget::Kind(DeployKind::Service) => {
            let instances = auth_client
                .list_service_instances(None, args.disabled.then_some(true))
                .await
                .into_diagnostic()?;
            output::print_json(&json!({ "instances": instances }))?;
        }
        DeployInstancesTarget::Kind(DeployKind::Device) => {
            let instances = auth_client
                .list_device_instances(None, args.state.map(DeviceInstanceState::as_wire_value))
                .await
                .into_diagnostic()?;
            output::print_json(&json!({ "instances": instances }))?;
        }
        DeployInstancesTarget::Ref(reference) => match reference.kind {
            DeployKind::Service => {
                let instances = auth_client
                    .list_service_instances(Some(&reference.id), args.disabled.then_some(true))
                    .await
                    .into_diagnostic()?;
                output::print_json(&json!({ "instances": instances }))?;
            }
            DeployKind::Device => {
                let instances = auth_client
                    .list_device_instances(
                        Some(&reference.id),
                        args.state.map(DeviceInstanceState::as_wire_value),
                    )
                    .await
                    .into_diagnostic()?;
                output::print_json(&json!({ "instances": instances }))?;
            }
        },
    }
    Ok(())
}

async fn provision_command(format: OutputFormat, args: &DeployProvisionArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match args.reference.kind {
        DeployKind::Service => {
            let (instance_seed, instance_key, generated_seed) =
                if let Some(seed) = &args.instance_seed {
                    let auth = SessionAuth::from_seed_base64url(seed).into_diagnostic()?;
                    (seed.clone(), auth.session_key, false)
                } else {
                    let (seed, key) = generate_session_keypair();
                    (seed, key, true)
                };
            let instance = auth_client
                .provision_service_instance(&authlib::AuthProvisionServiceInstanceRequest {
                    deployment_id: args.reference.id.clone(),
                    instance_key,
                })
                .await
                .into_diagnostic()?;
            output::print_json(
                &json!({ "instance": instance, "generatedSeed": generated_seed, "instanceSeed": generated_seed.then_some(instance_seed) }),
            )?;
        }
        DeployKind::Device => {
            let seed: [u8; 32] = rand::random();
            let root_secret = URL_SAFE_NO_PAD.encode(seed);
            let identity = authlib::derive_device_identity(&seed).into_diagnostic()?;
            let metadata = build_device_metadata(args)?;
            let instance = auth_client
                .provision_device_instance(
                    &args.reference.id,
                    &identity.public_identity_key,
                    &identity.activation_key_base64url,
                    metadata,
                )
                .await
                .into_diagnostic()?;
            output::print_json(&json!({ "instance": instance, "rootSecret": root_secret }))?;
        }
    }
    Ok(())
}

async fn activation_list_command(
    format: OutputFormat,
    args: &DeployActivationListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let activations = auth_client
        .list_device_activations(
            args.instance.as_deref(),
            args.deployment.as_deref(),
            args.state.map(DeviceActivationState::as_wire_value),
        )
        .await
        .into_diagnostic()?;
    output::print_json(&json!({ "activations": activations }))?;
    Ok(())
}

async fn activation_revoke_command(
    format: OutputFormat,
    args: &DeployActivationRevokeArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .revoke_device_activation(&args.instance)
        .await
        .into_diagnostic()?;
    output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
    Ok(())
}

async fn review_list_command(
    format: OutputFormat,
    args: &DeployReviewListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let reviews = auth_client
        .list_device_activation_reviews(
            args.instance.as_deref(),
            args.deployment.as_deref(),
            args.state.map(DeviceReviewState::as_wire_value),
        )
        .await
        .into_diagnostic()?;
    output::print_json(&json!({ "reviews": reviews }))?;
    Ok(())
}

async fn review_decide_command(
    format: OutputFormat,
    args: &DeployReviewDecisionArgs,
    decision: &str,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .decide_device_activation_review(&args.review, decision, args.reason.as_deref())
        .await
        .into_diagnostic()?;
    output::print_json(&response)?;
    Ok(())
}

fn print_deployment_result<T: serde::Serialize>(
    format: OutputFormat,
    message: &str,
    deployment: &T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "deployment": deployment }))?;
    } else {
        output::print_success(message);
    }
    Ok(())
}

fn ref_label(reference: &DeployRef) -> String {
    let prefix = match reference.kind {
        DeployKind::Service => "svc",
        DeployKind::Device => "dev",
    };
    format!("{prefix}/{}", reference.id)
}

fn prompt_for_typed_identifier(identifier: &str) -> miette::Result<bool> {
    print!("Type {identifier} to confirm: ");
    io::stdout().flush().into_diagnostic()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).into_diagnostic()?;
    Ok(line.trim() == identifier)
}

fn build_device_metadata(
    args: &DeployProvisionArgs,
) -> miette::Result<Option<BTreeMap<String, String>>> {
    let mut metadata = BTreeMap::new();
    if let Some(name) = &args.name {
        metadata.insert(DEVICE_NAME_METADATA_KEY.to_string(), name.clone());
    }
    if let Some(serial_number) = &args.serial_number {
        metadata.insert(
            DEVICE_SERIAL_METADATA_KEY.to_string(),
            serial_number.clone(),
        );
    }
    if let Some(model_number) = &args.model_number {
        metadata.insert(DEVICE_MODEL_METADATA_KEY.to_string(), model_number.clone());
    }
    for entry in &args.metadata {
        let Some((key, value)) = entry.split_once('=') else {
            return Err(miette::miette!("metadata entries must use KEY=VALUE"));
        };
        if key.is_empty() {
            return Err(miette::miette!("metadata key must not be empty"));
        }
        metadata.insert(key.to_string(), value.to_string());
    }
    Ok((!metadata.is_empty()).then_some(metadata))
}
