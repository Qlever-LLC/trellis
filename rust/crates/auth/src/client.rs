use crate::{
    AdminSessionState, ApprovalEntryRecord, AuthRequestsValidateRequest,
    AuthRequestsValidateResponse, AuthenticatedUser, ListApprovalsRequest, RevokeApprovalRequest,
    TrellisAuthError,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::BTreeMap;
use trellis_client::{RpcDescriptor, TrellisClient, UserConnectOptions};

use crate::protocol::LogoutResponse;
use trellis_sdk_auth::{
    rpc::{
        AuthCapabilitiesListRpc, AuthCapabilityGroupsListRpc, AuthDeploymentsCreateRpc,
        AuthDeploymentsDisableRpc, AuthDeploymentsEnableRpc, AuthDeploymentsListRpc,
        AuthDeploymentsRemoveRpc, AuthIdentitiesListRpc, AuthIdentityEnvelopesRevokeRpc,
        AuthSessionsListRpc, AuthSessionsMeRpc, AuthUsersCreateRpc, AuthUsersGetRpc,
        AuthUsersListRpc, AuthUsersPasswordResetCreateRpc, AuthUsersUpdateRpc, Empty,
    },
    types::{
        AuthCapabilitiesListRequest, AuthCapabilitiesListResponseEntriesItem,
        AuthCapabilityGroupsListRequest, AuthCapabilityGroupsListResponseEntriesItem,
        AuthDeploymentsCreateRequest, AuthDeploymentsDisableRequest, AuthDeploymentsEnableRequest,
        AuthDeploymentsListRequest, AuthDeploymentsRemoveRequest, AuthSessionsListRequest,
        AuthUsersCreateRequest, AuthUsersCreateResponseUser, AuthUsersGetRequest,
        AuthUsersGetResponseUser, AuthUsersListRequest, AuthUsersListResponseEntriesItem,
        AuthUsersPasswordResetCreateRequest, AuthUsersPasswordResetCreateResponse,
        AuthUsersUpdateRequest,
    },
};

const AUTH_CLIENT_LIST_LIMIT: i64 = 500;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDeploymentRecord {
    pub kind: String,
    pub deployment_id: String,
    pub namespaces: Vec<String>,
    pub disabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDeploymentRecord {
    pub kind: String,
    pub deployment_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_mode: Option<serde_json::Value>,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceDeploymentCreateRequest<'a> {
    kind: &'static str,
    deployment_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    review_mode: Option<&'a str>,
}

/// Connect an authenticated admin client from the stored session state.
pub async fn connect_admin_client_async(
    state: &AdminSessionState,
) -> Result<TrellisClient, TrellisAuthError> {
    Ok(TrellisClient::connect_user(UserConnectOptions {
        servers: &state.nats_servers,
        sentinel_jwt: &state.sentinel_jwt,
        sentinel_seed: &state.sentinel_seed,
        session_key_seed_base64url: &state.session_seed,
        contract_digest: &state.contract_digest,
        timeout_ms: 5_000,
    })
    .await?)
}

/// Thin typed client for Trellis auth/admin RPCs used by the CLI.
pub struct AuthClient<'a> {
    inner: &'a TrellisClient,
}

/// Options for removing a device deployment.
#[derive(Debug, Clone, Copy, Default)]
pub struct RemoveDeviceDeploymentOptions {
    /// Also remove dependent device instances and activation records.
    pub cascade: Option<bool>,
    /// Garbage-collect deployment contract records that are no longer referenced.
    pub purge_unused_contracts: Option<bool>,
}

/// Options for removing a service deployment.
#[derive(Debug, Clone, Copy, Default)]
pub struct RemoveServiceDeploymentOptions {
    /// Also remove dependent service instances and activation records.
    pub cascade: Option<bool>,
    /// Delete service-owned physical resource bindings before durable removal.
    pub purge_unused_contracts: Option<bool>,
}

impl<'a> AuthClient<'a> {
    /// Wrap an already-connected low-level Trellis client.
    pub fn new(inner: &'a TrellisClient) -> Self {
        Self { inner }
    }

    async fn call<Input, Output>(
        &self,
        subject: &str,
        input: &Input,
    ) -> Result<Output, TrellisAuthError>
    where
        Input: Serialize,
        Output: DeserializeOwned,
    {
        let request = serde_json::to_value(input)?;
        let response = self.inner.request_json_value(subject, &request).await?;
        Ok(serde_json::from_value(response)?)
    }

    async fn call_rpc<R>(&self, input: &R::Input) -> Result<R::Output, TrellisAuthError>
    where
        R: RpcDescriptor,
    {
        self.call(R::SUBJECT, input).await
    }

    /// Return the currently authenticated user.
    pub async fn me(&self) -> Result<AuthenticatedUser, TrellisAuthError> {
        let response = self.call_rpc::<AuthSessionsMeRpc>(&Empty {}).await?;
        let participant_kind = response
            .participant_kind
            .as_str()
            .unwrap_or("none")
            .to_string();

        match participant_kind.as_str() {
            "app" | "agent" if !response.user.is_null() => {
                Ok(serde_json::from_value(response.user)?)
            }
            _ => Err(TrellisAuthError::NotUserSession(participant_kind)),
        }
    }

    /// List stored app approval decisions.
    pub async fn list_approvals(
        &self,
        user: Option<&str>,
        digest: Option<&str>,
    ) -> Result<Vec<ApprovalEntryRecord>, TrellisAuthError> {
        let request = ListApprovalsRequest {
            limit: AUTH_CLIENT_LIST_LIMIT,
            offset: None,
            user: user.map(ToOwned::to_owned),
        };
        let approvals = self
            .call_rpc::<AuthIdentitiesListRpc>(&request)
            .await?
            .entries;
        Ok(match digest {
            Some(digest) => approvals
                .into_iter()
                .filter(|entry| entry.contract_evidence.contract_digest == digest)
                .collect(),
            None => approvals,
        })
    }

    /// Revoke one stored approval decision.
    pub async fn revoke_approval(
        &self,
        identity_envelope_id: &str,
        user: Option<&str>,
    ) -> Result<bool, TrellisAuthError> {
        let request = RevokeApprovalRequest {
            identity_envelope_id: identity_envelope_id.to_string(),
            user: user.map(ToOwned::to_owned),
        };
        Ok(self
            .call_rpc::<AuthIdentityEnvelopesRevokeRpc>(&request)
            .await?
            .success)
    }

    /// List Trellis users.
    pub async fn list_users(
        &self,
        limit: i64,
        offset: Option<i64>,
    ) -> Result<Vec<AuthUsersListResponseEntriesItem>, TrellisAuthError> {
        Ok(self
            .call_rpc::<AuthUsersListRpc>(&AuthUsersListRequest { limit, offset })
            .await?
            .entries)
    }

    /// Get one Trellis user by user ID.
    pub async fn get_user(
        &self,
        user_id: &str,
    ) -> Result<AuthUsersGetResponseUser, TrellisAuthError> {
        Ok(self
            .call_rpc::<AuthUsersGetRpc>(&AuthUsersGetRequest {
                user_id: user_id.to_string(),
            })
            .await?
            .user)
    }

    /// Create one Trellis user.
    pub async fn create_user(
        &self,
        input: &AuthUsersCreateRequest,
    ) -> Result<AuthUsersCreateResponseUser, TrellisAuthError> {
        Ok(self.call_rpc::<AuthUsersCreateRpc>(input).await?.user)
    }

    /// Update one Trellis user.
    pub async fn update_user(
        &self,
        input: &AuthUsersUpdateRequest,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self.call_rpc::<AuthUsersUpdateRpc>(input).await?.success)
    }

    /// List auth sessions.
    pub async fn list_sessions(
        &self,
        limit: i64,
        offset: Option<i64>,
        user: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, TrellisAuthError> {
        Ok(self
            .call_rpc::<AuthSessionsListRpc>(&AuthSessionsListRequest {
                limit,
                offset,
                user: user.map(ToOwned::to_owned),
            })
            .await?
            .entries)
    }

    /// List available auth capabilities.
    pub async fn list_capabilities(
        &self,
        limit: i64,
        offset: Option<i64>,
    ) -> Result<Vec<AuthCapabilitiesListResponseEntriesItem>, TrellisAuthError> {
        Ok(self
            .call_rpc::<AuthCapabilitiesListRpc>(&AuthCapabilitiesListRequest { limit, offset })
            .await?
            .entries)
    }

    /// List auth capability groups.
    pub async fn list_capability_groups(
        &self,
        limit: i64,
        offset: Option<i64>,
    ) -> Result<Vec<AuthCapabilityGroupsListResponseEntriesItem>, TrellisAuthError> {
        Ok(self
            .call_rpc::<AuthCapabilityGroupsListRpc>(&AuthCapabilityGroupsListRequest {
                limit,
                offset,
            })
            .await?
            .entries)
    }

    /// Create a local password reset flow for one Trellis user.
    pub async fn create_password_reset_flow(
        &self,
        input: &AuthUsersPasswordResetCreateRequest,
    ) -> Result<AuthUsersPasswordResetCreateResponse, TrellisAuthError> {
        self.call_rpc::<AuthUsersPasswordResetCreateRpc>(input)
            .await
    }

    /// List device deployments.
    pub async fn list_device_deployments(
        &self,
        disabled: bool,
    ) -> Result<Vec<DeviceDeploymentRecord>, TrellisAuthError> {
        let deployments = self
            .call_rpc::<AuthDeploymentsListRpc>(&AuthDeploymentsListRequest {
                disabled: if disabled { Some(true) } else { None },
                kind: Some(serde_json::json!("device")),
                limit: AUTH_CLIENT_LIST_LIMIT,
                offset: None,
            })
            .await?
            .entries;

        deployments
            .into_iter()
            .map(serde_json::from_value)
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// Create a device deployment.
    pub async fn create_device_deployment(
        &self,
        deployment_id: &str,
        review_mode: Option<&str>,
    ) -> Result<DeviceDeploymentRecord, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsCreateRpc>(&AuthDeploymentsCreateRequest(
                serde_json::to_value(DeviceDeploymentCreateRequest {
                    kind: "device",
                    deployment_id,
                    review_mode,
                })?,
            ))
            .await?;

        Ok(serde_json::from_value(response.deployment)?)
    }

    /// Disable a device deployment.
    pub async fn disable_device_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsDisableRpc>(&AuthDeploymentsDisableRequest {
                deployment_id: deployment_id.to_string(),
                kind: serde_json::json!("device"),
            })
            .await?;
        let deployment: DeviceDeploymentRecord = serde_json::from_value(response.deployment)?;
        Ok(deployment.disabled)
    }

    /// Enable a device deployment.
    pub async fn enable_device_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsEnableRpc>(&AuthDeploymentsEnableRequest {
                deployment_id: deployment_id.to_string(),
                kind: serde_json::json!("device"),
            })
            .await?;
        let deployment: DeviceDeploymentRecord = serde_json::from_value(response.deployment)?;
        Ok(!deployment.disabled)
    }

    /// Remove a device deployment.
    pub async fn remove_device_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        self.remove_device_deployment_with_options(deployment_id, None)
            .await
    }

    /// Remove a device deployment with explicit remove options.
    pub async fn remove_device_deployment_with_options(
        &self,
        deployment_id: &str,
        cascade: Option<bool>,
    ) -> Result<bool, TrellisAuthError> {
        self.remove_device_deployment_with_remove_options(
            deployment_id,
            RemoveDeviceDeploymentOptions {
                cascade,
                purge_unused_contracts: None,
            },
        )
        .await
    }

    /// Remove a device deployment with explicit remove options.
    pub async fn remove_device_deployment_with_remove_options(
        &self,
        deployment_id: &str,
        options: RemoveDeviceDeploymentOptions,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsRemoveRpc>(&AuthDeploymentsRemoveRequest {
                cascade: options.cascade,
                deployment_id: deployment_id.to_string(),
                kind: serde_json::json!("device"),
                purge_unused_contracts: options.purge_unused_contracts,
            })
            .await?;
        Ok(response.success)
    }

    /// Provision a device instance.
    pub async fn provision_device_instance(
        &self,
        deployment_id: &str,
        public_identity_key: &str,
        activation_key: &str,
        metadata: Option<BTreeMap<String, String>>,
    ) -> Result<trellis_sdk_auth::AuthDevicesProvisionResponseInstance, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDevicesProvisionResponse>(
                "rpc.v1.Auth.Devices.Provision",
                &trellis_sdk_auth::AuthDevicesProvisionRequest {
                    deployment_id: deployment_id.to_string(),
                    public_identity_key: public_identity_key.to_string(),
                    activation_key: activation_key.to_string(),
                    metadata,
                },
            )
            .await?
            .instance)
    }

    /// List device instances.
    pub async fn list_device_instances(
        &self,
        deployment_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthDevicesListResponseEntriesItem>, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDevicesListResponse>(
                "rpc.v1.Auth.Devices.List",
                &trellis_sdk_auth::AuthDevicesListRequest {
                    deployment_id: deployment_id.map(ToOwned::to_owned),
                    limit: AUTH_CLIENT_LIST_LIMIT,
                    offset: None,
                    state: state.map(|value| serde_json::json!(value)),
                },
            )
            .await?
            .entries)
    }

    /// Disable a device instance.
    pub async fn disable_device_instance(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthDevicesDisableResponse>(
                "rpc.v1.Auth.Devices.Disable",
                &trellis_sdk_auth::AuthDevicesDisableRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?;
        Ok(response.instance.state == serde_json::json!("disabled"))
    }

    /// Enable a device instance.
    pub async fn enable_device_instance(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthDevicesEnableResponse>(
                "rpc.v1.Auth.Devices.Enable",
                &trellis_sdk_auth::AuthDevicesEnableRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?;
        Ok(response.instance.state != serde_json::json!("disabled"))
    }

    /// Remove a device instance.
    pub async fn remove_device_instance(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthDevicesRemoveResponse>(
                "rpc.v1.Auth.Devices.Remove",
                &trellis_sdk_auth::AuthDevicesRemoveRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?;
        Ok(response.success)
    }

    /// List device activations.
    pub async fn list_device_activations(
        &self,
        instance_id: Option<&str>,
        deployment_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<
        Vec<trellis_sdk_auth::AuthDeviceUserAuthoritiesListResponseEntriesItem>,
        TrellisAuthError,
    > {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDeviceUserAuthoritiesListResponse>(
                "rpc.v1.Auth.DeviceUserAuthorities.List",
                &trellis_sdk_auth::AuthDeviceUserAuthoritiesListRequest {
                    instance_id: instance_id.map(ToOwned::to_owned),
                    deployment_id: deployment_id.map(ToOwned::to_owned),
                    limit: AUTH_CLIENT_LIST_LIMIT,
                    offset: None,
                    state: state.map(|value| serde_json::json!(value)),
                },
            )
            .await?
            .entries)
    }

    /// Revoke a device activation.
    pub async fn revoke_device_activation(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDeviceUserAuthoritiesRevokeResponse>(
                "rpc.v1.Auth.DeviceUserAuthorities.Revoke",
                &trellis_sdk_auth::AuthDeviceUserAuthoritiesRevokeRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// List device activation reviews.
    pub async fn list_device_activation_reviews(
        &self,
        instance_id: Option<&str>,
        deployment_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<
        Vec<trellis_sdk_auth::AuthDeviceUserAuthoritiesReviewsListResponseEntriesItem>,
        TrellisAuthError,
    > {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDeviceUserAuthoritiesReviewsListResponse>(
                "rpc.v1.Auth.DeviceUserAuthorities.Reviews.List",
                &trellis_sdk_auth::AuthDeviceUserAuthoritiesReviewsListRequest {
                    instance_id: instance_id.map(ToOwned::to_owned),
                    deployment_id: deployment_id.map(ToOwned::to_owned),
                    limit: AUTH_CLIENT_LIST_LIMIT,
                    offset: None,
                    state: state.map(|value| serde_json::json!(value)),
                },
            )
            .await?
            .entries)
    }

    /// Decide one device activation review.
    pub async fn decide_device_activation_review(
        &self,
        review_id: &str,
        decision: &str,
        reason: Option<&str>,
    ) -> Result<trellis_sdk_auth::AuthDeviceUserAuthoritiesReviewsDecideResponse, TrellisAuthError>
    {
        self.call(
            "rpc.v1.Auth.DeviceUserAuthorities.Reviews.Decide",
            &trellis_sdk_auth::AuthDeviceUserAuthoritiesReviewsDecideRequest {
                review_id: review_id.to_string(),
                decision: serde_json::json!(decision),
                reason: reason.map(ToOwned::to_owned),
            },
        )
        .await
    }

    /// Create one service deployment.
    pub async fn create_service_deployment(
        &self,
        deployment_id: &str,
        namespaces: Vec<String>,
    ) -> Result<ServiceDeploymentRecord, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsCreateRpc>(&AuthDeploymentsCreateRequest(
                serde_json::json!({
                    "kind": "service",
                    "deploymentId": deployment_id,
                    "namespaces": namespaces,
                }),
            ))
            .await?;
        Ok(serde_json::from_value(response.deployment)?)
    }

    /// List service deployments.
    pub async fn list_service_deployments(
        &self,
        disabled: bool,
    ) -> Result<Vec<ServiceDeploymentRecord>, TrellisAuthError> {
        self.call_rpc::<AuthDeploymentsListRpc>(&AuthDeploymentsListRequest {
            disabled: if disabled { Some(true) } else { None },
            kind: Some(serde_json::json!("service")),
            limit: AUTH_CLIENT_LIST_LIMIT,
            offset: None,
        })
        .await?
        .entries
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(Into::into)
    }

    /// Disable one service deployment.
    pub async fn disable_service_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<ServiceDeploymentRecord, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsDisableRpc>(&AuthDeploymentsDisableRequest {
                deployment_id: deployment_id.to_string(),
                kind: serde_json::json!("service"),
            })
            .await?;
        Ok(serde_json::from_value(response.deployment)?)
    }

    /// Enable one service deployment.
    pub async fn enable_service_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<ServiceDeploymentRecord, TrellisAuthError> {
        let response = self
            .call_rpc::<AuthDeploymentsEnableRpc>(&AuthDeploymentsEnableRequest {
                deployment_id: deployment_id.to_string(),
                kind: serde_json::json!("service"),
            })
            .await?;
        Ok(serde_json::from_value(response.deployment)?)
    }

    /// Remove one service deployment.
    pub async fn remove_service_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        self.remove_service_deployment_with_options(deployment_id, None)
            .await
    }

    /// Remove one service deployment with explicit remove options.
    pub async fn remove_service_deployment_with_options(
        &self,
        deployment_id: &str,
        cascade: Option<bool>,
    ) -> Result<bool, TrellisAuthError> {
        self.remove_service_deployment_with_remove_options(
            deployment_id,
            RemoveServiceDeploymentOptions {
                cascade,
                purge_unused_contracts: None,
            },
        )
        .await
    }

    /// Remove one service deployment with explicit remove options.
    pub async fn remove_service_deployment_with_remove_options(
        &self,
        deployment_id: &str,
        options: RemoveServiceDeploymentOptions,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call_rpc::<AuthDeploymentsRemoveRpc>(&AuthDeploymentsRemoveRequest {
                cascade: options.cascade,
                deployment_id: deployment_id.to_string(),
                kind: serde_json::json!("service"),
                purge_unused_contracts: options.purge_unused_contracts,
            })
            .await?
            .success)
    }

    /// Provision one service instance.
    pub async fn provision_service_instance(
        &self,
        input: &trellis_sdk_auth::AuthServiceInstancesProvisionRequest,
    ) -> Result<trellis_sdk_auth::AuthServiceInstancesProvisionResponseInstance, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthServiceInstancesProvisionResponse>(
                "rpc.v1.Auth.ServiceInstances.Provision",
                input,
            )
            .await?
            .instance)
    }

    /// List service instances.
    pub async fn list_service_instances(
        &self,
        deployment_id: Option<&str>,
        disabled: Option<bool>,
    ) -> Result<Vec<trellis_sdk_auth::AuthServiceInstancesListResponseEntriesItem>, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthServiceInstancesListResponse>(
                "rpc.v1.Auth.ServiceInstances.List",
                &trellis_sdk_auth::AuthServiceInstancesListRequest {
                    deployment_id: deployment_id.map(ToOwned::to_owned),
                    disabled,
                    limit: AUTH_CLIENT_LIST_LIMIT,
                    offset: None,
                },
            )
            .await?
            .entries)
    }

    /// Disable one service instance.
    pub async fn disable_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<trellis_sdk_auth::AuthServiceInstancesDisableResponseInstance, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthServiceInstancesDisableResponse>(
                "rpc.v1.Auth.ServiceInstances.Disable",
                &trellis_sdk_auth::AuthServiceInstancesDisableRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?
            .instance)
    }

    /// Enable one service instance.
    pub async fn enable_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<trellis_sdk_auth::AuthServiceInstancesEnableResponseInstance, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthServiceInstancesEnableResponse>(
                "rpc.v1.Auth.ServiceInstances.Enable",
                &trellis_sdk_auth::AuthServiceInstancesEnableRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?
            .instance)
    }

    /// Remove one service instance.
    pub async fn remove_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthServiceInstancesRemoveResponse>(
                "rpc.v1.Auth.ServiceInstances.Remove",
                &trellis_sdk_auth::AuthServiceInstancesRemoveRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// Validate one request payload.
    pub async fn validate_request(
        &self,
        input: &AuthRequestsValidateRequest,
    ) -> Result<AuthRequestsValidateResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.Requests.Validate", input).await
    }

    /// List service deployments.
    pub async fn list_services(&self) -> Result<Vec<ServiceDeploymentRecord>, TrellisAuthError> {
        self.list_service_deployments(false).await
    }

    /// Log out the current admin session remotely.
    pub async fn logout(&self) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, LogoutResponse>("rpc.v1.Auth.Sessions.Logout", &Empty {})
            .await?
            .success)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis_sdk_auth::types::AuthSessionsMeResponse;

    use super::{AuthenticatedUser, DeviceDeploymentCreateRequest, DeviceDeploymentRecord};

    #[test]
    fn sessions_me_response_user_value_deserializes_account_first_shape() {
        let response: AuthSessionsMeResponse = serde_json::from_value(json!({
            "participantKind": "agent",
            "user": {
                "userId": "usr_123",
                "active": true,
                "name": "Ada",
                "email": "ada@example.com",
                "identity": {
                    "identityId": "idn_github_123",
                    "provider": "github",
                    "subject": "123"
                },
                "capabilities": ["admin"]
            },
            "device": null,
            "service": null
        }))
        .expect("deserialize generated response");

        assert_eq!(response.participant_kind.as_str(), Some("agent"));
        let user: AuthenticatedUser =
            serde_json::from_value(response.user).expect("deserialize authenticated user");
        assert_eq!(user.user_id, "usr_123");
        assert_eq!(user.identity.identity_id, "idn_github_123");
        assert_eq!(user.identity.provider, "github");
        assert_eq!(user.identity.subject, "123");
    }

    #[test]
    fn device_deployment_requests_omit_absent_review_mode() {
        let without_review_mode = serde_json::to_value(DeviceDeploymentCreateRequest {
            kind: "device",
            deployment_id: "reader",
            review_mode: None,
        })
        .expect("serialize device deployment create request");
        assert_eq!(
            without_review_mode,
            json!({ "kind": "device", "deploymentId": "reader" })
        );
        assert!(!without_review_mode
            .as_object()
            .expect("request object")
            .contains_key("reviewMode"));

        let with_review_mode = serde_json::to_value(DeviceDeploymentCreateRequest {
            kind: "device",
            deployment_id: "reader",
            review_mode: Some("required"),
        })
        .expect("serialize device deployment create request with review mode");
        assert_eq!(
            with_review_mode,
            json!({ "kind": "device", "deploymentId": "reader", "reviewMode": "required" })
        );
    }

    #[test]
    fn device_deployment_records_omit_absent_review_mode() {
        let record = serde_json::to_value(DeviceDeploymentRecord {
            kind: "device".to_string(),
            deployment_id: "reader".to_string(),
            review_mode: None,
            disabled: false,
        })
        .expect("serialize device deployment record");

        assert_eq!(
            record,
            json!({ "kind": "device", "deploymentId": "reader", "disabled": false })
        );
        assert!(!record
            .as_object()
            .expect("record object")
            .contains_key("reviewMode"));
    }

    #[test]
    fn remove_deployment_requests_serialize_optional_cascade() {
        let service_without_cascade =
            serde_json::to_value(trellis_sdk_auth::AuthDeploymentsRemoveRequest {
                cascade: None,
                deployment_id: "api".to_string(),
                kind: json!("service"),
                purge_unused_contracts: None,
            })
            .expect("serialize service remove request");
        assert_eq!(
            service_without_cascade,
            json!({ "deploymentId": "api", "kind": "service" })
        );

        let service_with_cascade =
            serde_json::to_value(trellis_sdk_auth::AuthDeploymentsRemoveRequest {
                cascade: Some(true),
                deployment_id: "api".to_string(),
                kind: json!("service"),
                purge_unused_contracts: None,
            })
            .expect("serialize service cascade remove request");
        assert_eq!(
            service_with_cascade,
            json!({ "cascade": true, "deploymentId": "api", "kind": "service" })
        );

        let device_with_cascade =
            serde_json::to_value(trellis_sdk_auth::AuthDeploymentsRemoveRequest {
                cascade: Some(true),
                deployment_id: "reader".to_string(),
                kind: json!("device"),
                purge_unused_contracts: None,
            })
            .expect("serialize device cascade remove request");
        assert_eq!(
            device_with_cascade,
            json!({ "cascade": true, "deploymentId": "reader", "kind": "device" })
        );

        let service_with_purge =
            serde_json::to_value(trellis_sdk_auth::AuthDeploymentsRemoveRequest {
                cascade: Some(true),
                deployment_id: "api".to_string(),
                kind: json!("service"),
                purge_unused_contracts: Some(true),
            })
            .expect("serialize service purge remove request");
        assert_eq!(
            service_with_purge,
            json!({
                "cascade": true,
                "deploymentId": "api",
                "kind": "service",
                "purgeUnusedContracts": true
            })
        );

        let device_with_purge =
            serde_json::to_value(trellis_sdk_auth::AuthDeploymentsRemoveRequest {
                cascade: Some(true),
                deployment_id: "reader".to_string(),
                kind: json!("device"),
                purge_unused_contracts: Some(true),
            })
            .expect("serialize device purge remove request");
        assert_eq!(
            device_with_purge,
            json!({
                "cascade": true,
                "deploymentId": "reader",
                "kind": "device",
                "purgeUnusedContracts": true
            })
        );
    }
}
