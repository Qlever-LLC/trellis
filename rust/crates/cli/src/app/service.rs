use std::collections::BTreeMap;
use std::io::{self, Write};

use crate::app::{
    connect_authenticated_cli_client, contract_review_rows, generate_session_keypair,
    prompt_for_confirmation,
};
use crate::cli::*;
use crate::contract_input::resolve_contract_input;
use crate::output;
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis_auth as authlib;
use trellis_client::SessionAuth;

pub(super) async fn run(format: OutputFormat, command: ServiceCommand) -> miette::Result<()> {
    match command.command {
        ServiceSubcommand::Profile(profile) => match profile.command {
            ServiceProfileSubcommand::List(args) => profile_list_command(format, &args).await,
            ServiceProfileSubcommand::Create(args) => profile_create_command(format, &args).await,
            ServiceProfileSubcommand::Apply(args) => profile_apply_command(format, &args).await,
            ServiceProfileSubcommand::Unapply(args) => profile_unapply_command(format, &args).await,
            ServiceProfileSubcommand::Disable(args) => profile_disable_command(format, &args).await,
            ServiceProfileSubcommand::Enable(args) => profile_enable_command(format, &args).await,
            ServiceProfileSubcommand::Remove(args) => profile_remove_command(format, &args).await,
        },
        ServiceSubcommand::Instance(instance) => match instance.command {
            ServiceInstanceSubcommand::List(args) => instance_list_command(format, &args).await,
            ServiceInstanceSubcommand::Provision(args) => {
                instance_provision_command(format, &args).await
            }
            ServiceInstanceSubcommand::Disable(args) => {
                instance_disable_command(format, &args).await
            }
            ServiceInstanceSubcommand::Enable(args) => instance_enable_command(format, &args).await,
            ServiceInstanceSubcommand::Remove(args) => instance_remove_command(format, &args).await,
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

fn service_profile_rows(
    profile_id: &str,
    disabled: bool,
    namespaces: &[String],
    contract_count: usize,
) -> Vec<Vec<String>> {
    vec![
        vec!["profile".to_string(), profile_id.to_string()],
        vec!["disabled".to_string(), disabled.to_string()],
        vec!["namespaces".to_string(), namespaces.join(", ")],
        vec!["contracts".to_string(), contract_count.to_string()],
    ]
}

async fn profile_list_command(
    format: OutputFormat,
    args: &ServiceProfileListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profiles = auth_client
        .list_service_profiles(args.disabled)
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "profiles": profiles }))?;
        return Ok(());
    }

    if profiles.is_empty() {
        output::print_info("no service profiles found");
        return Ok(());
    }

    let rows = profiles
        .into_iter()
        .map(|profile| {
            vec![
                profile.profile_id,
                profile.disabled.to_string(),
                profile.applied_contracts.len().to_string(),
                profile.namespaces.join(", "),
            ]
        })
        .collect::<Vec<_>>();

    println!(
        "{}",
        output::table(&["profile", "disabled", "contracts", "namespaces"], rows,)
    );
    Ok(())
}

async fn profile_create_command(
    format: OutputFormat,
    args: &ServiceProfileCreateArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profile = auth_client
        .create_service_profile(&authlib::AuthCreateServiceProfileRequest {
            profile_id: args.profile.clone(),
            namespaces: args.namespaces.clone(),
        })
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "profile": profile }))?;
        return Ok(());
    }

    output::print_success("service profile created");
    output::print_info(&format!("profileId={}", profile.profile_id));
    Ok(())
}

async fn profile_apply_command(
    format: OutputFormat,
    args: &ServiceProfileApplyArgs,
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
        .ok_or_else(|| miette::miette!("service contract payload must be a JSON object"))?;

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
            return Err(miette::miette!("service profile apply cancelled"));
        }
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .apply_service_profile_contract(&authlib::AuthApplyServiceProfileContractRequest {
            profile_id: args.profile.clone(),
            contract,
        })
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&response)?;
        return Ok(());
    }

    output::print_success("service profile contract applied");
    output::print_info(&format!("profileId={}", response.profile.profile_id));
    output::print_info(&format!("contractId={}", response.contract.id));
    output::print_info(&format!("digest={}", response.contract.digest));
    Ok(())
}

async fn profile_unapply_command(
    format: OutputFormat,
    args: &ServiceProfileUnapplyArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let response = auth_client
        .unapply_service_profile_contract(&authlib::AuthUnapplyServiceProfileContractRequest {
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

    output::print_success("service profile contract unapplied");
    output::print_info(&format!("profileId={}", response.profile.profile_id));
    Ok(())
}

async fn profile_disable_command(
    format: OutputFormat,
    args: &ServiceProfileToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profile = auth_client
        .disable_service_profile(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profile": profile }))?;
        return Ok(());
    }
    output::print_success("service profile disabled");
    output::print_info(&format!("profileId={}", profile.profile_id));
    Ok(())
}

async fn profile_enable_command(
    format: OutputFormat,
    args: &ServiceProfileToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let profile = auth_client
        .enable_service_profile(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "profile": profile }))?;
        return Ok(());
    }
    output::print_success("service profile enabled");
    output::print_info(&format!("profileId={}", profile.profile_id));
    Ok(())
}

async fn profile_remove_command(
    format: OutputFormat,
    args: &ServiceProfileRemoveArgs,
) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );

    if !output::is_json(format) {
        let (_state, connected) = connect_authenticated_cli_client(format).await?;
        let auth_client = authlib::AuthClient::new(&connected);
        let profiles = auth_client
            .list_service_profiles(false)
            .await
            .into_diagnostic()?;
        if let Some(profile) = profiles
            .iter()
            .find(|profile| profile.profile_id == args.profile)
        {
            output::print_info("Removal review");
            println!(
                "{}",
                output::table(
                    &["field", "value"],
                    service_profile_rows(
                        &profile.profile_id,
                        profile.disabled,
                        &profile.namespaces,
                        profile.applied_contracts.len(),
                    ),
                )
            );
        }
        if !args.force && !prompt_for_typed_identifier(&args.profile)? {
            return Err(miette::miette!("service profile removal cancelled"));
        }
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .remove_service_profile(&args.profile)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "profileId": args.profile }))?;
    } else if success {
        output::print_success("service profile removed");
        output::print_info(&format!("profileId={}", args.profile));
    }
    Ok(())
}

async fn instance_list_command(
    format: OutputFormat,
    args: &ServiceInstanceListArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instances = auth_client
        .list_service_instances(args.profile.as_deref(), args.disabled.then_some(true))
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({ "instances": instances }))?;
        return Ok(());
    }

    if instances.is_empty() {
        output::print_info("no service instances found");
        return Ok(());
    }

    let rows = instances
        .into_iter()
        .map(|instance| {
            vec![
                instance.instance_id,
                instance.profile_id,
                instance.current_contract_id.unwrap_or_default(),
                instance.current_contract_digest.unwrap_or_default(),
                instance.disabled.to_string(),
            ]
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        output::table(
            &["instance", "profile", "contract id", "digest", "disabled"],
            rows,
        )
    );
    Ok(())
}

async fn instance_provision_command(
    format: OutputFormat,
    args: &ServiceInstanceProvisionArgs,
) -> miette::Result<()> {
    let (instance_seed, instance_key, generated_seed) = if let Some(seed) = &args.instance_seed {
        let auth = SessionAuth::from_seed_base64url(seed).into_diagnostic()?;
        (seed.clone(), auth.session_key, false)
    } else {
        let (seed, key) = generate_session_keypair();
        (seed, key, true)
    };

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instance = auth_client
        .provision_service_instance(&authlib::AuthProvisionServiceInstanceRequest {
            profile_id: args.profile.clone(),
            instance_key: instance_key.clone(),
        })
        .await
        .into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&json!({
            "instance": instance,
            "generatedSeed": generated_seed,
            "instanceSeed": generated_seed.then_some(instance_seed.clone()),
        }))?;
        return Ok(());
    }

    output::print_success("service instance provisioned");
    output::print_info(&format!("instanceId={}", instance.instance_id));
    output::print_info(&format!("profileId={}", instance.profile_id));
    output::print_info(&format!("instanceKey={}", instance.instance_key));
    if generated_seed {
        output::print_info(&format!("instanceSeed={instance_seed}"));
        output::print_info("store the instance seed securely; it will not be shown again");
    }
    Ok(())
}

async fn instance_disable_command(
    format: OutputFormat,
    args: &ServiceInstanceToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instance = auth_client
        .disable_service_instance(&args.instance)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "instance": instance }))?;
        return Ok(());
    }
    output::print_success("service instance disabled");
    output::print_info(&format!("instanceId={}", instance.instance_id));
    Ok(())
}

async fn instance_enable_command(
    format: OutputFormat,
    args: &ServiceInstanceToggleArgs,
) -> miette::Result<()> {
    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let instance = auth_client
        .enable_service_instance(&args.instance)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "instance": instance }))?;
        return Ok(());
    }
    output::print_success("service instance enabled");
    output::print_info(&format!("instanceId={}", instance.instance_id));
    Ok(())
}

async fn instance_remove_command(
    format: OutputFormat,
    args: &ServiceInstanceRemoveArgs,
) -> miette::Result<()> {
    miette::ensure!(
        !output::is_json(format) || args.force,
        "use -f with --format json to skip the interactive removal review"
    );

    if !output::is_json(format) && !args.force && !prompt_for_typed_identifier(&args.instance)? {
        return Err(miette::miette!("service instance removal cancelled"));
    }

    let (_state, connected) = connect_authenticated_cli_client(format).await?;
    let auth_client = authlib::AuthClient::new(&connected);
    let success = auth_client
        .remove_service_instance(&args.instance)
        .await
        .into_diagnostic()?;
    if output::is_json(format) {
        output::print_json(&json!({ "success": success, "instanceId": args.instance }))?;
    } else if success {
        output::print_success("service instance removed");
        output::print_info(&format!("instanceId={}", args.instance));
    }
    Ok(())
}
