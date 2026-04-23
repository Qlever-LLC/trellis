use crate::{
    AdminSessionState, ApprovalEntryRecord, AuthGetInstalledContractRequest,
    AuthGetInstalledContractResponse, AuthValidateRequestRequest, AuthValidateRequestResponse,
    AuthenticatedUser, DisableInstanceGrantPolicyRequest, InstanceGrantPolicyRecord,
    ListApprovalsRequest, RevokeApprovalRequest, TrellisAuthError,
    UpsertInstanceGrantPolicyRequest,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use trellis_client::{TrellisClient, UserConnectOptions};

use crate::protocol::{
    DisableInstanceGrantPolicyResponse, ListApprovalsResponse, ListInstanceGrantPoliciesResponse,
    LogoutResponse, MeResponse, RevokeApprovalResponse, UpsertInstanceGrantPolicyResponse,
};
use trellis_sdk_auth::rpc::Empty;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalRecord {
    pub portal_id: String,
    pub entry_url: String,
    pub disabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalDefaultRecord {
    pub portal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginPortalSelectionRecord {
    pub contract_id: String,
    pub portal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePortalSelectionRecord {
    pub profile_id: String,
    pub portal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatePortalResponse {
    portal: PortalRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ListPortalsResponse {
    portals: Vec<PortalRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct DisablePortalResponse {
    success: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GetPortalDefaultResponse {
    default_portal: PortalDefaultRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetPortalDefaultRequest {
    portal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetPortalDefaultResponse {
    default_portal: PortalDefaultRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ListLoginPortalSelectionsResponse {
    selections: Vec<LoginPortalSelectionRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetLoginPortalSelectionRequest {
    contract_id: String,
    portal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SetLoginPortalSelectionResponse {
    selection: LoginPortalSelectionRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearLoginPortalSelectionRequest {
    contract_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ClearLoginPortalSelectionResponse {
    success: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ListDevicePortalSelectionsResponse {
    selections: Vec<DevicePortalSelectionRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetDevicePortalSelectionRequest {
    profile_id: String,
    portal_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SetDevicePortalSelectionResponse {
    selection: DevicePortalSelectionRecord,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearDevicePortalSelectionRequest {
    profile_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct ClearDevicePortalSelectionResponse {
    success: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatePortalRequest {
    portal_id: String,
    entry_url: String,
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

    /// Return the currently authenticated user.
    pub async fn me(&self) -> Result<AuthenticatedUser, TrellisAuthError> {
        Ok(self
            .call::<_, MeResponse>("rpc.v1.Auth.Me", &Empty {})
            .await?
            .user)
    }

    /// List stored app approval decisions.
    pub async fn list_approvals(
        &self,
        user: Option<&str>,
        digest: Option<&str>,
    ) -> Result<Vec<ApprovalEntryRecord>, TrellisAuthError> {
        let request = ListApprovalsRequest {
            user: user.map(ToOwned::to_owned),
            digest: digest.map(ToOwned::to_owned),
        };
        Ok(self
            .call::<_, ListApprovalsResponse>("rpc.v1.Auth.ListApprovals", &request)
            .await?
            .approvals)
    }

    /// Revoke one stored approval decision.
    pub async fn revoke_approval(
        &self,
        digest: &str,
        user: Option<&str>,
    ) -> Result<bool, TrellisAuthError> {
        let request = RevokeApprovalRequest {
            contract_digest: digest.to_string(),
            user: user.map(ToOwned::to_owned),
        };
        Ok(self
            .call::<_, RevokeApprovalResponse>("rpc.v1.Auth.RevokeApproval", &request)
            .await?
            .success)
    }

    /// List registered portals.
    pub async fn list_portals(&self) -> Result<Vec<PortalRecord>, TrellisAuthError> {
        Ok(self
            .call::<_, ListPortalsResponse>("rpc.v1.Auth.ListPortals", &trellis_sdk_auth::Empty {})
            .await?
            .portals)
    }

    /// Create or replace a portal record.
    pub async fn create_portal(
        &self,
        portal_id: &str,
        entry_url: &str,
    ) -> Result<PortalRecord, TrellisAuthError> {
        Ok(self
            .call::<_, CreatePortalResponse>(
                "rpc.v1.Auth.CreatePortal",
                &CreatePortalRequest {
                    portal_id: portal_id.to_string(),
                    entry_url: entry_url.to_string(),
                },
            )
            .await?
            .portal)
    }

    /// List configured portal profiles.
    pub async fn list_portal_profiles(
        &self,
    ) -> Result<Vec<trellis_sdk_auth::AuthListPortalProfilesResponseProfilesItem>, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListPortalProfilesResponse>(
                "rpc.v1.Auth.ListPortalProfiles",
                &trellis_sdk_auth::AuthListPortalProfilesRequest(BTreeMap::new()),
            )
            .await?
            .profiles)
    }

    /// Create or replace a portal profile.
    pub async fn set_portal_profile(
        &self,
        portal_id: &str,
        entry_url: &str,
        contract_id: &str,
        allowed_origins: Option<&[String]>,
    ) -> Result<trellis_sdk_auth::AuthSetPortalProfileResponseProfile, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthSetPortalProfileResponse>(
                "rpc.v1.Auth.SetPortalProfile",
                &trellis_sdk_auth::AuthSetPortalProfileRequest {
                    allowed_origins: allowed_origins.map(|values| values.to_vec()),
                    contract_id: contract_id.to_string(),
                    entry_url: entry_url.to_string(),
                    portal_id: portal_id.to_string(),
                },
            )
            .await?
            .profile)
    }

    /// Disable a portal profile.
    pub async fn disable_portal_profile(
        &self,
        portal_id: &str,
    ) -> Result<trellis_sdk_auth::AuthDisablePortalProfileResponseProfile, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDisablePortalProfileResponse>(
                "rpc.v1.Auth.DisablePortalProfile",
                &trellis_sdk_auth::AuthDisablePortalProfileRequest {
                    portal_id: portal_id.to_string(),
                },
            )
            .await?
            .profile)
    }

    /// Disable a portal.
    pub async fn disable_portal(&self, portal_id: &str) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, DisablePortalResponse>(
                "rpc.v1.Auth.DisablePortal",
                &trellis_sdk_auth::AuthDisablePortalRequest {
                    portal_id: portal_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// Get the deployment-wide login portal default.
    pub async fn get_login_portal_default(&self) -> Result<PortalDefaultRecord, TrellisAuthError> {
        Ok(self
            .call::<_, GetPortalDefaultResponse>(
                "rpc.v1.Auth.GetLoginPortalDefault",
                &trellis_sdk_auth::Empty {},
            )
            .await?
            .default_portal)
    }

    /// Set the deployment-wide login portal default.
    pub async fn set_login_portal_default(
        &self,
        portal_id: Option<&str>,
    ) -> Result<PortalDefaultRecord, TrellisAuthError> {
        Ok(self
            .call::<_, SetPortalDefaultResponse>(
                "rpc.v1.Auth.SetLoginPortalDefault",
                &SetPortalDefaultRequest {
                    portal_id: portal_id.map(ToOwned::to_owned),
                },
            )
            .await?
            .default_portal)
    }

    /// List deployment-wide instance grant policies.
    pub async fn list_instance_grant_policies(
        &self,
    ) -> Result<Vec<InstanceGrantPolicyRecord>, TrellisAuthError> {
        Ok(self
            .call::<_, ListInstanceGrantPoliciesResponse>(
                "rpc.v1.Auth.ListInstanceGrantPolicies",
                &trellis_sdk_auth::Empty {},
            )
            .await?
            .policies)
    }

    /// Create or replace one deployment-wide instance grant policy.
    pub async fn upsert_instance_grant_policy(
        &self,
        contract_id: &str,
        implied_capabilities: &[String],
        allowed_origins: Option<&[String]>,
    ) -> Result<InstanceGrantPolicyRecord, TrellisAuthError> {
        Ok(self
            .call::<_, UpsertInstanceGrantPolicyResponse>(
                "rpc.v1.Auth.UpsertInstanceGrantPolicy",
                &UpsertInstanceGrantPolicyRequest {
                    allowed_origins: allowed_origins.map(|values| values.to_vec()),
                    contract_id: contract_id.to_string(),
                    implied_capabilities: implied_capabilities.to_vec(),
                },
            )
            .await?
            .policy)
    }

    /// Disable one deployment-wide instance grant policy.
    pub async fn disable_instance_grant_policy(
        &self,
        contract_id: &str,
    ) -> Result<InstanceGrantPolicyRecord, TrellisAuthError> {
        Ok(self
            .call::<_, DisableInstanceGrantPolicyResponse>(
                "rpc.v1.Auth.DisableInstanceGrantPolicy",
                &DisableInstanceGrantPolicyRequest {
                    contract_id: contract_id.to_string(),
                },
            )
            .await?
            .policy)
    }

    /// List contract-specific login portal selections.
    pub async fn list_login_portal_selections(
        &self,
    ) -> Result<Vec<LoginPortalSelectionRecord>, TrellisAuthError> {
        Ok(self
            .call::<_, ListLoginPortalSelectionsResponse>(
                "rpc.v1.Auth.ListLoginPortalSelections",
                &trellis_sdk_auth::Empty {},
            )
            .await?
            .selections)
    }

    /// Create or replace a contract-specific login portal selection.
    pub async fn set_login_portal_selection(
        &self,
        contract_id: &str,
        portal_id: Option<&str>,
    ) -> Result<LoginPortalSelectionRecord, TrellisAuthError> {
        Ok(self
            .call::<_, SetLoginPortalSelectionResponse>(
                "rpc.v1.Auth.SetLoginPortalSelection",
                &SetLoginPortalSelectionRequest {
                    contract_id: contract_id.to_string(),
                    portal_id: portal_id.map(ToOwned::to_owned),
                },
            )
            .await?
            .selection)
    }

    /// Clear a contract-specific login portal selection.
    pub async fn clear_login_portal_selection(
        &self,
        contract_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, ClearLoginPortalSelectionResponse>(
                "rpc.v1.Auth.ClearLoginPortalSelection",
                &ClearLoginPortalSelectionRequest {
                    contract_id: contract_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// Get the deployment-wide device portal default.
    pub async fn get_device_portal_default(&self) -> Result<PortalDefaultRecord, TrellisAuthError> {
        Ok(self
            .call::<_, GetPortalDefaultResponse>(
                "rpc.v1.Auth.GetDevicePortalDefault",
                &trellis_sdk_auth::Empty {},
            )
            .await?
            .default_portal)
    }

    /// Set the deployment-wide device portal default.
    pub async fn set_device_portal_default(
        &self,
        portal_id: Option<&str>,
    ) -> Result<PortalDefaultRecord, TrellisAuthError> {
        Ok(self
            .call::<_, SetPortalDefaultResponse>(
                "rpc.v1.Auth.SetDevicePortalDefault",
                &SetPortalDefaultRequest {
                    portal_id: portal_id.map(ToOwned::to_owned),
                },
            )
            .await?
            .default_portal)
    }

    /// List profile-specific device portal selections.
    pub async fn list_device_portal_selections(
        &self,
    ) -> Result<Vec<DevicePortalSelectionRecord>, TrellisAuthError> {
        Ok(self
            .call::<_, ListDevicePortalSelectionsResponse>(
                "rpc.v1.Auth.ListDevicePortalSelections",
                &trellis_sdk_auth::Empty {},
            )
            .await?
            .selections)
    }

    /// Create or replace a profile-specific device portal selection.
    pub async fn set_device_portal_selection(
        &self,
        profile_id: &str,
        portal_id: Option<&str>,
    ) -> Result<DevicePortalSelectionRecord, TrellisAuthError> {
        Ok(self
            .call::<_, SetDevicePortalSelectionResponse>(
                "rpc.v1.Auth.SetDevicePortalSelection",
                &SetDevicePortalSelectionRequest {
                    profile_id: profile_id.to_string(),
                    portal_id: portal_id.map(ToOwned::to_owned),
                },
            )
            .await?
            .selection)
    }

    /// Clear a profile-specific device portal selection.
    pub async fn clear_device_portal_selection(
        &self,
        profile_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, ClearDevicePortalSelectionResponse>(
                "rpc.v1.Auth.ClearDevicePortalSelection",
                &ClearDevicePortalSelectionRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// List device profiles.
    pub async fn list_device_profiles(
        &self,
        contract_id: Option<&str>,
        disabled: bool,
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceProfilesResponseProfilesItem>, TrellisAuthError>
    {
        let mut profiles = self
            .call::<_, trellis_sdk_auth::AuthListDeviceProfilesResponse>(
                "rpc.v1.Auth.ListDeviceProfiles",
                &trellis_sdk_auth::AuthListDeviceProfilesRequest {
                    disabled: if disabled { Some(true) } else { None },
                },
            )
            .await?
            .profiles;

        if let Some(contract_id) = contract_id {
            profiles.retain(|profile| {
                profile
                    .applied_contracts
                    .iter()
                    .any(|contract| contract.contract_id == contract_id)
            });
        }

        Ok(profiles)
    }

    /// Create a device profile.
    pub async fn create_device_profile(
        &self,
        profile_id: &str,
        review_mode: Option<&str>,
        contract: Option<BTreeMap<String, Value>>,
    ) -> Result<trellis_sdk_auth::AuthCreateDeviceProfileResponseProfile, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthCreateDeviceProfileResponse>(
                "rpc.v1.Auth.CreateDeviceProfile",
                &trellis_sdk_auth::AuthCreateDeviceProfileRequest {
                    profile_id: profile_id.to_string(),
                    review_mode: review_mode.map(|value| serde_json::json!(value)),
                },
            )
            .await?;

        if let Some(contract) = contract {
            let applied = self
                .call::<_, trellis_sdk_auth::AuthApplyDeviceProfileContractResponse>(
                    "rpc.v1.Auth.ApplyDeviceProfileContract",
                    &trellis_sdk_auth::AuthApplyDeviceProfileContractRequest {
                        profile_id: profile_id.to_string(),
                        contract,
                    },
                )
                .await?;
            return Ok(trellis_sdk_auth::AuthCreateDeviceProfileResponseProfile {
                applied_contracts: applied
                    .profile
                    .applied_contracts
                    .into_iter()
                    .map(|item| trellis_sdk_auth::AuthCreateDeviceProfileResponseProfileAppliedContractsItem {
                        allowed_digests: item.allowed_digests,
                        contract_id: item.contract_id,
                    })
                    .collect(),
                disabled: applied.profile.disabled,
                profile_id: applied.profile.profile_id,
                review_mode: applied.profile.review_mode,
            });
        }

        Ok(response.profile)
    }

    /// Apply one contract lineage or digest set to a device profile.
    pub async fn apply_device_profile_contract(
        &self,
        input: &trellis_sdk_auth::AuthApplyDeviceProfileContractRequest,
    ) -> Result<trellis_sdk_auth::AuthApplyDeviceProfileContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.ApplyDeviceProfileContract", input)
            .await
    }

    /// Disable a device profile.
    pub async fn disable_device_profile(&self, profile_id: &str) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthDisableDeviceProfileResponse>(
                "rpc.v1.Auth.DisableDeviceProfile",
                &trellis_sdk_auth::AuthDisableDeviceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?;
        Ok(response.profile.disabled)
    }

    /// Enable a device profile.
    pub async fn enable_device_profile(&self, profile_id: &str) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthEnableDeviceProfileResponse>(
                "rpc.v1.Auth.EnableDeviceProfile",
                &trellis_sdk_auth::AuthEnableDeviceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?;
        Ok(!response.profile.disabled)
    }

    /// Unapply one contract lineage or digest set from a device profile.
    pub async fn unapply_device_profile_contract(
        &self,
        input: &trellis_sdk_auth::AuthUnapplyDeviceProfileContractRequest,
    ) -> Result<trellis_sdk_auth::AuthUnapplyDeviceProfileContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.UnapplyDeviceProfileContract", input)
            .await
    }

    /// Remove a device profile.
    pub async fn remove_device_profile(&self, profile_id: &str) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthRemoveDeviceProfileResponse>(
                "rpc.v1.Auth.RemoveDeviceProfile",
                &trellis_sdk_auth::AuthRemoveDeviceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?;
        Ok(response.success)
    }

    /// Provision a device instance.
    pub async fn provision_device_instance(
        &self,
        profile_id: &str,
        public_identity_key: &str,
        activation_key: &str,
        metadata: Option<BTreeMap<String, String>>,
    ) -> Result<trellis_sdk_auth::AuthProvisionDeviceInstanceResponseInstance, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthProvisionDeviceInstanceResponse>(
                "rpc.v1.Auth.ProvisionDeviceInstance",
                &trellis_sdk_auth::AuthProvisionDeviceInstanceRequest {
                    profile_id: profile_id.to_string(),
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
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceInstancesResponseInstancesItem>, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListDeviceInstancesResponse>(
                "rpc.v1.Auth.ListDeviceInstances",
                &trellis_sdk_auth::AuthListDeviceInstancesRequest {
                    profile_id: profile_id.map(ToOwned::to_owned),
                    state: state.map(|value| serde_json::json!(value)),
                },
            )
            .await?
            .instances)
    }

    /// Disable a device instance.
    pub async fn disable_device_instance(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        let response = self
            .call::<_, trellis_sdk_auth::AuthDisableDeviceInstanceResponse>(
                "rpc.v1.Auth.DisableDeviceInstance",
                &trellis_sdk_auth::AuthDisableDeviceInstanceRequest {
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
            .call::<_, trellis_sdk_auth::AuthEnableDeviceInstanceResponse>(
                "rpc.v1.Auth.EnableDeviceInstance",
                &trellis_sdk_auth::AuthEnableDeviceInstanceRequest {
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
            .call::<_, trellis_sdk_auth::AuthRemoveDeviceInstanceResponse>(
                "rpc.v1.Auth.RemoveDeviceInstance",
                &trellis_sdk_auth::AuthRemoveDeviceInstanceRequest {
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
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<
        Vec<trellis_sdk_auth::AuthListDeviceActivationsResponseActivationsItem>,
        TrellisAuthError,
    > {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListDeviceActivationsResponse>(
                "rpc.v1.Auth.ListDeviceActivations",
                &trellis_sdk_auth::AuthListDeviceActivationsRequest {
                    instance_id: instance_id.map(ToOwned::to_owned),
                    profile_id: profile_id.map(ToOwned::to_owned),
                    state: state.map(|value| serde_json::json!(value)),
                },
            )
            .await?
            .activations)
    }

    /// Revoke a device activation.
    pub async fn revoke_device_activation(
        &self,
        instance_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthRevokeDeviceActivationResponse>(
                "rpc.v1.Auth.RevokeDeviceActivation",
                &trellis_sdk_auth::AuthRevokeDeviceActivationRequest {
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
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<
        Vec<trellis_sdk_auth::AuthListDeviceActivationReviewsResponseReviewsItem>,
        TrellisAuthError,
    > {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListDeviceActivationReviewsResponse>(
                "rpc.v1.Auth.ListDeviceActivationReviews",
                &trellis_sdk_auth::AuthListDeviceActivationReviewsRequest {
                    instance_id: instance_id.map(ToOwned::to_owned),
                    profile_id: profile_id.map(ToOwned::to_owned),
                    state: state.map(|value| serde_json::json!(value)),
                },
            )
            .await?
            .reviews)
    }

    /// Decide one device activation review.
    pub async fn decide_device_activation_review(
        &self,
        review_id: &str,
        decision: &str,
        reason: Option<&str>,
    ) -> Result<trellis_sdk_auth::AuthDecideDeviceActivationReviewResponse, TrellisAuthError> {
        self.call(
            "rpc.v1.Auth.DecideDeviceActivationReview",
            &trellis_sdk_auth::AuthDecideDeviceActivationReviewRequest {
                review_id: review_id.to_string(),
                decision: serde_json::json!(decision),
                reason: reason.map(ToOwned::to_owned),
            },
        )
        .await
    }

    /// Create one service profile.
    pub async fn create_service_profile(
        &self,
        input: &trellis_sdk_auth::AuthCreateServiceProfileRequest,
    ) -> Result<trellis_sdk_auth::AuthCreateServiceProfileResponseProfile, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthCreateServiceProfileResponse>(
                "rpc.v1.Auth.CreateServiceProfile",
                input,
            )
            .await?
            .profile)
    }

    /// List service profiles.
    pub async fn list_service_profiles(
        &self,
        disabled: bool,
    ) -> Result<Vec<trellis_sdk_auth::AuthListServiceProfilesResponseProfilesItem>, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListServiceProfilesResponse>(
                "rpc.v1.Auth.ListServiceProfiles",
                &trellis_sdk_auth::AuthListServiceProfilesRequest {
                    disabled: if disabled { Some(true) } else { None },
                },
            )
            .await?
            .profiles)
    }

    /// Apply one contract to a service profile.
    pub async fn apply_service_profile_contract(
        &self,
        input: &trellis_sdk_auth::AuthApplyServiceProfileContractRequest,
    ) -> Result<trellis_sdk_auth::AuthApplyServiceProfileContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.ApplyServiceProfileContract", input)
            .await
    }

    /// Unapply one service profile contract or digest set.
    pub async fn unapply_service_profile_contract(
        &self,
        input: &trellis_sdk_auth::AuthUnapplyServiceProfileContractRequest,
    ) -> Result<trellis_sdk_auth::AuthUnapplyServiceProfileContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.UnapplyServiceProfileContract", input)
            .await
    }

    /// Disable one service profile.
    pub async fn disable_service_profile(
        &self,
        profile_id: &str,
    ) -> Result<trellis_sdk_auth::AuthDisableServiceProfileResponseProfile, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDisableServiceProfileResponse>(
                "rpc.v1.Auth.DisableServiceProfile",
                &trellis_sdk_auth::AuthDisableServiceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?
            .profile)
    }

    /// Enable one service profile.
    pub async fn enable_service_profile(
        &self,
        profile_id: &str,
    ) -> Result<trellis_sdk_auth::AuthEnableServiceProfileResponseProfile, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthEnableServiceProfileResponse>(
                "rpc.v1.Auth.EnableServiceProfile",
                &trellis_sdk_auth::AuthEnableServiceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?
            .profile)
    }

    /// Remove one service profile.
    pub async fn remove_service_profile(&self, profile_id: &str) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthRemoveServiceProfileResponse>(
                "rpc.v1.Auth.RemoveServiceProfile",
                &trellis_sdk_auth::AuthRemoveServiceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// Provision one service instance.
    pub async fn provision_service_instance(
        &self,
        input: &trellis_sdk_auth::AuthProvisionServiceInstanceRequest,
    ) -> Result<trellis_sdk_auth::AuthProvisionServiceInstanceResponseInstance, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthProvisionServiceInstanceResponse>(
                "rpc.v1.Auth.ProvisionServiceInstance",
                input,
            )
            .await?
            .instance)
    }

    /// List service instances.
    pub async fn list_service_instances(
        &self,
        profile_id: Option<&str>,
        disabled: Option<bool>,
    ) -> Result<
        Vec<trellis_sdk_auth::AuthListServiceInstancesResponseInstancesItem>,
        TrellisAuthError,
    > {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListServiceInstancesResponse>(
                "rpc.v1.Auth.ListServiceInstances",
                &trellis_sdk_auth::AuthListServiceInstancesRequest {
                    profile_id: profile_id.map(ToOwned::to_owned),
                    disabled,
                },
            )
            .await?
            .instances)
    }

    /// Disable one service instance.
    pub async fn disable_service_instance(
        &self,
        instance_id: &str,
    ) -> Result<trellis_sdk_auth::AuthDisableServiceInstanceResponseInstance, TrellisAuthError>
    {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDisableServiceInstanceResponse>(
                "rpc.v1.Auth.DisableServiceInstance",
                &trellis_sdk_auth::AuthDisableServiceInstanceRequest {
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
    ) -> Result<trellis_sdk_auth::AuthEnableServiceInstanceResponseInstance, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthEnableServiceInstanceResponse>(
                "rpc.v1.Auth.EnableServiceInstance",
                &trellis_sdk_auth::AuthEnableServiceInstanceRequest {
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
            .call::<_, trellis_sdk_auth::AuthRemoveServiceInstanceResponse>(
                "rpc.v1.Auth.RemoveServiceInstance",
                &trellis_sdk_auth::AuthRemoveServiceInstanceRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// Fetch one installed contract by digest.
    pub async fn get_installed_contract(
        &self,
        input: &AuthGetInstalledContractRequest,
    ) -> Result<AuthGetInstalledContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.GetInstalledContract", input).await
    }

    /// Validate one request payload.
    pub async fn validate_request(
        &self,
        input: &AuthValidateRequestRequest,
    ) -> Result<AuthValidateRequestResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.ValidateRequest", input).await
    }

    /// List service profiles.
    pub async fn list_services(
        &self,
    ) -> Result<Vec<trellis_sdk_auth::AuthListServiceProfilesResponseProfilesItem>, TrellisAuthError>
    {
        self.list_service_profiles(false).await
    }

    /// Log out the current admin session remotely.
    pub async fn logout(&self) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, LogoutResponse>("rpc.v1.Auth.Logout", &Empty {})
            .await?
            .success)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{
        CreatePortalRequest, DevicePortalSelectionRecord, GetPortalDefaultResponse,
        LoginPortalSelectionRecord, PortalDefaultRecord, PortalRecord,
        SetDevicePortalSelectionRequest, SetDevicePortalSelectionResponse,
        SetLoginPortalSelectionRequest,
    };
    use crate::{
        InstanceGrantPolicyRecord, InstanceGrantPolicySourceRecord,
        UpsertInstanceGrantPolicyRequest,
    };

    #[test]
    fn portal_create_requests_serialize_with_camel_case_fields() {
        let value = serde_json::to_value(CreatePortalRequest {
            portal_id: "main".to_string(),
            entry_url: "https://portal.example.com/auth".to_string(),
        })
        .expect("serialize portal create request");

        assert_eq!(
            value,
            json!({
                "portalId": "main",
                "entryUrl": "https://portal.example.com/auth"
            })
        );
    }

    #[test]
    fn portal_records_and_defaults_deserialize_from_camel_case_fields() {
        let portal: PortalRecord = serde_json::from_value(json!({
            "portalId": "main",
            "entryUrl": "https://portal.example.com/auth",
            "disabled": false
        }))
        .expect("deserialize portal record");
        assert_eq!(portal.portal_id, "main");
        assert_eq!(portal.entry_url, "https://portal.example.com/auth");

        let response: GetPortalDefaultResponse = serde_json::from_value(json!({
            "defaultPortal": {
                "portalId": Value::Null
            }
        }))
        .expect("deserialize portal default response");
        assert_eq!(response.default_portal.portal_id, None);

        let default_value = serde_json::to_value(PortalDefaultRecord {
            portal_id: Some("main".to_string()),
        })
        .expect("serialize portal default record");
        assert_eq!(default_value, json!({ "portalId": "main" }));
    }

    #[test]
    fn portal_selection_types_use_camel_case_json() {
        let login_request = serde_json::to_value(SetLoginPortalSelectionRequest {
            contract_id: "trellis.console@v1".to_string(),
            portal_id: Some("main".to_string()),
        })
        .expect("serialize login portal selection request");
        assert_eq!(
            login_request,
            json!({
                "contractId": "trellis.console@v1",
                "portalId": "main"
            })
        );

        let login_record: LoginPortalSelectionRecord = serde_json::from_value(json!({
            "contractId": "trellis.console@v1",
            "portalId": "main"
        }))
        .expect("deserialize login portal selection record");
        assert_eq!(login_record.contract_id, "trellis.console@v1");
        assert_eq!(login_record.portal_id.as_deref(), Some("main"));

        let device_request = serde_json::to_value(SetDevicePortalSelectionRequest {
            profile_id: "reader.default".to_string(),
            portal_id: None,
        })
        .expect("serialize device portal selection request");
        assert_eq!(
            device_request,
            json!({
                "profileId": "reader.default",
                "portalId": Value::Null
            })
        );

        let device_response: SetDevicePortalSelectionResponse = serde_json::from_value(json!({
            "selection": {
                "profileId": "reader.default",
                "portalId": "main"
            }
        }))
        .expect("deserialize device portal selection response");
        assert_eq!(device_response.selection.profile_id, "reader.default");
        assert_eq!(device_response.selection.portal_id.as_deref(), Some("main"));

        let device_record_value = serde_json::to_value(DevicePortalSelectionRecord {
            profile_id: "reader.default".to_string(),
            portal_id: Some("main".to_string()),
        })
        .expect("serialize device portal selection record");
        assert_eq!(
            device_record_value,
            json!({
                "profileId": "reader.default",
                "portalId": "main"
            })
        );
    }

    #[test]
    fn instance_grant_policy_types_use_camel_case_json() {
        let request = serde_json::to_value(UpsertInstanceGrantPolicyRequest {
            allowed_origins: Some(vec!["https://console.example.com".to_string()]),
            contract_id: "trellis.console@v1".to_string(),
            implied_capabilities: vec!["admin".to_string()],
        })
        .expect("serialize instance grant policy request");
        assert_eq!(
            request,
            json!({
                "allowedOrigins": ["https://console.example.com"],
                "contractId": "trellis.console@v1",
                "impliedCapabilities": ["admin"]
            })
        );

        let record: InstanceGrantPolicyRecord = serde_json::from_value(json!({
            "contractId": "trellis.console@v1",
            "allowedOrigins": ["https://console.example.com"],
            "impliedCapabilities": ["admin"],
            "disabled": false,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-02T00:00:00Z",
            "source": {
                "kind": "admin_policy"
            }
        }))
        .expect("deserialize instance grant policy record");
        assert_eq!(record.contract_id, "trellis.console@v1");
        assert_eq!(
            record.allowed_origins,
            Some(vec!["https://console.example.com".to_string()])
        );

        let value = serde_json::to_value(InstanceGrantPolicyRecord {
            allowed_origins: None,
            contract_id: "trellis.console@v1".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            disabled: true,
            implied_capabilities: vec![],
            source: InstanceGrantPolicySourceRecord {
                created_by: None,
                kind: "admin_policy".to_string(),
                updated_by: None,
            },
            updated_at: "2026-01-02T00:00:00Z".to_string(),
        })
        .expect("serialize instance grant policy record");
        assert_eq!(
            value,
            json!({
                "contractId": "trellis.console@v1",
                "createdAt": "2026-01-01T00:00:00Z",
                "disabled": true,
                "impliedCapabilities": [],
                "source": { "kind": "admin_policy" },
                "updatedAt": "2026-01-02T00:00:00Z"
            })
        );
    }
}
