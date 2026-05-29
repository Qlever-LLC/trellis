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
use trellis::sdk::auth::types::AuthServiceInstancesProvisionRequest;
use trellis::sdk::core::client::CoreClient;
use trellis::service::{ConnectedServiceRuntime, HandlerResult, ServerError, ServiceRuntimeError};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::rpc::reauth_contract;

const AUTHORITY_DEPLOYMENT_ID: &str = "harness.catalog-authority";
const AUTHORITY_CONTRACT_ID: &str = "trellis.integration-harness.catalog-authority@v1";
const AUTHORITY_PERSIST_DEPLOYMENT_ID: &str = "harness.catalog-authority-persist";
const AUTHORITY_PERSIST_CONTRACT_ID: &str =
    "trellis.integration-harness.catalog-authority-persist@v1";
const AUTHORITY_SERVICE_NAME: &str = "harness-catalog-authority-rust";
const AUTHORITY_RPC_SUBJECT: &str = "rpc.v1.Harness.CatalogAuthority.Ping";

#[derive(Debug, Clone)]
pub(crate) struct CatalogAuthorityPersistenceCheck {
    contract_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct AuthorityPingRequest {
    message: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct AuthorityPingResponse {
    message: String,
}

struct AuthorityPingRpc;

impl trellis::client::RpcDescriptor for AuthorityPingRpc {
    type Input = AuthorityPingRequest;
    type Output = AuthorityPingResponse;

    const KEY: &'static str = "Authority.Ping";
    const SUBJECT: &'static str = AUTHORITY_RPC_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

pub(crate) async fn run_catalog_authority_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<(usize, CatalogAuthorityPersistenceCheck)> {
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
        .create_service_deployment(AUTHORITY_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let old_contract_json =
        authority_contract_json(AUTHORITY_CONTRACT_ID, AuthorityContractShape::Old)?;
    let old_digest = digest_contract_json(&old_contract_json).into_diagnostic()?;
    let new_contract_json =
        authority_contract_json(AUTHORITY_CONTRACT_ID, AuthorityContractShape::New)?;
    let new_digest = digest_contract_json(&new_contract_json).into_diagnostic()?;
    let service_seed = provision_service_instance(&auth_client, AUTHORITY_DEPLOYMENT_ID).await?;
    let old_connect_task = tokio::spawn(connect_service(
        trellis_url.to_string(),
        AUTHORITY_CONTRACT_ID.to_string(),
        old_contract_json.clone(),
        old_digest.clone(),
        service_seed.clone(),
        30_000,
    ));
    plan_accept_reconcile_deployment_authority(
        &sdk_auth_client,
        AUTHORITY_DEPLOYMENT_ID,
        &old_contract_json,
        &old_digest,
        "integration harness catalog authority setup",
    )
    .await?;
    let service_client = Arc::new(old_connect_task.await.into_diagnostic()??);
    let service_task = start_authority_service(Arc::clone(&service_client), &old_digest);

    let caller_contract_json = authority_caller_contract_json(AUTHORITY_CONTRACT_ID)?;
    let caller_login = login_contract(trellis_url, browser, &caller_contract_json).await?;
    let caller_client = connect_admin_client_async(&caller_login.state)
        .await
        .into_diagnostic()?;
    wait_for_authority_ping(&caller_client, "before-conflict").await?;

    assert_incompatible_same_instance_rejected(
        trellis_url,
        AUTHORITY_CONTRACT_ID,
        &new_contract_json,
        &new_digest,
        &service_seed,
    )
    .await?;
    let old_reconnect = connect_service(
        trellis_url.to_string(),
        AUTHORITY_CONTRACT_ID.to_string(),
        old_contract_json.clone(),
        old_digest.clone(),
        service_seed,
        30_000,
    )
    .await?;
    drop(old_reconnect);
    wait_for_authority_ping(&caller_client, "after-rejected-conflict").await?;

    let persistence_check = create_no_active_issue_check(
        trellis_url,
        &auth_client,
        &sdk_auth_client,
        &core_client,
        AUTHORITY_PERSIST_DEPLOYMENT_ID,
        AUTHORITY_PERSIST_CONTRACT_ID,
    )
    .await?;

    service_task.abort();
    Ok((5, persistence_check))
}

pub(crate) async fn verify_catalog_authority_persistence_after_restart(
    admin_login: &AdminLoginOutcome,
    check: &CatalogAuthorityPersistenceCheck,
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
        .find(|issue| issue.contract_id.as_deref() == Some(check.contract_id.as_str()));
    match issue {
        Some(issue) => Err(miette!(
            "catalog authority persistence retained active issue {} for authority-authorized contract {}",
            issue.issue_id,
            check.contract_id
        )),
        None => Ok(1),
    }
}

async fn create_no_active_issue_check(
    trellis_url: &str,
    auth_client: &trellis::auth::AuthClient<'_>,
    sdk_auth_client: &SdkAuthClient<'_>,
    core_client: &CoreClient<'_>,
    deployment_id: &str,
    contract_id: &str,
) -> Result<CatalogAuthorityPersistenceCheck> {
    auth_client
        .create_service_deployment(deployment_id, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;
    let old_contract_json = authority_contract_json(contract_id, AuthorityContractShape::Old)?;
    let old_digest = digest_contract_json(&old_contract_json).into_diagnostic()?;
    let new_contract_json = authority_contract_json(contract_id, AuthorityContractShape::New)?;
    let new_digest = digest_contract_json(&new_contract_json).into_diagnostic()?;
    let old_seed = provision_service_instance(auth_client, deployment_id).await?;
    let old_connect_task = tokio::spawn(connect_service(
        trellis_url.to_string(),
        contract_id.to_string(),
        old_contract_json.clone(),
        old_digest.clone(),
        old_seed.clone(),
        30_000,
    ));
    plan_accept_reconcile_deployment_authority(
        sdk_auth_client,
        deployment_id,
        &old_contract_json,
        &old_digest,
        "integration harness catalog authority persistence setup",
    )
    .await?;
    let old_client = old_connect_task.await.into_diagnostic()??;
    drop(old_client);

    assert_incompatible_same_instance_rejected(
        trellis_url,
        contract_id,
        &new_contract_json,
        &new_digest,
        &old_seed,
    )
    .await?;
    wait_for_catalog_issue_absent(core_client, contract_id).await?;
    Ok(CatalogAuthorityPersistenceCheck {
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

fn start_authority_service(
    service_client: Arc<TrellisClient>,
    digest: &str,
) -> tokio::task::JoinHandle<Result<(), ServiceRuntimeError>> {
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        AUTHORITY_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .expect("authority service client should include bootstrap binding");
    service.register_rpc::<AuthorityPingRpc, _, _>(|_ctx, input| async move {
        Ok::<_, ServerError>(AuthorityPingResponse {
            message: input.message,
        }) as HandlerResult<AuthorityPingResponse>
    });
    let _ = digest;
    tokio::spawn(async move { service.run().await })
}

async fn assert_authority_ping(client: &TrellisClient, message: &str) -> Result<()> {
    let response = client
        .call::<AuthorityPingRpc>(&AuthorityPingRequest {
            message: message.to_string(),
        })
        .await
        .map_err(|error| miette!("Authority.Ping `{message}` failed: {error}"))?;
    if response.message != message {
        return Err(miette!(
            "Authority.Ping returned `{}` instead of `{message}`",
            response.message
        ));
    }
    Ok(())
}

async fn wait_for_authority_ping(client: &TrellisClient, message: &str) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        match assert_authority_ping(client, message).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(miette!(
                        "timed out waiting for Authority.Ping `{message}`: {error}"
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
    authority_pending_timeout_ms: u64,
) -> Result<TrellisClient> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url: &trellis_url,
        contract_id: &contract_id,
        contract_digest: &contract_digest,
        contract_json: &contract_json,
        session_key_seed_base64url: &service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        authority_pending_timeout_ms,
    })
    .await
    .map_err(|error| miette!("service {contract_id} connect failed: {error}"))
}

async fn assert_incompatible_same_instance_rejected(
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
            "incompatible same-contract digest connected for existing strict service instance"
        )),
        Err(error) => {
            let message = error.to_string();
            if message.contains("contract_compatibility_violation")
                || message.contains("contract_changed")
                || message.contains("incompatible")
                || message.contains("timed out waiting for service deployment authority")
            {
                Ok(())
            } else {
                Err(miette!(
                    "incompatible same-contract digest failed with unexpected error: {message}"
                ))
            }
        }
    }
}

async fn wait_for_catalog_issue_absent(
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
                "timed out waiting for catalog issue for {contract_id} to remain absent"
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[derive(Debug, Clone, Copy)]
enum AuthorityContractShape {
    Old,
    New,
}

fn authority_contract_json(contract_id: &str, shape: AuthorityContractShape) -> Result<String> {
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
        AuthorityContractShape::Old => old_request_schema,
        AuthorityContractShape::New => new_request_schema,
    };
    let rpc_subject = authority_rpc_subject(contract_id)?;
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Catalog Authority",
        "Harness-owned service contract for active catalog authority verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("AuthorityPingRequest", request_schema)
    .schema("AuthorityPingResponse", response_schema)
    .rpc(
        "Authority.Ping",
        rpc(
            "v1",
            rpc_subject,
            "AuthorityPingRequest",
            "AuthorityPingResponse",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build catalog authority contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize catalog authority contract: {error}"))
}

fn authority_rpc_subject(contract_id: &str) -> Result<&'static str> {
    match contract_id {
        AUTHORITY_CONTRACT_ID => Ok(AUTHORITY_RPC_SUBJECT),
        AUTHORITY_PERSIST_CONTRACT_ID => Ok("rpc.v1.Harness.CatalogAuthority.Persist.Ping"),
        other => Err(miette!("unknown catalog authority contract id `{other}`")),
    }
}

fn authority_caller_contract_json(contract_id: &str) -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-catalog-authority-agent@v1",
        "Trellis Integration Catalog Authority Agent",
        "Verify catalog authority leaves existing RPC providers callable.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "authority",
        use_contract(contract_id).with_rpc_call(["Authority.Ping"]),
    )
    .build()
    .map_err(|error| miette!("failed to build catalog authority caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize catalog authority caller contract: {error}"))
}
