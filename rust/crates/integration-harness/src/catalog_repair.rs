use std::sync::Arc;
use std::time::Duration;

use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use trellis::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis::client::{ServiceConnectWithContractOptions, TrellisClient};
use trellis::contracts::{
    digest_contract_json, rpc, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis::sdk::auth::types::{
    AuthCatalogIssuesResolveRequest, AuthEnvelopeExpansionsApproveRequest,
    AuthEnvelopeExpansionsListRequest, AuthServiceInstancesProvisionRequest,
};
use trellis::sdk::core::client::CoreClient;
use trellis::sdk::core::types::TrellisCatalogResponseCatalogIssuesItem;
use trellis::service::{ConnectedServiceRuntime, HandlerResult, ServerError, ServiceRuntimeError};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::rpc::reauth_contract;

const REPAIR_DEPLOYMENT_ID: &str = "harness.catalog-repair";
const REPAIR_CONTRACT_ID: &str = "trellis.integration-harness.catalog-repair@v1";
const REPAIR_PERSIST_DEPLOYMENT_ID: &str = "harness.catalog-repair-persist";
const REPAIR_PERSIST_CONTRACT_ID: &str = "trellis.integration-harness.catalog-repair-persist@v1";
const REPAIR_SERVICE_NAME: &str = "harness-catalog-repair-rust";
const REPAIR_RPC_SUBJECT: &str = "rpc.v1.Harness.CatalogRepair.Ping";

#[derive(Debug, Clone)]
pub(crate) struct CatalogRepairPersistenceCheck {
    issue_id: String,
    contract_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct RepairPingRequest {
    message: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct RepairPingResponse {
    message: String,
}

struct RepairPingRpc;

impl trellis::client::RpcDescriptor for RepairPingRpc {
    type Input = RepairPingRequest;
    type Output = RepairPingResponse;

    const KEY: &'static str = "Repair.Ping";
    const SUBJECT: &'static str = REPAIR_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

pub(crate) async fn run_catalog_repair_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<(usize, CatalogRepairPersistenceCheck)> {
    let setup_contract_json = admin_setup_contract_json()?;
    let setup_login = reauth_contract(
        &admin_login.state,
        &setup_contract_json,
        trellis_url,
        browser,
    )
    .await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis::auth::AuthClient::new(&admin_client);
    let sdk_auth_client = SdkAuthClient::new(&admin_client);
    let core_client = CoreClient::new(&admin_client);

    auth_client
        .create_service_deployment(REPAIR_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let old_contract_json = repair_contract_json(REPAIR_CONTRACT_ID, RepairContractShape::Old)?;
    let old_digest = digest_contract_json(&old_contract_json).into_diagnostic()?;
    let new_contract_json = repair_contract_json(REPAIR_CONTRACT_ID, RepairContractShape::New)?;
    let new_digest = digest_contract_json(&new_contract_json).into_diagnostic()?;
    let old_seed = provision_service_instance(&auth_client, REPAIR_DEPLOYMENT_ID).await?;
    let old_connect_task = tokio::spawn(connect_service(
        trellis_url.to_string(),
        REPAIR_CONTRACT_ID.to_string(),
        old_contract_json.clone(),
        old_digest.clone(),
        old_seed,
        30_000,
    ));
    approve_pending_expansions(
        &sdk_auth_client,
        REPAIR_DEPLOYMENT_ID,
        REPAIR_CONTRACT_ID,
        &old_digest,
    )
    .await?;
    let service_client = Arc::new(old_connect_task.await.into_diagnostic()??);
    let service_task = start_repair_service(Arc::clone(&service_client), &old_digest);

    let caller_contract_json = repair_caller_contract_json(REPAIR_CONTRACT_ID)?;
    let caller_login = login_contract(trellis_url, browser, &caller_contract_json).await?;
    let caller_client = connect_admin_client_async(&caller_login.state)
        .await
        .into_diagnostic()?;
    wait_for_repair_ping(&caller_client, "before-conflict").await?;

    let new_seed = provision_service_instance(&auth_client, REPAIR_DEPLOYMENT_ID).await?;
    record_conflicting_evidence(
        trellis_url,
        REPAIR_CONTRACT_ID,
        &new_contract_json,
        &new_digest,
        &new_seed,
    )
    .await;
    let issue = wait_for_catalog_issue(&core_client, REPAIR_CONTRACT_ID, &old_digest).await?;
    wait_for_repair_ping(&caller_client, "during-conflict").await?;

    let blocked_seed = provision_service_instance(&auth_client, REPAIR_DEPLOYMENT_ID).await?;
    assert_active_issue_blocks_connect(
        trellis_url,
        REPAIR_CONTRACT_ID,
        &new_contract_json,
        &new_digest,
        &blocked_seed,
    )
    .await?;

    let repair = sdk_auth_client
        .rpc()
        .auth()
        .catalog_issues_resolve(&AuthCatalogIssuesResolveRequest {
            issue_id: issue.issue_id.clone(),
            action: json!("keep-current"),
        })
        .await
        .into_diagnostic()?;
    if !repair.success || repair.deleted_evidence.is_empty() {
        return Err(miette!(
            "Auth.CatalogIssues.Resolve did not report deleted evidence for {}",
            issue.issue_id
        ));
    }
    wait_for_catalog_issue_clear(&core_client, REPAIR_CONTRACT_ID).await?;

    let persistence_check = create_unresolved_conflict(
        trellis_url,
        &auth_client,
        &sdk_auth_client,
        &core_client,
        REPAIR_PERSIST_DEPLOYMENT_ID,
        REPAIR_PERSIST_CONTRACT_ID,
    )
    .await?;

    service_task.abort();
    Ok((7, persistence_check))
}

pub(crate) async fn verify_catalog_repair_persistence_after_restart(
    admin_login: &AdminLoginOutcome,
    check: &CatalogRepairPersistenceCheck,
) -> Result<usize> {
    let admin_client = connect_admin_client_async(&admin_login.state)
        .await
        .into_diagnostic()?;
    let catalog = CoreClient::new(&admin_client)
        .rpc()
        .trellis()
        .catalog()
        .await
        .into_diagnostic()?;
    let issue = catalog
        .catalog
        .issues
        .unwrap_or_default()
        .into_iter()
        .find(|issue| issue.issue_id == check.issue_id);
    match issue {
        Some(issue) if issue.contract_id.as_deref() == Some(check.contract_id.as_str()) => Ok(2),
        Some(issue) => Err(miette!(
            "catalog repair persistence issue {} had contract {:?}, expected {}",
            issue.issue_id,
            issue.contract_id,
            check.contract_id
        )),
        None => Err(miette!(
            "catalog repair persistence issue {} was not visible after restart",
            check.issue_id
        )),
    }
}

async fn create_unresolved_conflict(
    trellis_url: &str,
    auth_client: &trellis::auth::AuthClient<'_>,
    sdk_auth_client: &SdkAuthClient<'_>,
    core_client: &CoreClient<'_>,
    deployment_id: &str,
    contract_id: &str,
) -> Result<CatalogRepairPersistenceCheck> {
    auth_client
        .create_service_deployment(deployment_id, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;
    let old_contract_json = repair_contract_json(contract_id, RepairContractShape::Old)?;
    let old_digest = digest_contract_json(&old_contract_json).into_diagnostic()?;
    let new_contract_json = repair_contract_json(contract_id, RepairContractShape::New)?;
    let new_digest = digest_contract_json(&new_contract_json).into_diagnostic()?;
    let old_seed = provision_service_instance(auth_client, deployment_id).await?;
    let old_connect_task = tokio::spawn(connect_service(
        trellis_url.to_string(),
        contract_id.to_string(),
        old_contract_json,
        old_digest.clone(),
        old_seed,
        30_000,
    ));
    approve_pending_expansions(sdk_auth_client, deployment_id, contract_id, &old_digest).await?;
    let old_client = old_connect_task.await.into_diagnostic()??;
    drop(old_client);

    let new_seed = provision_service_instance(auth_client, deployment_id).await?;
    record_conflicting_evidence(
        trellis_url,
        contract_id,
        &new_contract_json,
        &new_digest,
        &new_seed,
    )
    .await;
    let issue = wait_for_catalog_issue(core_client, contract_id, &old_digest).await?;
    Ok(CatalogRepairPersistenceCheck {
        issue_id: issue.issue_id,
        contract_id: contract_id.to_string(),
    })
}

async fn login_contract(
    trellis_url: &str,
    browser: &BrowserContainer,
    contract_json: &str,
) -> Result<AdminLoginOutcome> {
    let challenge = trellis::auth::start_agent_login(&trellis::auth::StartAgentLoginOpts {
        trellis_url,
        contract_json,
    })
    .await
    .into_diagnostic()?;
    let login_url = challenge.login_url().to_string();
    let driver = browser.driver().await?;
    let login_result =
        complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
    let quit_result = driver
        .quit()
        .await
        .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
    login_result?;
    quit_result?;
    challenge.complete(trellis_url).await.into_diagnostic()
}

fn start_repair_service(
    service_client: Arc<TrellisClient>,
    digest: &str,
) -> tokio::task::JoinHandle<Result<(), ServiceRuntimeError>> {
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        REPAIR_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .expect("repair service client should include bootstrap binding");
    service.register_rpc::<RepairPingRpc, _, _>(|_ctx, input| async move {
        Ok::<_, ServerError>(RepairPingResponse {
            message: input.message,
        }) as HandlerResult<RepairPingResponse>
    });
    let _ = digest;
    tokio::spawn(async move { service.run().await })
}

async fn assert_repair_ping(client: &TrellisClient, message: &str) -> Result<()> {
    let response = client
        .call::<RepairPingRpc>(&RepairPingRequest {
            message: message.to_string(),
        })
        .await
        .map_err(|error| miette!("Repair.Ping `{message}` failed: {error}"))?;
    if response.message != message {
        return Err(miette!(
            "Repair.Ping returned `{}` instead of `{message}`",
            response.message
        ));
    }
    Ok(())
}

async fn wait_for_repair_ping(client: &TrellisClient, message: &str) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        match assert_repair_ping(client, message).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(miette!(
                        "timed out waiting for Repair.Ping `{message}`: {error}"
                    ));
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn provision_service_instance(
    auth_client: &trellis::auth::AuthClient<'_>,
    deployment_id: &str,
) -> Result<String> {
    let (seed, key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&AuthServiceInstancesProvisionRequest {
            deployment_id: deployment_id.to_string(),
            instance_key: key,
        })
        .await
        .into_diagnostic()?;
    Ok(seed)
}

async fn connect_service(
    trellis_url: String,
    contract_id: String,
    contract_json: String,
    contract_digest: String,
    service_seed: String,
    approval_timeout_ms: u64,
) -> Result<TrellisClient> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url: &trellis_url,
        contract_id: &contract_id,
        contract_digest: &contract_digest,
        contract_json: &contract_json,
        session_key_seed_base64url: &service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        approval_timeout_ms,
    })
    .await
    .map_err(|error| miette!("service {contract_id} connect failed: {error}"))
}

async fn record_conflicting_evidence(
    trellis_url: &str,
    contract_id: &str,
    contract_json: &str,
    contract_digest: &str,
    service_seed: &str,
) {
    let _ = connect_service(
        trellis_url.to_string(),
        contract_id.to_string(),
        contract_json.to_string(),
        contract_digest.to_string(),
        service_seed.to_string(),
        1_000,
    )
    .await;
}

async fn assert_active_issue_blocks_connect(
    trellis_url: &str,
    contract_id: &str,
    contract_json: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<()> {
    match connect_service(
        trellis_url.to_string(),
        contract_id.to_string(),
        contract_json.to_string(),
        contract_digest.to_string(),
        service_seed.to_string(),
        1_000,
    )
    .await
    {
        Ok(_) => Err(miette!(
            "conflicting service digest connected while active catalog issue was visible"
        )),
        Err(error) => {
            let message = error.to_string();
            if message.contains("contract_catalog_issue")
                || message.contains("active catalog issue")
            {
                Ok(())
            } else {
                Err(miette!(
                    "conflicting service digest failed with unexpected error: {message}"
                ))
            }
        }
    }
}

async fn approve_pending_expansions(
    auth_client: &SdkAuthClient<'_>,
    deployment_id: &str,
    contract_id: &str,
    contract_digest: &str,
) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let response = auth_client
            .rpc()
            .auth()
            .envelope_expansions_list(&AuthEnvelopeExpansionsListRequest {
                deployment_id: Some(deployment_id.to_string()),
                limit: 20,
                offset: None,
                state: Some(json!("pending")),
            })
            .await
            .into_diagnostic()?;
        let request_ids: Vec<_> = response
            .entries
            .into_iter()
            .filter(|request| {
                request.contract_id == contract_id && request.contract_digest == contract_digest
            })
            .map(|request| request.request_id)
            .collect();
        if !request_ids.is_empty() {
            for request_id in request_ids {
                auth_client
                    .rpc()
                    .auth()
                    .envelope_expansions_approve(&AuthEnvelopeExpansionsApproveRequest {
                        request_id,
                        reason: Some("integration harness catalog repair setup".to_string()),
                    })
                    .await
                    .into_diagnostic()?;
            }
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for catalog repair expansion request for {deployment_id}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn wait_for_catalog_issue(
    core_client: &CoreClient<'_>,
    contract_id: &str,
    expected_effective_digest: &str,
) -> Result<TrellisCatalogResponseCatalogIssuesItem> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let catalog = core_client
            .rpc()
            .trellis()
            .catalog()
            .await
            .into_diagnostic()?;
        let active_digest = catalog
            .catalog
            .contracts
            .iter()
            .find(|contract| contract.id == contract_id)
            .map(|contract| contract.digest.as_str());
        if active_digest != Some(expected_effective_digest) {
            return Err(miette!(
                "catalog effective digest for {contract_id} was {:?}, expected {expected_effective_digest}",
                active_digest
            ));
        }
        if let Some(issue) = catalog
            .catalog
            .issues
            .unwrap_or_default()
            .into_iter()
            .find(|issue| issue.contract_id.as_deref() == Some(contract_id))
        {
            if issue.effective_digests.as_ref().is_some_and(|digests| {
                digests
                    .iter()
                    .any(|digest| digest == expected_effective_digest)
            }) {
                return Ok(issue);
            }
            return Err(miette!(
                "catalog issue for {contract_id} did not retain effective digest {expected_effective_digest}"
            ));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for active catalog issue for {contract_id}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn wait_for_catalog_issue_clear(
    core_client: &CoreClient<'_>,
    contract_id: &str,
) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let catalog = core_client
            .rpc()
            .trellis()
            .catalog()
            .await
            .into_diagnostic()?;
        let has_issue = catalog
            .catalog
            .issues
            .unwrap_or_default()
            .into_iter()
            .any(|issue| issue.contract_id.as_deref() == Some(contract_id));
        if !has_issue {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for catalog issue for {contract_id} to clear"
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[derive(Debug, Clone, Copy)]
enum RepairContractShape {
    Old,
    New,
}

fn repair_contract_json(contract_id: &str, shape: RepairContractShape) -> Result<String> {
    let old_request_schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let new_request_schema = json!({
        "type": "object",
        "properties": { "messages": { "type": "array", "items": { "type": "string" } } },
        "required": ["messages"]
    });
    let response_schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let request_schema = match shape {
        RepairContractShape::Old => old_request_schema,
        RepairContractShape::New => new_request_schema,
    };
    let rpc_subject = repair_rpc_subject(contract_id)?;
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Catalog Repair",
        "Harness-owned service contract for active catalog repair verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("RepairPingRequest", request_schema)
    .schema("RepairPingResponse", response_schema)
    .rpc(
        "Repair.Ping",
        rpc("v1", rpc_subject, "RepairPingRequest", "RepairPingResponse")
            .with_call_capabilities(std::iter::empty::<&str>())
            .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build catalog repair contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize catalog repair contract: {error}"))
}

fn repair_rpc_subject(contract_id: &str) -> Result<&'static str> {
    match contract_id {
        REPAIR_CONTRACT_ID => Ok(REPAIR_RPC_SUBJECT),
        REPAIR_PERSIST_CONTRACT_ID => Ok("rpc.v1.Harness.CatalogRepair.Persist.Ping"),
        other => Err(miette!("unknown catalog repair contract id `{other}`")),
    }
}

fn repair_caller_contract_json(contract_id: &str) -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-catalog-repair-agent@v1",
        "Trellis Integration Catalog Repair Agent",
        "Verify catalog repair leaves existing RPC providers callable.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "repair",
        use_contract(contract_id).with_rpc_call(["Repair.Ping"]),
    )
    .build()
    .map_err(|error| miette!("failed to build catalog repair caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize catalog repair caller contract: {error}"))
}
