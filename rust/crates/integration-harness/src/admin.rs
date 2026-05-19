use std::collections::BTreeMap;

use bytes::Bytes;
use miette::{miette, IntoDiagnostic, Result};
use serde_json::{json, to_string, Value};
use trellis_auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_contracts::{digest_contract_json, ContractKind, ContractManifestBuilder};
use trellis_sdk_auth::{
    AuthCapabilitiesListRequest, AuthCapabilityGroupsDeleteRequest, AuthCapabilityGroupsGetRequest,
    AuthCapabilityGroupsListRequest, AuthCapabilityGroupsPutRequest, AuthClient as SdkAuthClient,
    AuthConnectionsListRequest, AuthDeploymentsCreateRequest, AuthDeploymentsListRequest,
    AuthDevicesListRequest, AuthDevicesProvisionRequest, AuthEnvelopesExpandRequest,
    AuthEnvelopesGetRequest, AuthEnvelopesListRequest, AuthIdentitiesGrantsListRequest,
    AuthIdentitiesListRequest, AuthPortalsLoginSettingsGetRequest, AuthServiceInstancesListRequest,
    AuthServiceInstancesProvisionRequest, AuthSessionsListRequest, AuthUserIdentitiesListRequest,
    AuthUsersGetRequest, AuthUsersListRequest, AuthUsersUpdateRequest,
};
use trellis_sdk_core::{CoreClient, TrellisContractGetRequest, TrellisSurfaceStatusRequest};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};

const ADMIN_API_PASSING_CASES: usize = 32;
const AUTH_ADMIN_TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const AUTH_ADMIN_TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

pub(crate) async fn run_admin_api_fixture(
    _trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = SdkAuthClient::new(&admin_client);
    let core_client = CoreClient::new(&admin_client);

    let me = auth_client.auth_sessions_me().await.into_diagnostic()?;
    let user_id = value_string(&me.user, "userId")?;
    if user_id != setup_login.user.user_id {
        return Err(miette!(
            "Auth.Sessions.Me returned userId `{user_id}`, expected `{}`",
            setup_login.user.user_id
        ));
    }
    if me.participant_kind != json!("agent") {
        return Err(miette!(
            "Auth.Sessions.Me returned participantKind `{}` instead of agent",
            me.participant_kind
        ));
    }
    assert_traced_auth_sessions_me(&admin_client, &setup_login.user.user_id).await?;

    let suffix = unique_suffix();
    assert_traced_auth_users_get_error(&admin_client, &format!("missing-user-{suffix}")).await?;

    let health = auth_client.auth_health().await.into_diagnostic()?;
    if health.service != "trellis-auth" && health.service != "trellis" {
        return Err(miette!(
            "Auth.Health returned unexpected service `{}`",
            health.service
        ));
    }

    let capabilities = auth_client
        .auth_capabilities_list(&AuthCapabilitiesListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !capabilities
        .capabilities
        .iter()
        .any(|capability| capability.key == "admin")
    {
        return Err(miette!("Auth.Capabilities.List did not include `admin`"));
    }

    let group_key = format!("harness.builtin-rpc.{suffix}");
    let put_group = auth_client
        .auth_capability_groups_put(&AuthCapabilityGroupsPutRequest {
            group_key: group_key.clone(),
            display_name: "Harness Built-In RPC Group".to_string(),
            description: "Created by live built-in RPC matrix coverage.".to_string(),
            capabilities: Some(vec!["admin".to_string()]),
            included_groups: None,
        })
        .await
        .into_diagnostic()?;
    if put_group.group.group_key != group_key || put_group.group.capabilities != ["admin"] {
        return Err(miette!(
            "Auth.CapabilityGroups.Put returned unexpected group"
        ));
    }
    let got_group = auth_client
        .auth_capability_groups_get(&AuthCapabilityGroupsGetRequest {
            group_key: group_key.clone(),
        })
        .await
        .into_diagnostic()?;
    if got_group.group.group_key != group_key {
        return Err(miette!("Auth.CapabilityGroups.Get returned wrong group"));
    }
    let groups = auth_client
        .auth_capability_groups_list(&AuthCapabilityGroupsListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !groups
        .groups
        .iter()
        .any(|group| group.group_key == group_key)
    {
        return Err(miette!(
            "Auth.CapabilityGroups.List did not include created group"
        ));
    }
    let deleted_group = auth_client
        .auth_capability_groups_delete(&AuthCapabilityGroupsDeleteRequest {
            group_key: group_key.clone(),
        })
        .await
        .into_diagnostic()?;
    if !deleted_group.success {
        return Err(miette!("Auth.CapabilityGroups.Delete did not succeed"));
    }

    let users = auth_client
        .auth_users_list(&AuthUsersListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !users.users.iter().any(|user| user.user_id == user_id) {
        return Err(miette!("Auth.Users.List did not include admin user"));
    }
    let user = auth_client
        .auth_users_get(&AuthUsersGetRequest {
            user_id: user_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if user.user.user_id != user_id {
        return Err(miette!("Auth.Users.Get returned wrong user"));
    }
    let updated_user = auth_client
        .auth_users_update(&AuthUsersUpdateRequest {
            user_id: user_id.clone(),
            active: None,
            capabilities: None,
            capability_groups: None,
            email: None,
            name: Some(setup_login.user.name.clone()),
        })
        .await
        .into_diagnostic()?;
    if !updated_user.success {
        return Err(miette!("Auth.Users.Update did not succeed"));
    }

    let identities = auth_client
        .auth_user_identities_list(&AuthUserIdentitiesListRequest {
            user_id: user_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if !identities
        .identities
        .iter()
        .any(|identity| identity.subject == "admin")
    {
        return Err(miette!(
            "Auth.UserIdentities.List did not include admin identity"
        ));
    }
    auth_client
        .auth_identities_list(&AuthIdentitiesListRequest {
            user: Some(user_id.clone()),
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    auth_client
        .auth_identities_grants_list(&AuthIdentitiesGrantsListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;

    let sessions = auth_client
        .auth_sessions_list(&AuthSessionsListRequest {
            user: Some(user_id.clone()),
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !sessions.sessions.iter().any(|session| {
        matches!(
            value_string(session, "sessionKey"),
            Ok(session_key) if session_key == setup_login.state.session_key
        )
    }) {
        return Err(miette!("Auth.Sessions.List did not include admin session"));
    }
    auth_client
        .auth_connections_list(&AuthConnectionsListRequest {
            user: Some(user_id.clone()),
            session_key: None,
        })
        .await
        .into_diagnostic()?;

    let portals = auth_client.auth_portals_list().await.into_diagnostic()?;
    let default_portal = portals
        .portals
        .iter()
        .find(|portal| portal.built_in)
        .ok_or_else(|| miette!("Auth.Portals.List did not include built-in portal"))?;
    let settings = auth_client
        .auth_portals_login_settings_get(&AuthPortalsLoginSettingsGetRequest {
            portal_id: default_portal.portal_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if settings.portal.portal_id != default_portal.portal_id {
        return Err(miette!(
            "Auth.Portals.LoginSettings.Get returned wrong portal"
        ));
    }
    auth_client
        .auth_portals_login_routes_list()
        .await
        .into_diagnostic()?;

    let service_deployment_id = format!("harness-admin-service-{suffix}");
    let device_deployment_id = format!("harness-admin-device-{suffix}");
    auth_client
        .auth_deployments_create(&AuthDeploymentsCreateRequest(json!({
            "kind": "service",
            "deploymentId": service_deployment_id,
            "namespaces": ["harness-admin"],
        })))
        .await
        .into_diagnostic()?;
    auth_client
        .auth_deployments_create(&AuthDeploymentsCreateRequest(json!({
            "kind": "device",
            "deploymentId": device_deployment_id,
        })))
        .await
        .into_diagnostic()?;

    let deployments = auth_client
        .auth_deployments_list(&AuthDeploymentsListRequest {
            disabled: None,
            kind: None,
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    assert_value_list_has_deployment(&deployments.deployments, &service_deployment_id)?;
    assert_value_list_has_deployment(&deployments.deployments, &device_deployment_id)?;

    let service_contract_id = format!("trellis.integration-admin-service-{suffix}@v1");
    let service_contract_json = service_contract_json(&service_contract_id)?;
    let service_contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let expanded = auth_client
        .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&service_contract_json)?,
            deployment_id: service_deployment_id.clone(),
            expected_digest: service_contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;
    if expanded.contract_evidence.contract_id != service_contract_id
        || expanded.contract_evidence.contract_digest != service_contract_digest
        || expanded.contract_evidence.deployment_id != service_deployment_id
    {
        return Err(miette!(
            "Auth.Envelopes.Expand returned unexpected contract evidence"
        ));
    }

    let envelopes = auth_client
        .auth_envelopes_list(&AuthEnvelopesListRequest {
            disabled: None,
            kind: None,
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !envelopes
        .envelopes
        .iter()
        .any(|envelope| envelope.deployment_id == service_deployment_id)
    {
        return Err(miette!(
            "Auth.Envelopes.List did not include `{service_deployment_id}`"
        ));
    }

    let envelope = auth_client
        .auth_envelopes_get(&AuthEnvelopesGetRequest {
            deployment_id: service_deployment_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if !envelope.contract_evidence.iter().any(|evidence| {
        evidence.contract_id == service_contract_id
            && evidence.contract_digest == service_contract_digest
            && evidence.deployment_id == service_deployment_id
    }) {
        return Err(miette!(
            "Auth.Envelopes.Get did not include expanded contract evidence"
        ));
    }

    let (_service_seed, service_key) = generate_session_keypair();
    let service_instance = auth_client
        .auth_service_instances_provision(&AuthServiceInstancesProvisionRequest {
            deployment_id: service_deployment_id.clone(),
            instance_key: service_key.clone(),
        })
        .await
        .into_diagnostic()?
        .instance;
    let service_instances = auth_client
        .auth_service_instances_list(&AuthServiceInstancesListRequest {
            deployment_id: Some(service_deployment_id.clone()),
            disabled: None,
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !service_instances.instances.iter().any(|instance| {
        instance.instance_id == service_instance.instance_id && instance.instance_key == service_key
    }) {
        return Err(miette!(
            "Auth.ServiceInstances.List did not include provisioned instance"
        ));
    }

    let (_device_seed, device_public_identity_key) = generate_session_keypair();
    let (_activation_seed, activation_key) = generate_session_keypair();
    let device_instance = auth_client
        .auth_devices_provision(&AuthDevicesProvisionRequest {
            deployment_id: device_deployment_id.clone(),
            public_identity_key: device_public_identity_key.clone(),
            activation_key,
            metadata: None,
        })
        .await
        .into_diagnostic()?
        .instance;
    let device_instances = auth_client
        .auth_devices_list(&AuthDevicesListRequest {
            deployment_id: Some(device_deployment_id.clone()),
            limit: 100,
            offset: None,
            state: None,
        })
        .await
        .into_diagnostic()?;
    if !device_instances.instances.iter().any(|instance| {
        instance.instance_id == device_instance.instance_id
            && instance.public_identity_key == device_public_identity_key
    }) {
        return Err(miette!(
            "Auth.Devices.List did not include provisioned device"
        ));
    }

    let catalog = core_client.trellis_catalog().await.into_diagnostic()?;
    if !catalog.catalog.contracts.iter().any(|contract| {
        contract.id == service_contract_id && contract.digest == service_contract_digest
    }) {
        return Err(miette!(
            "Trellis.Catalog did not include expanded contract `{service_contract_id}`"
        ));
    }
    let contract = core_client
        .trellis_contract_get(&TrellisContractGetRequest {
            digest: service_contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;
    if contract.contract.id != service_contract_id {
        return Err(miette!(
            "Trellis.Contract.Get returned `{}` instead of `{service_contract_id}`",
            contract.contract.id
        ));
    }
    let surface_status = core_client
        .trellis_surface_status(&TrellisSurfaceStatusRequest {
            contract_id: "trellis.core@v1".to_string(),
            kind: json!("rpc"),
            surface: "Trellis.Catalog".to_string(),
            action: Some(json!("call")),
        })
        .await
        .into_diagnostic()?;
    if surface_status.status.get("state") != Some(&json!("unavailable"))
        || surface_status.status.get("reason") != Some(&json!("envelope_unavailable"))
    {
        return Err(miette!(
            "Trellis.Surface.Status returned unexpected status {}",
            surface_status.status
        ));
    }

    Ok(ADMIN_API_PASSING_CASES)
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis_auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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
            challenge
                .complete(&admin_login.state.trellis_url)
                .await
                .into_diagnostic()
        }
    }
}

fn service_contract_json(contract_id: &str) -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Admin Service",
        "Contract expanded by the direct primary admin/public API integration fixture.",
        ContractKind::Service,
    )
    .build()
    .map_err(|error| miette!("failed to build admin API service contract: {error}"))?;

    to_string(&manifest)
        .map_err(|error| miette!("failed to serialize admin API service contract: {error}"))
}

fn assert_value_list_has_deployment(deployments: &[Value], deployment_id: &str) -> Result<()> {
    if deployments.iter().any(|deployment| {
        matches!(
            value_string(deployment, "deploymentId"),
            Ok(id) if id == deployment_id
        )
    }) {
        return Ok(());
    }

    Err(miette!(
        "Auth.Deployments.List did not include `{deployment_id}`"
    ))
}

fn value_string(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| miette!("expected object field `{key}` to be a string in {value}"))
}

async fn assert_traced_auth_sessions_me(
    client: &trellis_client::TrellisClient,
    expected_user_id: &str,
) -> Result<()> {
    let response = raw_traced_admin_rpc(client, "rpc.v1.Auth.Sessions.Me", json!({})).await?;
    if response
        .headers
        .as_ref()
        .and_then(|headers| headers.get("status"))
        .is_some_and(|status| status.as_str() == "error")
    {
        return Err(miette!(
            "traced Auth.Sessions.Me returned error: {}",
            String::from_utf8_lossy(&response.payload)
        ));
    }

    let body: Value = serde_json::from_slice(&response.payload)
        .map_err(|error| miette!("failed to decode traced Auth.Sessions.Me response: {error}"))?;
    let user = body
        .get("user")
        .ok_or_else(|| miette!("traced Auth.Sessions.Me response missing user: {body}"))?;
    let user_id = value_string(user, "userId")?;
    if user_id != expected_user_id || body.get("participantKind") != Some(&json!("agent")) {
        return Err(miette!(
            "traced Auth.Sessions.Me returned unexpected body {body}"
        ));
    }
    Ok(())
}

async fn assert_traced_auth_users_get_error(
    client: &trellis_client::TrellisClient,
    missing_user_id: &str,
) -> Result<()> {
    let response = raw_traced_admin_rpc(
        client,
        "rpc.v1.Auth.Users.Get",
        json!({ "userId": missing_user_id }),
    )
    .await?;
    let status = response
        .headers
        .as_ref()
        .and_then(|headers| headers.get("status"))
        .map(async_nats::HeaderValue::as_str);
    if status != Some("error") {
        return Err(miette!(
            "traced Auth.Users.Get missing-user request returned status {:?} and payload {}",
            status,
            String::from_utf8_lossy(&response.payload)
        ));
    }

    let error: Value = serde_json::from_slice(&response.payload)
        .map_err(|error| miette!("failed to decode traced Auth.Users.Get error: {error}"))?;
    if error.get("type") != Some(&json!("AuthError"))
        || error.get("reason") != Some(&json!("user_not_found"))
        || error.get("traceId") != Some(&json!(AUTH_ADMIN_TRACE_ID))
    {
        return Err(miette!(
            "traced Auth.Users.Get returned unexpected error payload {error}"
        ));
    }
    Ok(())
}

async fn raw_traced_admin_rpc(
    client: &trellis_client::TrellisClient,
    subject: &str,
    body: Value,
) -> Result<async_nats::Message> {
    let payload = Bytes::from(serde_json::to_vec(&body).into_diagnostic()?);
    let proof = client.auth().create_proof(subject, &payload);
    let mut headers = async_nats::HeaderMap::new();
    headers.insert("session-key", client.auth().session_key.as_str());
    headers.insert("proof", proof.as_str());
    headers.insert("traceparent", AUTH_ADMIN_TRACEPARENT);
    headers.insert("tracestate", "harness=auth-admin");
    client
        .nats()
        .request_with_headers(subject.to_string(), headers, payload)
        .await
        .into_diagnostic()
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse admin API contract JSON: {error}"))
}
