use std::collections::BTreeMap;

use crate::app::{
    connect_authenticated_cli_client, contract_review_rows, default_display_name,
    generate_session_keypair, infer_namespaces, prompt_for_confirmation,
    resolve_service_key_identity, resolve_upgrade_service_key,
};
use crate::cli::*;
use crate::contract_input::resolve_contract_input;
use crate::output;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis_auth as authlib;

pub(super) async fn run(format: OutputFormat, command: ServiceCommand) -> miette::Result<()> {
    match command.command {
        ServiceSubcommand::List => list_command(format).await,
        ServiceSubcommand::Install(args) => install_command(format, &args).await,
        ServiceSubcommand::Remove(args) => remove_command(format, &args).await,
        ServiceSubcommand::RollKey(args) => roll_key_command(format, &args).await,
        ServiceSubcommand::Upgrade(args) => upgrade_command(format, &args).await,
    }
}

fn service_detail_rows(service_key: &str, service: &authlib::ServiceListEntry) -> Vec<Vec<String>> {
    vec![
        vec!["service key".to_string(), service_key.to_string()],
        vec!["display name".to_string(), service.display_name.clone()],
        vec![
            "contract id".to_string(),
            service.contract_id.clone().unwrap_or_default(),
        ],
        vec![
            "contract digest".to_string(),
            service.contract_digest.clone().unwrap_or_default(),
        ],
        vec!["active".to_string(), service.active.to_string()],
        vec!["namespaces".to_string(), service.namespaces.join(", ")],
        vec!["description".to_string(), service.description.clone()],
    ]
}

fn installed_contract_payload(
    response: &authlib::AuthGetInstalledContractResponse,
) -> miette::Result<BTreeMap<String, Value>> {
    response
        .contract
        .contract
        .clone()
        .ok_or_else(|| miette::miette!("installed contract payload is missing canonical JSON"))
}

fn roll_key_partial_failure_message(old_service_key: &str, new_service_key: &str, seed: &str) -> String {
    format!(
        "new service installed with sessionKey={new_service_key} seed={seed}; remove the old service manually with `trellis service remove --service-key {old_service_key}`"
    )
}

async fn list_command(format: OutputFormat) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "services": services }))?;
        return Ok(());
    }

    if services.is_empty() {
        output::print_info("no installed services found");
        return Ok(());
    }

    let rows = services
        .into_iter()
        .map(|service| {
            vec![
                service.session_key,
                service.display_name,
                service.contract_id.unwrap_or_default(),
                service.contract_digest.unwrap_or_default(),
                service.active.to_string(),
                service.namespaces.join(", "),
                service.description,
            ]
        })
        .collect::<Vec<_>>();

    println!(
        "{}",
        output::table(
            &[
                "service key",
                "display name",
                "contract id",
                "contract digest",
                "active",
                "namespaces",
                "description",
            ],
            rows,
        )
    );

    Ok(())
}

async fn install_command(format: OutputFormat, args: &ServiceInstallArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let loaded = &resolved.loaded;
    let default_name = if loaded.manifest.display_name.is_empty() {
        default_display_name(&resolved.manifest_path)
    } else {
        loaded.manifest.display_name.clone()
    };
    let display_name = args.display_name.clone().unwrap_or(default_name);
    let description = args
        .description
        .clone()
        .unwrap_or_else(|| loaded.manifest.description.clone());
    let namespaces = {
        let mut values = std::collections::BTreeSet::new();
        values.extend(infer_namespaces(&loaded.manifest));
        values.extend(args.extra_namespaces.iter().cloned());
        values.into_iter().collect::<Vec<_>>()
    };
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive install review"
    );

    if !output::is_json(format) {
        output::print_info("Install review");
        println!(
            "{}",
            output::table(
                &["field", "value"],
                [
                    contract_review_rows(loaded),
                    vec![
                        vec!["service display name".to_string(), display_name.clone()],
                        vec!["service description".to_string(), description.clone()],
                        vec!["active".to_string(), (!args.inactive).to_string()],
                        vec!["namespaces".to_string(), namespaces.join(", ")],
                    ],
                ]
                .concat(),
            )
        );
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with service install for digest {}?",
                loaded.digest
            ))?
        {
            return Err(miette::miette!("service install cancelled"));
        }
    }

    let (seed, session_key) = generate_session_keypair();

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let contract = loaded
        .value
        .as_object()
        .cloned()
        .map(|contract| contract.into_iter().collect())
        .ok_or_else(|| miette::miette!("service contract payload must be a JSON object"))?;
    let response = auth_client
        .install_service(&authlib::AuthInstallServiceRequest {
            session_key: session_key.clone(),
            display_name: display_name.clone(),
            active: Some(!args.inactive),
            namespaces: namespaces.clone(),
            description: description.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": session_key,
            "displayName": display_name,
            "contractId": response.contract_id,
            "contractDigest": response.contract_digest,
            "resourceBindings": response.resource_bindings,
            "seedOmitted": true,
        }))?;
    } else {
        output::print_success("installed service contract");
        output::print_info(&format!("sessionKey={session_key}"));
        output::print_info(&format!("contractId={}", response.contract_id));
        output::print_info(&format!("contractDigest={}", response.contract_digest));
        output::print_info(&format!("seed={seed}"));
        output::print_info("store the seed securely; it will not be shown again");
    }

    Ok(())
}

async fn remove_command(format: OutputFormat, args: &ServiceRemoveArgs) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );
    let service_key =
        resolve_service_key_identity(args.target.service_key.as_deref(), args.target.seed.as_deref())?;

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;
    let current = services.iter().find(|service| service.session_key == service_key);

    if !output::is_json(format) {
        if let Some(service) = current {
            output::print_info("Removal review");
            println!(
                "{}",
                output::table(&["field", "value"], service_detail_rows(&service_key, service))
            );
            if !args.force
                && !prompt_for_confirmation(&format!("Proceed with removing service {}?", service_key))?
            {
                return Err(miette::miette!("service removal cancelled"));
            }
        }
    }

    let removed = auth_client
        .remove_service(&authlib::AuthRemoveServiceRequest {
            session_key: service_key.clone(),
        })
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": service_key,
            "success": removed,
        }))?;
    } else if removed {
        output::print_success("removed service");
        output::print_info(&format!("sessionKey={service_key}"));
    } else {
        output::print_info(&format!("service not found: {service_key}"));
    }

    Ok(())
}

async fn roll_key_command(format: OutputFormat, args: &ServiceRollKeyArgs) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive roll-key review"
    );
    let old_service_key =
        resolve_service_key_identity(args.target.service_key.as_deref(), args.target.seed.as_deref())?;

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;
    let current = services
        .iter()
        .find(|service| service.session_key == old_service_key)
        .ok_or_else(|| miette::miette!("service not found: {old_service_key}"))?;
    let contract_digest = current
        .contract_digest
        .clone()
        .ok_or_else(|| miette::miette!("service '{old_service_key}' has no installed contract digest"))?;
    let contract_id = current
        .contract_id
        .clone()
        .ok_or_else(|| miette::miette!("service '{old_service_key}' has no installed contract id"))?;
    let installed = auth_client
        .get_installed_contract(&authlib::AuthGetInstalledContractRequest {
            digest: contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;
    let contract = installed_contract_payload(&installed)?;
    let (seed, new_service_key) = generate_session_keypair();

    if !output::is_json(format) {
        output::print_info("Roll-key review");
        let mut rows = service_detail_rows(&old_service_key, current);
        rows.push(vec!["new service key".to_string(), new_service_key.clone()]);
        println!("{}", output::table(&["field", "value"], rows));
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with rolling the service key for {} ({})?",
                contract_id, contract_digest
            ))?
        {
            return Err(miette::miette!("service key roll cancelled"));
        }
    }

    let response = auth_client
        .install_service(&authlib::AuthInstallServiceRequest {
            session_key: new_service_key.clone(),
            display_name: current.display_name.clone(),
            active: Some(current.active),
            namespaces: current.namespaces.clone(),
            description: current.description.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;
    let partial_failure =
        roll_key_partial_failure_message(&old_service_key, &new_service_key, &seed);
    let removed = auth_client
        .remove_service(&authlib::AuthRemoveServiceRequest {
            session_key: old_service_key.clone(),
        })
        .await
        .map_err(|error| miette::miette!("{partial_failure}: {error}"))?;
    miette::ensure!(removed, "{partial_failure}: old service was not removed");
    if output::is_json(format) {
        output::print_json(&json!({
            "oldSessionKey": old_service_key,
            "newSessionKey": new_service_key,
            "displayName": current.display_name,
            "contractId": response.contract_id,
            "contractDigest": response.contract_digest,
            "resourceBindings": response.resource_bindings,
            "seedOmitted": true,
        }))?;
    } else {
        output::print_success("rolled service key");
        output::print_info(&format!("oldSessionKey={old_service_key}"));
        output::print_info(&format!("newSessionKey={new_service_key}"));
        output::print_info(&format!("contractId={}", response.contract_id));
        output::print_info(&format!("contractDigest={}", response.contract_digest));
        output::print_info(&format!("seed={seed}"));
        output::print_info("store the new seed securely; it will not be shown again");
    }

    Ok(())
}

async fn upgrade_command(format: OutputFormat, args: &ServiceUpgradeArgs) -> miette::Result<()> {
    let resolved = resolve_contract_input(
        args.contract.manifest.as_deref(),
        args.contract.source.as_deref(),
        args.contract.image.as_deref(),
        &args.contract.source_export,
        &args.contract.image_contract_path,
    )?;
    let loaded = &resolved.loaded;
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive upgrade review"
    );
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;
    let service_key = resolve_upgrade_service_key(args, &services, &loaded.manifest.id)?;

    if !output::is_json(format) {
        let current = services
            .iter()
            .find(|service| service.session_key == service_key);
        output::print_info("Upgrade review");
        let mut rows = contract_review_rows(loaded);
        rows.push(vec!["service key".to_string(), service_key.clone()]);
        if let Some(service) = current {
            rows.extend(service_detail_rows(&service_key, service).into_iter().skip(1));
        }
        println!("{}", output::table(&["field", "value"], rows));
        if !args.force
            && !prompt_for_confirmation(&format!(
                "Proceed with service upgrade to digest {}?",
                loaded.digest
            ))?
        {
            return Err(miette::miette!("service upgrade cancelled"));
        }
    }

    let contract = loaded
        .value
        .as_object()
        .cloned()
        .map(|contract| contract.into_iter().collect())
        .ok_or_else(|| miette::miette!("service contract payload must be a JSON object"))?;
    let response = auth_client
        .upgrade_service_contract(&authlib::AuthUpgradeServiceContractRequest {
            session_key: service_key.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({
            "sessionKey": service_key,
            "contractId": response.contract_id,
            "contractDigest": response.contract_digest,
            "resourceBindings": response.resource_bindings,
        }))?;
    } else {
        output::print_success("upgraded service contract");
        output::print_info(&format!("sessionKey={}", service_key));
        output::print_info(&format!("contractId={}", response.contract_id));
        output::print_info(&format!("contractDigest={}", response.contract_digest));
    }

    Ok(())
}
