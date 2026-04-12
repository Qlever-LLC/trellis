use crate::app::pack_json;
use crate::cli::*;
use crate::contract_input::resolve_contract_inputs;
use crate::{core_client, output};
use miette::IntoDiagnostic;
use serde_json::{json, Value};
use trellis_client::{ServiceConnectOptions, TrellisClient};
use trellis_contracts::{pack_loaded_manifests, write_catalog_pack};

pub(super) async fn run(format: OutputFormat, command: ContractsCommand) -> miette::Result<()> {
    match command.command {
        ContractsSubcommand::Pack(args) => pack_command(format, &args),
        ContractsSubcommand::VerifyLive(args) => verify_live_command(format, &args).await,
    }
}

fn pack_command(format: OutputFormat, args: &PackContractsArgs) -> miette::Result<()> {
    let resolved = resolve_contract_inputs(
        &args.manifests,
        &args.sources,
        &args.images,
        &args.source_export,
        &args.image_contract_path,
    )?;
    let pack = pack_loaded_manifests(resolved.into_iter().map(|entry| entry.loaded).collect())
        .into_diagnostic()?;
    write_catalog_pack(&pack, &args.output, args.contracts_out.as_ref()).into_diagnostic()?;

    if output::is_json(format) {
        output::print_json(&pack_json(
            &pack,
            &args.output,
            args.contracts_out.as_deref(),
        ))?;
        return Ok(());
    }

    let rows = pack
        .contracts
        .iter()
        .map(|manifest| {
            vec![
                manifest.manifest.id.clone(),
                manifest.digest.clone(),
                manifest.path.display().to_string(),
            ]
        })
        .collect();
    println!("{}", output::table(&["id", "digest", "path"], rows));
    output::print_success(&format!(
        "wrote {} contract(s) to {}",
        pack.contracts.len(),
        args.output.display()
    ));
    Ok(())
}

async fn verify_live_command(format: OutputFormat, args: &VerifyLiveArgs) -> miette::Result<()> {
    let creds = args.creds.display().to_string();
    let connected = TrellisClient::connect_service(ServiceConnectOptions {
        servers: &args.servers,
        sentinel_creds_path: &creds,
        session_key_seed_base64url: &args.session_seed,
        timeout_ms: 5_000,
    })
    .await
    .into_diagnostic()?;

    let core_client = core_client::CoreClient::new(&connected);
    let catalog = core_client.catalog().await.into_diagnostic()?.catalog;
    let mut verified = Vec::new();
    for (index, entry) in catalog.contracts.iter().enumerate() {
        if args.limit.is_some_and(|limit| index >= limit) {
            break;
        }
        let contract = core_client
            .contract_get(&entry.digest)
            .await
            .into_diagnostic()?
            .contract;
        let computed =
            trellis_contracts::digest_json(&serde_json::to_value(&contract).into_diagnostic()?)
                .into_diagnostic()?;
        miette::ensure!(computed == entry.digest, "digest mismatch for {}", entry.id);
        verified.push(json!({ "id": entry.id, "digest": entry.digest }));
    }

    if output::is_json(format) {
        output::print_json(&json!({
            "catalogContracts": catalog.contracts.len(),
            "verified": verified,
        }))?;
        return Ok(());
    }

    let rows = verified
        .iter()
        .map(|row| {
            vec![
                row.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                row.get("digest")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ]
        })
        .collect();
    println!("{}", output::table(&["id", "digest"], rows));
    Ok(())
}
