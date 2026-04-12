use crate::{
    save_admin_session, AdminSessionState, ApprovalEntryRecord, AuthGetInstalledContractRequest,
    AuthGetInstalledContractResponse, AuthInstallServiceRequest, AuthUpgradeServiceContractRequest,
    AuthValidateRequestRequest, AuthValidateRequestResponse, AuthenticatedUser, BoundSession,
    ListApprovalsRequest, RenewBindingTokenResponse, RevokeApprovalRequest, ServiceListEntry,
    TrellisAuthError,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use trellis_client::{TrellisClient, UserConnectOptions};

use crate::protocol::{
    AuthInstallServiceResponse, AuthUpgradeServiceContractResponse, ListApprovalsResponse,
    ListServicesResponse, LogoutResponse, MeResponse, RevokeApprovalResponse,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortalRecord {
    pub portal_id: String,
    pub app_contract_id: Option<String>,
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
    app_contract_id: Option<String>,
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
        binding_token: &state.binding_token,
        timeout_ms: 5_000,
    })
    .await?)
}

/// Persist a renewed binding token and sentinel credentials into the admin session state.
pub fn persist_renewed_admin_session(
    state: &mut AdminSessionState,
    renewed: RenewBindingTokenResponse,
) -> Result<(), TrellisAuthError> {
    let renewed = BoundSession {
        binding_token: renewed.binding_token,
        inbox_prefix: renewed.inbox_prefix,
        expires: renewed.expires,
        sentinel: renewed.sentinel,
    };

    state.binding_token = renewed.binding_token;
    state.expires = renewed.expires;
    state.sentinel_jwt = renewed.sentinel.jwt;
    state.sentinel_seed = renewed.sentinel.seed;
    save_admin_session(state)
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
        app_contract_id: Option<&str>,
        entry_url: &str,
    ) -> Result<PortalRecord, TrellisAuthError> {
        Ok(self
            .call::<_, CreatePortalResponse>(
                "rpc.v1.Auth.CreatePortal",
                &CreatePortalRequest {
                    portal_id: portal_id.to_string(),
                    app_contract_id: app_contract_id.map(ToOwned::to_owned),
                    entry_url: entry_url.to_string(),
                },
            )
            .await?
            .portal)
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
    pub async fn get_login_portal_default(
        &self,
    ) -> Result<PortalDefaultRecord, TrellisAuthError> {
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
    pub async fn get_device_portal_default(
        &self,
    ) -> Result<PortalDefaultRecord, TrellisAuthError> {
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
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceProfilesResponseProfilesItem>, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthListDeviceProfilesResponse>(
                "rpc.v1.Auth.ListDeviceProfiles",
                &trellis_sdk_auth::AuthListDeviceProfilesRequest {
                    contract_id: contract_id.map(ToOwned::to_owned),
                    disabled: if disabled { Some(true) } else { None },
                },
            )
            .await?
            .profiles)
    }

    /// Create a device profile.
    pub async fn create_device_profile(
        &self,
        profile_id: &str,
        contract_id: &str,
        allow_digests: &[String],
        review_mode: Option<&str>,
        contract: Option<BTreeMap<String, Value>>,
    ) -> Result<trellis_sdk_auth::AuthCreateDeviceProfileResponseProfile, TrellisAuthError> {
        #[derive(Debug, Clone, Deserialize, Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CreateDeviceProfileRequest {
            allowed_digests: Vec<String>,
            contract_id: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            contract: Option<BTreeMap<String, Value>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            review_mode: Option<Value>,
            profile_id: String,
        }

        Ok(self
            .call::<_, trellis_sdk_auth::AuthCreateDeviceProfileResponse>(
                "rpc.v1.Auth.CreateDeviceProfile",
                &CreateDeviceProfileRequest {
                    profile_id: profile_id.to_string(),
                    contract_id: contract_id.to_string(),
                    allowed_digests: allow_digests.to_vec(),
                    review_mode: review_mode.map(|value| serde_json::json!(value)),
                    contract,
                },
            )
            .await?
            .profile)
    }

    /// Disable a device profile.
    pub async fn disable_device_profile(
        &self,
        profile_id: &str,
    ) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDisableDeviceProfileResponse>(
                "rpc.v1.Auth.DisableDeviceProfile",
                &trellis_sdk_auth::AuthDisableDeviceProfileRequest {
                    profile_id: profile_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// Provision a device instance.
    pub async fn provision_device_instance(
        &self,
        profile_id: &str,
        public_identity_key: &str,
        activation_key: &str,
    ) -> Result<trellis_sdk_auth::AuthProvisionDeviceInstanceResponseInstance, TrellisAuthError> {
        Ok(self
            .call::<_, trellis_sdk_auth::AuthProvisionDeviceInstanceResponse>(
                "rpc.v1.Auth.ProvisionDeviceInstance",
                &trellis_sdk_auth::AuthProvisionDeviceInstanceRequest {
                    profile_id: profile_id.to_string(),
                    public_identity_key: public_identity_key.to_string(),
                    activation_key: activation_key.to_string(),
                },
            )
            .await?
            .instance)
    }

    /// Get device activation status for one handoff.
    pub async fn get_device_activation_status(
        &self,
        handoff_id: &str,
    ) -> Result<trellis_sdk_auth::AuthGetDeviceActivationStatusResponse, TrellisAuthError> {
        self.call(
            "rpc.v1.Auth.GetDeviceActivationStatus",
            &trellis_sdk_auth::AuthGetDeviceActivationStatusRequest {
                handoff_id: handoff_id.to_string(),
            },
        )
        .await
    }

    /// List device instances.
    pub async fn list_device_instances(
        &self,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceInstancesResponseInstancesItem>, TrellisAuthError> {
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
        Ok(self
            .call::<_, trellis_sdk_auth::AuthDisableDeviceInstanceResponse>(
                "rpc.v1.Auth.DisableDeviceInstance",
                &trellis_sdk_auth::AuthDisableDeviceInstanceRequest {
                    instance_id: instance_id.to_string(),
                },
            )
            .await?
            .success)
    }

    /// List device activations.
    pub async fn list_device_activations(
        &self,
        instance_id: Option<&str>,
        profile_id: Option<&str>,
        state: Option<&str>,
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceActivationsResponseActivationsItem>, TrellisAuthError> {
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
    ) -> Result<Vec<trellis_sdk_auth::AuthListDeviceActivationReviewsResponseReviewsItem>, TrellisAuthError> {
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

    /// Install one service contract remotely.
    pub async fn install_service(
        &self,
        input: &AuthInstallServiceRequest,
    ) -> Result<AuthInstallServiceResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.InstallService", input).await
    }

    /// Upgrade one installed service contract remotely.
    pub async fn upgrade_service_contract(
        &self,
        input: &AuthUpgradeServiceContractRequest,
    ) -> Result<AuthUpgradeServiceContractResponse, TrellisAuthError> {
        self.call("rpc.v1.Auth.UpgradeServiceContract", input).await
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

    /// List installed services.
    pub async fn list_services(&self) -> Result<Vec<ServiceListEntry>, TrellisAuthError> {
        Ok(self
            .call::<_, ListServicesResponse>("rpc.v1.Auth.ListServices", &Empty {})
            .await?
            .services)
    }

    /// Log out the current admin session remotely.
    pub async fn logout(&self) -> Result<bool, TrellisAuthError> {
        Ok(self
            .call::<_, LogoutResponse>("rpc.v1.Auth.Logout", &Empty {})
            .await?
            .success)
    }

    /// Mint and persist a fresh binding token for the current session.
    pub async fn renew_binding_token(
        &self,
        state: &mut AdminSessionState,
    ) -> Result<(), TrellisAuthError> {
        persist_renewed_admin_session(
            state,
            self.call("rpc.v1.Auth.RenewBindingToken", &Empty {})
                .await?,
        )
    }
}

#[derive(Debug, Serialize)]
struct Empty {}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{
        CreatePortalRequest, GetPortalDefaultResponse, LoginPortalSelectionRecord, PortalDefaultRecord,
        PortalRecord, SetLoginPortalSelectionRequest, SetDevicePortalSelectionRequest,
        SetDevicePortalSelectionResponse, DevicePortalSelectionRecord,
    };

    #[test]
    fn portal_create_requests_serialize_with_camel_case_fields() {
        let value = serde_json::to_value(CreatePortalRequest {
            portal_id: "main".to_string(),
            app_contract_id: Some("trellis.portal@v1".to_string()),
            entry_url: "https://portal.example.com/auth".to_string(),
        })
        .expect("serialize portal create request");

        assert_eq!(
            value,
            json!({
                "portalId": "main",
                "appContractId": "trellis.portal@v1",
                "entryUrl": "https://portal.example.com/auth"
            })
        );
    }

    #[test]
    fn portal_records_and_defaults_deserialize_from_camel_case_fields() {
        let portal: PortalRecord = serde_json::from_value(json!({
            "portalId": "main",
            "appContractId": "trellis.portal@v1",
            "entryUrl": "https://portal.example.com/auth",
            "disabled": false
        }))
        .expect("deserialize portal record");
        assert_eq!(portal.portal_id, "main");
        assert_eq!(portal.app_contract_id.as_deref(), Some("trellis.portal@v1"));
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
}
