use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use miette::{miette, IntoDiagnostic, Result};
use serde_json::{json, to_string, Value};
use time::OffsetDateTime;
use trellis_auth::{
    connect_admin_client_async, get_device_connect_info, sign_device_wait_request,
    start_device_activation_request, wait_for_device_activation_response, AdminLoginOutcome,
    AuthClient as AdminAuthClient, DeviceActivationPayload, DeviceActivationSessionBuilder,
    GetDeviceConnectInfoOpts, WaitForDeviceActivationResponse,
};
use trellis_client::{DeviceConnectOptions, OperationState, TrellisClient};
use trellis_contracts::{
    digest_contract_json, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis_sdk_auth::client::AuthClient as SdkAuthClient;
use trellis_sdk_auth::operations::AuthDeviceUserAuthoritiesResolveOperation;
use trellis_sdk_auth::types::{AuthDeviceUserAuthoritiesResolveInput, AuthEnvelopesExpandRequest};

use crate::browser::BrowserContainer;
use crate::rpc::reauth_contract;

const DEVICE_ACTIVATION_PASSING_CASES: usize = 27;
static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(1);

pub(crate) async fn run_device_activation_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let contract_json = device_activation_admin_contract_json()?;
    let setup_login =
        reauth_contract(&admin_login.state, &contract_json, trellis_url, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let sdk_auth = SdkAuthClient::new(&admin_client);
    let admin_auth = AdminAuthClient::new(&admin_client);

    let suffix = unique_suffix();
    let deployment_id = format!("harness-device-activation-{suffix}");
    let device_contract_id = format!("trellis.integration-device-activation-{suffix}@v1");
    let device_contract_json = device_contract_json(&device_contract_id)?;
    let device_contract_digest = digest_contract_json(&device_contract_json).into_diagnostic()?;

    admin_auth
        .create_device_deployment(&deployment_id, Some("none"))
        .await
        .into_diagnostic()?;
    sdk_auth
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&device_contract_json)?,
            deployment_id: deployment_id.clone(),
            expected_digest: device_contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;

    let root_secret = device_root_secret();
    let activation = DeviceActivationSessionBuilder::new(&root_secret, format!("nonce-{suffix}"))
        .into_diagnostic()?;
    let device_identity = trellis_auth::derive_device_identity(&root_secret).into_diagnostic()?;

    let provisioned = admin_auth
        .provision_device_instance(
            &deployment_id,
            activation.public_identity_key(),
            &device_identity.activation_key_base64url,
            Some(BTreeMap::from([(
                "name".to_string(),
                "Harness Reader".to_string(),
            )])),
        )
        .await
        .into_diagnostic()?;
    if provisioned.deployment_id != deployment_id
        || provisioned.public_identity_key != activation.public_identity_key()
    {
        return Err(miette!(
            "Auth.Devices.Provision returned unexpected instance"
        ));
    }

    assert_activation_start_rejected(
        trellis_url,
        &DeviceActivationPayload {
            qr_mac: format!("{}x", activation.payload().qr_mac),
            ..activation.payload().clone()
        },
        "tampered QR MAC",
    )
    .await?;

    let start = start_device_activation_request(trellis_url, activation.payload())
        .await
        .into_diagnostic()?;
    if start.deployment_id != deployment_id || start.instance_id != provisioned.instance_id {
        return Err(miette!(
            "device activation start returned deployment `{}` instance `{}`, expected `{deployment_id}` `{}`",
            start.deployment_id,
            start.instance_id,
            provisioned.instance_id
        ));
    }
    if !start.activation_url.contains(&start.flow_id) {
        return Err(miette!("device activation URL did not include the flow id"));
    }

    let pending_session = activation
        .pending_session(trellis_url, &device_contract_digest, start.clone())
        .into_diagnostic()?;
    assert_activation_wait_status_rejected(
        trellis_url,
        &sign_device_wait_request(
            &format!("{}-unknown", start.flow_id),
            &device_identity.public_identity_key,
            pending_session.local_state().nonce.as_str(),
            &device_identity.identity_seed_base64url,
            Some(&device_contract_digest),
            now_iat(),
        )
        .into_diagnostic()?,
        "unknown signed flow id",
    )
    .await?;
    let mut tampered_nonce_wait = pending_session
        .build_wait_request(now_iat())
        .into_diagnostic()?;
    tampered_nonce_wait.nonce.push_str("-tampered");
    assert_activation_wait_rejected(trellis_url, &tampered_nonce_wait, "tampered wait nonce")
        .await?;
    let wrong_device_identity =
        trellis_auth::derive_device_identity(&device_root_secret()).into_diagnostic()?;
    assert_activation_wait_rejected(
        trellis_url,
        &sign_device_wait_request(
            &start.flow_id,
            &wrong_device_identity.public_identity_key,
            pending_session.local_state().nonce.as_str(),
            &wrong_device_identity.identity_seed_base64url,
            Some(&device_contract_digest),
            now_iat(),
        )
        .into_diagnostic()?,
        "wrong wait device identity",
    )
    .await?;
    assert_activation_wait_rejected(
        trellis_url,
        &pending_session
            .build_wait_request(stale_iat())
            .into_diagnostic()?,
        "stale wait iat",
    )
    .await?;
    let pending_wait = wait_for_device_activation_response(
        trellis_url,
        &pending_session
            .build_wait_request(now_iat())
            .into_diagnostic()?,
    )
    .await
    .into_diagnostic()?;
    if !matches!(pending_wait, WaitForDeviceActivationResponse::Pending) {
        return Err(miette!("device wait before resolve was not pending"));
    }

    let terminal = admin_client
        .operation::<AuthDeviceUserAuthoritiesResolveOperation>()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: start.flow_id.clone(),
        })
        .await
        .into_diagnostic()?
        .wait()
        .await
        .into_diagnostic()?;
    if terminal.state != OperationState::Completed {
        return Err(miette!(
            "Auth.DeviceUserAuthorities.Resolve returned {:?}",
            terminal.state
        ));
    }

    let activated_wait = wait_for_device_activation_response(
        trellis_url,
        &pending_session
            .build_wait_request(now_iat())
            .into_diagnostic()?,
    )
    .await
    .into_diagnostic()?;
    let wait_connect_info = match activated_wait {
        WaitForDeviceActivationResponse::Activated { connect_info, .. } => connect_info,
        other => {
            return Err(miette!(
                "device wait after resolve returned unexpected status: {:?}",
                other
            ));
        }
    };
    assert_connect_info_value(
        &wait_connect_info,
        &provisioned.instance_id,
        &deployment_id,
        &device_contract_id,
        &device_contract_digest,
    )?;

    let connect_info = get_device_connect_info(GetDeviceConnectInfoOpts {
        trellis_url,
        public_identity_key: &device_identity.public_identity_key,
        identity_seed_base64url: &device_identity.identity_seed_base64url,
        contract_digest: &device_contract_digest,
        iat: now_iat(),
    })
    .await
    .into_diagnostic()?;
    if connect_info.status != "ready" {
        return Err(miette!(
            "device connect-info returned status `{}` instead of ready",
            connect_info.status
        ));
    }
    if connect_info.connect_info.instance_id != provisioned.instance_id
        || connect_info.connect_info.deployment_id != deployment_id
        || connect_info.connect_info.contract_digest != device_contract_digest
    {
        return Err(miette!(
            "device connect-info returned unexpected identity data"
        ));
    }
    assert_connect_info_rejected(
        GetDeviceConnectInfoOpts {
            trellis_url,
            public_identity_key: &device_identity.public_identity_key,
            identity_seed_base64url: &device_identity.identity_seed_base64url,
            contract_digest: &device_contract_digest,
            iat: stale_iat(),
        },
        "stale connect-info iat",
    )
    .await?;
    assert_connect_info_rejected(
        GetDeviceConnectInfoOpts {
            trellis_url,
            public_identity_key: &device_identity.public_identity_key,
            identity_seed_base64url: &device_identity.identity_seed_base64url,
            contract_digest: "digest-v1-invalid",
            iat: now_iat(),
        },
        "wrong connect-info contract digest",
    )
    .await?;

    let device_client = TrellisClient::connect_device(DeviceConnectOptions {
        trellis_url,
        contract_digest: &device_contract_digest,
        public_identity_key: &device_identity.public_identity_key,
        identity_seed_base64url: &device_identity.identity_seed_base64url,
        timeout_ms: 10_000,
    })
    .await
    .into_diagnostic()?;
    let device_auth = SdkAuthClient::new(&device_client);
    let me = device_auth.auth_sessions_me().await.into_diagnostic()?;
    if me.participant_kind != json!("device") {
        return Err(miette!(
            "activated device Auth.Sessions.Me returned participant kind `{}`",
            me.participant_kind
        ));
    }
    assert_device_undeclared_access_denied(&device_auth, &device_contract_json, &deployment_id)
        .await?;

    let activations = admin_auth
        .list_device_activations(
            Some(&provisioned.instance_id),
            Some(&deployment_id),
            Some("activated"),
        )
        .await
        .into_diagnostic()?;
    if !activations.iter().any(|activation| {
        activation.instance_id == provisioned.instance_id
            && activation.deployment_id == deployment_id
            && activation.state == json!("activated")
    }) {
        return Err(miette!(
            "Auth.DeviceUserAuthorities.List did not include activated device"
        ));
    }

    run_review_required_activation(
        trellis_url,
        &admin_client,
        &sdk_auth,
        &admin_auth,
        &device_contract_json,
        &device_contract_id,
        &device_contract_digest,
        ReviewDecision::Approve,
    )
    .await?;
    run_review_required_activation(
        trellis_url,
        &admin_client,
        &sdk_auth,
        &admin_auth,
        &device_contract_json,
        &device_contract_id,
        &device_contract_digest,
        ReviewDecision::Reject,
    )
    .await?;

    Ok(DEVICE_ACTIVATION_PASSING_CASES)
}

async fn assert_activation_start_rejected(
    trellis_url: &str,
    payload: &DeviceActivationPayload,
    label: &str,
) -> Result<()> {
    if start_device_activation_request(trellis_url, payload)
        .await
        .is_ok()
    {
        return Err(miette!(
            "device activation start unexpectedly accepted {}",
            label
        ));
    }
    Ok(())
}

async fn assert_activation_wait_rejected(
    trellis_url: &str,
    request: &trellis_auth::DeviceActivationWaitRequest,
    label: &str,
) -> Result<()> {
    if wait_for_device_activation_response(trellis_url, request)
        .await
        .is_ok()
    {
        return Err(miette!(
            "device activation wait unexpectedly accepted {}",
            label
        ));
    }
    Ok(())
}

async fn assert_activation_wait_status_rejected(
    trellis_url: &str,
    request: &trellis_auth::DeviceActivationWaitRequest,
    label: &str,
) -> Result<()> {
    let response = wait_for_device_activation_response(trellis_url, request)
        .await
        .into_diagnostic()?;
    if !matches!(response, WaitForDeviceActivationResponse::Rejected { .. }) {
        return Err(miette!(
            "device activation wait returned {:?} instead of rejected for {}",
            response,
            label
        ));
    }
    Ok(())
}

async fn assert_connect_info_rejected(
    opts: GetDeviceConnectInfoOpts<'_>,
    label: &str,
) -> Result<()> {
    if get_device_connect_info(opts).await.is_ok() {
        return Err(miette!(
            "device connect-info unexpectedly accepted {}",
            label
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum ReviewDecision {
    Approve,
    Reject,
}

impl ReviewDecision {
    fn request_value(self) -> &'static str {
        match self {
            Self::Approve => "approve",
            Self::Reject => "reject",
        }
    }

    fn review_state(self) -> &'static str {
        match self {
            Self::Approve => "approved",
            Self::Reject => "rejected",
        }
    }
}

async fn run_review_required_activation(
    trellis_url: &str,
    admin_client: &TrellisClient,
    sdk_auth: &SdkAuthClient<'_>,
    admin_auth: &AdminAuthClient<'_>,
    device_contract_json: &str,
    device_contract_id: &str,
    device_contract_digest: &str,
    decision: ReviewDecision,
) -> Result<()> {
    let suffix = unique_suffix();
    let deployment_id = format!("harness-device-activation-review-{suffix}");
    admin_auth
        .create_device_deployment(&deployment_id, Some("required"))
        .await
        .into_diagnostic()?;
    sdk_auth
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(device_contract_json)?,
            deployment_id: deployment_id.clone(),
            expected_digest: device_contract_digest.to_string(),
        })
        .await
        .into_diagnostic()?;

    let device_root_secret = device_root_secret();
    let activation =
        DeviceActivationSessionBuilder::new(&device_root_secret, format!("nonce-{suffix}"))
            .into_diagnostic()?;
    let device_identity =
        trellis_auth::derive_device_identity(&device_root_secret).into_diagnostic()?;
    let provisioned = admin_auth
        .provision_device_instance(
            &deployment_id,
            activation.public_identity_key(),
            &device_identity.activation_key_base64url,
            Some(BTreeMap::from([(
                "name".to_string(),
                "Harness Review Reader".to_string(),
            )])),
        )
        .await
        .into_diagnostic()?;
    let start = start_device_activation_request(trellis_url, activation.payload())
        .await
        .into_diagnostic()?;
    let pending_session = activation
        .pending_session(trellis_url, device_contract_digest, start.clone())
        .into_diagnostic()?;
    let pending_wait = wait_for_device_activation_response(
        trellis_url,
        &pending_session
            .build_wait_request(now_iat())
            .into_diagnostic()?,
    )
    .await
    .into_diagnostic()?;
    if !matches!(pending_wait, WaitForDeviceActivationResponse::Pending) {
        return Err(miette!(
            "review-required device wait before resolve was not pending"
        ));
    }

    let operation_ref = admin_client
        .operation::<AuthDeviceUserAuthoritiesResolveOperation>()
        .start(&AuthDeviceUserAuthoritiesResolveInput {
            flow_id: start.flow_id.clone(),
        })
        .await
        .into_diagnostic()?;
    let review_id = wait_for_pending_review(&operation_ref).await?;
    let reviews = admin_auth
        .list_device_activation_reviews(
            Some(&provisioned.instance_id),
            Some(&deployment_id),
            Some("pending"),
        )
        .await
        .into_diagnostic()?;
    if !reviews.iter().any(|review| {
        review.review_id == review_id
            && review.instance_id == provisioned.instance_id
            && review.deployment_id == deployment_id
            && review.state == json!("pending")
    }) {
        return Err(miette!(
            "Auth.DeviceUserAuthorities.Reviews.List did not include pending review"
        ));
    }

    let decide_response = admin_client
        .request_json_value(
            "rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide",
            &json!({
                "reviewId": review_id,
                "decision": decision.request_value(),
                "reason": "integration review decision"
            }),
        )
        .await
        .into_diagnostic()?;
    if decide_response["review"]["state"] != json!(decision.review_state()) {
        return Err(miette!(
            "Auth.DeviceUserAuthorities.Reviews.Decide returned unexpected review state: {}",
            decide_response
        ));
    }

    let terminal = operation_ref.wait().await.into_diagnostic()?;
    if terminal.state != OperationState::Completed {
        return Err(miette!(
            "review-required Auth.DeviceUserAuthorities.Resolve returned {:?}",
            terminal.state
        ));
    }

    match decision {
        ReviewDecision::Approve => {
            let activated_wait = wait_for_device_activation_response(
                trellis_url,
                &pending_session
                    .build_wait_request(now_iat())
                    .into_diagnostic()?,
            )
            .await
            .into_diagnostic()?;
            let wait_connect_info = match activated_wait {
                WaitForDeviceActivationResponse::Activated { connect_info, .. } => connect_info,
                other => {
                    return Err(miette!(
                        "approved review wait returned unexpected status: {:?}",
                        other
                    ));
                }
            };
            assert_connect_info_value(
                &wait_connect_info,
                &provisioned.instance_id,
                &deployment_id,
                device_contract_id,
                device_contract_digest,
            )?;
            let device_client = TrellisClient::connect_device(DeviceConnectOptions {
                trellis_url,
                contract_digest: device_contract_digest,
                public_identity_key: &device_identity.public_identity_key,
                identity_seed_base64url: &device_identity.identity_seed_base64url,
                timeout_ms: 10_000,
            })
            .await
            .into_diagnostic()?;
            let device_auth = SdkAuthClient::new(&device_client);
            let me = device_auth.auth_sessions_me().await.into_diagnostic()?;
            if me.participant_kind != json!("device") {
                return Err(miette!(
                    "approved device Auth.Sessions.Me returned participant kind `{}`",
                    me.participant_kind
                ));
            }
        }
        ReviewDecision::Reject => {
            let rejected_wait = wait_for_device_activation_response(
                trellis_url,
                &pending_session
                    .build_wait_request(now_iat())
                    .into_diagnostic()?,
            )
            .await
            .into_diagnostic()?;
            if !matches!(
                rejected_wait,
                WaitForDeviceActivationResponse::Rejected { .. }
            ) {
                return Err(miette!(
                    "rejected review wait returned unexpected status: {:?}",
                    rejected_wait
                ));
            }
            if get_device_connect_info(GetDeviceConnectInfoOpts {
                trellis_url,
                public_identity_key: &device_identity.public_identity_key,
                identity_seed_base64url: &device_identity.identity_seed_base64url,
                contract_digest: device_contract_digest,
                iat: now_iat(),
            })
            .await
            .is_ok()
            {
                return Err(miette!(
                    "rejected device unexpectedly received connect info"
                ));
            }
            if TrellisClient::connect_device(DeviceConnectOptions {
                trellis_url,
                contract_digest: device_contract_digest,
                public_identity_key: &device_identity.public_identity_key,
                identity_seed_base64url: &device_identity.identity_seed_base64url,
                timeout_ms: 10_000,
            })
            .await
            .is_ok()
            {
                return Err(miette!("rejected device unexpectedly connected"));
            }
        }
    }

    Ok(())
}

async fn wait_for_pending_review(
    operation_ref: &trellis_client::OperationRef<
        '_,
        TrellisClient,
        AuthDeviceUserAuthoritiesResolveOperation,
    >,
) -> Result<String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let snapshot = operation_ref.get().await.into_diagnostic()?;
        if let Some(progress) = snapshot.progress {
            if progress.status == "pending_review" {
                return Ok(progress.review_id);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!(
                "Auth.DeviceUserAuthorities.Resolve did not report pending review"
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

async fn assert_device_undeclared_access_denied(
    device_auth: &SdkAuthClient<'_>,
    device_contract_json: &str,
    deployment_id: &str,
) -> Result<()> {
    if device_auth
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(device_contract_json)?,
            deployment_id: deployment_id.to_string(),
            expected_digest: digest_contract_json(device_contract_json).into_diagnostic()?,
        })
        .await
        .is_ok()
    {
        return Err(miette!(
            "activated device unexpectedly expanded an envelope without declared access"
        ));
    }
    Ok(())
}

fn device_activation_admin_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-device-activation-agent@v1",
        "Trellis Integration Device Activation Agent",
        "Verify known-device activation through public/admin APIs.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1")
            .with_rpc_call([
                "Auth.Deployments.Create",
                "Auth.Envelopes.Expand",
                "Auth.Devices.Provision",
                "Auth.DeviceUserAuthorities.List",
                "Auth.DeviceUserAuthorities.Reviews.Decide",
                "Auth.DeviceUserAuthorities.Reviews.List",
                "Auth.Sessions.Me",
            ])
            .with_operation_call(["Auth.DeviceUserAuthorities.Resolve"]),
    )
    .build()
    .map_err(|error| miette!("failed to build device activation agent contract: {error}"))?;

    to_string(&manifest)
        .map_err(|error| miette!("failed to serialize device activation agent contract: {error}"))
}

fn device_contract_json(contract_id: &str) -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Device",
        "Device contract used by the live activation integration fixture.",
        ContractKind::Device,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Me"]),
    )
    .use_ref(
        "health",
        use_contract("trellis.health@v1").with_event_publish(["Health.Heartbeat"]),
    )
    .build()
    .map_err(|error| miette!("failed to build device contract: {error}"))?;

    to_string(&manifest).map_err(|error| miette!("failed to serialize device contract: {error}"))
}

fn assert_connect_info_value(
    value: &Value,
    instance_id: &str,
    deployment_id: &str,
    contract_id: &str,
    contract_digest: &str,
) -> Result<()> {
    assert_value_field(value, "instanceId", instance_id)?;
    assert_value_field(value, "deploymentId", deployment_id)?;
    assert_value_field(value, "contractId", contract_id)?;
    assert_value_field(value, "contractDigest", contract_digest)?;
    assert_value_field(&value["auth"], "mode", "device_identity")?;
    if value["transports"]["native"]["natsServers"]
        .as_array()
        .is_none_or(Vec::is_empty)
    {
        return Err(miette!(
            "device wait connectInfo did not include native NATS servers"
        ));
    }
    Ok(())
}

fn assert_value_field(value: &Value, field: &str, expected: &str) -> Result<()> {
    match value.get(field).and_then(Value::as_str) {
        Some(actual) if actual == expected => Ok(()),
        Some(actual) => Err(miette!(
            "device connectInfo field `{field}` was `{actual}`, expected `{expected}`"
        )),
        None => Err(miette!("device connectInfo missing string field `{field}`")),
    }
}

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse contract JSON: {error}"))
}

fn device_root_secret() -> [u8; 32] {
    let suffix = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed).to_be_bytes();
    let mut secret = [0x42; 32];
    secret[..8].copy_from_slice(&suffix);
    secret
}

fn now_iat() -> u64 {
    u64::try_from(OffsetDateTime::now_utc().unix_timestamp()).unwrap_or_default()
}

fn stale_iat() -> u64 {
    now_iat().saturating_sub(3_600)
}

fn unique_suffix() -> String {
    let timestamp = OffsetDateTime::now_utc().unix_timestamp_nanos();
    let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{timestamp}-{counter}")
}
