use std::collections::BTreeMap;

use miette::{miette, IntoDiagnostic, Result};
use serde_json::{json, to_string, Value};
use trellis_auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_contracts::{digest_contract_json, ContractKind, ContractManifestBuilder};
use trellis_sdk_auth::{
    AuthClient as SdkAuthClient, AuthDeploymentsCreateRequest, AuthDeploymentsListRequest,
    AuthDevicesListRequest, AuthDevicesProvisionRequest, AuthEnvelopesExpandRequest,
    AuthEnvelopesGetRequest, AuthEnvelopesListRequest, AuthServiceInstancesListRequest,
    AuthServiceInstancesProvisionRequest, AuthSessionsMeRequest,
};
use trellis_sdk_core::{CoreClient, TrellisCatalogRequest, TrellisContractGetRequest};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};

const ADMIN_API_PASSING_CASES: usize = 13;

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

    let me = auth_client
        .auth_sessions_me(&AuthSessionsMeRequest(BTreeMap::new()))
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

    let suffix = unique_suffix();
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

    let catalog = core_client
        .trellis_catalog(&TrellisCatalogRequest(BTreeMap::new()))
        .await
        .into_diagnostic()?;
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
