use std::collections::BTreeMap;

use bytes::Bytes;
use miette::{miette, IntoDiagnostic, Result};
use serde_json::{json, to_string, Value};
use trellis::auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis::client::{ServiceConnectOptions, TrellisClient};
use trellis::contracts::{
    digest_contract_json, rpc, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis::sdk::auth::{
    AuthCapabilitiesListRequest, AuthCapabilityGroupsDeleteRequest, AuthCapabilityGroupsGetRequest,
    AuthCapabilityGroupsListRequest, AuthCapabilityGroupsPutRequest, AuthClient as SdkAuthClient,
    AuthConnectionsListRequest, AuthDeploymentsCreateRequest, AuthDeploymentsListRequest,
    AuthDevicesListRequest, AuthDevicesProvisionRequest, AuthEnvelopesExpandRequest,
    AuthEnvelopesGetRequest, AuthEnvelopesListRequest, AuthIdentitiesGrantsListRequest,
    AuthIdentitiesListRequest, AuthPortalsGetRequest, AuthPortalsListRequest,
    AuthPortalsLoginSettingsGetRequest, AuthPortalsPutRequest, AuthPortalsRemoveRequest,
    AuthPortalsRoutesPutRequest, AuthPortalsRoutesRemoveRequest, AuthServiceInstancesListRequest,
    AuthServiceInstancesProvisionRequest, AuthSessionsListRequest, AuthUserIdentitiesListRequest,
    AuthUsersGetRequest, AuthUsersListRequest, AuthUsersPasswordChangeRequest,
    AuthUsersUpdateRequest,
};
use trellis::sdk::core::{
    rpc::TrellisBindingsGetRpc, CoreClient, TrellisBindingsGetRequest, TrellisContractGetRequest,
    TrellisSurfaceStatusRequest,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};

const ADMIN_API_PASSING_CASES: usize = 40;
const PASSWORD_CHANGE_PASSING_CASES: usize = 3;
const AUTH_ADMIN_TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const AUTH_ADMIN_TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

pub(crate) async fn run_admin_api_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = SdkAuthClient::new(&admin_client);
    let core_client = CoreClient::new(&admin_client);

    let me = auth_client
        .rpc()
        .auth()
        .sessions_me()
        .await
        .into_diagnostic()?;
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

    let health = auth_client.rpc().auth().health().await.into_diagnostic()?;
    if health.service != "trellis-auth" && health.service != "trellis" {
        return Err(miette!(
            "Auth.Health returned unexpected service `{}`",
            health.service
        ));
    }

    let capabilities = auth_client
        .rpc()
        .auth()
        .capabilities_list(&AuthCapabilitiesListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !capabilities
        .entries
        .iter()
        .any(|capability| capability.key == "admin")
    {
        return Err(miette!("Auth.Capabilities.List did not include `admin`"));
    }

    let group_key = format!("harness.builtin-rpc.{suffix}");
    let put_group = auth_client
        .rpc()
        .auth()
        .capability_groups_put(&AuthCapabilityGroupsPutRequest {
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
        .rpc()
        .auth()
        .capability_groups_get(&AuthCapabilityGroupsGetRequest {
            group_key: group_key.clone(),
        })
        .await
        .into_diagnostic()?;
    if got_group.group.group_key != group_key {
        return Err(miette!("Auth.CapabilityGroups.Get returned wrong group"));
    }
    let groups = auth_client
        .rpc()
        .auth()
        .capability_groups_list(&AuthCapabilityGroupsListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !groups
        .entries
        .iter()
        .any(|group| group.group_key == group_key)
    {
        return Err(miette!(
            "Auth.CapabilityGroups.List did not include created group"
        ));
    }
    let deleted_group = auth_client
        .rpc()
        .auth()
        .capability_groups_delete(&AuthCapabilityGroupsDeleteRequest {
            group_key: group_key.clone(),
        })
        .await
        .into_diagnostic()?;
    if !deleted_group.success {
        return Err(miette!("Auth.CapabilityGroups.Delete did not succeed"));
    }

    let users = auth_client
        .rpc()
        .auth()
        .users_list(&AuthUsersListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !users.entries.iter().any(|user| user.user_id == user_id) {
        return Err(miette!("Auth.Users.List did not include admin user"));
    }
    let user = auth_client
        .rpc()
        .auth()
        .users_get(&AuthUsersGetRequest {
            user_id: user_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if user.user.user_id != user_id {
        return Err(miette!("Auth.Users.Get returned wrong user"));
    }
    let updated_user = auth_client
        .rpc()
        .auth()
        .users_update(&AuthUsersUpdateRequest {
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
        .rpc()
        .auth()
        .user_identities_list(&AuthUserIdentitiesListRequest {
            limit: 100,
            offset: None,
            user_id: user_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if !identities
        .entries
        .iter()
        .any(|identity| identity.subject == "admin")
    {
        return Err(miette!(
            "Auth.UserIdentities.List did not include admin identity"
        ));
    }
    auth_client
        .rpc()
        .auth()
        .identities_list(&AuthIdentitiesListRequest {
            user: Some(user_id.clone()),
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    auth_client
        .rpc()
        .auth()
        .identities_grants_list(&AuthIdentitiesGrantsListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;

    let sessions = auth_client
        .rpc()
        .auth()
        .sessions_list(&AuthSessionsListRequest {
            user: Some(user_id.clone()),
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !sessions.entries.iter().any(|session| {
        matches!(
            value_string(session, "sessionKey"),
            Ok(session_key) if session_key == setup_login.state.session_key
        )
    }) {
        return Err(miette!("Auth.Sessions.List did not include admin session"));
    }
    auth_client
        .rpc()
        .auth()
        .connections_list(&AuthConnectionsListRequest {
            limit: 100,
            offset: None,
            session_key: None,
            user: Some(user_id.clone()),
        })
        .await
        .into_diagnostic()?;

    let portals = auth_client
        .rpc()
        .auth()
        .portals_list(&AuthPortalsListRequest {
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    let default_portal = portals
        .entries
        .iter()
        .find(|portal| portal.built_in)
        .ok_or_else(|| miette!("Auth.Portals.List did not include built-in portal"))?;
    let settings = auth_client
        .rpc()
        .auth()
        .portals_login_settings_get(&AuthPortalsLoginSettingsGetRequest {
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
        .rpc()
        .auth()
        .portals_get(&AuthPortalsGetRequest {
            portal_id: default_portal.portal_id.clone(),
        })
        .await
        .into_diagnostic()?;
    assert_external_portal_origin_hardening(trellis_url, &auth_client, suffix).await?;

    let service_deployment_id = format!("harness-admin-service-{suffix}");
    let device_deployment_id = format!("harness-admin-device-{suffix}");
    auth_client
        .rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "kind": "service",
            "deploymentId": service_deployment_id,
            "namespaces": ["harness-admin"],
        })))
        .await
        .into_diagnostic()?;
    auth_client
        .rpc()
        .auth()
        .deployments_create(&AuthDeploymentsCreateRequest(json!({
            "kind": "device",
            "deploymentId": device_deployment_id,
        })))
        .await
        .into_diagnostic()?;

    let deployments = auth_client
        .rpc()
        .auth()
        .deployments_list(&AuthDeploymentsListRequest {
            disabled: None,
            kind: None,
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    assert_value_list_has_deployment(&deployments.entries, &service_deployment_id)?;
    assert_value_list_has_deployment(&deployments.entries, &device_deployment_id)?;

    let service_contract_id = format!("trellis.integration-admin-service-{suffix}@v1");
    let service_contract_json = service_contract_json(&service_contract_id)?;
    let service_contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let device_contract_id = format!("trellis.integration-admin-device-{suffix}@v1");
    let device_contract_json = device_contract_json(&device_contract_id)?;
    let device_contract_digest = digest_contract_json(&device_contract_json).into_diagnostic()?;
    let expanded = auth_client
        .rpc()
        .auth()
        .envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&service_contract_json)?,
            deployment_id: service_deployment_id.clone(),
            expected_digest: service_contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;
    if expanded.envelope.deployment_id != service_deployment_id {
        return Err(miette!(
            "Auth.Envelopes.Expand returned envelope for unexpected deployment `{}`",
            expanded.envelope.deployment_id
        ));
    }
    if !expanded.contract_history.iter().any(|entry| {
        entry.scope_id == service_deployment_id
            && entry.source.contract_id.as_deref() == Some(service_contract_id.as_str())
            && entry.source.contract_digest.as_deref() == Some(service_contract_digest.as_str())
    }) {
        return Err(miette!(
            "Auth.Envelopes.Expand contract history did not identify expanded service contract `{service_contract_id}`"
        ));
    }
    auth_client
        .rpc()
        .auth()
        .envelopes_expand(&AuthEnvelopesExpandRequest {
            contract: contract_json_object(&device_contract_json)?,
            deployment_id: device_deployment_id.clone(),
            expected_digest: device_contract_digest.clone(),
        })
        .await
        .into_diagnostic()?;

    let envelopes = auth_client
        .rpc()
        .auth()
        .envelopes_list(&AuthEnvelopesListRequest {
            disabled: None,
            kind: None,
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !envelopes
        .entries
        .iter()
        .any(|envelope| envelope.deployment_id == service_deployment_id)
    {
        return Err(miette!(
            "Auth.Envelopes.List did not include `{service_deployment_id}`"
        ));
    }

    let envelope = auth_client
        .rpc()
        .auth()
        .envelopes_get(&AuthEnvelopesGetRequest {
            deployment_id: service_deployment_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if !envelope.contract_history.iter().any(|entry| {
        entry.scope_id == service_deployment_id
            && entry.source.contract_id.as_deref() == Some(service_contract_id.as_str())
            && entry.source.contract_digest.as_deref() == Some(service_contract_digest.as_str())
    }) {
        return Err(miette!(
            "Auth.Envelopes.Get contract history did not identify expanded service contract `{service_contract_id}`"
        ));
    }
    if envelope.implementation_offers.iter().any(|offer| {
        offer.deployment_id == service_deployment_id
            && offer.contract_id == service_contract_id
            && offer.contract_digest == service_contract_digest
            && offer.status == "accepted"
    }) {
        return Err(miette!(
            "Auth.Envelopes.Get included an accepted service offer before service bootstrap for `{service_contract_id}`"
        ));
    }
    let cold_catalog = core_client
        .rpc()
        .trellis()
        .catalog()
        .await
        .into_diagnostic()?;
    if cold_catalog.catalog.contracts.iter().any(|contract| {
        contract.id == service_contract_id && contract.digest == service_contract_digest
    }) {
        return Err(miette!(
            "Trellis.Catalog included cold expanded contract `{service_contract_id}`"
        ));
    }

    let (service_seed, service_key) = generate_session_keypair();
    let service_instance = auth_client
        .rpc()
        .auth()
        .service_instances_provision(&AuthServiceInstancesProvisionRequest {
            deployment_id: service_deployment_id.clone(),
            instance_key: service_key.clone(),
        })
        .await
        .into_diagnostic()?
        .instance;
    let service_instances = auth_client
        .rpc()
        .auth()
        .service_instances_list(&AuthServiceInstancesListRequest {
            deployment_id: Some(service_deployment_id.clone()),
            disabled: None,
            limit: 100,
            offset: None,
        })
        .await
        .into_diagnostic()?;
    if !service_instances.entries.iter().any(|instance| {
        instance.instance_id == service_instance.instance_id && instance.instance_key == service_key
    }) {
        return Err(miette!(
            "Auth.ServiceInstances.List did not include provisioned instance"
        ));
    }
    assert_trellis_bindings_get(
        trellis_url,
        &service_contract_id,
        &service_contract_digest,
        &service_seed,
    )
    .await?;
    let envelope_after_service_bootstrap = auth_client
        .rpc()
        .auth()
        .envelopes_get(&AuthEnvelopesGetRequest {
            deployment_id: service_deployment_id.clone(),
        })
        .await
        .into_diagnostic()?;
    if !envelope_after_service_bootstrap
        .implementation_offers
        .iter()
        .any(|offer| {
            offer.deployment_id == service_deployment_id
                && offer.contract_id == service_contract_id
                && offer.contract_digest == service_contract_digest
                && offer.deployment_kind == "service"
                && offer.status == "accepted"
        })
    {
        return Err(miette!(
            "Auth.Envelopes.Get implementation offers did not include accepted service offer for `{service_contract_id}` after service bootstrap"
        ));
    }
    let active_catalog = core_client
        .rpc()
        .trellis()
        .catalog()
        .await
        .into_diagnostic()?;
    if !active_catalog.catalog.contracts.iter().any(|contract| {
        contract.id == service_contract_id && contract.digest == service_contract_digest
    }) {
        return Err(miette!(
            "Trellis.Catalog did not include active service implementation `{service_contract_id}` after service bootstrap"
        ));
    }

    let (_device_seed, device_public_identity_key) = generate_session_keypair();
    let (_activation_seed, activation_key) = generate_session_keypair();
    let device_instance = auth_client
        .rpc()
        .auth()
        .devices_provision(&AuthDevicesProvisionRequest {
            deployment_id: device_deployment_id.clone(),
            public_identity_key: device_public_identity_key.clone(),
            activation_key,
            metadata: None,
        })
        .await
        .into_diagnostic()?
        .instance;
    let device_instances = auth_client
        .rpc()
        .auth()
        .devices_list(&AuthDevicesListRequest {
            deployment_id: Some(device_deployment_id.clone()),
            limit: 100,
            offset: None,
            state: None,
        })
        .await
        .into_diagnostic()?;
    if !device_instances.entries.iter().any(|instance| {
        instance.instance_id == device_instance.instance_id
            && instance.public_identity_key == device_public_identity_key
    }) {
        return Err(miette!(
            "Auth.Devices.List did not include provisioned device"
        ));
    }
    assert_trellis_surface_status_unavailable(
        &core_client,
        &device_contract_id,
        "Harness.Admin.Device.Ping",
    )
    .await?;

    let contract = core_client
        .rpc()
        .trellis()
        .contract_get(&TrellisContractGetRequest {
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
        .rpc()
        .trellis()
        .surface_status(&TrellisSurfaceStatusRequest {
            contract_id: "trellis.core@v1".to_string(),
            kind: "rpc".to_string(),
            surface: "Trellis.Catalog".to_string(),
            action: Some("call".to_string()),
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

pub(crate) async fn run_password_change_fixture(admin_login: &AdminLoginOutcome) -> Result<usize> {
    let admin_client = connect_admin_client_async(&admin_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = SdkAuthClient::new(&admin_client);

    match auth_client
        .rpc()
        .auth()
        .users_password_change(&AuthUsersPasswordChangeRequest {
            current_password: "not-the-admin-password".to_string(),
            new_password: "temporary-admin-password".to_string(),
        })
        .await
    {
        Ok(_) => {
            return Err(miette!(
                "Auth.Users.Password.Change accepted the wrong password"
            ))
        }
        Err(trellis::client::TrellisClientError::RpcError(payload)) => {
            assert_password_change_error(
                &payload,
                "invalid_request",
                "Current password is incorrect.",
            )?;
        }
        Err(error) => {
            return Err(miette!(
                "Auth.Users.Password.Change wrong-password returned non-RPC error: {error}"
            ));
        }
    }

    let changed = auth_client
        .rpc()
        .auth()
        .users_password_change(&AuthUsersPasswordChangeRequest {
            current_password: "trellis-admin-password".to_string(),
            new_password: "temporary-admin-password".to_string(),
        })
        .await
        .into_diagnostic()?;
    if !changed.success {
        return Err(miette!("Auth.Users.Password.Change did not report success"));
    }

    let restored = auth_client
        .rpc()
        .auth()
        .users_password_change(&AuthUsersPasswordChangeRequest {
            current_password: "temporary-admin-password".to_string(),
            new_password: "trellis-admin-password".to_string(),
        })
        .await
        .into_diagnostic()?;
    if !restored.success {
        return Err(miette!(
            "Auth.Users.Password.Change did not restore the admin password"
        ));
    }

    Ok(PASSWORD_CHANGE_PASSING_CASES)
}

fn assert_password_change_error(
    payload: &trellis::client::RpcErrorPayload,
    expected_reason: &str,
    expected_message: &str,
) -> Result<()> {
    let Some(value) = payload.value() else {
        return Err(miette!(
            "Auth.Users.Password.Change returned unstructured error: {}",
            payload.raw()
        ));
    };
    let message = value
        .get("context")
        .and_then(|context| context.get("message"))
        .and_then(Value::as_str);
    if payload.error_type() != Some("AuthError")
        || value.get("reason") != Some(&json!(expected_reason))
        || message != Some(expected_message)
    {
        return Err(miette!(
            "Auth.Users.Password.Change returned unexpected error payload {}",
            payload.raw()
        ));
    }
    Ok(())
}

async fn assert_external_portal_origin_hardening(
    trellis_url: &str,
    auth_client: &SdkAuthClient<'_>,
    suffix: u128,
) -> Result<()> {
    let portal_id = format!("harness.portal.{suffix}");
    let allowed_origin = format!("https://portal-{suffix}.example.test");
    auth_client
        .rpc()
        .auth()
        .portals_put(&AuthPortalsPutRequest {
            portal_id: portal_id.clone(),
            display_name: "Harness External Portal".to_string(),
            entry_url: format!("{allowed_origin}/login"),
            disabled: Some(false),
        })
        .await
        .into_diagnostic()?;
    auth_client
        .rpc()
        .auth()
        .portals_routes_put(&AuthPortalsRoutesPutRequest {
            portal_id: portal_id.clone(),
            contract_id: Some(json!("trellis.integration-agent@v1")),
            origin: None,
            disabled: Some(false),
        })
        .await
        .into_diagnostic()?;

    let result = assert_live_flow_origin(trellis_url, &allowed_origin).await;
    let remove_route = auth_client
        .rpc()
        .auth()
        .portals_routes_remove(&AuthPortalsRoutesRemoveRequest {
            portal_id: portal_id.clone(),
            contract_id: Some(json!("trellis.integration-agent@v1")),
            origin: None,
        })
        .await
        .into_diagnostic();
    let remove_portal = auth_client
        .rpc()
        .auth()
        .portals_remove(&AuthPortalsRemoveRequest {
            portal_id: portal_id.clone(),
        })
        .await
        .into_diagnostic();
    result?;
    if !remove_route?.success {
        return Err(miette!("Auth.Portals.Routes.Remove did not succeed"));
    }
    if !remove_portal?.success {
        return Err(miette!("Auth.Portals.Remove did not succeed"));
    }
    Ok(())
}

async fn assert_live_flow_origin(trellis_url: &str, allowed_origin: &str) -> Result<()> {
    let contract_json = admin_setup_contract_json()?;
    let challenge = trellis::auth::start_agent_login(&trellis::auth::StartAgentLoginOpts {
        trellis_url,
        contract_json: &contract_json,
    })
    .await
    .into_diagnostic()?;
    let flow_id = flow_id_from_login_url(challenge.login_url())?;
    let client = reqwest::Client::new();
    let flow_url = format!("{trellis_url}/auth/flow/{flow_id}");

    let allowed = client
        .get(&flow_url)
        .header("Origin", allowed_origin)
        .send()
        .await
        .into_diagnostic()?;
    if allowed.status() != reqwest::StatusCode::OK {
        return Err(miette!(
            "allowed portal Origin returned status {} instead of 200",
            allowed.status()
        ));
    }
    let allow_origin = allowed
        .headers()
        .get("access-control-allow-origin")
        .and_then(|value| value.to_str().ok());
    if allow_origin != Some(allowed_origin) {
        return Err(miette!(
            "allowed portal Origin returned Access-Control-Allow-Origin {:?}, expected {allowed_origin}",
            allow_origin
        ));
    }

    let disallowed = client
        .get(&flow_url)
        .header("Origin", "https://attacker.example.test")
        .send()
        .await
        .into_diagnostic()?;
    let status = disallowed.status();
    let body = disallowed.text().await.into_diagnostic()?;
    if status != reqwest::StatusCode::FORBIDDEN || !body.contains("portal_origin_mismatch") {
        return Err(miette!(
            "disallowed portal Origin returned status {status} and body {body:?}"
        ));
    }
    Ok(())
}

fn flow_id_from_login_url(login_url: &str) -> Result<String> {
    let flow_id = login_url
        .split('?')
        .nth(1)
        .and_then(|query| {
            query.split('&').find_map(|part| {
                let (key, value) = part.split_once('=')?;
                (key == "flowId").then_some(value)
            })
        })
        .filter(|flow_id| !flow_id.is_empty())
        .ok_or_else(|| miette!("agent login URL missing flowId: {login_url}"))?;
    Ok(flow_id.to_string())
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis::auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
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
    .use_ref(
        "core",
        use_contract("trellis.core@v1").with_rpc_call(["Trellis.Bindings.Get"]),
    )
    .build()
    .map_err(|error| miette!("failed to build admin API service contract: {error}"))?;

    to_string(&manifest)
        .map_err(|error| miette!("failed to serialize admin API service contract: {error}"))
}

fn device_contract_json(contract_id: &str) -> Result<String> {
    let ping_schema = json!({
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
    });
    let manifest = ContractManifestBuilder::new(
        contract_id,
        "Trellis Integration Admin Device",
        "Device contract used by the direct primary admin/public API integration fixture.",
        ContractKind::Device,
    )
    .schema("Ping", ping_schema)
    .rpc(
        "Harness.Admin.Device.Ping",
        rpc("v1", "rpc.v1.Harness.Admin.Device.Ping", "Ping", "Ping")
            .with_call_capabilities(std::iter::empty::<&str>())
            .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build admin API device contract: {error}"))?;

    to_string(&manifest)
        .map_err(|error| miette!("failed to serialize admin API device contract: {error}"))
}

async fn assert_trellis_surface_status_unavailable(
    core_client: &CoreClient<'_>,
    contract_id: &str,
    surface: &str,
) -> Result<()> {
    let surface_status = core_client
        .rpc()
        .trellis()
        .surface_status(&TrellisSurfaceStatusRequest {
            contract_id: contract_id.to_string(),
            kind: "rpc".to_string(),
            surface: surface.to_string(),
            action: Some("call".to_string()),
        })
        .await
        .into_diagnostic()?;
    if surface_status.status.get("state") != Some(&json!("unavailable"))
        || surface_status.status.get("reason") != Some(&json!("envelope_unavailable"))
    {
        return Err(miette!(
            "Trellis.Surface.Status returned unexpected inactive device surface status {}",
            surface_status.status
        ));
    }
    Ok(())
}

async fn assert_trellis_bindings_get(
    trellis_url: &str,
    contract_id: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<()> {
    let service_client = TrellisClient::connect_service(ServiceConnectOptions {
        trellis_url,
        contract_id,
        contract_digest,
        session_key_seed_base64url: service_seed,
        timeout_ms: 5_000,
    })
    .await
    .into_diagnostic()?;
    let response = service_client
        .call::<TrellisBindingsGetRpc>(&TrellisBindingsGetRequest {
            contract_id: Some(contract_id.to_string()),
            digest: Some(contract_digest.to_string()),
        })
        .await
        .into_diagnostic()?;
    let binding = response
        .binding
        .ok_or_else(|| miette!("Trellis.Bindings.Get did not return service binding"))?;
    if binding.contract_id != contract_id || binding.digest != contract_digest {
        return Err(miette!(
            "Trellis.Bindings.Get returned contract {} digest {}, expected {contract_id} digest {contract_digest}",
            binding.contract_id,
            binding.digest
        ));
    }
    Ok(())
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
    client: &trellis::client::TrellisClient,
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
    client: &trellis::client::TrellisClient,
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
    client: &trellis::client::TrellisClient,
    subject: &str,
    body: Value,
) -> Result<async_nats::Message> {
    let payload = Bytes::from(serde_json::to_vec(&body).into_diagnostic()?);
    let iat = current_iat();
    let request_id = format!("integration-admin-trace-{}", unique_suffix());
    let proof = client
        .auth()
        .create_proof(subject, &payload, iat, &request_id);
    let mut headers = async_nats::HeaderMap::new();
    headers.insert("session-key", client.auth().session_key.as_str());
    headers.insert("proof", proof.as_str());
    headers.insert("iat", iat.to_string().as_str());
    headers.insert("request-id", request_id.as_str());
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

fn current_iat() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse admin API contract JSON: {error}"))
}
