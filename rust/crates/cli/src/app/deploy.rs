use std::collections::BTreeMap;
use std::io::{self, Write};
use std::path::Path;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis::auth as authlib;
use trellis::client::{SessionAuth, TrellisClient};

use crate::app::{connect_authenticated_cli_client, generate_session_keypair, json_value_label};
use crate::cli::*;
use crate::contract_input;
use crate::output;

const DEVICE_NAME_METADATA_KEY: &str = "name";
const DEVICE_SERIAL_METADATA_KEY: &str = "serialNumber";
const DEVICE_MODEL_METADATA_KEY: &str = "modelNumber";

pub(super) async fn run_svc(format: OutputFormat, command: SvcCommand) -> miette::Result<()> {
    match (command.id, command.command) {
        (None, SvcSubcommand::List(args)) => list_services(format, &args).await,
        (Some(id), SvcSubcommand::Resource(action)) => {
            run_svc_resource(format, SvcResourceCommand { id, action }).await
        }
        (Some(_), SvcSubcommand::List(_)) => Err(miette::miette!(
            "`list` is a top-level service command; use `trellis svc list`"
        )),
        (None, SvcSubcommand::Resource(_)) => Err(miette::miette!(
            "missing service deployment ID; use `trellis svc <ID> <COMMAND>`"
        )),
    }
}

pub(super) async fn run_dev(format: OutputFormat, command: DevCommand) -> miette::Result<()> {
    match (command.id, command.command) {
        (None, DevSubcommand::List(args)) => list_devices(format, &args).await,
        (Some(id), DevSubcommand::Resource(action)) => {
            run_dev_resource(format, DevResourceCommand { id, action }).await
        }
        (Some(_), DevSubcommand::List(_)) => Err(miette::miette!(
            "`list` is a top-level device command; use `trellis dev list`"
        )),
        (None, DevSubcommand::Resource(_)) => Err(miette::miette!(
            "missing device deployment ID; use `trellis dev <ID> <COMMAND>`"
        )),
    }
}

pub(super) async fn run_grants(format: OutputFormat, command: GrantsCommand) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    match command.command {
        GrantsSubcommand::List(args) => {
            if let Some(deployment_id) = args.deployment {
                deployment_grants_list(format, &connected, &deployment_id).await
            } else {
                deployment_grants_list_all(format, &connected).await
            }
        }
        GrantsSubcommand::Add(args) => {
            deployment_grants_mutate(format, &connected, &args.deployment, &args.grant, true).await
        }
        GrantsSubcommand::Remove(args) => {
            deployment_grants_mutate(format, &connected, &args.deployment, &args.grant, false).await
        }
    }
}

async fn run_svc_resource(format: OutputFormat, command: SvcResourceCommand) -> miette::Result<()> {
    match command.action {
        SvcResourceAction::Show => show_service(format, &command.id).await,
        SvcResourceAction::Create(args) => create_service(format, &command.id, &args).await,
        SvcResourceAction::Apply(args) => apply_contract(format, &command.id, &args).await,
        SvcResourceAction::Disable => toggle_service(format, &command.id, false).await,
        SvcResourceAction::Enable => toggle_service(format, &command.id, true).await,
        SvcResourceAction::Remove(args) => {
            remove_deployment(format, DeploymentKind::Service, &command.id, &args).await
        }
        SvcResourceAction::Instances(args) => service_instances(format, &command.id, &args).await,
        SvcResourceAction::Provision(args) => provision_service(format, &command.id, &args).await,
        SvcResourceAction::Authority(authority) => {
            deployment_authority(format, &command.id, authority).await
        }
    }
}

async fn run_dev_resource(format: OutputFormat, command: DevResourceCommand) -> miette::Result<()> {
    let id = command.id;
    match command.action {
        DevResourceAction::Show => show_device(format, &id).await,
        DevResourceAction::Create(args) => create_device(format, &id, &args).await,
        DevResourceAction::Apply(args) => apply_contract(format, &id, &args).await,
        DevResourceAction::Disable => toggle_device(format, &id, false).await,
        DevResourceAction::Enable => toggle_device(format, &id, true).await,
        DevResourceAction::Remove(args) => {
            remove_deployment(format, DeploymentKind::Device, &id, &args).await
        }
        DevResourceAction::Instances(args) => device_instances(format, &id, &args).await,
        DevResourceAction::Provision(args) => provision_device(format, &id, &args).await,
        DevResourceAction::Authority(command) => deployment_authority(format, &id, command).await,
        DevResourceAction::Activations(command) => dev_activations(format, &id, command).await,
        DevResourceAction::Reviews(command) => dev_reviews(format, &id, command).await,
    }
}

#[derive(Clone, Copy)]
enum DeploymentKind {
    Service,
    Device,
}

async fn list_services(format: OutputFormat, args: &SvcListArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let deployments = authlib::AuthClient::new(&connected)
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
                deployment.namespaces.join(", "),
            ]
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        output::table(&["ref", "disabled", "namespaces"], rows)
    );
    Ok(())
}

async fn list_devices(format: OutputFormat, args: &DevListArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let mut deployments = authlib::AuthClient::new(&connected)
        .list_device_deployments(args.disabled)
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
                deployment
                    .review_mode
                    .as_ref()
                    .map(json_value_label)
                    .unwrap_or_else(|| "none".to_string()),
            ]
        })
        .collect::<Vec<_>>();
    println!("{}", output::table(&["ref", "disabled", "review"], rows));
    Ok(())
}

async fn show_service(format: OutputFormat, id: &str) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let deployment = authlib::AuthClient::new(&connected)
        .list_service_deployments(false)
        .await
        .into_diagnostic()?
        .into_iter()
        .find(|deployment| deployment.deployment_id == id)
        .ok_or_else(|| miette::miette!("service deployment not found: {id}"))?;
    print_deployment_show_result(format, DeploymentKind::Service, &deployment)
}

async fn show_device(format: OutputFormat, id: &str) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let deployment = authlib::AuthClient::new(&connected)
        .list_device_deployments(false)
        .await
        .into_diagnostic()?
        .into_iter()
        .find(|deployment| deployment.deployment_id == id)
        .ok_or_else(|| miette::miette!("device deployment not found: {id}"))?;
    print_deployment_show_result(format, DeploymentKind::Device, &deployment)
}

async fn create_service(
    format: OutputFormat,
    id: &str,
    args: &SvcCreateArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let deployment = authlib::AuthClient::new(&connected)
        .create_service_deployment(id, args.namespaces.clone())
        .await
        .into_diagnostic()?;
    print_deployment_result(format, "service deployment created", &deployment)
}

async fn create_device(format: OutputFormat, id: &str, args: &DevCreateArgs) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let deployment = authlib::AuthClient::new(&connected)
        .create_device_deployment(id, args.review_mode.as_optional_wire_value())
        .await
        .into_diagnostic()?;
    print_deployment_result(format, "device deployment created", &deployment)
}

async fn apply_contract(
    format: OutputFormat,
    deployment_id: &str,
    args: &ApplyArgs,
) -> miette::Result<()> {
    let resolved = contract_input::resolve_contract_input(
        args.manifest.as_deref().map(Path::new),
        args.source.as_deref().map(Path::new),
        args.image.as_deref(),
        "CONTRACT",
        contract_input::default_image_contract_path(),
    )?;
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let response = connected
        .request_json_value(
            "rpc.v1.Auth.DeploymentAuthority.Plan",
            &json!({
                "deploymentId": deployment_id,
                "contract": resolved.loaded.value,
                "expectedDigest": resolved.loaded.digest,
            }),
        )
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&response)?;
    } else {
        output::print_success("deployment authority plan created");
        output::print_info(&format!("deploymentId={deployment_id}"));
        output::print_info(&format!("contractDigest={}", resolved.loaded.digest));
        if let Some(plan) = response.get("plan") {
            if let Some(plan_id) = plan.get("planId").and_then(Value::as_str) {
                output::print_info(&format!("planId={plan_id}"));
            }
            if let Some(classification) = plan.get("classification").and_then(Value::as_str) {
                output::print_info(&format!("classification={classification}"));
            }
        }
    }
    Ok(())
}

async fn toggle_service(format: OutputFormat, id: &str, enable: bool) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let deployment = if enable {
        auth_client
            .enable_service_deployment(id)
            .await
            .into_diagnostic()?
    } else {
        auth_client
            .disable_service_deployment(id)
            .await
            .into_diagnostic()?
    };
    print_toggle_service_result(format, id, enable, &deployment)
}

async fn toggle_device(format: OutputFormat, id: &str, enable: bool) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let success = if enable {
        authlib::AuthClient::new(&connected)
            .enable_device_deployment(id)
            .await
            .into_diagnostic()?
    } else {
        authlib::AuthClient::new(&connected)
            .disable_device_deployment(id)
            .await
            .into_diagnostic()?
    };
    print_toggle_success_result(format, DeploymentKind::Device, id, enable, success)
}

async fn remove_deployment(
    format: OutputFormat,
    kind: DeploymentKind,
    id: &str,
    args: &RemoveArgs,
) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );
    let label = ref_label(kind, id);
    if !output::is_json(format) && !args.force && !prompt_for_typed_identifier(&label)? {
        return Err(miette::miette!("deployment removal cancelled"));
    }
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = match kind {
        DeploymentKind::Service => {
            auth_client
                .remove_service_deployment_with_remove_options(
                    id,
                    authlib::RemoveServiceDeploymentOptions {
                        cascade: args.cascade.then_some(true),
                        purge_unused_contracts: args
                            .should_purge_unused_contracts()
                            .then_some(true),
                    },
                )
                .await
        }
        DeploymentKind::Device => {
            auth_client
                .remove_device_deployment_with_remove_options(
                    id,
                    authlib::RemoveDeviceDeploymentOptions {
                        cascade: args.cascade.then_some(true),
                        purge_unused_contracts: args
                            .should_purge_unused_contracts()
                            .then_some(true),
                    },
                )
                .await
        }
    }
    .into_diagnostic()?;
    print_remove_result(format, kind, id, success)
}

async fn service_instances(
    format: OutputFormat,
    id: &str,
    args: &SvcInstancesArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let instances = authlib::AuthClient::new(&connected)
        .list_service_instances(Some(id), args.disabled.then_some(true))
        .await
        .into_diagnostic()?;
    print_service_instances_result(format, instances)
}

async fn device_instances(
    format: OutputFormat,
    id: &str,
    args: &DevInstancesArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let instances = authlib::AuthClient::new(&connected)
        .list_device_instances(Some(id), args.state.map(DeviceInstanceState::as_wire_value))
        .await
        .into_diagnostic()?;
    print_device_instances_result(format, instances)
}

async fn provision_service(
    format: OutputFormat,
    id: &str,
    args: &SvcProvisionArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let (instance_seed, instance_key, generated_seed) = if let Some(seed) = &args.instance_seed {
        let auth = SessionAuth::from_seed_base64url(seed).into_diagnostic()?;
        (seed.clone(), auth.session_key, false)
    } else {
        let (seed, key) = generate_session_keypair();
        (seed, key, true)
    };
    let instance = authlib::AuthClient::new(&connected)
        .provision_service_instance(&authlib::AuthServiceInstancesProvisionRequest {
            deployment_id: id.to_string(),
            instance_key,
        })
        .await
        .into_diagnostic()?;
    print_service_provision_result(format, &instance, generated_seed, &instance_seed)
}

async fn provision_device(
    format: OutputFormat,
    id: &str,
    args: &DevProvisionArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let seed: [u8; 32] = rand::random();
    let root_secret = URL_SAFE_NO_PAD.encode(seed);
    let identity = authlib::derive_device_identity(&seed).into_diagnostic()?;
    let metadata = build_device_metadata(args)?;
    let instance = authlib::AuthClient::new(&connected)
        .provision_device_instance(
            id,
            &identity.public_identity_key,
            &identity.activation_key_base64url,
            metadata,
        )
        .await
        .into_diagnostic()?;
    print_device_provision_result(format, &instance, &root_secret)
}

async fn dev_activations(
    format: OutputFormat,
    deployment_id: &str,
    command: DevActivationsCommand,
) -> miette::Result<()> {
    match command {
        DevActivationsCommand::List(args) => {
            let (_state, connected) = connect_authenticated_cli_client(format).await?;
            let activations = authlib::AuthClient::new(&connected)
                .list_device_activations(
                    args.instance.as_deref(),
                    Some(deployment_id),
                    args.state.map(DeviceActivationState::as_wire_value),
                )
                .await
                .into_diagnostic()?;
            print_device_activations_result(format, activations)
        }
        DevActivationsCommand::Revoke(args) => {
            let (_state, connected) = connect_authenticated_cli_client(format).await?;
            let success = authlib::AuthClient::new(&connected)
                .revoke_device_activation(&args.instance_id)
                .await
                .into_diagnostic()?;
            print_revoke_activation_result(format, &args.instance_id, success)
        }
    }
}

async fn dev_reviews(
    format: OutputFormat,
    deployment_id: &str,
    command: DevReviewsCommand,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    match command {
        DevReviewsCommand::List(args) => {
            let reviews = auth_client
                .list_device_activation_reviews(
                    args.instance.as_deref(),
                    Some(deployment_id),
                    args.state.map(DeviceReviewState::as_wire_value),
                )
                .await
                .into_diagnostic()?;
            print_device_reviews_result(format, reviews)
        }
        DevReviewsCommand::Approve(args) => {
            review_decide(format, auth_client, &args, "approve").await
        }
        DevReviewsCommand::Reject(args) => {
            review_decide(format, auth_client, &args, "reject").await
        }
    }
}

async fn review_decide(
    format: OutputFormat,
    auth_client: authlib::AuthClient<'_>,
    args: &DevReviewDecisionArgs,
    decision: &str,
) -> miette::Result<()> {
    let response = auth_client
        .decide_device_activation_review(&args.review_id, decision, args.reason.as_deref())
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&response)?;
    } else {
        let message = match decision {
            "approve" => "approved device review",
            "reject" => "rejected device review",
            _ => "updated device review",
        };
        output::print_success(message);
        output::print_info(&format!("reviewId={}", args.review_id));
    }
    Ok(())
}

async fn deployment_authority(
    format: OutputFormat,
    deployment_id: &str,
    command: DeploymentAuthorityCommand,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    match command {
        DeploymentAuthorityCommand::Show => {
            let response = connected
                .request_json_value(
                    "rpc.v1.Auth.DeploymentAuthority.Get",
                    &json!({ "deploymentId": deployment_id }),
                )
                .await
                .into_diagnostic()?;
            print_deployment_authority_result(format, &response)
        }
        DeploymentAuthorityCommand::Plan(command) => {
            deployment_authority_plan(format, &connected, deployment_id, command).await
        }
        DeploymentAuthorityCommand::AcceptUpdate(args) => {
            let mut body = json!({ "planId": args.plan_id });
            if let Some(version) = args.expected_desired_version.as_deref() {
                body["expectedDesiredVersion"] = json!(version);
            }
            let response = connected
                .request_json_value("rpc.v1.Auth.DeploymentAuthority.AcceptUpdate", &body)
                .await
                .into_diagnostic()?;
            print_authority_decision_result(
                format,
                &response,
                "accepted desired authority update",
                true,
            )
        }
        DeploymentAuthorityCommand::AcceptMigration(args) => {
            let mut body = json!({
                "planId": args.plan_id,
                "acknowledgement": args.acknowledgement,
            });
            if let Some(version) = args.expected_desired_version.as_deref() {
                body["expectedDesiredVersion"] = json!(version);
            }
            let response = connected
                .request_json_value("rpc.v1.Auth.DeploymentAuthority.AcceptMigration", &body)
                .await
                .into_diagnostic()?;
            print_authority_decision_result(
                format,
                &response,
                "accepted desired authority migration",
                true,
            )
        }
        DeploymentAuthorityCommand::Reject(args) => {
            let mut body = json!({ "planId": args.plan_id });
            if let Some(reason) = args.reason.as_deref() {
                body["reason"] = json!(reason);
            }
            let response = connected
                .request_json_value("rpc.v1.Auth.DeploymentAuthority.Reject", &body)
                .await
                .into_diagnostic()?;
            print_authority_decision_result(format, &response, "rejected authority plan", false)
        }
        DeploymentAuthorityCommand::Reconcile(args) => {
            let mut body = json!({ "deploymentId": deployment_id });
            if let Some(version) = args.desired_version.as_deref() {
                body["desiredVersion"] = json!(version);
            }
            let response = connected
                .request_json_value("rpc.v1.Auth.DeploymentAuthority.Reconcile", &body)
                .await
                .into_diagnostic()?;
            print_authority_decision_result(
                format,
                &response,
                "requested authority reconciliation",
                false,
            )
        }
    }
}

async fn deployment_authority_plan(
    format: OutputFormat,
    connected: &TrellisClient,
    deployment_id: &str,
    command: AuthorityPlanCommand,
) -> miette::Result<()> {
    match command {
        AuthorityPlanCommand::List(args) => {
            let mut body = json!({
                "deploymentId": deployment_id,
                "limit": 500,
                "offset": 0,
            });
            if let Some(state) = args.state {
                body["state"] = json!(state.as_wire_value());
            }
            if let Some(classification) = args.classification {
                body["classification"] = json!(classification.as_wire_value());
            }
            let response = connected
                .request_json_value("rpc.v1.Auth.DeploymentAuthority.Plans.List", &body)
                .await
                .into_diagnostic()?;
            print_deployment_authority_plans_result(format, &response)
        }
        AuthorityPlanCommand::Show(args) => {
            let response = connected
                .request_json_value(
                    "rpc.v1.Auth.DeploymentAuthority.Plans.Get",
                    &json!({ "planId": args.plan_id }),
                )
                .await
                .into_diagnostic()?;
            print_deployment_authority_result(format, &response)
        }
    }
}

fn print_deployment_authority_result(format: OutputFormat, response: &Value) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&response)?;
    } else {
        output::print_json(response)?;
    }
    Ok(())
}

fn print_deployment_authority_plans_result(
    format: OutputFormat,
    response: &Value,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(response)?;
    } else {
        let entries = response.get("entries").unwrap_or(&Value::Null);
        print_value_table(
            entries,
            &[
                "planId",
                "deploymentId",
                "classification",
                "state",
                "createdAt",
                "expiresAt",
            ],
        )?;
    }
    Ok(())
}

fn print_authority_decision_result(
    format: OutputFormat,
    response: &Value,
    message: &str,
    reconciliation_queued: bool,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(response)?;
    } else {
        output::print_success(message);
        if let Some(authority) = response.get("authority") {
            if let Some(deployment_id) = authority.get("deploymentId").and_then(Value::as_str) {
                output::print_info(&format!("deploymentId={deployment_id}"));
            }
            if let Some(version) = authority_desired_version(response) {
                output::print_info(&format!("desiredVersion={version}"));
            }
        }
        if reconciliation_queued {
            output::print_info("reconciliation=triggered");
        }
    }
    Ok(())
}

fn authority_desired_version(response: &Value) -> Option<&str> {
    response
        .get("desiredVersion")
        .and_then(Value::as_str)
        .or_else(|| {
            response
                .get("authority")
                .and_then(|authority| authority.get("desiredVersion"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            response
                .get("authority")
                .and_then(|authority| authority.get("version"))
                .and_then(Value::as_str)
        })
}

async fn deployment_grants_list(
    format: OutputFormat,
    connected: &TrellisClient,
    deployment_id: &str,
) -> miette::Result<()> {
    let response = connected
        .request_json_value(
            "rpc.v1.Auth.DeploymentAuthority.Get",
            &json!({ "deploymentId": deployment_id }),
        )
        .await
        .into_diagnostic()?;
    print_deployment_grants_result(format, deployment_id, &response)
}

async fn deployment_grants_list_all(
    format: OutputFormat,
    connected: &TrellisClient,
) -> miette::Result<()> {
    let list_response = connected
        .request_json_value(
            "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.List",
            &json!({ "limit": 500, "offset": 0 }),
        )
        .await
        .into_diagnostic()?;
    let grant_overrides = list_response
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    print_grants_result(format, &Value::Array(grant_overrides))
}

async fn deployment_grants_mutate(
    format: OutputFormat,
    connected: &TrellisClient,
    deployment_id: &str,
    args: &DeploymentGrantMutationArgs,
    add: bool,
) -> miette::Result<()> {
    let contract_id = args
        .contract_id
        .as_deref()
        .ok_or_else(|| miette::miette!("--contract is required for grant overrides"))?;
    let identity_value = match args.identity_kind {
        DeploymentAuthorityGrantOverrideIdentityKind::Web => args
            .origin
            .as_deref()
            .ok_or_else(|| miette::miette!("--origin is required for web grant overrides"))?,
        DeploymentAuthorityGrantOverrideIdentityKind::Session => {
            args.session_public_key.as_deref().ok_or_else(|| {
                miette::miette!("--session-public-key is required for session grant overrides")
            })?
        }
    };
    if args.capabilities.is_empty() && args.capability_groups.is_empty() {
        return Err(miette::miette!(
            "at least one --capability or --capability-group is required"
        ));
    }

    let identity_kind = args.identity_kind.as_wire_value();
    let mut grant_overrides = args
        .capabilities
        .iter()
        .map(|capability| match args.identity_kind {
            DeploymentAuthorityGrantOverrideIdentityKind::Web => json!({
                "deploymentId": deployment_id,
                "identityKind": identity_kind,
                "grantKind": "capability",
                "contractId": contract_id,
                "origin": identity_value,
                "sessionPublicKey": null,
                "capability": capability,
                "capabilityGroupKey": null,
            }),
            DeploymentAuthorityGrantOverrideIdentityKind::Session => json!({
                "deploymentId": deployment_id,
                "identityKind": identity_kind,
                "grantKind": "capability",
                "contractId": contract_id,
                "origin": null,
                "sessionPublicKey": identity_value,
                "capability": capability,
                "capabilityGroupKey": null,
            }),
        })
        .collect::<Vec<_>>();
    grant_overrides.extend(args.capability_groups.iter().map(
        |group_key| match args.identity_kind {
            DeploymentAuthorityGrantOverrideIdentityKind::Web => json!({
                "deploymentId": deployment_id,
                "identityKind": identity_kind,
                "grantKind": "capability-group",
                "contractId": contract_id,
                "origin": identity_value,
                "sessionPublicKey": null,
                "capability": null,
                "capabilityGroupKey": group_key,
            }),
            DeploymentAuthorityGrantOverrideIdentityKind::Session => json!({
                "deploymentId": deployment_id,
                "identityKind": identity_kind,
                "grantKind": "capability-group",
                "contractId": contract_id,
                "origin": null,
                "sessionPublicKey": identity_value,
                "capability": null,
                "capabilityGroupKey": group_key,
            }),
        },
    ));
    let request_overrides = if add {
        let response = connected
            .request_json_value(
                "rpc.v1.Auth.DeploymentAuthority.Get",
                &json!({ "deploymentId": deployment_id }),
            )
            .await
            .into_diagnostic()?;
        let mut existing = response
            .get("grantOverrides")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for override_row in grant_overrides {
            if !existing
                .iter()
                .any(|existing_row| existing_row == &override_row)
            {
                existing.push(override_row);
            }
        }
        existing
    } else {
        grant_overrides
    };
    let subject = if add {
        "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Put"
    } else {
        "rpc.v1.Auth.DeploymentAuthority.GrantOverrides.Remove"
    };
    let response = connected
        .request_json_value(
            subject,
            &json!({
                "deploymentId": deployment_id,
                "overrides": request_overrides,
            }),
        )
        .await
        .into_diagnostic()?;
    print_deployment_grant_mutation_result(
        format,
        deployment_id,
        &response,
        add,
        args.capabilities.len() + args.capability_groups.len(),
    )
}

fn print_grants_result(format: OutputFormat, grant_overrides: &Value) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "grantOverrides": grant_overrides }))?;
        return Ok(());
    }

    print_value_table(
        grant_overrides,
        &[
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
        ],
    )
}

fn print_deployment_show_result<T: serde::Serialize>(
    format: OutputFormat,
    kind: DeploymentKind,
    deployment: &T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "deployment": deployment }))?;
        return Ok(());
    }

    let value = serde_json::to_value(deployment).into_diagnostic()?;
    output::print_info(&format!(
        "ref={}",
        ref_label(kind, &value_string(&value, "deploymentId"))
    ));
    print_value_field(&value, "disabled");
    print_value_field(&value, "namespaces");
    print_value_field(&value, "reviewMode");
    Ok(())
}

fn print_toggle_service_result<T: serde::Serialize>(
    format: OutputFormat,
    id: &str,
    enable: bool,
    deployment: &T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "deployment": deployment }))?;
        return Ok(());
    }

    print_toggle_text(DeploymentKind::Service, id, enable);
    Ok(())
}

fn print_toggle_success_result(
    format: OutputFormat,
    kind: DeploymentKind,
    id: &str,
    enable: bool,
    success: bool,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "deploymentId": id }))?;
        return Ok(());
    }

    if success {
        print_toggle_text(kind, id, enable);
    } else {
        output::print_info("no matching deployment updated");
        output::print_info(&format!("ref={}", ref_label(kind, id)));
    }
    Ok(())
}

fn print_toggle_text(kind: DeploymentKind, id: &str, enable: bool) {
    let state = if enable { "enabled" } else { "disabled" };
    output::print_success(&format!("{state} deployment"));
    output::print_info(&format!("ref={}", ref_label(kind, id)));
}

fn print_remove_result(
    format: OutputFormat,
    kind: DeploymentKind,
    id: &str,
    success: bool,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "deploymentId": id }))?;
        return Ok(());
    }

    if success {
        output::print_success("removed deployment");
    } else {
        output::print_info("no matching deployment removed");
    }
    output::print_info(&format!("ref={}", ref_label(kind, id)));
    Ok(())
}

fn print_service_instances_result<T: serde::Serialize>(
    format: OutputFormat,
    instances: T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "instances": instances }))?;
        return Ok(());
    }

    print_value_table(
        &serde_json::to_value(instances).into_diagnostic()?,
        &["instanceId", "deploymentId", "disabled"],
    )
}

fn print_device_instances_result<T: serde::Serialize>(
    format: OutputFormat,
    instances: T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "instances": instances }))?;
        return Ok(());
    }

    print_value_table(
        &serde_json::to_value(instances).into_diagnostic()?,
        &[
            "instanceId",
            "deploymentId",
            "state",
            "publicIdentityKey",
            "name",
            "serialNumber",
            "modelNumber",
        ],
    )
}

fn print_service_provision_result<T: serde::Serialize>(
    format: OutputFormat,
    instance: &T,
    generated_seed: bool,
    instance_seed: &str,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(
            &json!({ "instance": instance, "generatedSeed": generated_seed, "instanceSeed": generated_seed.then_some(instance_seed) }),
        )?;
        return Ok(());
    }

    output::print_success("provisioned service instance");
    let value = serde_json::to_value(instance).into_diagnostic()?;
    print_value_field(&value, "instanceId");
    print_value_field(&value, "deploymentId");
    print_value_field(&value, "instanceKey");
    if generated_seed {
        output::print_info(&format!("instanceSeed={instance_seed}"));
    }
    Ok(())
}

fn print_device_provision_result<T: serde::Serialize>(
    format: OutputFormat,
    instance: &T,
    root_secret: &str,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "instance": instance, "rootSecret": root_secret }))?;
        return Ok(());
    }

    output::print_success("provisioned device instance");
    let value = serde_json::to_value(instance).into_diagnostic()?;
    print_value_field(&value, "instanceId");
    print_value_field(&value, "deploymentId");
    print_value_field(&value, "publicIdentityKey");
    output::print_info(&format!("rootSecret={root_secret}"));
    Ok(())
}

fn print_device_activations_result<T: serde::Serialize>(
    format: OutputFormat,
    activations: T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "activations": activations }))?;
        return Ok(());
    }

    print_value_table(
        &serde_json::to_value(activations).into_diagnostic()?,
        &[
            "instanceId",
            "deploymentId",
            "state",
            "activatedAt",
            "revokedAt",
        ],
    )
}

fn print_revoke_activation_result(
    format: OutputFormat,
    instance_id: &str,
    success: bool,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": instance_id }))?;
        return Ok(());
    }

    if success {
        output::print_success("revoked device activation");
    } else {
        output::print_info("no matching activation revoked");
    }
    output::print_info(&format!("instanceId={instance_id}"));
    Ok(())
}

fn print_device_reviews_result<T: serde::Serialize>(
    format: OutputFormat,
    reviews: T,
) -> miette::Result<()> {
    if output::is_json(format) {
        output::print_json(&json!({ "reviews": reviews }))?;
        return Ok(());
    }

    print_value_table(
        &serde_json::to_value(reviews).into_diagnostic()?,
        &[
            "reviewId",
            "instanceId",
            "deploymentId",
            "state",
            "createdAt",
        ],
    )
}

fn print_deployment_grants_result(
    format: OutputFormat,
    deployment_id: &str,
    response: &Value,
) -> miette::Result<()> {
    let grant_overrides = response.get("grantOverrides").unwrap_or(&Value::Null);
    if output::is_json(format) {
        output::print_json(&json!({
            "deploymentId": deployment_id,
            "grantOverrides": grant_overrides,
        }))?;
        return Ok(());
    }

    print_value_table(
        grant_overrides,
        &[
            "identityKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
        ],
    )
}

fn print_deployment_grant_mutation_result(
    format: OutputFormat,
    deployment_id: &str,
    response: &Value,
    add: bool,
    count: usize,
) -> miette::Result<()> {
    let grant_overrides = response.get("grantOverrides").unwrap_or(&Value::Null);
    if output::is_json(format) {
        output::print_json(&json!({
            "deploymentId": deployment_id,
            "grantOverrides": grant_overrides,
        }))?;
        return Ok(());
    }

    let message = if add {
        "added deployment grant overrides"
    } else {
        "removed deployment grant overrides"
    };
    output::print_success(message);
    output::print_info(&format!("deploymentId={deployment_id}"));
    output::print_info(&format!("count={count}"));
    Ok(())
}

fn print_value_table(value: &Value, columns: &[&str]) -> miette::Result<()> {
    let rows = value
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    columns
                        .iter()
                        .map(|column| value_string(item, column))
                        .collect::<Vec<_>>()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    println!("{}", output::table(columns, rows));
    Ok(())
}

fn print_value_field(value: &Value, field: &str) {
    let rendered = value_string(value, field);
    if !rendered.is_empty() {
        output::print_info(&format!("{field}={rendered}"));
    }
}

fn value_string(value: &Value, field: &str) -> String {
    match value.get(field) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Array(values)) => values
            .iter()
            .map(json_value_label)
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => value.get(field).map(json_value_label).unwrap_or_default(),
        Some(Value::Null) | None => String::new(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authority_desired_version_prefers_explicit_response_value() {
        let response = json!({
            "desiredVersion": "desired-new",
            "authority": {
                "version": "authority-version",
                "desiredVersion": "authority-desired"
            }
        });

        assert_eq!(authority_desired_version(&response), Some("desired-new"));
    }

    #[test]
    fn authority_desired_version_falls_back_to_authority_version() {
        let response = json!({
            "authority": {
                "version": "authority-version"
            }
        });

        assert_eq!(
            authority_desired_version(&response),
            Some("authority-version")
        );
    }
}

fn ref_label(kind: DeploymentKind, id: &str) -> String {
    let prefix = match kind {
        DeploymentKind::Service => "svc",
        DeploymentKind::Device => "dev",
    };
    format!("{prefix}/{id}")
}

fn prompt_for_typed_identifier(identifier: &str) -> miette::Result<bool> {
    print!("Type {identifier} to confirm: ");
    io::stdout().flush().into_diagnostic()?;
    let mut line = String::new();
    io::stdin().read_line(&mut line).into_diagnostic()?;
    Ok(line.trim() == identifier)
}

fn build_device_metadata(
    args: &DevProvisionArgs,
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
