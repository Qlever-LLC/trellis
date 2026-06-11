use std::sync::Arc;

use miette::{miette, IntoDiagnostic, Result};
use serde_json::json;
use trellis_rs::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_rs::client::{ServiceConnectWithContractOptions, TrellisClient};
use trellis_rs::contracts::digest_contract_json;
use trellis_rs::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis_rs::service::{ConnectedServiceRuntime, HandlerResult, ServerError};

use crate::app::admin_setup_contract_json;
use crate::browser::BrowserContainer;
use crate::deployment_authority::plan_accept_reconcile_deployment_authority;
use crate::nats::connect_admin_nats;
use crate::rpc::{
    assert_rust_client_caller_context, assert_rust_client_ping, assert_rust_client_trace_context,
    caller_context_response, harness_caller_contract_json, harness_service_contract_json,
    reauth_contract, run_ts_client, trace_context_response, HarnessCallerContextResponse,
    HarnessPingResponse, HarnessRustCallerContextRpc, HarnessRustPingRpc,
    HarnessRustTraceContextRpc, HarnessTraceContextResponse, HarnessTsCallerContextRpc,
    HarnessTsPingRpc, HarnessTsTraceContextRpc, TsServiceProcess, HARNESS_CONTRACT_ID,
};

const APPROVAL_DEPLOYMENT_ID: &str = "harness.service-approval";
const APPROVAL_RUST_SERVICE_NAME: &str = "harness-approval-rust";

pub(crate) async fn run_service_approval_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
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
    let auth_client = trellis_rs::auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(APPROVAL_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let (rust_service_seed, rust_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(
            &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: APPROVAL_DEPLOYMENT_ID.to_string(),
                instance_key: rust_service_key,
            },
        )
        .await
        .into_diagnostic()?;
    let (ts_service_seed, ts_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(
            &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: APPROVAL_DEPLOYMENT_ID.to_string(),
                instance_key: ts_service_key,
            },
        )
        .await
        .into_diagnostic()?;
    let (ts_stop_service_seed, ts_stop_service_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(
            &trellis_rs::sdk::auth::AuthServiceInstancesProvisionRequest {
                deployment_id: APPROVAL_DEPLOYMENT_ID.to_string(),
                instance_key: ts_stop_service_key,
            },
        )
        .await
        .into_diagnostic()?;

    let rust_connect_task = tokio::spawn(connect_approval_rust_service(
        trellis_url.to_string(),
        contract_digest.clone(),
        service_contract_json.clone(),
        rust_service_seed,
    ));
    let ts_service = TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;

    let sdk_auth_client = SdkAuthClient::new(&admin_client);
    plan_accept_reconcile_deployment_authority(
        &sdk_auth_client,
        APPROVAL_DEPLOYMENT_ID,
        &service_contract_json,
        &contract_digest,
        "integration harness service startup approval",
    )
    .await?;

    let service_client = Arc::new(rust_connect_task.await.into_diagnostic()??);
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        APPROVAL_RUST_SERVICE_NAME,
        Arc::clone(&service_client),
    )
    .map_err(|error| miette!("failed to create approval service runtime: {error}"))?;
    service.register_rpc::<HarnessRustPingRpc, _, _>(|_ctx, input| async move {
        if input.message == "handler-error" {
            return Err(ServerError::Nats("rust handler error marker".to_string()))
                as HandlerResult<HarnessPingResponse>;
        }
        if input.message == "not-found" {
            return Err(ServerError::DeclaredRpc(
                trellis_rs::service::DeclaredRpcError::new(
                    "NotFoundError",
                    "Workspace not found",
                    [("resource", json!("Workspace"))],
                ),
            )) as HandlerResult<HarnessPingResponse>;
        }
        Ok::<_, ServerError>(HarnessPingResponse {
            message: input.message,
        }) as HandlerResult<HarnessPingResponse>
    });
    service.register_rpc::<HarnessRustCallerContextRpc, _, _>(|ctx, _input| async move {
        caller_context_response("rust", ctx.request())
            as HandlerResult<HarnessCallerContextResponse>
    });
    service.register_rpc::<HarnessRustTraceContextRpc, _, _>(|ctx, _input| async move {
        trace_context_response("rust", ctx.request()) as HandlerResult<HarnessTraceContextResponse>
    });
    let service_task = tokio::spawn(async move { service.run().await });

    ts_service.wait_ready().await?;
    let call_result = async {
        let caller_contract_json = harness_caller_contract_json()?;
        let caller_login = reauth_contract(
            &setup_login.state,
            &caller_contract_json,
            trellis_url,
            browser,
        )
        .await?;
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;
        let caller_nats = connect_admin_nats(&caller_login.state).await?;
        assert_rust_client_ping::<HarnessRustPingRpc>(&caller_client, "approval-rust-rust").await?;
        assert_rust_client_ping::<HarnessTsPingRpc>(&caller_client, "approval-rust-ts").await?;
        assert_rust_client_caller_context::<HarnessRustCallerContextRpc>(
            &caller_client,
            "rust",
            &caller_login.user.user_id,
        )
        .await?;
        assert_rust_client_caller_context::<HarnessTsCallerContextRpc>(
            &caller_client,
            "ts",
            &caller_login.user.user_id,
        )
        .await?;
        assert_rust_client_trace_context::<HarnessRustTraceContextRpc>(
            &caller_client,
            &caller_nats,
            "rust",
        )
        .await?;
        assert_rust_client_trace_context::<HarnessTsTraceContextRpc>(
            &caller_client,
            &caller_nats,
            "ts",
        )
        .await?;
        run_ts_client(
            trellis_url,
            &caller_login.state.session_seed,
            &ts_stop_service_seed,
        )
        .await?;
        Ok(12)
    }
    .await;
    service_task.abort();
    drop(ts_service);
    call_result
}

async fn connect_approval_rust_service(
    trellis_url: String,
    contract_digest: String,
    contract_json: String,
    service_seed: String,
) -> Result<TrellisClient> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url: &trellis_url,
        contract_id: HARNESS_CONTRACT_ID,
        contract_digest: &contract_digest,
        contract_json: &contract_json,
        session_key_seed_base64url: &service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        authority_pending_timeout_ms: 30_000,
    })
    .await
    .into_diagnostic()
}
