use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use rusqlite::params;
use serde_json::{json, Value};
use trellis_rs::client::{OperationState, ServiceConnectWithContractOptions};
use trellis_rs::sdk::auth::types::{
    AuthDeploymentAuthorityPlanRequest, AuthDeploymentsCreateRequest,
    AuthDeviceUserAuthoritiesListRequest, AuthDeviceUserAuthoritiesResolveInput,
    AuthDeviceUserAuthoritiesReviewsDecideRequest, AuthDeviceUserAuthoritiesReviewsListRequest,
    AuthDeviceUserAuthoritiesRevokeRequest, AuthDevicesProvisionRequest,
    AuthServiceInstancesListRequest, AuthSessionsListRequest, AuthSessionsRevokeRequest,
};
use trellis_rs::sdk::auth::AuthClient as GeneratedAuthClient;

use crate::support::assertions::assert_case_registered;

const DEVICE_CONTRACT_ID: &str = "trellis.integration.device-activation-device@v1";
const SERVICE_CONTRACT_ID: &str = "trellis.integration.service-approval-service@v1";
const SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.service-approval-service@v1",
  "displayName": "Trellis Integration Service Approval Service",
  "description": "Exercises service startup waiting for deployment authority approval.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.service-approval-service::ping": {
      "displayName": "Ping approval service",
      "description": "Call the service after startup approval completes."
    }
  },
  "schemas": {
    "StartupPingInput": {
      "type": "object",
      "required": ["message"],
      "properties": { "message": { "type": "string" } }
    },
    "StartupPingOutput": {
      "type": "object",
      "required": ["message", "approved"],
      "properties": {
        "message": { "type": "string" },
        "approved": { "type": "boolean" }
      }
    }
  },
  "rpc": {
    "Startup.Ping": {
      "version": "v1",
      "subject": "rpc.v1.Startup.Ping",
      "input": { "schema": "StartupPingInput" },
      "output": { "schema": "StartupPingOutput" },
      "capabilities": { "call": ["trellis.integration.service-approval-service::ping"] },
      "errors": []
    }
  }
}"#;

fn device_contract() -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        DEVICE_CONTRACT_ID,
        "Trellis Integration Activated Device",
        "Activated device participant for the device activation integration fixture.",
        trellis_rs::contracts::ContractKind::Device,
    )
    .use_ref(
        "auth",
        trellis_rs::contracts::use_contract(trellis_rs::sdk::auth::CONTRACT_ID)
            .with_rpc_call(["Auth.Sessions.Me"]),
    )
    .build()?;
    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn device_root_secret() -> [u8; 32] {
    let mut secret = [0x44; 32];
    secret[0] = 1;
    secret[31] = 0x99;
    secret
}

fn generate_deployment_id() -> String {
    format!(
        "device-activation-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

fn generate_nonce() -> String {
    format!(
        "nonce-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}

async fn create_device_deployment(auth: &GeneratedAuthClient<'_>, deployment_id: &str) {
    create_device_deployment_with_review_mode(auth, deployment_id, "none").await;
}

async fn create_device_deployment_with_review_mode(
    auth: &GeneratedAuthClient<'_>,
    deployment_id: &str,
    review_mode: &str,
) {
    auth.rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": deployment_id,
            "kind": "device",
            "reviewMode": review_mode,
        })))
        .await
        .expect("create device deployment");
}

async fn wait_for_pending_review(
    auth: &GeneratedAuthClient<'_>,
    deployment_id: &str,
    instance_id: &str,
    public_identity_key: &str,
) -> trellis_rs::sdk::auth::types::AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let reviews = auth
            .rpc()
            .auth()
            .device_user_authorities_reviews_list(&AuthDeviceUserAuthoritiesReviewsListRequest {
                deployment_id: Some(deployment_id.to_string()),
                instance_id: Some(instance_id.to_string()),
                limit: 20,
                offset: None,
                state: Some("pending".to_string()),
            })
            .await
            .expect("list device activation reviews");
        if let Some(review) = reviews.entries.into_iter().find(|entry| {
            entry.deployment_id == deployment_id
                && entry.instance_id == instance_id
                && entry.public_identity_key == public_identity_key
        }) {
            return review;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for pending device activation review"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn approve_device_contract(
    auth: &GeneratedAuthClient<'_>,
    deployment_id: &str,
    device_contract: &trellis_test::TrellisTestContract,
) -> String {
    let device_contract_digest = device_contract.digest().to_string();

    let contract_map: BTreeMap<String, Value> = device_contract
        .manifest()
        .as_object()
        .expect("device contract manifest should be a JSON object")
        .clone()
        .into_iter()
        .collect();
    let planned = auth
        .rpc()
        .auth()
        .deployment_authority_plan(&AuthDeploymentAuthorityPlanRequest {
            deployment_id: deployment_id.to_string(),
            contract: contract_map,
            expected_digest: device_contract.digest().to_string(),
        })
        .await
        .expect("plan device contract authority");

    if planned.plan.get("classification").and_then(Value::as_str) == Some("update") {
        auth.rpc()
            .auth()
            .deployment_authority_accept_update(
                &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityAcceptUpdateRequest {
                    plan_id: planned
                        .plan
                        .get("planId")
                        .and_then(Value::as_str)
                        .expect("planId")
                        .to_string(),
                    expected_desired_version: None,
                },
            )
            .await
            .expect("accept device contract update");
    } else {
        auth.rpc()
            .auth()
            .deployment_authority_accept_migration(
                &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityAcceptMigrationRequest {
                    plan_id: planned
                        .plan
                        .get("planId")
                        .and_then(Value::as_str)
                        .expect("planId")
                        .to_string(),
                    expected_desired_version: None,
                    acknowledgement: "Approved by device activation integration test.".to_string(),
                },
            )
            .await
            .expect("accept device contract migration");
    }

    auth.rpc()
        .auth()
        .deployment_authority_reconcile(
            &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityReconcileRequest {
                deployment_id: deployment_id.to_string(),
                desired_version: None,
            },
        )
        .await
        .expect("reconcile device deployment authority");

    wait_for_deployment_authority_ready(auth, deployment_id).await;
    device_contract_digest
}

async fn provision_device(
    auth: &GeneratedAuthClient<'_>,
    deployment_id: &str,
    identity: &trellis_rs::auth::DeviceIdentity,
) -> trellis_rs::sdk::auth::types::AuthDevicesProvisionResponse {
    let provisioned = auth
        .rpc()
        .auth()
        .devices_provision(&AuthDevicesProvisionRequest {
            deployment_id: deployment_id.to_string(),
            public_identity_key: identity.public_identity_key.clone(),
            activation_key: identity.activation_key_base64url.clone(),
            metadata: Some(
                [(
                    "name".to_string(),
                    "Integration Activated Device".to_string(),
                )]
                .into_iter()
                .collect(),
            ),
        })
        .await
        .expect("provision device");

    assert_eq!(provisioned.instance.deployment_id, deployment_id);
    assert_eq!(
        provisioned.instance.public_identity_key,
        identity.public_identity_key
    );

    provisioned
}

async fn session_key_for(auth: &GeneratedAuthClient<'_>, kind: &str, id: &str) -> String {
    auth.rpc()
        .auth()
        .sessions_list(&AuthSessionsListRequest {
            limit: 500,
            offset: None,
            user: None,
        })
        .await
        .expect("list sessions")
        .entries
        .into_iter()
        .find(|entry| {
            entry.get("sessionKey").and_then(Value::as_str) == Some(id)
                || (entry.get("participantKind").and_then(Value::as_str) == Some(kind)
                    && principal_matches(entry, id))
        })
        .and_then(|entry| {
            entry
                .get("sessionKey")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| panic!("expected {kind} session"))
}

fn principal_matches(entry: &Value, id: &str) -> bool {
    let Some(principal) = entry.get("principal") else {
        return false;
    };
    ["deviceId", "id", "instanceId"]
        .into_iter()
        .any(|field| principal.get(field).and_then(Value::as_str) == Some(id))
}

async fn wait_for_session_absent(auth: &GeneratedAuthClient<'_>, session_key: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let sessions = auth
            .rpc()
            .auth()
            .sessions_list(&AuthSessionsListRequest {
                limit: 500,
                offset: None,
                user: None,
            })
            .await
            .expect("list sessions after revocation");
        if sessions
            .entries
            .iter()
            .all(|entry| entry.get("sessionKey").and_then(Value::as_str) != Some(session_key))
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for revoked session removal"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_sessions_me_denied(auth: &GeneratedAuthClient<'_>) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if auth.rpc().auth().sessions_me().await.is_err() {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for Auth.Sessions.Me denial"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_device_authority_state(
    auth: &GeneratedAuthClient<'_>,
    deployment_id: &str,
    instance_id: &str,
    public_identity_key: &str,
    state: &str,
) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let listings = auth
            .rpc()
            .auth()
            .device_user_authorities_list(&AuthDeviceUserAuthoritiesListRequest {
                deployment_id: Some(deployment_id.to_string()),
                instance_id: Some(instance_id.to_string()),
                limit: 20,
                offset: None,
                state: Some(state.to_string()),
            })
            .await
            .expect("list device user authorities");
        if listings.entries.iter().any(|entry| {
            entry.instance_id == instance_id
                && entry.public_identity_key == public_identity_key
                && entry.deployment_id == deployment_id
                && entry.state == state
        }) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for device authority state"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_disabled_service_instance(auth: &GeneratedAuthClient<'_>, instance_key: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let instances = auth
            .rpc()
            .auth()
            .service_instances_list(&AuthServiceInstancesListRequest {
                deployment_id: Some("test".to_string()),
                disabled: Some(true),
                limit: 100,
                offset: None,
            })
            .await
            .expect("list disabled service instances");
        if instances
            .entries
            .iter()
            .any(|entry| entry.instance_key == instance_key && entry.disabled)
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for disabled service instance"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_deployment_authority_ready(auth: &GeneratedAuthClient<'_>, deployment_id: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    loop {
        let result = auth
            .rpc()
            .auth()
            .deployment_authority_get(
                &trellis_rs::sdk::auth::types::AuthDeploymentAuthorityGetRequest {
                    deployment_id: deployment_id.to_string(),
                },
            )
            .await
            .expect("get deployment authority");
        let materialized = &result.materialized_authority;
        if materialized.is_null() {
            tokio::time::sleep(Duration::from_millis(25)).await;
            continue;
        }
        let obj = materialized
            .as_object()
            .expect("materialized authority should be object");
        match obj.get("status").and_then(Value::as_str) {
            Some("current") => {
                if obj.get("desiredVersion").and_then(Value::as_str)
                    == Some(&result.authority.version as &str)
                    && obj.get("reconciledAt").is_some_and(|v| !v.is_null())
                {
                    return;
                }
            }
            Some("failed") => {
                panic!(
                    "deployment authority reconciliation failed: {}",
                    obj.get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                );
            }
            _ => {}
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for deployment authority ready"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[tokio::test]
async fn device_activation_admin_provisions_known_device() {
    assert_case_registered(
        "device-activation.admin-provisions-known-device",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let _provisioned = provision_device(&auth, &deployment_id, &identity).await;
}

#[tokio::test]
async fn device_activation_device_starts_activation_request() {
    assert_case_registered(
        "device-activation.device-starts-activation-request",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let _provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()));
    assert!(flow_id.is_some(), "activation URL should contain a flowId");
}

#[tokio::test]
async fn device_activation_admin_resolves_activation_operation() {
    assert_case_registered(
        "device-activation.admin-resolves-activation-operation",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    let _device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let _provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");

    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");

    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);
    let output = terminal
        .output
        .expect("resolve operation completed with output");
    assert_eq!(
        output.0.get("status").and_then(Value::as_str),
        Some("activated")
    );
}

#[tokio::test]
async fn device_activation_review_reject_denies_connect() {
    assert_case_registered(
        "device-activation.review-reject-denies-connect",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment_with_review_mode(&auth, &deployment_id, "required").await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");

    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");

    let review = wait_for_pending_review(
        &auth,
        &deployment_id,
        &provisioned.instance.instance_id,
        &identity.public_identity_key,
    )
    .await;

    let rejection_reason = "integration review rejected";
    let decided = auth
        .rpc()
        .auth()
        .device_user_authorities_reviews_decide(&AuthDeviceUserAuthoritiesReviewsDecideRequest {
            review_id: review.review_id,
            decision: "reject".to_string(),
            reason: Some(rejection_reason.to_string()),
        })
        .await
        .expect("reject device activation review");
    assert_eq!(decided.review.state, "rejected");
    assert_eq!(decided.review.reason.as_deref(), Some(rejection_reason));

    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);
    let output = terminal
        .output
        .expect("resolve operation completed with output");
    assert_eq!(
        output.0.get("status").and_then(Value::as_str),
        Some("rejected")
    );
    assert_eq!(
        output.0.get("reason").and_then(Value::as_str),
        Some(rejection_reason)
    );

    let wait_error = trellis_rs::auth::wait_for_device_activation(
        trellis_rs::auth::WaitForDeviceActivationOpts {
            trellis_url: &trellis_url,
            flow_id: &flow_id,
            public_identity_key: &identity.public_identity_key,
            nonce: &nonce,
            identity_seed_base64url: &identity.identity_seed_base64url,
            contract_digest: Some(&device_contract_digest),
            poll_interval: Duration::from_millis(25),
        },
    )
    .await
    .expect_err("rejected activation wait should fail");
    assert!(
        matches!(&wait_error, trellis_rs::auth::TrellisAuthError::DeviceActivationRejected(reason) if reason.contains(rejection_reason)),
        "unexpected device activation wait error: {wait_error:?}"
    );

    let connect = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await;
    assert!(connect.is_err(), "rejected device should not connect");
}

#[tokio::test]
async fn device_activation_revoked_device_cannot_reconnect() {
    assert_case_registered(
        "device-activation.revoked-device-cannot-reconnect",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");

    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");

    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);

    let _connect_info = trellis_rs::auth::wait_for_device_activation(
        trellis_rs::auth::WaitForDeviceActivationOpts {
            trellis_url: &trellis_url,
            flow_id: &flow_id,
            public_identity_key: &identity.public_identity_key,
            nonce: &nonce,
            identity_seed_base64url: &identity.identity_seed_base64url,
            contract_digest: Some(&device_contract_digest),
            poll_interval: Duration::from_millis(25),
        },
    )
    .await
    .expect("wait for device activation");

    let device = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await
    .expect("connect device client");
    device
        .flush()
        .await
        .expect("device NATS flush should succeed");

    let device_auth = GeneratedAuthClient::new(&device);
    let me = device_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as device");
    assert_eq!(me.participant_kind.as_str(), Some("device"));

    let revoked = auth
        .rpc()
        .auth()
        .device_user_authorities_revoke(&AuthDeviceUserAuthoritiesRevokeRequest {
            instance_id: provisioned.instance.instance_id.clone(),
        })
        .await
        .expect("revoke device activation");
    assert!(revoked.success, "device activation revoke should succeed");

    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let listings = auth
            .rpc()
            .auth()
            .device_user_authorities_list(&AuthDeviceUserAuthoritiesListRequest {
                deployment_id: Some(deployment_id.clone()),
                instance_id: Some(provisioned.instance.instance_id.clone()),
                limit: 20,
                offset: None,
                state: Some("revoked".to_string()),
            })
            .await
            .expect("list revoked device user authorities");
        let found = listings.entries.iter().any(|entry| {
            entry.instance_id == provisioned.instance.instance_id
                && entry.public_identity_key == identity.public_identity_key
                && entry.deployment_id == deployment_id
                && entry.state == "revoked"
        });
        if found {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for revoked device activation state"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if device_auth.rpc().auth().sessions_me().await.is_err() {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for existing device session denial"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    let reconnect = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await;
    assert!(reconnect.is_err(), "revoked device should not reconnect");
}

#[tokio::test]
async fn auth_sessions_revoke_revokes_device_and_service_access() {
    assert_case_registered(
        "auth.sessions-revoke-revokes-device-and-service-access",
        "auth",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(SERVICE_CONTRACT_JSON)
            .expect("build service contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision service instance");
    let service_digest = service_contract.digest().to_string();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");
    create_device_deployment(&auth, &deployment_id).await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let provisioned = provision_device(&auth, &deployment_id, &identity).await;
    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");
    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");
    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");
    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");
    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);
    trellis_rs::auth::wait_for_device_activation(trellis_rs::auth::WaitForDeviceActivationOpts {
        trellis_url: &trellis_url,
        flow_id: &flow_id,
        public_identity_key: &identity.public_identity_key,
        nonce: &nonce,
        identity_seed_base64url: &identity.identity_seed_base64url,
        contract_digest: Some(&device_contract_digest),
        poll_interval: Duration::from_millis(25),
    })
    .await
    .expect("wait for device activation");

    let device = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await
    .expect("connect device client");
    device
        .flush()
        .await
        .expect("device NATS flush should succeed");
    let device_auth = GeneratedAuthClient::new(&device);
    device_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as device");
    let device_session_key =
        session_key_for(&auth, "device", &provisioned.instance.instance_id).await;

    let revoked = auth
        .rpc()
        .auth()
        .sessions_revoke(&AuthSessionsRevokeRequest {
            session_key: device_session_key.clone(),
        })
        .await
        .expect("revoke device session through Auth.Sessions.Revoke");
    assert!(revoked.success);
    wait_for_device_authority_state(
        &auth,
        &deployment_id,
        &provisioned.instance.instance_id,
        &identity.public_identity_key,
        "revoked",
    )
    .await;
    wait_for_session_absent(&auth, &device_session_key).await;
    wait_for_sessions_me_denied(&device_auth).await;

    let reconnect_device = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await;
    assert!(
        reconnect_device.is_err(),
        "revoked device should not reconnect"
    );

    let service = trellis_rs::client::TrellisClient::connect_service_with_contract(
        ServiceConnectWithContractOptions {
            trellis_url: &trellis_url,
            contract_id: SERVICE_CONTRACT_ID,
            contract_digest: &service_digest,
            contract_json: SERVICE_CONTRACT_JSON,
            session_key_seed_base64url: &service_key.seed,
            timeout_ms: 15_000,
            retry_delay_ms: 100,
            authority_pending_timeout_ms: 1_000,
        },
    )
    .await
    .expect("connect service client");
    service
        .flush()
        .await
        .expect("service NATS flush should succeed");

    let service_session_key = session_key_for(&auth, "service", &service_key.session_key).await;
    let revoked = auth
        .rpc()
        .auth()
        .sessions_revoke(&AuthSessionsRevokeRequest {
            session_key: service_session_key.clone(),
        })
        .await
        .expect("revoke service session through Auth.Sessions.Revoke");
    assert!(revoked.success);
    wait_for_session_absent(&auth, &service_session_key).await;
    wait_for_disabled_service_instance(&auth, &service_key.session_key).await;

    let reconnect_service = trellis_rs::client::TrellisClient::connect_service_with_contract(
        ServiceConnectWithContractOptions {
            trellis_url: &trellis_url,
            contract_id: SERVICE_CONTRACT_ID,
            contract_digest: &service_digest,
            contract_json: SERVICE_CONTRACT_JSON,
            session_key_seed_base64url: &service_key.seed,
            timeout_ms: 2_000,
            retry_delay_ms: 100,
            authority_pending_timeout_ms: 500,
        },
    )
    .await;
    assert!(
        reconnect_service.is_err(),
        "disabled service instance should not reconnect"
    );
}

#[tokio::test]
async fn device_activation_device_receives_connect_info() {
    assert_case_registered(
        "device-activation.device-receives-connect-info",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let _provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");

    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");

    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);

    let activated = trellis_rs::auth::wait_for_device_activation(
        trellis_rs::auth::WaitForDeviceActivationOpts {
            trellis_url: &trellis_url,
            flow_id: &flow_id,
            public_identity_key: &identity.public_identity_key,
            nonce: &nonce,
            identity_seed_base64url: &identity.identity_seed_base64url,
            contract_digest: Some(&device_contract_digest),
            poll_interval: Duration::from_millis(25),
        },
    )
    .await
    .expect("wait for device activation");

    assert_eq!(
        activated.pointer("/deploymentId").and_then(Value::as_str),
        Some(&deployment_id as &str)
    );
    assert_eq!(
        activated.pointer("/contractDigest").and_then(Value::as_str),
        Some(&device_contract_digest as &str)
    );
}

#[tokio::test]
async fn device_activation_activated_device_connects_and_authenticates() {
    assert_case_registered(
        "device-activation.activated-device-connects-and-authenticates",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let _provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");

    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");

    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);

    let _connect_info = trellis_rs::auth::wait_for_device_activation(
        trellis_rs::auth::WaitForDeviceActivationOpts {
            trellis_url: &trellis_url,
            flow_id: &flow_id,
            public_identity_key: &identity.public_identity_key,
            nonce: &nonce,
            identity_seed_base64url: &identity.identity_seed_base64url,
            contract_digest: Some(&device_contract_digest),
            poll_interval: Duration::from_millis(25),
        },
    )
    .await
    .expect("wait for device activation");

    let device = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await
    .expect("connect device client");
    device
        .flush()
        .await
        .expect("device NATS flush should succeed");

    let device_auth = GeneratedAuthClient::new(&device);
    let me = device_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as device");

    assert_eq!(
        me.participant_kind.as_str(),
        Some("device"),
        "session should identify as device"
    );
    let device_info = me
        .device
        .as_object()
        .expect("device session should have device info");
    assert_eq!(
        device_info.get("deploymentId").and_then(Value::as_str),
        Some(&deployment_id as &str)
    );
    assert_eq!(
        device_info.get("runtimePublicKey").and_then(Value::as_str),
        Some(&identity.public_identity_key as &str)
    );
}

#[tokio::test]
async fn device_activation_activated_device_authority_is_listed() {
    assert_case_registered(
        "device-activation.activated-device-authority-is-listed",
        "device-activation",
        "device_activation",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);

    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;

    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let provisioned = provision_device(&auth, &deployment_id, &identity).await;

    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");

    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");

    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");

    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");

    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);

    let _connect_info = trellis_rs::auth::wait_for_device_activation(
        trellis_rs::auth::WaitForDeviceActivationOpts {
            trellis_url: &trellis_url,
            flow_id: &flow_id,
            public_identity_key: &identity.public_identity_key,
            nonce: &nonce,
            identity_seed_base64url: &identity.identity_seed_base64url,
            contract_digest: Some(&device_contract_digest),
            poll_interval: Duration::from_millis(25),
        },
    )
    .await
    .expect("wait for device activation");

    let device = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await
    .expect("connect device client");
    device
        .flush()
        .await
        .expect("device NATS flush should succeed");

    let device_auth = GeneratedAuthClient::new(&device);
    let me = device_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as device");

    assert_eq!(
        me.participant_kind.as_str(),
        Some("device"),
        "session should identify as device"
    );

    let listings = auth
        .rpc()
        .auth()
        .device_user_authorities_list(&AuthDeviceUserAuthoritiesListRequest {
            deployment_id: Some(deployment_id.clone()),
            instance_id: Some(provisioned.instance.instance_id.clone()),
            limit: 20,
            offset: None,
            state: Some("activated".to_string()),
        })
        .await
        .expect("list device user authorities");

    let found = listings.entries.iter().any(|entry| {
        entry.instance_id == provisioned.instance.instance_id
            && entry.public_identity_key == identity.public_identity_key
            && entry.deployment_id == deployment_id
            && entry.state == "activated"
    });
    assert!(
        found,
        "activated device should be listed by Auth.DeviceUserAuthorities.List"
    );
}

#[tokio::test]
async fn auth_sessions_me_reports_device_envelope() {
    assert_case_registered(
        "auth.sessions-me-reports-device-envelope",
        "auth",
        "device_activation",
    );

    let (_runtime, mut admin, bootstrap_url, deployment_id, identity, provisioned, device) =
        connect_activated_device_for_auth_case().await;
    let me = GeneratedAuthClient::new(&device)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me as activated device");

    assert_eq!(me.participant_kind.as_str(), Some("device"));
    assert!(!me.user.is_null(), "activated device should include user");
    let device = me
        .device
        .as_object()
        .expect("device session should include device envelope");
    assert_eq!(
        device.get("deploymentId").and_then(Value::as_str),
        Some(deployment_id.as_str())
    );
    assert_eq!(
        device.get("runtimePublicKey").and_then(Value::as_str),
        Some(identity.public_identity_key.as_str())
    );
    assert_eq!(device.get("active").and_then(Value::as_bool), Some(true));
    assert!(me.service.is_null());

    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("reuse admin client");
    let sessions = GeneratedAuthClient::new(admin_client)
        .rpc()
        .auth()
        .sessions_list(&AuthSessionsListRequest {
            limit: 500,
            offset: None,
            user: None,
        })
        .await
        .expect("list sessions for activated device metadata");
    let device_session = sessions
        .entries
        .iter()
        .find(|entry| {
            entry.get("participantKind").and_then(Value::as_str) == Some("device")
                && entry.get("sessionKey").and_then(Value::as_str)
                    == Some(identity.public_identity_key.as_str())
        })
        .expect("Auth.Sessions.List should include activated device metadata row");
    assert_eq!(
        device_session
            .get("principal")
            .and_then(|principal| principal.get("type"))
            .and_then(Value::as_str),
        Some("device")
    );
    assert_eq!(
        device_session
            .get("principal")
            .and_then(|principal| principal.get("deviceId"))
            .and_then(Value::as_str),
        Some(provisioned.instance.instance_id.as_str())
    );
    assert_eq!(
        device_session
            .get("principal")
            .and_then(|principal| principal.get("deploymentId"))
            .and_then(Value::as_str),
        Some(deployment_id.as_str())
    );
    assert_eq!(
        device_session
            .get("principal")
            .and_then(|principal| principal.get("runtimePublicKey"))
            .and_then(Value::as_str),
        Some(identity.public_identity_key.as_str())
    );
    assert_eq!(
        device_session.get("contractId").and_then(Value::as_str),
        Some(DEVICE_CONTRACT_ID)
    );
}

#[tokio::test]
async fn auth_sessions_me_rejects_stale_device_principals() {
    assert_case_registered(
        "auth.sessions-me-rejects-stale-device-principals",
        "auth",
        "device_activation",
    );

    let (runtime, _admin, _bootstrap_url, deployment_id, identity, provisioned, device) =
        connect_activated_device_for_auth_case().await;
    let device_auth = GeneratedAuthClient::new(&device);
    device_auth
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("call Auth.Sessions.Me before stale device mutations");

    let sqlite = runtime.control_plane_sqlite();
    let snapshot = sqlite
        .take_session(&identity.public_identity_key)
        .expect("delete device session row")
        .expect("device session row should exist");
    assert!(device_auth.rpc().auth().sessions_me().await.is_err());
    snapshot.restore().expect("restore device session row");

    sqlite
        .execute(
            "UPDATE device_instances SET deployment_id = ? WHERE instance_id = ?",
            params![
                format!("{deployment_id}.stale"),
                provisioned.instance.instance_id
            ],
        )
        .expect("make device activation deployment stale");
    assert!(device_auth.rpc().auth().sessions_me().await.is_err());

    sqlite
        .execute(
            "UPDATE device_instances SET deployment_id = ? WHERE instance_id = ?",
            params![deployment_id, provisioned.instance.instance_id],
        )
        .expect("restore device instance deployment");
    sqlite
        .execute(
            "UPDATE device_activations SET public_identity_key = ? WHERE instance_id = ?",
            params![
                format!("B{}", &identity.public_identity_key[1..]),
                provisioned.instance.instance_id
            ],
        )
        .expect("make device activation identity key stale");
    assert!(device_auth.rpc().auth().sessions_me().await.is_err());
}

async fn connect_activated_device_for_auth_case() -> (
    trellis_test::TrellisTestRuntime,
    trellis_test::TrellisTestAdmin,
    String,
    String,
    trellis_rs::auth::DeviceIdentity,
    trellis_rs::sdk::auth::types::AuthDevicesProvisionResponse,
    trellis_rs::client::TrellisClient,
) {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let trellis_url = runtime.trellis_url().to_string();
    let mut admin = runtime.admin();
    let admin_client = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let auth = GeneratedAuthClient::new(admin_client);
    let deployment_id = generate_deployment_id();
    let device_contract = device_contract().expect("build device contract");

    create_device_deployment(&auth, &deployment_id).await;
    let device_contract_digest =
        approve_device_contract(&auth, &deployment_id, &device_contract).await;
    let root_secret = device_root_secret();
    let identity =
        trellis_rs::auth::derive_device_identity(&root_secret).expect("derive device identity");
    let provisioned = provision_device(&auth, &deployment_id, &identity).await;
    let nonce = generate_nonce();
    let payload = trellis_rs::auth::build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        &nonce,
    )
    .expect("build activation payload");
    let activation = trellis_rs::auth::start_device_activation_request(&trellis_url, &payload)
        .await
        .expect("start device activation request");
    let flow_id = url::Url::parse(&activation.activation_url)
        .expect("parse activation URL")
        .query_pairs()
        .find_map(|(key, value)| (key == "flowId").then(|| value.into_owned()))
        .expect("activation URL should contain a flowId");
    let resolve_op = auth
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: flow_id.clone(),
        })
        .await
        .expect("start device user authorities resolve operation");
    let terminal = resolve_op
        .wait()
        .await
        .expect("wait for resolve operation to complete");
    assert_eq!(terminal.state, OperationState::Completed);
    trellis_rs::auth::wait_for_device_activation(trellis_rs::auth::WaitForDeviceActivationOpts {
        trellis_url: &trellis_url,
        flow_id: &flow_id,
        public_identity_key: &identity.public_identity_key,
        nonce: &nonce,
        identity_seed_base64url: &identity.identity_seed_base64url,
        contract_digest: Some(&device_contract_digest),
        poll_interval: Duration::from_millis(25),
    })
    .await
    .expect("wait for device activation");
    let device = trellis_rs::client::TrellisClient::connect_device(
        trellis_rs::client::DeviceConnectOptions {
            trellis_url: &trellis_url,
            contract_digest: &device_contract_digest,
            public_identity_key: &identity.public_identity_key,
            identity_seed_base64url: &identity.identity_seed_base64url,
            timeout_ms: 15_000,
        },
    )
    .await
    .expect("connect device client");
    device
        .flush()
        .await
        .expect("device NATS flush should succeed");
    drop(auth);

    (
        runtime,
        admin,
        bootstrap_url,
        deployment_id,
        identity,
        provisioned,
        device,
    )
}
