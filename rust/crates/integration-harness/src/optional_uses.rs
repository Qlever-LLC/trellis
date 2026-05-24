use std::sync::Arc;
use std::time::Duration;

use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use trellis::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis::client::{ServiceConnectOptions, ServiceConnectWithContractOptions, TrellisClient};
use trellis::contracts::{
    digest_contract_json, rpc, use_contract, ContractCapabilityMetadata, ContractKind,
    ContractManifestBuilder,
};
use trellis::sdk::auth::client::AuthClient as SdkAuthClient;
use trellis::sdk::auth::types::{
    AuthCatalogIssuesResolveRequest, AuthEnvelopeExpansionsApproveRequest,
    AuthEnvelopeExpansionsListRequest, AuthEnvelopeExpansionsListResponseEntriesItem,
    AuthEnvelopesExpandRequest, AuthEnvelopesGetRequest,
};
use trellis::sdk::core::client::CoreClient;
use trellis::sdk::core::types::TrellisCatalogResponseCatalogIssuesItem;
use trellis::service::{ConnectedServiceRuntime, HandlerResult, ServerError, ServiceRuntimeError};

use crate::app::admin_setup_contract_json;
use crate::browser::BrowserContainer;
use crate::rpc::{contract_json_object, reauth_contract};

const PASSING_CASES: usize = 11;
const CONSUMER_DEPLOYMENT_ID: &str = "harness.optional-consumer";
const DEPENDENCY_DEPLOYMENT_ID: &str = "harness.optional-dep";
const CONSUMER_CONTRACT_ID: &str = "trellis.integration-harness.optional-consumer@v1";
const DEPENDENCY_CONTRACT_ID: &str = "trellis.integration-harness.optional-dep@v1";
const DEPENDENCY_SERVICE_NAME: &str = "harness-optional-dep-rust";
const OPTIONAL_DEP_PING_SUBJECT: &str = "rpc.v1.Optional.Dep.Ping";

const REQUIRED_CONSUMER_DEPLOYMENT_ID: &str = "harness.required-consumer";
const UNKNOWN_REQUIRED_CONSUMER_DEPLOYMENT_ID: &str = "harness.required-consumer-unknown";
const REQUIRED_DEPLOYMENT_ID: &str = "harness.required-dep";
const REQUIRED_CONSUMER_CONTRACT_ID: &str = "trellis.integration-harness.required-consumer@v1";
const UNKNOWN_REQUIRED_CONSUMER_CONTRACT_ID: &str =
    "trellis.integration-harness.required-consumer-unknown@v1";
const REQUIRED_DEP_CONTRACT_ID: &str = "trellis.integration-harness.required-dep@v1";
const UNKNOWN_REQUIRED_DEP_CONTRACT_ID: &str = "trellis.integration-harness.required-unknown@v1";
const REQUIRED_DEP_SERVICE_NAME: &str = "harness-required-dep-rust";
const REQUIRED_DEP_PING_SUBJECT: &str = "rpc.v1.Required.Dep.Ping";
const REQUIRED_DEP_PONG_SUBJECT: &str = "rpc.v1.Required.Dep.Pong";
const REQUIRED_DEP_PING_CAPABILITY: &str = "required.dep.ping";
const REQUIRED_DEP_PONG_CAPABILITY: &str = "required.dep.pong";
const REQUIRED_DEP_PING_GLOBAL_CAPABILITY: &str =
    "trellis.integration-harness.required-dep::required.dep.ping";
const REQUIRED_DEP_PONG_GLOBAL_CAPABILITY: &str =
    "trellis.integration-harness.required-dep::required.dep.pong";

const CYCLE_A_DEPLOYMENT_ID: &str = "harness.required-cycle-a";
const CYCLE_B_DEPLOYMENT_ID: &str = "harness.required-cycle-b";
const CYCLE_A_CONTRACT_ID: &str = "trellis.integration-harness.required-cycle-a@v1";
const CYCLE_B_CONTRACT_ID: &str = "trellis.integration-harness.required-cycle-b@v1";
const CYCLE_A_SUBJECT: &str = "rpc.v1.Required.Cycle.A.Ping";
const CYCLE_B_SUBJECT: &str = "rpc.v1.Required.Cycle.B.Ping";

pub(crate) async fn run_optional_uses_fixture(
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
    let auth_client = trellis::auth::AuthClient::new(&admin_client);
    let sdk_auth_client = SdkAuthClient::new(&admin_client);
    let core_client = CoreClient::new(&admin_client);

    auth_client
        .create_service_deployment(CONSUMER_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;
    auth_client
        .create_service_deployment(DEPENDENCY_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let consumer_contract_json = optional_consumer_contract_json()?;
    let consumer_digest = digest_contract_json(&consumer_contract_json).into_diagnostic()?;
    let (consumer_seed, consumer_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: CONSUMER_DEPLOYMENT_ID.to_string(),
            instance_key: consumer_key,
        })
        .await
        .into_diagnostic()?;

    let consumer_connect_task = tokio::spawn(connect_optional_consumer(
        trellis_url.to_string(),
        consumer_contract_json.clone(),
        consumer_digest.clone(),
        consumer_seed.clone(),
        30_000,
    ));
    let request_ids =
        wait_for_consumer_pending_optional_delta(&sdk_auth_client, &consumer_digest, false).await?;
    for request_id in request_ids {
        sdk_auth_client
            .auth_envelope_expansions_approve(&AuthEnvelopeExpansionsApproveRequest {
                request_id,
                reason: Some("integration harness optional dependency setup".to_string()),
            })
            .await
            .into_diagnostic()?;
    }
    let consumer_client = consumer_connect_task.await.into_diagnostic()??;
    assert_consumer_envelope_omits_dependency(&sdk_auth_client).await?;
    drop(consumer_client);

    let dependency_contract_json = optional_dependency_contract_json()?;
    let dependency_digest = digest_contract_json(&dependency_contract_json).into_diagnostic()?;
    sdk_auth_client
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&dependency_contract_json)?,
            deployment_id: DEPENDENCY_DEPLOYMENT_ID.to_string(),
            expected_digest: dependency_digest.clone(),
        })
        .await
        .into_diagnostic()?;

    let (dependency_seed, dependency_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: DEPENDENCY_DEPLOYMENT_ID.to_string(),
            instance_key: dependency_key,
        })
        .await
        .into_diagnostic()?;
    let dependency_client = TrellisClient::connect_service(ServiceConnectOptions {
        trellis_url,
        contract_id: DEPENDENCY_CONTRACT_ID,
        contract_digest: &dependency_digest,
        session_key_seed_base64url: &dependency_seed,
        timeout_ms: 5_000,
    })
    .await
    .into_diagnostic()?;

    let dependency_client = Arc::new(dependency_client);
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        DEPENDENCY_SERVICE_NAME,
        Arc::clone(&dependency_client),
    )
    .map_err(|error| miette!("failed to create optional dependency service runtime: {error}"))?;
    service.register_rpc::<OptionalDepPingRpc, _, _>(|_ctx, input| async move {
        Ok::<_, ServerError>(OptionalPingResponse {
            message: input.message,
        }) as HandlerResult<OptionalPingResponse>
    });
    let service_task = tokio::spawn(async move { service.run().await });

    if connect_optional_consumer(
        trellis_url.to_string(),
        consumer_contract_json.clone(),
        consumer_digest.clone(),
        consumer_seed.clone(),
        1_000,
    )
    .await
    .is_ok()
    {
        abort_service_task(service_task).await;
        return Err(miette!(
            "consumer connected with active optional dependency before expansion approval"
        ));
    }
    let request_ids =
        wait_for_consumer_pending_optional_delta(&sdk_auth_client, &consumer_digest, true).await?;
    for request_id in request_ids {
        sdk_auth_client
            .auth_envelope_expansions_approve(&AuthEnvelopeExpansionsApproveRequest {
                request_id,
                reason: Some("integration harness active optional dependency".to_string()),
            })
            .await
            .into_diagnostic()?;
    }
    let reconnect_result = async {
        let reconnected_consumer = connect_optional_consumer(
            trellis_url.to_string(),
            consumer_contract_json.clone(),
            consumer_digest.clone(),
            consumer_seed.clone(),
            30_000,
        )
        .await?;
        assert_consumer_envelope_includes_dependency(&sdk_auth_client).await?;
        assert_optional_dependency_call(&reconnected_consumer).await
    }
    .await;
    abort_service_task(service_task).await;
    reconnect_result?;

    run_required_dependency_closure_fixture(
        trellis_url,
        &auth_client,
        &sdk_auth_client,
        &core_client,
    )
    .await?;
    run_cyclic_required_dependency_fixture(trellis_url, &auth_client, &sdk_auth_client).await?;

    Ok(PASSING_CASES)
}

async fn run_required_dependency_closure_fixture(
    trellis_url: &str,
    auth_client: &trellis::auth::AuthClient<'_>,
    sdk_auth_client: &SdkAuthClient<'_>,
    core_client: &CoreClient<'_>,
) -> Result<()> {
    auth_client
        .create_service_deployment(REQUIRED_CONSUMER_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .map_err(|error| miette!("failed to create required consumer deployment: {error}"))?;
    auth_client
        .create_service_deployment(
            UNKNOWN_REQUIRED_CONSUMER_DEPLOYMENT_ID,
            vec!["harness".to_string()],
        )
        .await
        .map_err(|error| {
            miette!("failed to create unknown required consumer deployment: {error}")
        })?;
    auth_client
        .create_service_deployment(REQUIRED_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .map_err(|error| miette!("failed to create required dependency deployment: {error}"))?;

    let unknown_consumer_contract_json = required_consumer_contract_json(
        UNKNOWN_REQUIRED_CONSUMER_CONTRACT_ID,
        UNKNOWN_REQUIRED_DEP_CONTRACT_ID,
        "Required.Dep.Ping",
    )?;
    let unknown_consumer_digest =
        digest_contract_json(&unknown_consumer_contract_json).into_diagnostic()?;
    let (unknown_consumer_seed, unknown_consumer_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: UNKNOWN_REQUIRED_CONSUMER_DEPLOYMENT_ID.to_string(),
            instance_key: unknown_consumer_key,
        })
        .await
        .map_err(|error| {
            miette!("failed to provision unknown required consumer instance: {error}")
        })?;
    assert_service_connect_fails(
        trellis_url,
        UNKNOWN_REQUIRED_CONSUMER_CONTRACT_ID,
        &unknown_consumer_contract_json,
        &unknown_consumer_digest,
        &unknown_consumer_seed,
    )
    .await?;
    let unknown_requests = wait_for_pending_delta(
        sdk_auth_client,
        UNKNOWN_REQUIRED_CONSUMER_DEPLOYMENT_ID,
        UNKNOWN_REQUIRED_CONSUMER_CONTRACT_ID,
        &unknown_consumer_digest,
    )
    .await?;
    assert_required_unknown_delta_fails_closed(&unknown_requests)?;

    let (consumer_seed, consumer_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: REQUIRED_CONSUMER_DEPLOYMENT_ID.to_string(),
            instance_key: consumer_key,
        })
        .await
        .map_err(|error| miette!("failed to provision required consumer instance: {error}"))?;

    let dependency_contract_json = required_dependency_contract_json(false)?;
    let dependency_digest = digest_contract_json(&dependency_contract_json).into_diagnostic()?;
    let (dependency_seed, dependency_key) = generate_session_keypair();
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: REQUIRED_DEPLOYMENT_ID.to_string(),
            instance_key: dependency_key,
        })
        .await
        .map_err(|error| miette!("failed to provision required dependency instance: {error}"))?;
    sdk_auth_client
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&dependency_contract_json)?,
            deployment_id: REQUIRED_DEPLOYMENT_ID.to_string(),
            expected_digest: dependency_digest.clone(),
        })
        .await
        .map_err(|error| miette!("failed to expand required dependency envelope: {error}"))?;
    auth_client
        .disable_service_deployment(REQUIRED_DEPLOYMENT_ID)
        .await
        .map_err(|error| miette!("failed to disable required dependency deployment: {error}"))?;
    let active_consumer_contract_json = required_consumer_contract_json(
        REQUIRED_CONSUMER_CONTRACT_ID,
        REQUIRED_DEP_CONTRACT_ID,
        "Required.Dep.Ping",
    )?;
    let required_consumer_digest =
        digest_contract_json(&active_consumer_contract_json).into_diagnostic()?;
    assert_service_connect_fails(
        trellis_url,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &active_consumer_contract_json,
        &required_consumer_digest,
        &consumer_seed,
    )
    .await?;
    let consumer_requests = wait_for_pending_delta(
        sdk_auth_client,
        REQUIRED_CONSUMER_DEPLOYMENT_ID,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &required_consumer_digest,
    )
    .await?;
    assert_required_dependency_delta(
        &consumer_requests,
        "Required.Dep.Ping",
        REQUIRED_DEP_PING_GLOBAL_CAPABILITY,
    )?;
    approve_requests(
        sdk_auth_client,
        consumer_requests,
        "integration harness required dependency known inactive",
    )
    .await?;
    assert_service_connect_fails(
        trellis_url,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &active_consumer_contract_json,
        &required_consumer_digest,
        &consumer_seed,
    )
    .await?;
    auth_client
        .enable_service_deployment(REQUIRED_DEPLOYMENT_ID)
        .await
        .map_err(|error| miette!("failed to enable required dependency deployment: {error}"))?;

    let dependency_client = connect_service(
        trellis_url,
        REQUIRED_DEP_CONTRACT_ID,
        &dependency_contract_json,
        &dependency_digest,
        &dependency_seed,
        30_000,
    )
    .await?;
    let service_task =
        spawn_required_dependency_service(dependency_client, dependency_digest.clone(), false);
    let required_consumer = connect_service(
        trellis_url,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &active_consumer_contract_json,
        &required_consumer_digest,
        &consumer_seed,
        30_000,
    )
    .await?;
    assert_required_dependency_call(&required_consumer).await?;
    drop(required_consumer);
    abort_service_task(service_task).await;

    let updated_dependency_contract_json = required_dependency_contract_json(true)?;
    let updated_dependency_digest =
        digest_contract_json(&updated_dependency_contract_json).into_diagnostic()?;
    sdk_auth_client
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&updated_dependency_contract_json)?,
            deployment_id: REQUIRED_DEPLOYMENT_ID.to_string(),
            expected_digest: updated_dependency_digest.clone(),
        })
        .await
        .map_err(|error| {
            miette!("failed to expand updated required dependency envelope: {error}")
        })?;
    let forced_update_issue =
        wait_for_forced_update_issue(core_client, REQUIRED_DEP_CONTRACT_ID, &dependency_digest)
            .await?;
    let resolved_update = sdk_auth_client
        .auth_catalog_issues_resolve(&AuthCatalogIssuesResolveRequest {
            issue_id: forced_update_issue.issue_id.clone(),
            action: json!("force-replace"),
        })
        .await
        .into_diagnostic()?;
    if !resolved_update.success || resolved_update.deleted_evidence.is_empty() {
        return Err(miette!(
            "Auth.CatalogIssues.Resolve did not replace forced update {}",
            forced_update_issue.issue_id
        ));
    }
    wait_for_forced_update_clear(
        core_client,
        REQUIRED_DEP_CONTRACT_ID,
        &updated_dependency_digest,
    )
    .await?;
    assert_service_digest_connect_fails(
        trellis_url,
        REQUIRED_DEP_CONTRACT_ID,
        &dependency_digest,
        &dependency_seed,
    )
    .await?;
    let updated_dependency_client = connect_service(
        trellis_url,
        REQUIRED_DEP_CONTRACT_ID,
        &updated_dependency_contract_json,
        &updated_dependency_digest,
        &dependency_seed,
        30_000,
    )
    .await?;
    let updated_service_task = spawn_required_dependency_service(
        updated_dependency_client,
        updated_dependency_digest,
        true,
    );

    let updated_consumer_contract_json = required_consumer_contract_json(
        REQUIRED_CONSUMER_CONTRACT_ID,
        REQUIRED_DEP_CONTRACT_ID,
        "Required.Dep.Pong",
    )?;
    let updated_consumer_digest =
        digest_contract_json(&updated_consumer_contract_json).into_diagnostic()?;
    assert_service_connect_fails(
        trellis_url,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &updated_consumer_contract_json,
        &updated_consumer_digest,
        &consumer_seed,
    )
    .await?;
    let updated_consumer_requests = wait_for_pending_delta(
        sdk_auth_client,
        REQUIRED_CONSUMER_DEPLOYMENT_ID,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &updated_consumer_digest,
    )
    .await?;
    assert_required_dependency_delta(
        &updated_consumer_requests,
        "Required.Dep.Pong",
        REQUIRED_DEP_PONG_GLOBAL_CAPABILITY,
    )?;
    approve_requests(
        sdk_auth_client,
        updated_consumer_requests,
        "integration harness same-id required dependency digest update",
    )
    .await?;
    let consumer_update_issue = wait_for_forced_update_issue(
        core_client,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &required_consumer_digest,
    )
    .await?;
    let resolved_consumer_update = sdk_auth_client
        .auth_catalog_issues_resolve(&AuthCatalogIssuesResolveRequest {
            issue_id: consumer_update_issue.issue_id.clone(),
            action: json!("force-replace"),
        })
        .await
        .into_diagnostic()?;
    if !resolved_consumer_update.success || resolved_consumer_update.deleted_evidence.is_empty() {
        return Err(miette!(
            "Auth.CatalogIssues.Resolve did not replace forced update {}",
            consumer_update_issue.issue_id
        ));
    }
    wait_for_forced_update_clear(
        core_client,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &updated_consumer_digest,
    )
    .await?;
    let updated_consumer = connect_service(
        trellis_url,
        REQUIRED_CONSUMER_CONTRACT_ID,
        &updated_consumer_contract_json,
        &updated_consumer_digest,
        &consumer_seed,
        30_000,
    )
    .await?;
    assert_required_dependency_update_call(&updated_consumer).await?;
    abort_service_task(updated_service_task).await;

    Ok(())
}

async fn run_cyclic_required_dependency_fixture(
    trellis_url: &str,
    auth_client: &trellis::auth::AuthClient<'_>,
    sdk_auth_client: &SdkAuthClient<'_>,
) -> Result<()> {
    auth_client
        .create_service_deployment(CYCLE_A_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .map_err(|error| miette!("failed to create required cycle A deployment: {error}"))?;
    auth_client
        .create_service_deployment(CYCLE_B_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .map_err(|error| miette!("failed to create required cycle B deployment: {error}"))?;

    let cycle_a_contract_json = cycle_contract_json(
        CYCLE_A_CONTRACT_ID,
        CYCLE_B_CONTRACT_ID,
        "Cycle.B.Ping",
        CYCLE_A_SUBJECT,
    )?;
    let cycle_a_digest = digest_contract_json(&cycle_a_contract_json).into_diagnostic()?;
    let cycle_b_contract_json = cycle_contract_json(
        CYCLE_B_CONTRACT_ID,
        CYCLE_A_CONTRACT_ID,
        "Cycle.A.Ping",
        CYCLE_B_SUBJECT,
    )?;
    let cycle_b_digest = digest_contract_json(&cycle_b_contract_json).into_diagnostic()?;
    let (cycle_a_seed, cycle_a_key) = generate_session_keypair();
    let (cycle_b_seed, cycle_b_key) = generate_session_keypair();

    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: CYCLE_A_DEPLOYMENT_ID.to_string(),
            instance_key: cycle_a_key,
        })
        .await
        .map_err(|error| miette!("failed to provision required cycle A instance: {error}"))?;
    auth_client
        .provision_service_instance(&trellis::sdk::auth::AuthServiceInstancesProvisionRequest {
            deployment_id: CYCLE_B_DEPLOYMENT_ID.to_string(),
            instance_key: cycle_b_key,
        })
        .await
        .map_err(|error| miette!("failed to provision required cycle B instance: {error}"))?;

    assert_service_connect_fails(
        trellis_url,
        CYCLE_A_CONTRACT_ID,
        &cycle_a_contract_json,
        &cycle_a_digest,
        &cycle_a_seed,
    )
    .await?;
    assert_service_connect_fails(
        trellis_url,
        CYCLE_B_CONTRACT_ID,
        &cycle_b_contract_json,
        &cycle_b_digest,
        &cycle_b_seed,
    )
    .await?;
    assert_service_connect_fails(
        trellis_url,
        CYCLE_A_CONTRACT_ID,
        &cycle_a_contract_json,
        &cycle_a_digest,
        &cycle_a_seed,
    )
    .await?;
    let cycle_a_requests = wait_for_pending_delta(
        sdk_auth_client,
        CYCLE_A_DEPLOYMENT_ID,
        CYCLE_A_CONTRACT_ID,
        &cycle_a_digest,
    )
    .await?;
    let cycle_b_requests = wait_for_pending_delta(
        sdk_auth_client,
        CYCLE_B_DEPLOYMENT_ID,
        CYCLE_B_CONTRACT_ID,
        &cycle_b_digest,
    )
    .await?;
    assert_required_dependency_delta(&cycle_a_requests, "Cycle.B.Ping", "")?;
    assert_required_dependency_delta(&cycle_b_requests, "Cycle.A.Ping", "")?;
    approve_requests(
        sdk_auth_client,
        cycle_a_requests,
        "integration harness cyclic required dependency A",
    )
    .await?;
    approve_requests(
        sdk_auth_client,
        cycle_b_requests,
        "integration harness cyclic required dependency B",
    )
    .await?;

    connect_service(
        trellis_url,
        CYCLE_A_CONTRACT_ID,
        &cycle_a_contract_json,
        &cycle_a_digest,
        &cycle_a_seed,
        30_000,
    )
    .await?;
    connect_service(
        trellis_url,
        CYCLE_B_CONTRACT_ID,
        &cycle_b_contract_json,
        &cycle_b_digest,
        &cycle_b_seed,
        30_000,
    )
    .await?;

    Ok(())
}

fn required_consumer_contract_json(
    contract_id: &str,
    dependency_contract_id: &str,
    rpc_name: &str,
) -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Required Consumer",
        "Harness-owned service contract that declares a required dependency.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .use_ref(
        "requiredDep",
        use_contract(dependency_contract_id).with_rpc_call([rpc_name]),
    )
    .build()
    .map_err(|error| miette!("failed to build required consumer contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize required consumer contract: {error}"))
}

fn required_dependency_contract_json(include_pong: bool) -> Result<String> {
    let schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let mut builder = ContractManifestBuilder::new(
        REQUIRED_DEP_CONTRACT_ID,
        "Trellis Integration Required Dependency",
        "Harness-owned required dependency service contract.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .capability(
        REQUIRED_DEP_PING_CAPABILITY,
        ContractCapabilityMetadata {
            display_name: "Call required dependency ping".to_string(),
            description: "Allows callers to invoke the required dependency ping RPC.".to_string(),
            consequence: None,
        },
    )
    .schema("Message", schema)
    .rpc(
        "Required.Dep.Ping",
        rpc("v1", REQUIRED_DEP_PING_SUBJECT, "Message", "Message")
            .with_call_capabilities([REQUIRED_DEP_PING_CAPABILITY])
            .with_error_types(["UnexpectedError"]),
    );
    if include_pong {
        builder = builder
            .capability(
                REQUIRED_DEP_PONG_CAPABILITY,
                ContractCapabilityMetadata {
                    display_name: "Call required dependency pong".to_string(),
                    description: "Allows callers to invoke the required dependency pong RPC."
                        .to_string(),
                    consequence: None,
                },
            )
            .rpc(
                "Required.Dep.Pong",
                rpc("v1", REQUIRED_DEP_PONG_SUBJECT, "Message", "Message")
                    .with_call_capabilities([REQUIRED_DEP_PONG_CAPABILITY])
                    .with_error_types(["UnexpectedError"]),
            );
    }
    let manifest = builder
        .build()
        .map_err(|error| miette!("failed to build required dependency contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize required dependency contract: {error}"))
}

fn cycle_contract_json(
    contract_id: &str,
    dependency_contract_id: &str,
    dependency_rpc_name: &str,
    subject: &str,
) -> Result<String> {
    let schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let own_rpc_name = if contract_id == CYCLE_A_CONTRACT_ID {
        "Cycle.A.Ping"
    } else {
        "Cycle.B.Ping"
    };
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Required Cycle",
        "Harness-owned service contract that participates in a required dependency cycle.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .use_ref(
        "cyclePeer",
        use_contract(dependency_contract_id).with_rpc_call([dependency_rpc_name]),
    )
    .schema("Message", schema)
    .rpc(
        own_rpc_name,
        rpc("v1", subject, "Message", "Message")
            .with_call_capabilities(std::iter::empty::<&str>())
            .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build cyclic required contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize cyclic required contract: {error}"))
}

async fn connect_service(
    trellis_url: &str,
    contract_id: &str,
    contract_json: &str,
    contract_digest: &str,
    service_seed: &str,
    approval_timeout_ms: u64,
) -> Result<TrellisClient> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url,
        contract_id,
        contract_digest,
        contract_json,
        session_key_seed_base64url: service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        approval_timeout_ms,
    })
    .await
    .map_err(|error| miette!("service {contract_id} connect failed: {error}"))
}

async fn assert_service_connect_fails(
    trellis_url: &str,
    contract_id: &str,
    contract_json: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<()> {
    if connect_service(
        trellis_url,
        contract_id,
        contract_json,
        contract_digest,
        service_seed,
        1_000,
    )
    .await
    .is_ok()
    {
        return Err(miette!(
            "service contract {contract_id} connected before required dependency closure was active"
        ));
    }
    Ok(())
}

async fn assert_service_digest_connect_fails(
    trellis_url: &str,
    contract_id: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<()> {
    if TrellisClient::connect_service(ServiceConnectOptions {
        trellis_url,
        contract_id,
        contract_digest,
        session_key_seed_base64url: service_seed,
        timeout_ms: 1_000,
    })
    .await
    .is_ok()
    {
        return Err(miette!(
            "service contract {contract_id} connected with inactive digest {contract_digest}"
        ));
    }
    Ok(())
}

async fn wait_for_pending_delta(
    auth_client: &SdkAuthClient<'_>,
    deployment_id: &str,
    contract_id: &str,
    contract_digest: &str,
) -> Result<Vec<AuthEnvelopeExpansionsListResponseEntriesItem>> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let response = auth_client
            .auth_envelope_expansions_list(&AuthEnvelopeExpansionsListRequest {
                deployment_id: Some(deployment_id.to_string()),
                limit: 20,
                offset: None,
                state: Some(json!("pending")),
            })
            .await
            .into_diagnostic()?;
        let requests: Vec<_> = response
            .entries
            .into_iter()
            .filter(|request| {
                request.contract_id == contract_id && request.contract_digest == contract_digest
            })
            .collect();
        if !requests.is_empty() {
            return Ok(requests);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for envelope expansion request for {deployment_id}"
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

async fn approve_requests(
    auth_client: &SdkAuthClient<'_>,
    requests: Vec<AuthEnvelopeExpansionsListResponseEntriesItem>,
    reason: &str,
) -> Result<()> {
    for request in requests {
        auth_client
            .auth_envelope_expansions_approve(&AuthEnvelopeExpansionsApproveRequest {
                request_id: request.request_id,
                reason: Some(reason.to_string()),
            })
            .await
            .into_diagnostic()?;
    }
    Ok(())
}

async fn wait_for_forced_update_issue(
    core_client: &CoreClient<'_>,
    contract_id: &str,
    expected_effective_digest: &str,
) -> Result<TrellisCatalogResponseCatalogIssuesItem> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let catalog = core_client.trellis_catalog().await.into_diagnostic()?;
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
            return Ok(issue);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for forced update issue for {contract_id}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn wait_for_forced_update_clear(
    core_client: &CoreClient<'_>,
    contract_id: &str,
    expected_active_digest: &str,
) -> Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        let catalog = core_client.trellis_catalog().await.into_diagnostic()?;
        let active_digest = catalog
            .catalog
            .contracts
            .iter()
            .find(|contract| contract.id == contract_id)
            .map(|contract| contract.digest.as_str());
        let has_issue = catalog
            .catalog
            .issues
            .unwrap_or_default()
            .into_iter()
            .any(|issue| issue.contract_id.as_deref() == Some(contract_id));
        if active_digest == Some(expected_active_digest) && !has_issue {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for forced update for {contract_id} to activate {expected_active_digest}; active digest was {:?}, issue present: {has_issue}",
                active_digest
            ));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn assert_required_unknown_delta_fails_closed(
    requests: &[AuthEnvelopeExpansionsListResponseEntriesItem],
) -> Result<()> {
    for request in requests {
        let has_unknown_contract = request.delta.contracts.iter().any(|contract| {
            contract.contract_id == UNKNOWN_REQUIRED_DEP_CONTRACT_ID && contract.required
        });
        if !has_unknown_contract {
            return Err(miette!(
                "unknown required dependency did not appear as a required pending contract"
            ));
        }
        if request
            .delta
            .surfaces
            .iter()
            .any(|surface| surface.contract_id == UNKNOWN_REQUIRED_DEP_CONTRACT_ID)
        {
            return Err(miette!(
                "unknown required dependency derived surfaces before its manifest was known"
            ));
        }
        if request
            .delta
            .capabilities
            .iter()
            .any(|capability| capability.contains("::required.dep."))
        {
            return Err(miette!(
                "unknown required dependency derived dependency capabilities before its manifest was known"
            ));
        }
    }
    Ok(())
}

fn assert_required_dependency_delta(
    requests: &[AuthEnvelopeExpansionsListResponseEntriesItem],
    rpc_name: &str,
    capability: &str,
) -> Result<()> {
    let has_surface = requests.iter().any(|request| {
        request.delta.surfaces.iter().any(|surface| {
            surface.contract_id != request.contract_id
                && surface.name == rpc_name
                && surface.required
        })
    });
    if !has_surface {
        return Err(miette!(
            "required dependency delta did not include required surface {rpc_name}"
        ));
    }
    if !capability.is_empty()
        && !requests.iter().any(|request| {
            request
                .delta
                .capabilities
                .iter()
                .any(|value| value == capability)
        })
    {
        return Err(miette!(
            "required dependency delta did not include capability {capability}"
        ));
    }
    Ok(())
}

fn spawn_required_dependency_service(
    client: TrellisClient,
    digest: String,
    include_pong: bool,
) -> tokio::task::JoinHandle<Result<(), ServiceRuntimeError>> {
    let client = Arc::new(client);
    let mut service = ConnectedServiceRuntime::<()>::from_connected_client(
        REQUIRED_DEP_SERVICE_NAME,
        Arc::clone(&client),
    )
    .expect("required dependency service client should include bootstrap binding");
    service.register_rpc::<RequiredDepPingRpc, _, _>(|_ctx, input| async move {
        Ok::<_, ServerError>(OptionalPingResponse {
            message: input.message,
        }) as HandlerResult<OptionalPingResponse>
    });
    if include_pong {
        service.register_rpc::<RequiredDepPongRpc, _, _>(|_ctx, input| async move {
            Ok::<_, ServerError>(OptionalPingResponse {
                message: input.message,
            }) as HandlerResult<OptionalPingResponse>
        });
    }
    let _ = digest;
    tokio::spawn(async move { service.run().await })
}

async fn abort_service_task<T>(task: tokio::task::JoinHandle<T>) {
    task.abort();
    let _ = task.await;
}

async fn assert_required_dependency_call(client: &TrellisClient) -> Result<()> {
    let input = OptionalPingRequest {
        message: "required-active".to_string(),
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let output = loop {
        match client.call::<RequiredDepPingRpc>(&input).await {
            Ok(output) => break output,
            Err(error) if tokio::time::Instant::now() < deadline => {
                let _ = error;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(error) => {
                return Err(miette!("required dependency ping RPC failed: {error}"));
            }
        }
    };
    if output.message != input.message {
        return Err(miette!("required dependency RPC did not echo the request"));
    }
    Ok(())
}

async fn assert_required_dependency_update_call(client: &TrellisClient) -> Result<()> {
    let input = OptionalPingRequest {
        message: "required-updated".to_string(),
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let output = loop {
        match client.call::<RequiredDepPongRpc>(&input).await {
            Ok(output) => break output,
            Err(error) if tokio::time::Instant::now() < deadline => {
                let _ = error;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(error) => {
                return Err(miette!("required dependency pong RPC failed: {error}"));
            }
        }
    };
    if output.message != input.message {
        return Err(miette!(
            "updated required dependency RPC did not echo the request"
        ));
    }
    Ok(())
}

fn optional_consumer_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        CONSUMER_CONTRACT_ID,
        "Trellis Integration Optional Consumer",
        "Harness-owned service contract that declares an optional dependency.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .optional_use_ref(
        "optionalDep",
        use_contract(DEPENDENCY_CONTRACT_ID).with_rpc_call(["Optional.Dep.Ping"]),
    )
    .build()
    .map_err(|error| miette!("failed to build optional consumer contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize optional consumer contract: {error}"))
}

fn optional_dependency_contract_json() -> Result<String> {
    let schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let manifest = ContractManifestBuilder::new(
        DEPENDENCY_CONTRACT_ID,
        "Trellis Integration Optional Dependency",
        "Harness-owned optional dependency service contract.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("Ping", schema.clone())
    .rpc(
        "Optional.Dep.Ping",
        rpc("v1", OPTIONAL_DEP_PING_SUBJECT, "Ping", "Ping")
            .with_call_capabilities(std::iter::empty::<&str>())
            .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build optional dependency contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize optional dependency contract: {error}"))
}

async fn connect_optional_consumer(
    trellis_url: String,
    contract_json: String,
    contract_digest: String,
    service_seed: String,
    approval_timeout_ms: u64,
) -> Result<TrellisClient> {
    TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
        trellis_url: &trellis_url,
        contract_id: CONSUMER_CONTRACT_ID,
        contract_digest: &contract_digest,
        contract_json: &contract_json,
        session_key_seed_base64url: &service_seed,
        timeout_ms: 5_000,
        retry_delay_ms: 250,
        approval_timeout_ms,
    })
    .await
    .into_diagnostic()
}

async fn wait_for_consumer_pending_optional_delta(
    auth_client: &SdkAuthClient<'_>,
    consumer_digest: &str,
    expect_optional_dependency: bool,
) -> Result<Vec<String>> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let response = auth_client
            .auth_envelope_expansions_list(&AuthEnvelopeExpansionsListRequest {
                deployment_id: Some(CONSUMER_DEPLOYMENT_ID.to_string()),
                limit: 20,
                offset: None,
                state: Some(json!("pending")),
            })
            .await
            .into_diagnostic()?;
        let requests: Vec<_> = response
            .entries
            .iter()
            .filter(|request| {
                request.contract_id == CONSUMER_CONTRACT_ID
                    && request.contract_digest == consumer_digest
            })
            .collect();
        if !requests.is_empty() {
            let mut saw_expected_optional_delta = false;
            for request in &requests {
                let has_optional_contract = request
                    .delta
                    .contracts
                    .iter()
                    .any(|contract| contract.contract_id == DEPENDENCY_CONTRACT_ID);
                let has_optional_surface = request.delta.surfaces.iter().any(|surface| {
                    surface.contract_id == DEPENDENCY_CONTRACT_ID
                        && surface.name == "Optional.Dep.Ping"
                });
                if expect_optional_dependency && (!has_optional_contract || !has_optional_surface) {
                    continue;
                }
                if expect_optional_dependency {
                    saw_expected_optional_delta = true;
                }
                if !expect_optional_dependency && (has_optional_contract || has_optional_surface) {
                    return Err(miette!(
                        "missing optional dependency appeared in pending expansion delta"
                    ));
                }
            }
            if expect_optional_dependency && !saw_expected_optional_delta {
                if tokio::time::Instant::now() < deadline {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    continue;
                }
                return Err(miette!(
                    "active optional dependency did not appear in pending expansion delta"
                ));
            }
            return Ok(requests
                .into_iter()
                .filter(|request| {
                    !expect_optional_dependency
                        || request.delta.surfaces.iter().any(|surface| {
                            surface.contract_id == DEPENDENCY_CONTRACT_ID
                                && surface.name == "Optional.Dep.Ping"
                        })
                })
                .map(|request| request.request_id.clone())
                .collect());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "timed out waiting for optional consumer envelope expansion request"
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

async fn assert_consumer_envelope_omits_dependency(auth_client: &SdkAuthClient<'_>) -> Result<()> {
    let envelope = auth_client
        .auth_envelopes_get(&AuthEnvelopesGetRequest {
            deployment_id: CONSUMER_DEPLOYMENT_ID.to_string(),
        })
        .await
        .into_diagnostic()?;
    if envelope
        .envelope
        .boundary
        .contracts
        .iter()
        .any(|contract| contract.contract_id == DEPENDENCY_CONTRACT_ID)
    {
        return Err(miette!(
            "consumer envelope included missing optional dependency contract"
        ));
    }
    if envelope.envelope.boundary.surfaces.iter().any(|surface| {
        surface.contract_id == DEPENDENCY_CONTRACT_ID && surface.name == "Optional.Dep.Ping"
    }) {
        return Err(miette!(
            "consumer envelope included missing optional dependency RPC surface"
        ));
    }
    Ok(())
}

async fn assert_consumer_envelope_includes_dependency(
    auth_client: &SdkAuthClient<'_>,
) -> Result<()> {
    let envelope = auth_client
        .auth_envelopes_get(&AuthEnvelopesGetRequest {
            deployment_id: CONSUMER_DEPLOYMENT_ID.to_string(),
        })
        .await
        .into_diagnostic()?;
    let includes_contract = envelope
        .envelope
        .boundary
        .contracts
        .iter()
        .any(|contract| contract.contract_id == DEPENDENCY_CONTRACT_ID && !contract.required);
    let includes_surface = envelope.envelope.boundary.surfaces.iter().any(|surface| {
        surface.contract_id == DEPENDENCY_CONTRACT_ID
            && surface.name == "Optional.Dep.Ping"
            && !surface.required
    });
    if !includes_contract || !includes_surface {
        return Err(miette!(
            "consumer envelope did not include active optional dependency after reconnect"
        ));
    }
    Ok(())
}

async fn assert_optional_dependency_call(client: &TrellisClient) -> Result<()> {
    let input = OptionalPingRequest {
        message: "optional-active".to_string(),
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    let output = loop {
        match client.call::<OptionalDepPingRpc>(&input).await {
            Ok(output) => break output,
            Err(error) if tokio::time::Instant::now() < deadline => {
                let _ = error;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            Err(error) => return Err(error).into_diagnostic(),
        }
    };
    if output
        != (OptionalPingResponse {
            message: input.message,
        })
    {
        return Err(miette!("optional dependency RPC did not echo the request"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct OptionalPingRequest {
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct OptionalPingResponse {
    message: String,
}

struct OptionalDepPingRpc;

impl trellis::client::RpcDescriptor for OptionalDepPingRpc {
    type Input = OptionalPingRequest;
    type Output = OptionalPingResponse;

    const KEY: &'static str = "Optional.Dep.Ping";
    const SUBJECT: &'static str = OPTIONAL_DEP_PING_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

struct RequiredDepPingRpc;

impl trellis::client::RpcDescriptor for RequiredDepPingRpc {
    type Input = OptionalPingRequest;
    type Output = OptionalPingResponse;

    const KEY: &'static str = "Required.Dep.Ping";
    const SUBJECT: &'static str = REQUIRED_DEP_PING_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[REQUIRED_DEP_PING_GLOBAL_CAPABILITY];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

struct RequiredDepPongRpc;

impl trellis::client::RpcDescriptor for RequiredDepPongRpc {
    type Input = OptionalPingRequest;
    type Output = OptionalPingResponse;

    const KEY: &'static str = "Required.Dep.Pong";
    const SUBJECT: &'static str = REQUIRED_DEP_PONG_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[REQUIRED_DEP_PONG_GLOBAL_CAPABILITY];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}
