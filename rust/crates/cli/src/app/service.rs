use std::path::PathBuf;

use crate::app::{
    contract_review_rows, default_display_name, generate_session_keypair, infer_namespaces,
    prompt_for_confirmation, resolve_upgrade_service_key,
};
use crate::cli::*;
use crate::contract_input::resolve_contract_input;
use crate::output;
use miette::IntoDiagnostic;
use serde_json::json;
use trellis_auth as authlib;

pub(super) async fn run(
    format: OutputFormat,
    global_nats_servers: Option<String>,
    global_creds: Option<PathBuf>,
    command: ServiceCommand,
) -> miette::Result<()> {
    match command.command {
        ServiceSubcommand::List => list_command(format).await,
        ServiceSubcommand::Install(args) => {
            install_command(format, global_nats_servers, global_creds, &args).await
        }
        ServiceSubcommand::Upgrade(args) => {
            upgrade_command(format, global_nats_servers, global_creds, &args).await
        }
    }
}

async fn list_command(format: OutputFormat) -> miette::Result<()> {
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
    let auth_client = authlib::AuthClient::new(&connected);
    let services = auth_client.list_services().await.into_diagnostic()?;
    auth_client
        .renew_binding_token(&mut state)
        .await
        .into_diagnostic()?;

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

async fn install_command(
    format: OutputFormat,
    _global_nats_servers: Option<String>,
    _global_creds: Option<PathBuf>,
    args: &ServiceInstallArgs,
) -> miette::Result<()> {
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

    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
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
    auth_client
        .renew_binding_token(&mut state)
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

async fn upgrade_command(
    format: OutputFormat,
    _global_nats_servers: Option<String>,
    _global_creds: Option<PathBuf>,
    args: &ServiceUpgradeArgs,
) -> miette::Result<()> {
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
    let mut state = authlib::load_admin_session().into_diagnostic()?;
    let connected = authlib::connect_admin_client_async(&state)
        .await
        .into_diagnostic()?;
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
            rows.push(vec![
                "display name".to_string(),
                service.display_name.clone(),
            ]);
            rows.push(vec![
                "current digest".to_string(),
                service.contract_digest.clone().unwrap_or_default(),
            ]);
            rows.push(vec!["active".to_string(), service.active.to_string()]);
            rows.push(vec![
                "namespaces".to_string(),
                service.namespaces.join(", "),
            ]);
            rows.push(vec!["description".to_string(), service.description.clone()]);
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
    auth_client
        .renew_binding_token(&mut state)
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
