use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{json, Value};
use trellis_rs::client::OperationState;
use trellis_rs::sdk::auth::types::{
    AuthDeploymentAuthorityPlanRequest, AuthDeploymentsCreateRequest,
    AuthDeviceUserAuthoritiesListRequest, AuthDeviceUserAuthoritiesResolveInput,
    AuthDevicesProvisionRequest,
};
use trellis_rs::sdk::auth::AuthClient as GeneratedAuthClient;

use crate::support::assertions::assert_case_registered;

const DEVICE_CONTRACT_ID: &str = "trellis.integration.device-activation-device@v1";

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
    auth.rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "deploymentId": deployment_id,
            "kind": "device",
            "reviewMode": "none",
        })))
        .await
        .expect("create device deployment");
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
