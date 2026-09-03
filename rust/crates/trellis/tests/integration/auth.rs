use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use futures_util::StreamExt;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::task::JoinHandle;
use trellis_rs::auth::{
    check_device_activation, check_device_activation_with_test_proof, derive_device_identity,
    wait_for_device_activation, DeviceActivationOptions, DeviceActivationStatus,
};
use trellis_rs::client::OperationState as ClientOperationState;
use trellis_rs::client::{
    AuthorizationContextStore as _, EventDescriptor, FileAuthorizationContextStore,
    MemoryAuthorizationContextStore, RpcDescriptor,
};
use trellis_rs::generated::Caller;
use trellis_rs::service::{
    ConnectedServiceRuntime, ServiceEventListenOptions, ServiceEventListenerMode,
};
use trellis_runtime_apis::auth as auth_sdk;

use crate::support::assertions::{assert_case_registered, assert_runtime_case_registered};

const SERVICE_ID: &str = "integration.trusted-portal-service@v1";
const CLIENT_ID: &str = "integration.trusted-portal-client@v1";
const APPROVED_CLIENT_ID: &str = "integration.approved-client@v1";
const READ_CAPABILITY: &str = "integration.trusted-portal-service::read";
const PUBLISH_CAPABILITY: &str = "integration.trusted-portal-service::publish";
const API_SOURCE: &str = r#"{
  "format": "trellis.api.v1",
  "id": "integration.trusted-portal-service@v1",
  "version": "1.0.0",
  "displayName": "Trusted Portal Integration Service",
  "description": "Exercises trusted-portal authority transitions.",
  "capabilities": {
    "integration.trusted-portal-service::read": {"allows": [
      {"target": {"kind": "apiSurface", "api": "integration.trusted-portal-service@v1", "surface": "rpc", "name": "Value.Get"}, "action": "call"}
    ]},
    "integration.trusted-portal-service::publish": {"allows": [
      {"target": {"kind": "apiSurface", "api": "integration.trusted-portal-service@v1", "surface": "event", "name": "Value.Changed"}, "action": "publish"}
    ]}
  },
  "schemas": {
    "ValueGetInput": {"type": "object", "required": ["value"], "properties": {"value": {"type": "string"}}},
    "ValueGetOutput": {"type": "object", "required": ["value"], "properties": {"value": {"type": "string"}}}
  },
  "rpc": {
    "Value.Get": {"version": "v1", "input": {"schema": "ValueGetInput"}, "output": {"schema": "ValueGetOutput"}, "errors": []}
  },
  "events": {
    "Value.Changed": {"version": "v1", "event": {"schema": "ValueGetOutput"}}
  }
}"#;

struct TrustedPortalServiceContract;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct ValueMessage {
    value: String,
}

struct ValueGet;
struct ValueChanged;

struct TrustedPortalListenerContract;

impl RpcDescriptor for ValueGet {
    type Input = ValueMessage;
    type Output = ValueMessage;

    const KEY: &'static str = "Value.Get";
    const SUBJECT: &'static str = "rpc.v1.Value.Get";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[READ_CAPABILITY];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["value"],"properties":{"value":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = Self::INPUT_SCHEMA_JSON;
}

impl EventDescriptor for ValueChanged {
    type Event = ValueMessage;

    const KEY: &'static str = "Value.Changed";
    const SUBJECT: &'static str = "events.v1.Value.Changed";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[PUBLISH_CAPABILITY];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
    const EVENT_SCHEMA_JSON: &'static str = ValueGet::OUTPUT_SCHEMA_JSON;
}

struct AbortOnDrop(Option<JoinHandle<Result<(), trellis_rs::service::ServiceRuntimeError>>>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        if let Some(handle) = &self.0 {
            handle.abort();
        }
    }
}

struct Fixture {
    runtime: trellis_test::TrellisTestRuntime,
    admin: trellis_test::TrellisTestAdmin,
    admin_caller: Caller,
    service_handle: trellis_rs::service::ServiceHandle,
    bootstrap_url: String,
    portal_id: String,
    service_contract: trellis_test::TrellisTestContract,
    client_contract: trellis_test::TrellisTestContract,
    read_capability: String,
    publish_capability: String,
    _service: AbortOnDrop,
}

struct DeviceActivationCase {
    approval: trellis_test::TrellisTestContractApproval,
    identity: trellis_rs::auth::DeviceIdentity,
    instance_id: String,
    principal_id: String,
}

impl DeviceActivationCase {
    fn connect_options<'a>(
        &'a self,
        trellis_url: &'a str,
    ) -> trellis_rs::client::DeviceConnectOptions<'a, trellis_rs::generated::DynamicDeviceContract>
    {
        self.connect_options_for_deployment(trellis_url, &self.approval.deployment_id)
    }

    fn connect_options_for_deployment<'a>(
        &'a self,
        trellis_url: &'a str,
        deployment_id: &'a str,
    ) -> trellis_rs::client::DeviceConnectOptions<'a, trellis_rs::generated::DynamicDeviceContract>
    {
        trellis_test::device_connect_options(
            trellis_url,
            &self.approval,
            deployment_id,
            &self.instance_id,
            &self.identity,
            Arc::new(MemoryAuthorizationContextStore::default()),
        )
        .with_timeout_ms(10_000)
    }

    fn activation_options<'a>(
        &'a self,
        trellis_url: &'a str,
    ) -> DeviceActivationOptions<'a, trellis_rs::generated::DynamicDeviceContract> {
        DeviceActivationOptions::new(
            self.connect_options(trellis_url),
            &self.identity.activation_key_base64url,
        )
        .with_nonce(format!("activation:{}", self.instance_id))
    }
}

#[tokio::test]
async fn bootstrap_setup_seeds_cli_authority_and_reset_restores_revoked_authority() {
    assert_runtime_case_registered(
        "control-plane.admin-bootstrap-creates-first-local-admin",
        "control-plane",
        "auth",
    );

    let mut runtime = trellis_test::TrellisTestRuntime::start(
        trellis_test::TrellisTestRuntimeOptions::repo_platform(),
    )
    .await
    .expect("start bootstrap runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first administrator bootstrap URL");
    runtime
        .complete_bootstrap()
        .await
        .expect("complete first administrator bootstrap");
    assert_eq!(
        runtime
            .control_plane_sqlite()
            .query(
                "SELECT principal_id FROM auth_principals WHERE kind = 'user' AND state = 'active'",
                [],
            )
            .expect("query active administrators")
            .len(),
        1
    );
    assert!(
        runtime.complete_bootstrap().await.is_err(),
        "first administrator bootstrap completed twice"
    );
    assert_eq!(
        runtime
            .control_plane_sqlite()
            .query(
                "SELECT principal_id FROM auth_principals WHERE kind = 'user' AND state = 'active'",
                [],
            )
            .expect("query administrators after replay")
            .len(),
        1
    );
    let principal_id = runtime
        .control_plane_sqlite()
        .query(
            "SELECT principal_id FROM auth_bootstrap_administrator WHERE singleton = 1",
            [],
        )
        .expect("query bootstrap administrator")[0]["principal_id"]
        .as_str()
        .expect("bootstrap administrator principal id")
        .to_owned();
    let initial_authority = runtime
        .control_plane_sqlite()
        .query(
            "SELECT a.authority_id, a.participant_artifact_digest, a.accepted_needs_digest,
                    a.state, a.version, b.artifact_digest AS current_artifact_digest,
                    b.needs_digest AS current_needs_digest
             FROM auth_identity_authorities a
             JOIN auth_participant_bindings b
               ON b.participant_id = a.participant_id AND b.state = 'resolved'
             WHERE a.principal_id = ?1 AND a.participant_id = 'trellis-app.cli@v1'",
            params![principal_id],
        )
        .expect("query initial CLI authority");
    assert_eq!(initial_authority.len(), 1);
    assert_eq!(initial_authority[0]["state"], "accepted");
    assert_eq!(
        initial_authority[0]["participant_artifact_digest"],
        initial_authority[0]["current_artifact_digest"]
    );
    assert_eq!(
        initial_authority[0]["accepted_needs_digest"],
        initial_authority[0]["current_needs_digest"]
    );
    let authority_id = initial_authority[0]["authority_id"]
        .as_str()
        .expect("CLI authority id")
        .to_owned();
    let initial_version = initial_authority[0]["version"]
        .as_i64()
        .expect("CLI authority version");
    let pending_password_reset_url = {
        let mut admin = runtime.admin();
        let admin_caller = admin
            .connect_admin(&bootstrap_url)
            .await
            .expect("connect initial CLI administrator")
            .clone();
        let auth = auth_sdk::AuthClient::new(&admin_caller).rpc().auth();
        let initial_session = auth
            .sessions_me()
            .await
            .expect("read initial CLI administrator session");
        assert!(
            initial_session
                .user
                .as_ref()
                .and_then(|user| user.get("capabilities"))
                .and_then(Value::as_array)
                .expect("initial CLI capabilities")
                .iter()
                .any(|capability| capability == "trellis.auth::admin"),
            "CLI administrator lacks capability delegation authority"
        );
        assert!(
            initial_session
                .user
                .as_ref()
                .and_then(|user| user.get("capabilities"))
                .and_then(Value::as_array)
                .expect("initial CLI capabilities")
                .iter()
                .any(|capability| capability == "trellis.auth::capabilities.delegate"),
            "CLI administrator lacks granular capability delegation authority"
        );
        let reset = auth
            .users_password_reset_create(&auth_sdk::AuthUsersPasswordResetCreateRequest {
                idempotency_key: ulid::Ulid::new().to_string(),
                return_target: None,
                user_id: principal_id.clone(),
            })
            .await
            .expect("create administrator password-reset flow");
        auth.identity_authority_revoke(&auth_sdk::types::AuthIdentityAuthorityRevokeRequest {
            authority_id,
            expected_version: initial_version,
            idempotency_key: ulid::Ulid::new().to_string(),
            reason: Some("verify ordinary CLI authority lifecycle".to_owned()),
        })
        .await
        .expect("revoke CLI authority through ordinary Auth RPC");
        assert_eq!(
            runtime
                .control_plane_sqlite()
                .query(
                    "SELECT state FROM auth_identity_authorities
                 WHERE principal_id = ?1 AND participant_id = 'trellis-app.cli@v1'",
                    params![principal_id],
                )
                .expect("query revoked CLI authority")[0]["state"],
            "revoked"
        );
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if auth.sessions_me().await.is_err() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("revoked CLI authorization context remained usable");
        reset.flow.completion_url
    };
    runtime
        .admin()
        .complete_local_password_flow(
            &pending_password_reset_url,
            &format!("Trellis-test-stale-reset-{}!", ulid::Ulid::new()),
        )
        .await
        .expect_err("stale administrator reset completed after requester lost admin authority");

    runtime
        .restart_control_plane_with_admin_reset()
        .await
        .expect("restart with explicit administrator reset");
    let recovery_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe administrator recovery URL");
    runtime
        .complete_bootstrap_with_password(format!("Trellis-test-reset-{}!", ulid::Ulid::new()))
        .await
        .expect("complete administrator recovery");
    let restored_authority = runtime
        .control_plane_sqlite()
        .query(
            "SELECT a.participant_artifact_digest, a.accepted_needs_digest, a.state, a.version,
                    b.artifact_digest AS current_artifact_digest,
                    b.needs_digest AS current_needs_digest
             FROM auth_identity_authorities a
             JOIN auth_participant_bindings b
               ON b.participant_id = a.participant_id AND b.state = 'resolved'
             WHERE a.principal_id = ?1 AND a.participant_id = 'trellis-app.cli@v1'",
            params![principal_id],
        )
        .expect("query restored CLI authority");
    assert_eq!(restored_authority.len(), 1);
    assert_eq!(restored_authority[0]["state"], "accepted");
    assert_eq!(
        restored_authority[0]["participant_artifact_digest"],
        restored_authority[0]["current_artifact_digest"]
    );
    assert_eq!(
        restored_authority[0]["accepted_needs_digest"],
        restored_authority[0]["current_needs_digest"]
    );
    assert!(
        restored_authority[0]["version"]
            .as_i64()
            .expect("restored CLI authority version")
            > initial_version
    );
    let mut restored_admin = runtime.admin();
    let restored_caller = restored_admin
        .connect_admin(&recovery_url)
        .await
        .expect("connect restored CLI administrator");
    auth_sdk::AuthClient::new(restored_caller)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("use restored CLI authority");
}

async fn start_fixture(user_jwt_ttl_ms: Option<u64>, use_test_oidc_provider: bool) -> Fixture {
    let mut options = trellis_test::TrellisTestRuntimeOptions::repo_platform();
    options.nats_user_jwt_ttl_ms = user_jwt_ttl_ms;
    options.use_shared_test_oidc_provider = use_test_oidc_provider;
    start_fixture_with_options(options).await
}

async fn start_fixture_with_options(options: trellis_test::TrellisTestRuntimeOptions) -> Fixture {
    let runtime = trellis_test::TrellisTestRuntime::start(options)
        .await
        .expect("start isolated trusted-portal runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first administrator bootstrap URL");
    let auth_contract = trellis_test::TrellisTestContract::from_native_api_json(
        auth_sdk::API_ID,
        auth_sdk::API_JSON,
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build Auth API reference contract");
    let base_service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        SERVICE_ID,
        API_SOURCE,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build trusted-portal base service contract");
    let mut service_participant = base_service_contract.participant().clone();
    let service_participant = service_participant
        .as_object_mut()
        .expect("service participant is an object");
    service_participant.insert(
        "uses".to_owned(),
        serde_json::json!({
            "required": {
                (auth_sdk::API_ID): {
                    "api": auth_sdk::API_ID,
                    "apiDigest": auth_contract.api_digest(),
                    "events": {
                        "subscribe": [
                            "Auth.DeviceUserAuthorities.Approved",
                            "Auth.DeviceUserAuthorities.Requested",
                            "Auth.DeviceUserAuthorities.Resolved",
                            "Auth.DeviceUserAuthorities.ReviewRequested"
                        ]
                    },
                    "rpc": {
                        "call": [
                            "Auth.DeviceUserAuthorities.List",
                            "Auth.DeviceUserAuthorities.Reviews.Decide",
                            "Auth.DeviceUserAuthorities.Reviews.List"
                        ]
                    }
                }
            }
        }),
    );
    let service_contract =
        trellis_test::TrellisTestContract::from_artifacts_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::from_native(
                base_service_contract.api().clone(),
                service_participant.clone().into(),
            )
            .referenced_api(auth_sdk::API_ID, auth_contract.api().clone())
            .build()
            .expect("compile trusted-portal service contract"),
            &[&auth_contract],
        )
        .expect("build trusted-portal service contract");
    let client_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                CLIENT_ID,
                CLIENT_ID,
                "1.0.0",
                "Trusted Portal Integration Client",
                "Exercises optional authority selected by a trusted portal.",
                trellis_rs::contracts::ContractKind::App,
            )
            .optional_use_ref(
                "service",
                trellis_rs::contracts::use_contract(SERVICE_ID)
                    .with_rpc_call(["Value.Get"])
                    .with_event_publish(["Value.Changed"]),
            )
            .use_ref(
                "auth",
                trellis_rs::contracts::use_contract(auth_sdk::API_ID).with_rpc_call([
                    "Auth.Sessions.Logout",
                    "Auth.Sessions.Me",
                    "Auth.UserIdentities.List",
                    "Auth.UserIdentities.Unlink",
                    "Auth.Users.IdentityLink.Create",
                    "Auth.Users.Password.Change",
                ]),
            ),
            &[&service_contract, &auth_contract],
        )
        .expect("build trusted-portal client contract");
    let read_capability = format!(
        "{}::read",
        service_contract
            .id()
            .strip_suffix("@v1")
            .expect("versioned trusted-portal service ID")
    );
    let publish_capability = read_capability.replace("::read", "::publish");
    let mut admin = runtime.admin();
    let participant_id = client_contract.id().to_owned();
    let portal_id = runtime.integration_name("portal");
    admin
        .put_test_login_portal(
            &bootstrap_url,
            &portal_id,
            &participant_id,
            vec!["local".to_owned(), "test-oidc".to_owned()],
        )
        .await
        .expect("create participant-scoped login portal");
    let key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision trusted-portal service");
    let mut service: ConnectedServiceRuntime<TrustedPortalServiceContract> =
        trellis_test::connect_service_runtime(runtime.trellis_url(), &key)
            .await
            .expect("connect trusted-portal service");
    service.register_rpc::<ValueGet, _, _>(|_, input| async move { Ok(input) });
    let service_handle = service.generated_handle();
    let service = AbortOnDrop(Some(tokio::spawn(async move { service.run().await })));
    let admin_caller = admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect test administrator")
        .clone();
    Fixture {
        runtime,
        admin,
        admin_caller,
        service_handle,
        bootstrap_url,
        portal_id,
        service_contract,
        client_contract,
        read_capability,
        publish_capability,
        _service: service,
    }
}

async fn provision_device_activation_case(
    fixture: &mut Fixture,
    case_id: &str,
    review_mode: &str,
) -> DeviceActivationCase {
    provision_device_activation_case_with_delegation(fixture, case_id, review_mode, true).await
}

async fn provision_device_activation_case_with_delegation(
    fixture: &mut Fixture,
    case_id: &str,
    review_mode: &str,
    requires_device_delegation: bool,
) -> DeviceActivationCase {
    let auth_contract = trellis_test::TrellisTestContract::from_native_api_json(
        auth_sdk::API_ID,
        auth_sdk::API_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build Auth API reference contract");
    let contract = trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        trellis_rs::contracts::ContractBuilder::authoring(
            format!("integration.{case_id}.device@v1"),
            format!("integration.{case_id}.device@v1"),
            "1.0.0",
            "Device Activation Integration Device",
            "Exercises current preregistered device activation.",
            trellis_rs::contracts::ContractKind::Device,
        )
        .use_ref(
            "auth",
            trellis_rs::contracts::use_contract(auth_sdk::API_ID)
                .with_rpc_call(["Auth.Sessions.Me"]),
        ),
        &[&auth_contract],
    )
    .expect("build device activation contract");
    let deployment_name = format!("{case_id}-deployment");
    fixture
        .admin
        .create_device_deployment(
            &fixture.bootstrap_url,
            &deployment_name,
            requires_device_delegation,
            review_mode,
        )
        .await
        .expect("create device deployment");
    let approval = fixture
        .admin
        .approve_contract(
            &fixture.bootstrap_url,
            &contract,
            Some(&deployment_name),
            &[trellis_test::AuthorityPlanClassification::Update],
        )
        .await
        .expect("approve device contract");
    let root_secret = rand::random::<[u8; 32]>();
    let identity = derive_device_identity(&root_secret).expect("derive device identity");
    let service_caller = fixture.admin_caller.clone();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let provisioned = auth
        .devices_provision(&auth_sdk::AuthDevicesProvisionRequest {
            deployment_id: approval.deployment_id.clone(),
            idempotency_key: format!("provision-{case_id}"),
            identity_public_key: Some(identity.public_identity_key.clone()),
            instance_id: Some(format!("{case_id}-device")),
            participant_id: Some(approval.participant_id.clone()),
        })
        .await
        .expect("provision device identity")
        .device;
    DeviceActivationCase {
        approval,
        identity,
        instance_id: provisioned.instance_id,
        principal_id: provisioned.principal_id,
    }
}

async fn connect_device_activation_user(fixture: &mut Fixture, case_id: &str) -> Caller {
    let auth_contract = trellis_test::TrellisTestContract::from_native_api_json(
        auth_sdk::API_ID,
        auth_sdk::API_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build Auth API reference contract");
    let contract = trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
        trellis_rs::contracts::ContractBuilder::authoring(
            format!("integration.{case_id}.activator@v1"),
            format!("integration.{case_id}.activator@v1"),
            "1.0.0",
            "Device Activation Integration User",
            "Exercises user activation and unprivileged review denial.",
            trellis_rs::contracts::ContractKind::App,
        )
        .use_ref(
            "auth",
            trellis_rs::contracts::use_contract(auth_sdk::API_ID)
                .with_rpc_call(["Auth.DeviceUserAuthorities.Reviews.Decide"])
                .with_operation_call(["Auth.DeviceUserAuthorities.Resolve"]),
        ),
        &[&auth_contract],
    )
    .expect("build device activator contract");
    fixture
        .admin
        .connect_new_local_user(
            &fixture.bootstrap_url,
            &contract,
            &format!("{case_id}-user"),
            &format!("{case_id}-password-123"),
        )
        .await
        .expect("connect device activation user")
}

#[tokio::test]
async fn concurrent_different_principals_claim_one_trusted_browser_flow() {
    assert_runtime_case_registered(
        "auth.concurrent-different-principal-browser-flow",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let auth_api = trellis_test::TrellisTestContract::from_native_api_json(
        trellis_runtime_apis::auth::API_ID,
        trellis_runtime_apis::auth::API_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build Auth API reference");
    let registration_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                APPROVED_CLIENT_ID,
                APPROVED_CLIENT_ID,
                "1.0.0",
                "Principal Claim Registration Client",
                "Creates users before racing one trusted browser flow.",
                trellis_rs::contracts::ContractKind::App,
            )
            .use_ref(
                "auth",
                trellis_rs::contracts::use_contract(trellis_runtime_apis::auth::API_ID)
                    .with_rpc_call(["Auth.Sessions.Me"]),
            )
            .use_ref(
                "service",
                trellis_rs::contracts::use_contract(SERVICE_ID).with_rpc_call(["Value.Get"]),
            ),
            &[&fixture.service_contract, &auth_api],
        )
        .expect("build registration client contract");
    for (username, password) in [
        ("principal-claim-a", "principal-claim-a-password-123"),
        ("principal-claim-b", "principal-claim-b-password-123"),
    ] {
        fixture
            .admin
            .register_local_browser_user(
                &fixture.bootstrap_url,
                &fixture.client_contract,
                username,
                password,
            )
            .await
            .expect("register principal claim user");
    }
    fixture
        .admin
        .put_test_login_portal(
            &fixture.bootstrap_url,
            &fixture.runtime.integration_name("principal-claim-portal"),
            registration_contract.id(),
            vec!["local".to_owned()],
        )
        .await
        .expect("create trusted principal claim portal");
    fixture
        .admin
        .put_portal_grant_override(
            &fixture.bootstrap_url,
            &fixture.runtime.integration_name("principal-claim-portal"),
            registration_contract.id(),
            None,
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("configure trusted principal claim authority");

    let flow_id = fixture
        .admin
        .start_browser_auth_flow(
            &fixture.bootstrap_url,
            &registration_contract,
            &format!(
                "{}/_trellis/test/principal-claim",
                fixture.runtime.trellis_url()
            ),
        )
        .await
        .expect("start shared browser flow");
    let (first, second) = tokio::join!(
        fixture.admin.complete_local_browser_flow(
            &flow_id,
            "principal-claim-a",
            "principal-claim-a-password-123",
        ),
        fixture.admin.complete_local_browser_flow(
            &flow_id,
            "principal-claim-b",
            "principal-claim-b-password-123",
        ),
    );
    assert_ne!(first.is_ok(), second.is_ok(), "exactly one principal wins");
    let winning_username = if first.is_ok() {
        "principal-claim-a"
    } else {
        "principal-claim-b"
    };
    let rows = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT c.normalized_username AS username, (SELECT count(*) FROM auth_identity_authorities a WHERE a.principal_id = c.principal_id AND a.participant_id = ?) AS authority_count, (SELECT count(*) FROM auth_portal_authority_bindings b WHERE b.principal_id = c.principal_id AND b.participant_id = ?) AS binding_count FROM auth_local_credentials c WHERE c.normalized_username IN (?, ?) ORDER BY c.normalized_username",
            [
                registration_contract.id(),
                registration_contract.id(),
                "principal-claim-a",
                "principal-claim-b",
            ],
        )
        .expect("query authority effects for competing principals");
    assert_eq!(rows.len(), 2);
    for row in rows {
        let username = row["username"].as_str().expect("username");
        let expected = i64::from(username == winning_username);
        assert_eq!(row["authority_count"].as_i64(), Some(expected));
        assert_eq!(row["binding_count"].as_i64(), Some(expected));
    }
}

#[tokio::test]
async fn local_login_binds_approved_client_and_calls_authorized_rpc() {
    assert_runtime_case_registered("auth.local-login-binds-approved-client", "auth", "auth");
    let mut fixture = start_fixture(None, false).await;
    let auth_api = trellis_test::TrellisTestContract::from_native_api_json(
        trellis_runtime_apis::auth::API_ID,
        trellis_runtime_apis::auth::API_JSON,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build Auth API reference");
    let client_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                APPROVED_CLIENT_ID,
                APPROVED_CLIENT_ID,
                "1.0.0",
                "Approved Integration Client",
                "Exercises approved local-user binding and authenticated RPC.",
                trellis_rs::contracts::ContractKind::App,
            )
            .use_ref(
                "service",
                trellis_rs::contracts::use_contract(SERVICE_ID).with_rpc_call(["Value.Get"]),
            )
            .use_ref(
                "auth",
                trellis_rs::contracts::use_contract(trellis_runtime_apis::auth::API_ID)
                    .with_rpc_call(["Auth.Sessions.Me"]),
            ),
            &[&fixture.service_contract, &auth_api],
        )
        .expect("build approved client contract");
    let participant_id = client_contract.id().to_owned();
    let client = fixture
        .admin
        .connect_new_local_user(
            &fixture.bootstrap_url,
            &client_contract,
            "approved-client-user",
            "approved-client-password-123",
        )
        .await
        .expect("register and bind approved local user");

    let session = auth_sdk::AuthClient::new(&client)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("read current bound session");
    assert_eq!(session.session.state, "active");
    assert_eq!(session.session.participant_kind, "app");
    assert_eq!(session.session.principal_kind, "user");
    assert_eq!(session.session.participant_id, participant_id);
    assert_eq!(
        call_value(&client, "approved")
            .await
            .expect("call authorized service RPC"),
        ValueMessage {
            value: "approved".to_owned()
        }
    );
}

#[tokio::test]
async fn portal_grant_override_binds_without_user_selected_capability() {
    assert_runtime_case_registered(
        "auth.grant-overrides-bind-without-user-capability",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let participant_id = fixture.client_contract.id().to_owned();
    fixture
        .admin
        .put_portal_grant_override(
            &fixture.bootstrap_url,
            &fixture.portal_id,
            &participant_id,
            None,
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("put portal grant override");

    let client = fixture
        .admin
        .connect_new_local_user(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "grant-override-user",
            "grant-override-password-123",
        )
        .await
        .expect("bind without selecting an optional capability");
    assert_eq!(
        call_value(&client, "override")
            .await
            .expect("call RPC granted only by portal override"),
        ValueMessage {
            value: "override".to_owned()
        }
    );
}

#[tokio::test]
async fn session_revoke_denies_reconnect() {
    assert_runtime_case_registered("auth.session-revoke-denies-reconnect", "auth", "auth");
    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "revoked-session-user",
            "revoked-session-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect session that will be revoked");
    assert_eq!(
        fixture
            .runtime
            .control_plane_sqlite()
            .query(
                "SELECT state FROM auth_sessions WHERE session_id = ?",
                [reconnect.session_id()],
            )
            .expect("query active session")[0]["state"],
        "active"
    );

    fixture
        .admin
        .revoke_session(
            &fixture.bootstrap_url,
            &auth_sdk::AuthSessionsRevokeRequest {
                expected_version: None,
                idempotency_key: "revoke-integration-session".to_owned(),
                reason: Some("integration test".to_owned()),
                session_id: reconnect.session_id().to_owned(),
            },
        )
        .await
        .expect("revoke active session through Auth admin RPC");
    wait_for_reconnect_denied(&reconnect).await;
    drop(client);
    assert_eq!(
        fixture
            .runtime
            .control_plane_sqlite()
            .query(
                "SELECT state FROM auth_sessions WHERE session_id = ?",
                [reconnect.session_id()],
            )
            .expect("query revoked session")[0]["state"],
        "revoked"
    );
}

#[tokio::test]
async fn sessions_logout_revokes_session_and_cleans_connections() {
    assert_runtime_case_registered(
        "auth.sessions-logout-deletes-session-and-connections",
        "auth",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "logout-user",
            "logout-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect session to log out");
    assert!(!fixture
        .admin
        .list_connections(&fixture.bootstrap_url, reconnect.session_id())
        .await
        .expect("list connection before logout")
        .is_empty());

    let logout = auth_sdk::AuthClient::new(&client)
        .rpc()
        .auth()
        .sessions_logout()
        .await;
    if let Err(error) = &logout {
        assert!(
            matches!(error, trellis_rs::client::CallError::Timeout)
                || matches!(error, trellis_rs::client::CallError::Transport(_)),
            "logout failed before revoking the session: {logout:?}"
        );
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if fixture
            .admin
            .list_connections(&fixture.bootstrap_url, reconnect.session_id())
            .await
            .expect("list connections after logout")
            .is_empty()
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "logout did not clear connections"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(
        fixture
            .runtime
            .control_plane_sqlite()
            .query(
                "SELECT state FROM auth_sessions WHERE session_id = ?",
                [reconnect.session_id()],
            )
            .expect("query logged-out session")[0]["state"],
        "revoked"
    );
    drop(client);
    wait_for_reconnect_denied(&reconnect).await;
}

#[tokio::test]
async fn cli_logout_then_login_replaces_persisted_session_and_retains_trust_floor() {
    assert_runtime_case_registered(
        "auth.cli-logout-new-login-retains-trust-floor",
        "auth",
        "auth",
    );
    let config = std::env::temp_dir().join(format!("trellis-cli-auth-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&config).expect("create isolated CLI config");
    std::env::set_var("XDG_CONFIG_HOME", &config);
    let store = Arc::new(FileAuthorizationContextStore::new(
        config.join("trellis/authorization-context.json"),
    ));
    let mut fixture = start_fixture(None, false).await;
    let username = "cli-logout-login-user";
    let password = "cli-logout-login-password-123";
    let (first_client, first_reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            username,
            password,
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("complete first CLI-style login");
    store
        .commit(
            first_reconnect
                .authorization_state()
                .expect("load first authorization state")
                .expect("first authorization state"),
        )
        .expect("persist first authorization state");
    call_value(&first_client, "session-a")
        .await
        .expect("call through session A");
    let first_session_id = first_reconnect.session_id().to_owned();
    let principal_id = authority_rows(&fixture.runtime, &first_session_id)[0]["principal_id"]
        .as_str()
        .expect("ordinary CLI test principal ID")
        .to_owned();
    let admin_error = fixture
        .admin
        .try_admin_login_as(username, password)
        .await
        .expect_err("ordinary user cannot complete CLI administrator login");
    assert!(
        admin_error
            .to_string()
            .contains("lacks trellis.auth::admin capability"),
        "unexpected non-admin CLI login error: {admin_error}"
    );
    let retained = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT desired_capabilities_json FROM auth_identity_authorities
             WHERE principal_id = ? AND participant_id = 'trellis-app.cli@v1'",
            [&principal_id],
        )
        .expect("query rejected CLI authority");
    assert_eq!(retained.len(), 1, "expected one ordinary CLI authority row");
    let retained_capabilities = retained[0]["desired_capabilities_json"]
        .as_str()
        .expect("desired capabilities");
    assert!(
        !retained_capabilities.contains("trellis.auth::admin"),
        "rejected ordinary user retained administrator authority: {retained_capabilities}"
    );

    let admin_auth = auth_sdk::AuthClient::new(&fixture.admin_caller)
        .rpc()
        .auth();
    admin_auth
        .portals_grant_overrides_put(&auth_sdk::AuthPortalsGrantOverridesPutRequest {
            capability_group_keys: vec!["admin".to_owned()],
            direct_capabilities: Vec::new(),
            expected_version: None,
            idempotency_key: ulid::Ulid::new().to_string(),
            participant_id: "trellis-app.cli@v1".to_owned(),
            portal_id: "builtin".to_owned(),
            role_mappings: Vec::new(),
        })
        .await
        .expect("configure trusted CLI administrator policy");
    let policy_manager_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                "integration.auth-policy-manager@v1",
                "integration.auth-policy-manager@v1",
                "1.0.0",
                "Non-admin Portal Policy Manager",
                "Proves portal grant-override policy writes require administrator authority.",
                trellis_rs::contracts::ContractKind::App,
            )
            .use_ref(
                "auth",
                trellis_rs::contracts::use_contract(auth_sdk::API_ID)
                    .with_rpc_call(["Auth.Portals.GrantOverrides.Put"]),
            ),
            &[&trellis_test::TrellisTestContract::from_native_api_json(
                auth_sdk::API_ID,
                auth_sdk::API_JSON,
                trellis_rs::contracts::ContractKind::App,
            )
            .expect("build Auth API reference contract")],
        )
        .expect("build non-admin policy manager contract");
    let policy_manager = fixture
        .admin
        .connect_new_local_user(
            &fixture.bootstrap_url,
            &policy_manager_contract,
            "policy-manager",
            "policy-manager-password-123",
        )
        .await
        .expect("connect non-admin policy manager");
    let policy_error = auth_sdk::AuthClient::new(&policy_manager)
        .rpc()
        .auth()
        .portals_grant_overrides_put(&auth_sdk::AuthPortalsGrantOverridesPutRequest {
            capability_group_keys: vec!["admin".to_owned()],
            direct_capabilities: Vec::new(),
            expected_version: None,
            idempotency_key: ulid::Ulid::new().to_string(),
            participant_id: "trellis-app.cli@v1".to_owned(),
            portal_id: "builtin".to_owned(),
            role_mappings: Vec::new(),
        })
        .await
        .expect_err("non-admin wrote trusted portal administrator policy");
    assert!(
        policy_error.to_string().contains("invalid_request"),
        "unexpected non-admin policy-write error: {policy_error}"
    );
    assert_eq!(
        fixture
            .runtime
            .control_plane_sqlite()
            .query(
                "SELECT version FROM auth_portal_grant_overrides
                 WHERE portal_id = 'builtin' AND participant_id = 'trellis-app.cli@v1'
                 AND capability_group_keys_json = '[\"admin\"]'",
                [],
            )
            .expect("query trusted portal policy")[0]["version"],
        1,
        "rejected non-admin policy write mutated the stored override"
    );
    fixture
        .admin
        .try_admin_login_as(username, password)
        .await
        .expect("trusted policy creates a second CLI administrator");
    let second_admin = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT desired_capabilities_json FROM auth_identity_authorities
             WHERE principal_id = ? AND participant_id = 'trellis-app.cli@v1' AND state = 'accepted'",
            [&principal_id],
        )
        .expect("query second CLI administrator authority");
    let capabilities = second_admin[0]["desired_capabilities_json"]
        .as_str()
        .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .expect("decode second CLI administrator capabilities");
    assert!(capabilities.contains(&"trellis.auth::admin".to_owned()));
    assert!(capabilities.contains(&"trellis.auth::capabilities.delegate".to_owned()));

    let _ = auth_sdk::AuthClient::new(&first_client)
        .rpc()
        .auth()
        .sessions_logout()
        .await;
    trellis_rs::auth::clear_admin_session().expect("clear CLI session");
    let retained = store
        .load()
        .expect("load retained trust")
        .expect("retained trust state");
    assert!(retained.context.is_none());
    assert!(retained.routing.is_none());
    wait_for_reconnect_denied(&first_reconnect).await;
    drop(first_client);

    let (second_bootstrap_client, second_reconnect) = fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            password,
        )
        .await
        .expect("complete second login");
    drop(second_bootstrap_client);
    assert_ne!(second_reconnect.session_id(), first_session_id);
    let second_client = second_reconnect
        .connect_bound_with_store(store.clone())
        .await
        .expect("connect session B through retained file store");
    call_value(&second_client, "session-b")
        .await
        .expect("call through session B");
    let replaced = store
        .load()
        .expect("load replaced session")
        .expect("replaced authorization state");
    assert_eq!(replaced.runtime.session_id, second_reconnect.session_id());
    assert_eq!(replaced.trust.root_key_id, retained.trust.root_key_id);
    assert_eq!(replaced.trust.root_digest, retained.trust.root_digest);
    assert!(
        replaced.trust.minimum_manifest_generation >= retained.trust.minimum_manifest_generation
    );
}

#[tokio::test]
async fn connections_list_skips_malformed_entries() {
    assert_runtime_case_registered(
        "auth.connections-list-skips-malformed-connection-entries",
        "auth",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "connection-list-user",
            "connection-list-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect valid session");
    fixture
        .runtime
        .seed_raw_auth_connection_presence(trellis_test::TrellisRawAuthConnectionPresence {
            key: "malformed-presence-entry".to_owned(),
            value: Value::String("not a connection record".to_owned()),
        })
        .await
        .expect("seed malformed connection presence");

    let entries = fixture
        .admin
        .list_connections(&fixture.bootstrap_url, reconnect.session_id())
        .await
        .expect("list connections despite malformed presence");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].session_id, reconnect.session_id());
    drop(client);
}

#[tokio::test]
async fn session_and_connection_inventory_report_participant_metadata() {
    assert_runtime_case_registered(
        "auth.sessions-list-and-connections-list-report-participant-metadata",
        "auth",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "inventory-user",
            "inventory-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect inventoried session");
    let expected_contract = &fixture.client_contract;
    let expected_needs_digest = expected_contract.needs_digest();
    let service_caller = fixture.admin_caller.clone();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let sessions = auth
        .sessions_list(&auth_sdk::AuthSessionsListRequest {
            cursor: None,
            deployment_id: None,
            limit: None,
            participant_id: Some(expected_contract.id().to_owned()),
            principal_id: None,
            state: Some(auth_sdk::AuthSessionsListRequestState::Active),
        })
        .await
        .expect("list participant sessions");
    let session = sessions
        .entries
        .iter()
        .find(|session| session.session_id == reconnect.session_id())
        .expect("find inventoried session");
    assert_eq!(session.participant_id, expected_contract.id());
    assert_eq!(
        session.participant_artifact_digest,
        expected_contract.digest()
    );
    assert_eq!(session.participant_needs_digest, expected_needs_digest);
    assert_eq!(session.participant_kind.as_str(), "app");

    let connections = auth
        .connections_list(&auth_sdk::AuthConnectionsListRequest {
            cursor: None,
            limit: None,
            session_id: Some(reconnect.session_id().to_owned()),
        })
        .await
        .expect("list participant connections");
    assert!(connections
        .entries
        .iter()
        .any(|connection| connection.session_id == reconnect.session_id()));
    drop(client);
}

#[tokio::test]
async fn sessions_me_rejects_stale_user_principal() {
    assert_runtime_case_registered(
        "auth.sessions-me-rejects-stale-user-principals",
        "auth",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "stale-user",
            "stale-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect user before stale-principal mutation");
    auth_sdk::AuthClient::new(&client)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("read active session before stale-principal mutation");
    let sqlite = fixture.runtime.control_plane_sqlite();
    let principal_id = sqlite
        .query(
            "SELECT principal_id FROM auth_sessions WHERE session_id = ?1",
            params![reconnect.session_id()],
        )
        .expect("read session principal")[0]["principal_id"]
        .as_str()
        .expect("session principal ID")
        .to_owned();
    assert_eq!(
        sqlite
            .execute(
                "UPDATE auth_principals SET state = 'disabled', disabled_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE principal_id = ?1",
                params![principal_id],
            )
            .expect("make session principal stale")
            .rows_affected,
        1
    );

    let error = auth_sdk::AuthClient::new(&client)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect_err("stale principal retained Sessions.Me access");
    assert!(
        error.to_string().contains("stale")
            || error.to_string().contains("inactive")
            || error.to_string().contains("disabled")
            || error.to_string().contains("not_authorized"),
        "unexpected stale-principal rejection: {error}"
    );
}

#[tokio::test]
async fn user_and_identity_surfaces_paginate_scope_and_reject_missing_unlink() {
    assert_runtime_case_registered(
        "auth.users-identities-admin-surfaces-page-and-scope",
        "auth",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let (first_client, first_reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "identity-page-user-one",
            "identity-page-password-one-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect first identity-page user");
    let (second_client, _) = fixture
        .admin
        .connect_new_local_user_with_session_seed_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "identity-page-user-two",
            "identity-page-password-two-123",
            &URL_SAFE_NO_PAD.encode([19_u8; 32]),
        )
        .await
        .expect("connect second identity-page user");
    let auth_contract = trellis_test::TrellisTestContract::from_native_api_json(
        auth_sdk::API_ID,
        auth_sdk::API_JSON,
        trellis_rs::contracts::ContractKind::App,
    )
    .expect("build Auth API reference contract");
    let revoker_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                "integration.auth-revoker@v1",
                "integration.auth-revoker@v1",
                "1.0.0",
                "Non-admin Authority Revoker",
                "Proves direct cross-account revocation requires administrator authority.",
                trellis_rs::contracts::ContractKind::App,
            )
            .use_ref(
                "auth",
                trellis_rs::contracts::use_contract(auth_sdk::API_ID).with_rpc_call([
                    "Auth.IdentityAuthority.Revoke",
                    "Auth.Users.PasswordReset.Create",
                ]),
            ),
            &[&auth_contract],
        )
        .expect("build non-admin authority revoker contract");
    let revoker = fixture
        .admin
        .connect_new_local_user(
            &fixture.bootstrap_url,
            &revoker_contract,
            "identity-page-revoker",
            "identity-page-revoker-password-123",
        )
        .await
        .expect("connect non-admin authority revoker");
    let bootstrap_principal_id = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT principal_id FROM auth_bootstrap_administrator WHERE singleton = 1",
            [],
        )
        .expect("query bootstrap administrator")[0]["principal_id"]
        .as_str()
        .expect("bootstrap administrator principal ID")
        .to_owned();
    let reset_error = auth_sdk::AuthClient::new(&revoker)
        .rpc()
        .auth()
        .users_password_reset_create(&auth_sdk::AuthUsersPasswordResetCreateRequest {
            idempotency_key: ulid::Ulid::new().to_string(),
            return_target: None,
            user_id: bootstrap_principal_id,
        })
        .await
        .expect_err("non-admin created an administrator password-reset token");
    assert!(reset_error.to_string().contains("invalid_request"));
    let target = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT a.authority_id, a.version FROM auth_identity_authorities a JOIN auth_sessions s ON s.principal_id = a.principal_id AND s.participant_id = a.participant_id WHERE s.session_id = ?",
            [first_reconnect.session_id()],
        )
        .expect("query cross-account revocation target")
        .into_iter()
        .next()
        .expect("cross-account revocation target");
    let revoke_error = auth_sdk::AuthClient::new(&revoker)
        .rpc()
        .auth()
        .identity_authority_revoke(&auth_sdk::AuthIdentityAuthorityRevokeRequest {
            authority_id: target["authority_id"]
                .as_str()
                .expect("target authority ID")
                .to_owned(),
            expected_version: target["version"]
                .as_i64()
                .expect("target authority version"),
            idempotency_key: ulid::Ulid::new().to_string(),
            reason: Some("unauthorized cross-account revocation".to_owned()),
        })
        .await
        .expect_err("non-admin revoked another principal's authority");
    assert!(revoke_error.to_string().contains("invalid_request"));
    let service_caller = fixture.admin_caller.clone();
    let admin_auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let first_page = admin_auth
        .users_list(&auth_sdk::AuthUsersListRequest {
            cursor: None,
            limit: Some(1),
            state: Some(auth_sdk::AuthUsersListRequestState::Active),
        })
        .await
        .expect("list first user page");
    assert_eq!(first_page.entries.len(), 1);
    let cursor = first_page.next_cursor.expect("first user page cursor");
    let second_page = admin_auth
        .users_list(&auth_sdk::AuthUsersListRequest {
            cursor: Some(cursor),
            limit: Some(10),
            state: Some(auth_sdk::AuthUsersListRequestState::Active),
        })
        .await
        .expect("list second user page");
    assert!(!second_page.entries.is_empty());
    let user_id = second_page.entries[0].user_id.clone();
    assert_eq!(
        admin_auth
            .users_get(&auth_sdk::AuthUsersGetRequest {
                user_id: user_id.clone(),
            })
            .await
            .expect("get paged user")
            .user
            .user_id,
        user_id
    );

    let user_auth = auth_sdk::AuthClient::new(&first_client).rpc().auth();
    assert!(!user_auth
        .user_identities_list(&auth_sdk::AuthUserIdentitiesListRequest {
            cursor: None,
            limit: Some(10),
            provider_id: None,
        })
        .await
        .expect("list caller-scoped identities")
        .entries
        .is_empty());
    let unlink_error = user_auth
        .user_identities_unlink(&auth_sdk::AuthUserIdentitiesUnlinkRequest {
            idempotency_key: "unlink-missing-identity".to_owned(),
            provider_id: "missing-provider".to_owned(),
            subject: "missing-subject".to_owned(),
        })
        .await
        .expect_err("missing identity unlink succeeded");
    assert!(
        unlink_error.to_string().contains("identity_not_found"),
        "unexpected missing identity error: {unlink_error}"
    );
    assert!(
        auth_sdk::AuthClient::new(&second_client)
            .rpc()
            .auth()
            .users_list(&auth_sdk::AuthUsersListRequest {
                cursor: None,
                limit: Some(1),
                state: None,
            })
            .await
            .is_err(),
        "non-admin caller bound the Users.List surface"
    );
}

#[tokio::test]
async fn capability_groups_validate_and_protect_builtins() {
    assert_runtime_case_registered(
        "auth.capability-groups-validate-and-protect-builtins",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let service_caller = fixture.admin_caller.clone();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    assert!(auth
        .sessions_me()
        .await
        .expect("read test administrator session")
        .user
        .and_then(|user| user.get("capabilities").cloned())
        .and_then(|capabilities| capabilities.as_array().cloned())
        .is_some_and(|capabilities| capabilities
            .iter()
            .any(|capability| capability == "trellis.auth::admin")));
    let admin_group = auth
        .capability_groups_get(&auth_sdk::AuthCapabilityGroupsGetRequest {
            group_key: "admin".to_owned(),
        })
        .await
        .expect("get built-in admin capability group")
        .group;
    assert!(
        admin_group
            .capabilities
            .contains(&"trellis.auth::admin".to_owned()),
        "admin group does not mark capability administrators"
    );
    assert_eq!(
        admin_group.capabilities,
        [
            "trellis.auth::admin",
            "trellis.auth::authorities.mutate",
            "trellis.auth::authorities.read",
            "trellis.auth::capabilities.delegate",
            "trellis.auth::capabilities.read",
            "trellis.auth::connections.kick",
            "trellis.auth::connections.read",
            "trellis.auth::deployments.mutate",
            "trellis.auth::deployments.read",
            "trellis.auth::devices.mutate",
            "trellis.auth::devices.read",
            "trellis.auth::devices.review",
            "trellis.auth::portals.mutate",
            "trellis.auth::portals.read",
            "trellis.auth::services.mutate",
            "trellis.auth::services.read",
            "trellis.auth::sessions.read",
            "trellis.auth::sessions.revoke",
            "trellis.auth::users.mutate",
            "trellis.auth::users.read",
        ]
        .map(str::to_owned)
    );
    let canonical_admin_capabilities = admin_group.capabilities.clone();
    let replace_error = auth
        .capability_groups_put(&auth_sdk::AuthCapabilityGroupsPutRequest {
            capabilities: admin_group.capabilities.clone(),
            description: admin_group.description.clone(),
            display_name: admin_group.display_name.clone(),
            expected_version: Some(admin_group.version),
            group_key: admin_group.group_key.clone(),
            idempotency_key: "replace-built-in-admin".to_owned(),
            included_groups: admin_group.included_groups.clone(),
        })
        .await
        .expect_err("built-in admin capability group was mutable");
    assert!(replace_error.to_string().contains("invalid_request"));
    let delete_error = auth
        .capability_groups_delete(&auth_sdk::AuthCapabilityGroupsDeleteRequest {
            expected_version: admin_group.version,
            group_key: admin_group.group_key,
            idempotency_key: "delete-built-in-admin".to_owned(),
        })
        .await
        .expect_err("built-in admin capability group was deletable");
    assert!(delete_error.to_string().contains("invalid_request"));
    let group_key = "integration-readers";
    let created = auth
        .capability_groups_put(&auth_sdk::AuthCapabilityGroupsPutRequest {
            capabilities: vec![fixture.read_capability.clone()],
            description: "Rust integration capability group".to_owned(),
            display_name: "Integration Readers".to_owned(),
            expected_version: None,
            group_key: group_key.to_owned(),
            idempotency_key: "put-integration-readers".to_owned(),
            included_groups: Vec::new(),
        })
        .await
        .expect("create capability group");
    assert_eq!(created.group.group_key, group_key);
    assert_eq!(
        auth.capability_groups_get(&auth_sdk::AuthCapabilityGroupsGetRequest {
            group_key: group_key.to_owned(),
        })
        .await
        .expect("get capability group")
        .group
        .capabilities,
        vec![fixture.read_capability.clone()]
    );
    assert!(auth
        .capability_groups_put(&auth_sdk::AuthCapabilityGroupsPutRequest {
            capabilities: Vec::new(),
            description: "Invalid group".to_owned(),
            display_name: "Invalid Group".to_owned(),
            expected_version: None,
            group_key: "integration-invalid".to_owned(),
            idempotency_key: "put-invalid-group".to_owned(),
            included_groups: vec!["missing-group".to_owned()],
        })
        .await
        .is_err());

    assert!(
        auth.capability_groups_delete(&auth_sdk::AuthCapabilityGroupsDeleteRequest {
            expected_version: created.group.version,
            group_key: group_key.to_owned(),
            idempotency_key: "delete-integration-readers".to_owned(),
        })
        .await
        .expect("delete custom capability group")
        .success
    );
    fixture
        .runtime
        .control_plane_sqlite()
        .execute(
            "UPDATE auth_capability_groups
             SET display_name = 'Changed', capabilities_json = '[\"custom::admin\"]'
             WHERE group_key = 'admin'",
            [],
        )
        .expect("stale persisted admin capability group");
    fixture
        .runtime
        .restart_control_plane()
        .await
        .expect("restart runtime to reconcile built-in capability groups");
    let repaired = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT display_name, capabilities_json, version
             FROM auth_capability_groups WHERE group_key = 'admin'",
            [],
        )
        .expect("query reconciled admin capability group");
    assert_eq!(repaired[0]["display_name"], "Administrator");
    assert_eq!(
        repaired[0]["capabilities_json"]
            .as_str()
            .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
            .expect("decode reconciled admin capabilities"),
        canonical_admin_capabilities
    );
    assert_eq!(
        repaired[0]["version"]
            .as_i64()
            .expect("reconciled admin group version"),
        1,
        "reconciled admin group must remain at version 1"
    );
}

#[tokio::test]
async fn auth_validation_failure_persists_no_state_or_actions() {
    assert_runtime_case_registered(
        "auth.validation-failure-persists-no-state-or-actions",
        "auth",
        "auth",
    );
    let fixture = start_fixture(None, false).await;
    let sqlite = fixture.runtime.control_plane_sqlite();
    let service_caller = fixture.admin_caller.clone();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();

    auth.users_update(&auth_sdk::AuthUsersUpdateRequest {
        email: None,
        expected_version: 1,
        idempotency_key: "validation-failure-missing-user".to_owned(),
        image: None,
        name: None,
        state: auth_sdk::AuthUsersUpdateRequestState::Disabled,
        user_id: "missing-validation-user".to_owned(),
    })
    .await
    .expect_err("missing user update passed validation");

    assert!(sqlite
        .query(
            "SELECT 1 FROM auth_principals WHERE principal_id = ?",
            ["missing-validation-user"],
        )
        .expect("query missing validation principal")
        .is_empty());
    assert!(sqlite
        .query(
            "SELECT 1 FROM auth_idempotency_results WHERE request_id = ?",
            ["validation-failure-missing-user"],
        )
        .expect("query missing validation idempotency result")
        .is_empty());
    assert!(sqlite
        .query(
            "SELECT 1 FROM auth_post_commit_actions WHERE payload_json LIKE ?",
            ["%missing-validation-user%"],
        )
        .expect("query missing validation post-commit action")
        .is_empty());
}

#[tokio::test]
async fn portal_route_selection_and_policy_drive_browser_flow() {
    assert_runtime_case_registered(
        "auth.portal-route-selection-and-policy-drive-browser-flow",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let service_caller = fixture.admin_caller.clone();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let portal_id = "integration-custom-portal";
    let portal = auth
        .portals_put(&auth_sdk::AuthPortalsPutRequest {
            disabled: false,
            display_name: "Integration Custom Portal".to_owned(),
            entry_url: None,
            expected_version: None,
            idempotency_key: "put-integration-custom-portal".to_owned(),
            login_settings: auth_sdk::AuthPortalsPutRequestLoginSettings {
                federated_registration: false,
                local_login: false,
                local_registration: false,
                providers: Some(Vec::new()),
            },
            portal_id: portal_id.to_owned(),
        })
        .await
        .expect("create custom portal");
    let participant_id = fixture.client_contract.id().to_owned();
    let route = auth
        .portals_routes_put(&auth_sdk::AuthPortalsRoutesPutRequest {
            deployment_id: None,
            expected_version: None,
            idempotency_key: "put-integration-custom-route".to_owned(),
            origin: None,
            participant_id: Some(participant_id),
            portal_id: portal_id.to_owned(),
            priority: 137,
            route_id: None,
        })
        .await
        .expect("create custom portal route")
        .route;
    assert!(auth
        .portals_routes_put(&auth_sdk::AuthPortalsRoutesPutRequest {
            deployment_id: None,
            expected_version: None,
            idempotency_key: "put-conflicting-custom-route".to_owned(),
            origin: None,
            participant_id: route.participant_id.clone(),
            portal_id: portal_id.to_owned(),
            priority: 137,
            route_id: None,
        })
        .await
        .is_err());
    let redirect = format!(
        "{}/_trellis/test/portal-route",
        fixture.runtime.trellis_url()
    );
    let flow_id = fixture
        .admin
        .start_browser_auth_flow(&fixture.bootstrap_url, &fixture.client_contract, &redirect)
        .await
        .expect("start custom portal auth flow");
    let selected: Value = reqwest::get(format!(
        "{}/auth/flow/{flow_id}",
        fixture.runtime.trellis_url()
    ))
    .await
    .expect("fetch selected custom flow")
    .error_for_status()
    .expect("custom flow status")
    .json()
    .await
    .expect("decode custom flow");
    assert_eq!(selected["providers"], serde_json::json!([]));
    assert_eq!(selected["registrationEnabled"], false);

    auth.portals_put(&auth_sdk::AuthPortalsPutRequest {
        disabled: true,
        display_name: portal.portal.display_name,
        entry_url: portal.portal.entry_url,
        expected_version: Some(portal.portal.version),
        idempotency_key: "disable-integration-custom-portal".to_owned(),
        login_settings: auth_sdk::AuthPortalsPutRequestLoginSettings {
            federated_registration: false,
            local_login: false,
            local_registration: false,
            providers: Some(Vec::new()),
        },
        portal_id: portal_id.to_owned(),
    })
    .await
    .expect("disable custom portal");
    let fallback_flow = fixture
        .admin
        .start_browser_auth_flow(&fixture.bootstrap_url, &fixture.client_contract, &redirect)
        .await
        .expect("start fallback portal auth flow");
    let fallback: Value = reqwest::get(format!(
        "{}/auth/flow/{fallback_flow}",
        fixture.runtime.trellis_url()
    ))
    .await
    .expect("fetch fallback flow")
    .error_for_status()
    .expect("fallback flow status")
    .json()
    .await
    .expect("decode fallback flow");
    assert!(fallback["providers"]
        .as_array()
        .expect("fallback providers")
        .iter()
        .any(|provider| provider == "local"));
    assert_eq!(fallback["registrationEnabled"], true);

    auth.portals_routes_remove(&auth_sdk::AuthPortalsRoutesRemoveRequest {
        expected_version: route.version,
        idempotency_key: "remove-integration-custom-route".to_owned(),
        route_id: route.route_id,
    })
    .await
    .expect("remove custom portal route");
    assert!(auth
        .portals_remove(&auth_sdk::AuthPortalsRemoveRequest {
            expected_version: 1,
            idempotency_key: "remove-builtin-portal".to_owned(),
            portal_id: "builtin".to_owned(),
        })
        .await
        .is_err());
}

#[tokio::test]
async fn account_flow_oauth_callback_handles_errors_mismatch_and_link() {
    assert_runtime_case_registered("auth.account-flow-oauth-callback-runtime", "auth", "auth");
    let mut fixture = start_fixture(None, true).await;
    let service_caller = fixture.admin_caller.clone();
    let admin_auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let builtin = admin_auth
        .portals_list(&auth_sdk::AuthPortalsListRequest {
            cursor: None,
            disabled: None,
            limit: Some(100),
        })
        .await
        .expect("list OIDC portals")
        .entries
        .into_iter()
        .find(|portal| portal.portal_id == "builtin")
        .expect("built-in OIDC portal");
    fixture
        .admin
        .update_login_providers(
            &fixture.bootstrap_url,
            builtin.version,
            vec![
                "local".to_owned(),
                "test-oidc".to_owned(),
                "other-oidc".to_owned(),
            ],
        )
        .await
        .expect("enable test OIDC providers");
    let (user, _) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "account-flow-oauth-user",
            "account-flow-oauth-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect account-flow OAuth user");
    let user_auth = auth_sdk::AuthClient::new(&user).rpc().auth();

    let denied = user_auth
        .users_identity_link_create(&auth_sdk::AuthUsersIdentityLinkCreateRequest {
            allowed_providers: vec!["test-oidc".to_owned()],
            idempotency_key: "oauth-provider-error-flow".to_owned(),
            return_target: None,
        })
        .await
        .expect("create provider-error identity flow");
    let (status, body, _) = fixture
        .admin
        .complete_test_oidc_account_flow(
            &denied.flow.completion_url,
            "test-oidc",
            "test-oidc",
            true,
        )
        .await
        .expect("complete provider-error callback");
    assert_eq!(status, 400, "provider-error body: {body}");

    let mismatched = user_auth
        .users_identity_link_create(&auth_sdk::AuthUsersIdentityLinkCreateRequest {
            allowed_providers: vec!["test-oidc".to_owned()],
            idempotency_key: "oauth-provider-mismatch-flow".to_owned(),
            return_target: None,
        })
        .await
        .expect("create provider-mismatch identity flow");
    let (status, body, _) = fixture
        .admin
        .complete_test_oidc_account_flow(
            &mismatched.flow.completion_url,
            "test-oidc",
            "other-oidc",
            false,
        )
        .await
        .expect("complete provider-mismatch callback");
    assert_eq!(status, 400, "provider-mismatch body: {body}");

    fixture
        .admin
        .set_test_oidc_claims(serde_json::json!({ "roles": ["linked"] }))
        .await
        .expect("set account-flow OIDC claims");
    let linked = user_auth
        .users_identity_link_create(&auth_sdk::AuthUsersIdentityLinkCreateRequest {
            allowed_providers: vec!["test-oidc".to_owned()],
            idempotency_key: "oauth-success-flow".to_owned(),
            return_target: None,
        })
        .await
        .expect("create successful identity flow");
    let (status, body, location) = fixture
        .admin
        .complete_test_oidc_account_flow(
            &linked.flow.completion_url,
            "test-oidc",
            "test-oidc",
            false,
        )
        .await
        .expect("complete successful identity callback");
    assert_eq!(status, 307, "successful callback body: {body}");
    assert!(location
        .as_deref()
        .is_some_and(|value| value.contains("/login/account/complete")));
    assert!(user_auth
        .user_identities_list(&auth_sdk::AuthUserIdentitiesListRequest {
            cursor: None,
            limit: Some(100),
            provider_id: Some("test-oidc".to_owned()),
        })
        .await
        .expect("list linked OIDC identity")
        .entries
        .iter()
        .any(|identity| identity.provider_id == "test-oidc"));
}

#[tokio::test]
async fn local_login_rebinds_with_updated_authority() {
    assert_runtime_case_registered(
        "auth.local-login-rebinds-existing-session-with-updated-authority",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let username = "rebound-authority-user";
    let password = "rebound-authority-password-123";
    let session_seed = URL_SAFE_NO_PAD.encode([14_u8; 32]);
    let (first_client, first_reconnect) = fixture
        .admin
        .connect_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            trellis_test::TrustedLocalUserRegistration {
                portal_id: fixture.portal_id.clone(),
                username: username.to_owned(),
                password: password.to_owned(),
                capabilities: vec![fixture.read_capability.clone()],
                session_seed: session_seed.clone(),
            },
        )
        .await
        .expect("establish initial local-user authority");
    drop(first_client);
    let first_session = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT session_id, principal_id, session_key_id, created_at FROM auth_sessions WHERE session_id = ?",
            [first_reconnect.session_id()],
        )
        .expect("query initial bound session")
        .remove(0);
    assert_eq!(
        wait_for_authority(
            &fixture.runtime,
            first_reconnect.session_id(),
            "accepted",
            &[fixture.read_capability.as_str()],
        )
        .await["version"],
        1
    );

    let read_capability = fixture.read_capability.clone();
    let publish_capability = fixture.publish_capability.clone();
    update_policy(
        &mut fixture,
        vec![read_capability.clone(), publish_capability.clone()],
    )
    .await;
    let (rebound_client, rebound) = fixture
        .admin
        .connect_local_user_for_portal_with_session_seed_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            password,
            &session_seed,
        )
        .await
        .expect("rebind existing local identity after policy update");

    assert_eq!(first_reconnect.session_id(), rebound.session_id());
    let rebound_session = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT session_id, principal_id, session_key_id, created_at FROM auth_sessions WHERE session_id = ?",
            [rebound.session_id()],
        )
        .expect("query rebound session")
        .remove(0);
    assert_eq!(
        rebound_session["principal_id"],
        first_session["principal_id"]
    );
    assert_eq!(
        rebound_session["session_key_id"],
        first_session["session_key_id"]
    );
    assert_eq!(rebound_session["created_at"], first_session["created_at"]);
    assert_eq!(
        wait_for_authority(
            &fixture.runtime,
            rebound.session_id(),
            "accepted",
            &[publish_capability.as_str(), read_capability.as_str()],
        )
        .await["version"],
        2
    );
    assert_eq!(
        call_value(&rebound_client, "rebound")
            .await
            .expect("call service with rebound authority"),
        ValueMessage {
            value: "rebound".to_owned()
        }
    );
    rebound_client
        .publish::<ValueChanged>(&ValueMessage {
            value: "expanded".to_owned(),
        })
        .await
        .expect("publish with expanded rebound authority");

    drop(rebound_client);
    let (replacement_client, replacement) = fixture
        .admin
        .connect_new_local_user_with_session_seed_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "replacement-authority-user",
            "replacement-authority-password-123",
            session_seed,
        )
        .await
        .expect("bind the session key to a different local identity");
    drop(replacement_client);
    assert_ne!(replacement.session_id(), rebound.session_id());
    let replacement_session = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT principal_id, session_key_id FROM auth_sessions WHERE session_id = ?",
            [replacement.session_id()],
        )
        .expect("query replacement session")
        .remove(0);
    assert_ne!(
        replacement_session["principal_id"],
        first_session["principal_id"]
    );
    assert_eq!(
        replacement_session["session_key_id"],
        first_session["session_key_id"]
    );
    assert!(fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT session_id FROM auth_sessions WHERE session_id = ?",
            [rebound.session_id()],
        )
        .expect("query replaced session")
        .is_empty());
}

#[tokio::test]
async fn password_reset_and_change_invalidate_old_credentials() {
    assert_runtime_case_registered(
        "control-plane.password-reset-change-invalidates-old-password",
        "control-plane",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let username = "password-change-user";
    let old_password = "password-reset-old-123";
    let reset_password = "password-reset-new-456";
    let final_password = "password-change-final-789";
    let (old_session, old_reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            username,
            old_password,
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect password-reset target");
    let principal_id = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT principal_id FROM auth_local_credentials WHERE normalized_username = ?",
            [username],
        )
        .expect("query password-reset principal")[0]["principal_id"]
        .as_str()
        .expect("password-reset principal ID")
        .to_owned();
    let service_caller = fixture.admin_caller.clone();
    let reset = auth_sdk::AuthClient::new(&service_caller)
        .rpc()
        .auth()
        .users_password_reset_create(&auth_sdk::AuthUsersPasswordResetCreateRequest {
            idempotency_key: "create-password-reset-integration".to_owned(),
            return_target: None,
            user_id: principal_id,
        })
        .await
        .expect("create password reset flow");
    fixture
        .admin
        .complete_local_password_flow(&reset.flow.completion_url, reset_password)
        .await
        .expect("complete password reset flow");
    drop(old_session);
    assert!(
        old_reconnect.connect_bound_only().await.is_err(),
        "password reset left old session active"
    );
    assert!(fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            old_password,
        )
        .await
        .is_err());

    let (current, current_reconnect) = fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            reset_password,
        )
        .await
        .expect("log in with reset password");
    let (sibling, sibling_reconnect) = fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            reset_password,
        )
        .await
        .expect("connect sibling password session");
    drop(sibling);
    drop(current);
    let current = current_reconnect
        .connect_bound_only()
        .await
        .expect("refresh current password session context");

    let response = auth_sdk::AuthClient::new(&current)
        .rpc()
        .auth()
        .users_password_change(&auth_sdk::AuthUsersPasswordChangeRequest {
            current_password: reset_password.to_owned(),
            idempotency_key: "change-password-integration".to_owned(),
            new_password: final_password.to_owned(),
        })
        .await
        .expect("change account password");
    assert!(response.revoked_session_count >= 1);
    assert!(
        sibling_reconnect.connect_bound_only().await.is_err(),
        "sibling session survived password change"
    );
    assert!(fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            reset_password,
        )
        .await
        .is_err());
    let (replacement, _) = fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            username,
            final_password,
        )
        .await
        .expect("log in with changed password");
    auth_sdk::AuthClient::new(&replacement)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("use replacement password session");
}

#[tokio::test]
async fn sessions_survive_control_plane_restart() {
    assert_runtime_case_registered(
        "control-plane.sessions-survive-control-plane-restart",
        "control-plane",
        "auth",
    );

    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "restart-session-user",
            "restart-session-password-123",
            vec![fixture.publish_capability.clone()],
        )
        .await
        .expect("connect user before restart");
    drop(client);

    fixture
        .runtime
        .restart_control_plane()
        .await
        .expect("restart control plane");
    let reconnected = reconnect
        .connect_bound_only()
        .await
        .expect("reconnect persisted session after restart");
    reconnected
        .publish::<ValueChanged>(&ValueMessage {
            value: "after restart".to_owned(),
        })
        .await
        .expect("use persisted authority after restart");
}

#[tokio::test]
async fn admin_service_deployment_lifecycle_controls_bootstrap() {
    assert_runtime_case_registered(
        "control-plane.admin-service-deployment-lifecycle",
        "control-plane",
        "auth",
    );
    let fixture = start_fixture(None, false).await;
    let service_caller = fixture.admin_caller.clone();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let created = auth
        .deployments_create(&auth_sdk::AuthDeploymentsCreateRequest {
            display_name: "Lifecycle Deployment".to_owned(),
            expires_at: None,
            idempotency_key: "create-lifecycle-deployment".to_owned(),
            kind: auth_sdk::AuthDeploymentsCreateRequestKind::Service,
            participant_id: None,
            portal_id: None,
            requires_device_delegation: false,
            review_mode: None,
        })
        .await
        .expect("create lifecycle deployment")
        .deployment;
    let deployment_id = created.deployment_id;
    assert_eq!(created.version, 1);
    auth.deployments_disable(&auth_sdk::AuthDeploymentsDisableRequest {
        deployment_id: deployment_id.clone(),
        expected_version: 1,
        idempotency_key: "disable-lifecycle-deployment".to_owned(),
        reason: Some("lifecycle integration test".to_owned()),
    })
    .await
    .expect("disable lifecycle deployment");
    auth.deployments_enable(&auth_sdk::AuthDeploymentsEnableRequest {
        deployment_id: deployment_id.clone(),
        expected_version: 2,
        idempotency_key: "enable-lifecycle-deployment".to_owned(),
        reason: Some("lifecycle integration test".to_owned()),
    })
    .await
    .expect("enable lifecycle deployment");
    auth.deployments_remove(&auth_sdk::AuthDeploymentsRemoveRequest {
        deployment_id: deployment_id.clone(),
        expected_version: 3,
        idempotency_key: "remove-lifecycle-deployment".to_owned(),
        reason: Some("lifecycle integration test".to_owned()),
    })
    .await
    .expect("remove lifecycle deployment");
    let removed = auth
        .deployments_list(&auth_sdk::AuthDeploymentsListRequest {
            cursor: None,
            kind: None,
            limit: None,
            state: Some(auth_sdk::AuthDeploymentsListRequestState::Revoked),
        })
        .await
        .expect("list removed deployments");
    assert!(removed
        .entries
        .iter()
        .any(|deployment| deployment.deployment_id == deployment_id && deployment.version == 4));
}

#[tokio::test]
async fn device_activation_without_review_connects_and_revocation_denies_reuse() {
    run_device_activation_without_review("auth.device-activation-none-connect-revoke", true).await;
}

#[tokio::test]
async fn rust_device_activation_client_reaches_rust_owner() {
    run_device_activation_without_review("state.activated-devices-rust-owner", false).await;
}

async fn run_device_activation_without_review(case_id: &str, runtime_case: bool) {
    if runtime_case {
        assert_runtime_case_registered(case_id, "auth", "auth");
    } else {
        assert_case_registered(case_id, "state", "auth");
    }
    let mut fixture = start_fixture(None, false).await;
    let device = provision_device_activation_case(&mut fixture, case_id, "none").await;
    let trellis_url = fixture.runtime.trellis_url().to_owned();
    let activation = device.activation_options(&trellis_url);
    let pending = match check_device_activation(&activation)
        .await
        .expect("start device activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unactivated device was ready"),
    };
    assert!(pending.activation_url.contains(&pending.review_id));
    assert!(Caller::connect_device(device.connect_options(&trellis_url))
        .await
        .is_err());

    let user = connect_device_activation_user(&mut fixture, case_id).await;
    let operation = auth_sdk::AuthClient::new(&user)
        .operation()
        .auth()
        .device_user_authorities_resolve();
    let operation = operation
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: pending.confirmation_code.clone(),
            flow_id: pending.review_id.clone(),
        })
        .await
        .expect("start no-review activation operation");
    let terminal = operation
        .wait()
        .await
        .expect("wait for no-review activation");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    let session = wait_for_device_activation(&activation, &pending, Duration::from_secs(20))
        .await
        .expect("observe ready device activation");

    let connected = Caller::connect_device(
        activation
            .into_connect_options(session)
            .expect("activation session origin"),
    )
    .await
    .expect("connect activated device");
    let session = auth_sdk::AuthClient::new(&connected)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("project device session");
    assert_eq!(session.session.principal_kind, "device");
    assert_eq!(session.session.principal_id, device.principal_id);

    let service_caller = fixture.admin_caller.clone();

    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let authorities = auth
        .device_user_authorities_list(&auth_sdk::AuthDeviceUserAuthoritiesListRequest {
            cursor: None,
            deployment_id: Some(device.approval.deployment_id.clone()),
            limit: None,
            principal_id: Some(device.principal_id.clone()),
        })
        .await
        .expect("list activated device authority");
    assert_eq!(authorities.entries.len(), 1);
    assert_eq!(
        authorities.entries[0].device.administrative_approval,
        "approved"
    );
    auth.device_user_authorities_revoke(&auth_sdk::AuthDeviceUserAuthoritiesRevokeRequest {
        deployment_id: device.approval.deployment_id.clone(),
        device_principal_id: device.principal_id.clone(),
        idempotency_key: format!("revoke-device-none-{case_id}"),
        reason: Some("live activation revocation".to_owned()),
    })
    .await
    .expect("revoke device activation");
    assert!(Caller::connect_device(device.connect_options(&trellis_url))
        .await
        .is_err());
}

#[tokio::test]
async fn device_activation_required_review_needs_privileged_decision() {
    assert_runtime_case_registered("auth.device-activation-required-review", "auth", "auth");
    let mut fixture = start_fixture(None, false).await;
    let device =
        provision_device_activation_case(&mut fixture, "device-required", "required").await;
    let trellis_url = fixture.runtime.trellis_url().to_owned();
    let activation = device.activation_options(&trellis_url);
    let pending = match check_device_activation(&activation)
        .await
        .expect("start required-review activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unreviewed device was ready"),
    };
    let user = connect_device_activation_user(&mut fixture, "device-required").await;
    let operation = auth_sdk::AuthClient::new(&user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: pending.confirmation_code.clone(),
            flow_id: pending.review_id.clone(),
        })
        .await
        .expect("start required-review operation");
    let mut wait = Box::pin(operation.wait());
    assert!(auth_sdk::AuthClient::new(&user)
        .rpc()
        .auth()
        .device_user_authorities_reviews_decide(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequest {
                decision: auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequestDecision::Approve,
                expected_version: 2,
                idempotency_key: "unauthorized-device-review".to_owned(),
                reason: None,
                review_id: pending.review_id.clone(),
            },
        )
        .await
        .is_err());

    let service_caller = fixture.service_handle.caller();

    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let reviews = auth
        .device_user_authorities_reviews_list(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequest {
                cursor: None,
                deployment_id: Some(device.approval.deployment_id.clone()),
                limit: None,
                state: Some(auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequestState::Pending),
            },
        )
        .await
        .expect("list deployment-scoped pending review");
    let review = reviews
        .entries
        .iter()
        .find(|review| review.review_id == pending.review_id)
        .expect("find claimed review");
    assert!(review.activated_by_user_principal_id.is_some());
    auth.device_user_authorities_reviews_decide(
        &auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequest {
            decision: auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequestDecision::Approve,
            expected_version: review.version,
            idempotency_key: "approve-device-required".to_owned(),
            reason: None,
            review_id: pending.review_id.clone(),
        },
    )
    .await
    .expect("approve required device review");
    let terminal = tokio::time::timeout(Duration::from_secs(5), &mut wait)
        .await
        .expect("review decision did not notify the operation waiter")
        .expect("wait for reviewed activation");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    let session = wait_for_device_activation(&activation, &pending, Duration::from_secs(20))
        .await
        .expect("observe approved activation");
    Caller::connect_device(
        activation
            .into_connect_options(session)
            .expect("activation session origin"),
    )
    .await
    .expect("connect reviewed device");

    let rejected_device =
        provision_device_activation_case(&mut fixture, "device-required-rejected", "required")
            .await;
    let rejected_activation = rejected_device.activation_options(&trellis_url);
    let rejected_pending = match check_device_activation(&rejected_activation)
        .await
        .expect("start rejected device activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unreviewed rejected device was ready"),
    };
    let rejected_operation = auth_sdk::AuthClient::new(&user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: rejected_pending.confirmation_code.clone(),
            flow_id: rejected_pending.review_id.clone(),
        })
        .await
        .expect("start rejected activation operation");
    let rejected_reviews = auth
        .device_user_authorities_reviews_list(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequest {
                cursor: None,
                deployment_id: Some(rejected_device.approval.deployment_id.clone()),
                limit: None,
                state: Some(auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequestState::Pending),
            },
        )
        .await
        .expect("list rejected device review");
    let rejected_review = rejected_reviews
        .entries
        .iter()
        .find(|review| review.review_id == rejected_pending.review_id)
        .expect("find rejected device review");
    auth.device_user_authorities_reviews_decide(
        &auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequest {
            decision: auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequestDecision::Reject,
            expected_version: rejected_review.version,
            idempotency_key: "reject-device-required".to_owned(),
            reason: Some("integration rejection".to_owned()),
            review_id: rejected_pending.review_id.clone(),
        },
    )
    .await
    .expect("reject required device review");
    let rejected_terminal = rejected_operation
        .wait()
        .await
        .expect("wait for rejected activation");
    assert_eq!(rejected_terminal.state, ClientOperationState::Completed);
    assert!(matches!(
        check_device_activation(&rejected_activation).await,
        Err(trellis_rs::auth::DeviceActivationError::Rejected)
    ));
    assert!(
        Caller::connect_device(rejected_device.connect_options(&trellis_url))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn device_activation_wait_is_event_driven() {
    assert_runtime_case_registered(
        "auth.device-activation-wait-is-event-driven",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let device =
        provision_device_activation_case(&mut fixture, "device-event-driven-wait", "required")
            .await;
    let activation = device.activation_options(fixture.runtime.trellis_url());
    let pending = match check_device_activation(&activation)
        .await
        .expect("start event-driven-wait activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unreviewed device was ready"),
    };
    let user = connect_device_activation_user(&mut fixture, "device-event-driven-wait").await;
    let operation = auth_sdk::AuthClient::new(&user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: pending.confirmation_code,
            flow_id: pending.review_id.clone(),
        })
        .await
        .expect("claim event-driven-wait review");
    let mut wait = Box::pin(operation.wait());
    tokio::select! {
        result = &mut wait => panic!("review wait completed before approval: {result:?}"),
        () = tokio::time::sleep(Duration::from_millis(1_100)) => {}
    }
    let service_caller = fixture.service_handle.caller();
    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let reviews = auth
        .device_user_authorities_reviews_list(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequest {
                cursor: None,
                deployment_id: Some(device.approval.deployment_id.clone()),
                limit: None,
                state: Some(auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequestState::Pending),
            },
        )
        .await
        .expect("list review for event-driven approval");
    let review = reviews
        .entries
        .iter()
        .find(|review| review.review_id == pending.review_id)
        .expect("find event-driven-wait review");
    auth.device_user_authorities_reviews_decide(
        &auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequest {
            decision: auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequestDecision::Approve,
            expected_version: review.version,
            idempotency_key: "approve-event-driven-wait".to_owned(),
            reason: None,
            review_id: pending.review_id.clone(),
        },
    )
    .await
    .expect("approve event-driven-wait review");
    let terminal = tokio::time::timeout(Duration::from_secs(2), &mut wait)
        .await
        .expect("approval did not promptly wake the operation wait")
        .expect("observe approved event-driven operation");
    assert_eq!(terminal.state, ClientOperationState::Completed);
}

#[tokio::test]
async fn device_activation_events_follow_effective_state() {
    assert_runtime_case_registered(
        "auth.device-activation-events-follow-effective-state",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let device =
        provision_device_activation_case(&mut fixture, "device-event-order", "required").await;
    let user = connect_device_activation_user(&mut fixture, "device-event-order").await;
    let observer = async_nats::ConnectOptions::new()
        .credentials_file(
            fixture
                .runtime
                .workdir()
                .join("nats/creds/trellis-auth.creds"),
        )
        .await
        .expect("load event-order observer credentials")
        .connect(fixture.runtime.nats_url())
        .await
        .expect("connect event-order observer");
    let event_subject = format!(
        "events.v1.Auth.DeviceUserAuthorities.*.{}",
        device.approval.deployment_id,
    );
    let mut events = observer
        .subscribe(event_subject)
        .await
        .expect("subscribe to activation lifecycle events");
    observer.flush().await.expect("flush event-order observer");

    let activation = device.activation_options(fixture.runtime.trellis_url());
    let pending = match check_device_activation(&activation)
        .await
        .expect("start event-order activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unreviewed device was ready"),
    };
    let review_requested = tokio::time::timeout(Duration::from_secs(5), events.next())
        .await
        .expect("ReviewRequested event was not published")
        .expect("activation lifecycle event stream ended");
    assert!(review_requested
        .subject
        .as_str()
        .contains(".ReviewRequested."));
    assert!(matches!(
        check_device_activation(&activation).await,
        Ok(DeviceActivationStatus::Pending(_))
    ));

    let operation = auth_sdk::AuthClient::new(&user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: pending.confirmation_code,
            flow_id: pending.review_id.clone(),
        })
        .await
        .expect("claim event-order activation review");
    let requested = tokio::time::timeout(Duration::from_secs(5), events.next())
        .await
        .expect("Requested event was not published")
        .expect("activation lifecycle event stream ended");
    assert!(requested.subject.as_str().contains(".Requested."));
    assert!(matches!(
        check_device_activation(&activation).await,
        Ok(DeviceActivationStatus::Pending(_))
    ));

    let service_caller = fixture.service_handle.caller();

    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let reviews = auth
        .device_user_authorities_reviews_list(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequest {
                cursor: None,
                deployment_id: Some(device.approval.deployment_id.clone()),
                limit: None,
                state: Some(auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequestState::Pending),
            },
        )
        .await
        .expect("list event-order activation review");
    let review = reviews
        .entries
        .iter()
        .find(|review| review.review_id == pending.review_id)
        .expect("find event-order activation review");
    auth.device_user_authorities_reviews_decide(
        &auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequest {
            decision: auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequestDecision::Approve,
            expected_version: review.version,
            idempotency_key: "approve-device-event-order".to_owned(),
            reason: None,
            review_id: pending.review_id.clone(),
        },
    )
    .await
    .expect("approve event-order activation review");
    let approved = tokio::time::timeout(Duration::from_secs(5), events.next())
        .await
        .expect("Approved event was not published")
        .expect("activation lifecycle event stream ended");
    assert!(approved.subject.as_str().contains(".Approved."));
    let authorities = auth
        .device_user_authorities_list(&auth_sdk::AuthDeviceUserAuthoritiesListRequest {
            cursor: None,
            deployment_id: Some(device.approval.deployment_id.clone()),
            limit: None,
            principal_id: Some(device.principal_id.clone()),
        })
        .await
        .expect("inspect authority at Approved event");
    assert_eq!(authorities.entries.len(), 1);
    assert_eq!(authorities.entries[0].device.state, "active");
    assert_eq!(authorities.entries[0].device.delegation_state, "active");
    let resolved = tokio::time::timeout(Duration::from_secs(5), events.next())
        .await
        .expect("Resolved event was not published")
        .expect("activation lifecycle event stream ended");
    assert!(resolved.subject.as_str().contains(".Resolved."));
    assert!(matches!(
        check_device_activation(&activation).await,
        Ok(DeviceActivationStatus::Ready(_))
    ));
    assert_eq!(
        operation
            .wait()
            .await
            .expect("observe event-order operation completion")
            .state,
        ClientOperationState::Completed,
    );

    let no_review =
        provision_device_activation_case(&mut fixture, "device-event-order-none", "none").await;
    let no_review_user =
        connect_device_activation_user(&mut fixture, "device-event-order-none").await;
    let no_review_subject = format!(
        "events.v1.Auth.DeviceUserAuthorities.*.{}",
        no_review.approval.deployment_id,
    );
    let mut no_review_events = observer
        .subscribe(no_review_subject)
        .await
        .expect("subscribe to no-review activation lifecycle events");
    observer
        .flush()
        .await
        .expect("flush no-review event observer");
    let no_review_activation = no_review.activation_options(fixture.runtime.trellis_url());
    let no_review_pending = match check_device_activation(&no_review_activation)
        .await
        .expect("start no-review event-order activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unactivated no-review device was ready"),
    };
    let no_review_operation = auth_sdk::AuthClient::new(&no_review_user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: no_review_pending.confirmation_code,
            flow_id: no_review_pending.review_id,
        })
        .await
        .expect("start no-review event-order activation");
    for expected in [".Requested.", ".Approved.", ".Resolved."] {
        let event = tokio::time::timeout(Duration::from_secs(5), no_review_events.next())
            .await
            .unwrap_or_else(|_| panic!("{expected} no-review event was not published"))
            .expect("no-review activation lifecycle event stream ended");
        assert!(
            event.subject.as_str().contains(expected),
            "expected {expected}, received {}",
            event.subject
        );
    }
    let no_review_caller = fixture.admin_caller.clone();
    let no_review_auth = auth_sdk::AuthClient::new(&no_review_caller).rpc().auth();
    let authorities = no_review_auth
        .device_user_authorities_list(&auth_sdk::AuthDeviceUserAuthoritiesListRequest {
            cursor: None,
            deployment_id: Some(no_review.approval.deployment_id.clone()),
            limit: None,
            principal_id: Some(no_review.principal_id.clone()),
        })
        .await
        .expect("inspect no-review authority at Resolved event");
    assert_eq!(authorities.entries.len(), 1);
    assert_eq!(authorities.entries[0].device.state, "active");
    assert_eq!(authorities.entries[0].device.delegation_state, "active");
    assert!(matches!(
        check_device_activation(&no_review_activation).await,
        Ok(DeviceActivationStatus::Ready(_))
    ));
    assert_eq!(
        no_review_operation
            .wait()
            .await
            .expect("observe no-review event-order operation completion")
            .state,
        ClientOperationState::Completed,
    );
    assert!(
        tokio::time::timeout(Duration::from_secs(1), no_review_events.next())
            .await
            .is_err(),
        "no-review activation emitted an unexpected fourth lifecycle event"
    );
}

#[tokio::test]
async fn device_activation_approved_unclaimed_cannot_complete_delegation() {
    assert_runtime_case_registered(
        "auth.device-activation-approved-unclaimed-cannot-complete-delegation",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let device =
        provision_device_activation_case(&mut fixture, "device-approval-before-claim", "required")
            .await;
    let trellis_url = fixture.runtime.trellis_url().to_owned();
    let activation = device.activation_options(&trellis_url);
    let pending = match check_device_activation(&activation)
        .await
        .expect("start approval-before-claim activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unreviewed device was ready"),
    };
    let first_user = connect_device_activation_user(&mut fixture, "device-first-claimant").await;
    let second_user = connect_device_activation_user(&mut fixture, "device-second-claimant").await;

    let observer = async_nats::ConnectOptions::new()
        .credentials_file(
            fixture
                .runtime
                .workdir()
                .join("nats/creds/trellis-auth.creds"),
        )
        .await
        .expect("load activation observer credentials")
        .connect(fixture.runtime.nats_url())
        .await
        .expect("connect activation event observer");
    let resolved_subject = format!(
        "{}.{}",
        auth_sdk::events::AuthDeviceUserAuthoritiesResolvedEventDescriptor::SUBJECT,
        device.approval.deployment_id,
    );
    let mut resolved_events = observer
        .subscribe(resolved_subject)
        .await
        .expect("subscribe to resolved activation events");
    observer
        .flush()
        .await
        .expect("flush activation event observer");

    let service_caller = fixture.service_handle.caller();

    let auth = auth_sdk::AuthClient::new(&service_caller).rpc().auth();
    let reviews = auth
        .device_user_authorities_reviews_list(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequest {
                cursor: None,
                deployment_id: Some(device.approval.deployment_id.clone()),
                limit: None,
                state: Some(auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequestState::Pending),
            },
        )
        .await
        .expect("list unclaimed activation review");
    let review = reviews
        .entries
        .iter()
        .find(|review| review.review_id == pending.review_id)
        .expect("find unclaimed activation review");
    assert!(review.activated_by_user_principal_id.is_none());
    let approved = auth
        .device_user_authorities_reviews_decide(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequest {
                decision: auth_sdk::AuthDeviceUserAuthoritiesReviewsDecideRequestDecision::Approve,
                expected_version: review.version,
                idempotency_key: "approve-device-before-claim".to_owned(),
                reason: None,
                review_id: pending.review_id.clone(),
            },
        )
        .await
        .expect("approve unclaimed activation review")
        .review;
    assert!(approved.activated_by_user_principal_id.is_none());
    assert!(
        tokio::time::timeout(Duration::from_millis(300), resolved_events.next())
            .await
            .is_err()
    );
    match check_device_activation(&activation).await {
        Ok(DeviceActivationStatus::Pending(current)) => {
            assert_eq!(current.review_id, pending.review_id)
        }
        result => panic!("approved unclaimed activation was not pending: {result:?}"),
    }

    let operation = auth_sdk::AuthClient::new(&first_user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: pending.confirmation_code.clone(),
            flow_id: pending.review_id.clone(),
        })
        .await
        .expect("claim approved activation review");
    assert!(auth_sdk::AuthClient::new(&second_user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: pending.confirmation_code.clone(),
            flow_id: pending.review_id.clone(),
        })
        .await
        .is_err());
    tokio::time::timeout(Duration::from_secs(5), resolved_events.next())
        .await
        .expect("active resolution event was not published")
        .expect("resolved activation event stream ended");
    let session = match check_device_activation(&activation)
        .await
        .expect("resolved event must follow ready activation state")
    {
        DeviceActivationStatus::Ready(session) => session,
        DeviceActivationStatus::Pending(_) => panic!("resolved(active) preceded ready state"),
    };
    let terminal = operation
        .wait()
        .await
        .expect("observe claimed activation completion");
    assert_eq!(terminal.state, ClientOperationState::Completed);
    Caller::connect_device(
        activation
            .into_connect_options(session)
            .expect("activation session origin"),
    )
    .await
    .expect("connect activation completed by the claimant");
}

#[tokio::test]
async fn device_activation_rejects_invalid_proof_confirmation_and_deployment() {
    assert_runtime_case_registered("auth.device-activation-proof-scoping", "auth", "auth");
    let mut fixture = start_fixture(None, false).await;
    let device = provision_device_activation_case(&mut fixture, "device-proof", "none").await;
    let trellis_url = fixture.runtime.trellis_url().to_owned();
    let activation = device.activation_options(&trellis_url);

    assert!(
        check_device_activation_with_test_proof(&activation, None, true)
            .await
            .is_err()
    );
    let stale = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time after epoch")
        .as_millis() as i64
        - 10 * 60_000;
    assert!(
        check_device_activation_with_test_proof(&activation, Some(stale), false)
            .await
            .is_err()
    );

    let wrong_deployment = format!("{}-wrong", device.approval.deployment_id);
    let wrong_activation = DeviceActivationOptions::new(
        device.connect_options_for_deployment(&trellis_url, &wrong_deployment),
        &device.identity.activation_key_base64url,
    );
    assert!(check_device_activation(&wrong_activation).await.is_err());

    let pending = match check_device_activation(&activation)
        .await
        .expect("start valid activation")
    {
        DeviceActivationStatus::Pending(pending) => pending,
        DeviceActivationStatus::Ready(_) => panic!("unactivated device was ready"),
    };
    let user = connect_device_activation_user(&mut fixture, "device-proof").await;
    assert!(auth_sdk::AuthClient::new(&user)
        .operation()
        .auth()
        .device_user_authorities_resolve()
        .start(&auth_sdk::AuthDeviceUserAuthoritiesResolveInput {
            confirmation_code: "00000000".to_owned(),
            flow_id: pending.review_id.clone(),
        })
        .await
        .is_err());

    let service_caller = fixture.service_handle.caller();

    let reviews = auth_sdk::AuthClient::new(&service_caller)
        .rpc()
        .auth()
        .device_user_authorities_reviews_list(
            &auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequest {
                cursor: None,
                deployment_id: Some(device.approval.deployment_id.clone()),
                limit: None,
                state: Some(auth_sdk::AuthDeviceUserAuthoritiesReviewsListRequestState::Pending),
            },
        )
        .await
        .expect("list unchanged review");
    let review = reviews
        .entries
        .iter()
        .find(|review| review.review_id == pending.review_id)
        .expect("find unchanged review");
    assert!(review.activated_by_user_principal_id.is_none());
    assert_eq!(review.version, 1);
}

fn authority_rows(
    runtime: &trellis_test::TrellisTestRuntime,
    session_id: &str,
) -> Vec<Map<String, Value>> {
    runtime
        .control_plane_sqlite()
        .query(
            "SELECT a.principal_id, a.participant_id, a.state, a.version, a.desired_capabilities_json FROM auth_identity_authorities a JOIN auth_sessions s ON s.principal_id = a.principal_id AND s.participant_id = a.participant_id WHERE s.session_id = ?",
            [session_id],
        )
        .expect("query trusted portal authority")
}

fn binding_rows(
    runtime: &trellis_test::TrellisTestRuntime,
    session_id: &str,
) -> Vec<Map<String, Value>> {
    runtime
        .control_plane_sqlite()
        .query(
            "SELECT b.principal_id, b.provider_id, b.roles_json, b.effective_policy_digest, b.authority_version FROM auth_portal_authority_bindings b JOIN auth_sessions s ON s.principal_id = b.principal_id AND s.participant_id = b.participant_id WHERE s.session_id = ?",
            [session_id],
        )
        .expect("query trusted portal binding")
}

fn portal_policy_version(
    runtime: &trellis_test::TrellisTestRuntime,
    portal_id: &str,
    participant_id: &str,
) -> Option<i64> {
    runtime
        .control_plane_sqlite()
        .query(
            "SELECT version FROM auth_portal_grant_overrides WHERE portal_id = ? AND participant_id = ?",
            [portal_id, participant_id],
        )
        .expect("query portal grant override")
        .first()
        .and_then(|row| row["version"].as_i64())
}

fn context_states(runtime: &trellis_test::TrellisTestRuntime, session_id: &str) -> Vec<String> {
    runtime
        .control_plane_sqlite()
        .query(
            "SELECT state FROM auth_authorization_contexts WHERE session_id = ? ORDER BY version",
            [session_id],
        )
        .expect("query authorization contexts")
        .into_iter()
        .map(|row| row["state"].as_str().expect("context state").to_owned())
        .collect()
}

fn session_count(runtime: &trellis_test::TrellisTestRuntime, session_id: &str) -> usize {
    runtime
        .control_plane_sqlite()
        .query(
            "SELECT session_id FROM auth_sessions WHERE session_id = ?",
            [session_id],
        )
        .expect("query retained session")
        .len()
}

async fn list_connections(
    fixture: &mut Fixture,
    session_id: &str,
) -> Vec<auth_sdk::types::AuthConnectionsListResponseEntriesItem> {
    fixture
        .admin
        .list_connections(&fixture.bootstrap_url, session_id)
        .await
        .expect("list physical connections")
}

async fn update_policy(fixture: &mut Fixture, capabilities: Vec<String>) {
    let portal_id = fixture.portal_id.clone();
    update_portal_policy(fixture, &portal_id, capabilities).await;
}

async fn update_portal_policy(fixture: &mut Fixture, portal_id: &str, capabilities: Vec<String>) {
    let participant_id = fixture.client_contract.id().to_owned();
    let version = portal_policy_version(&fixture.runtime, portal_id, &participant_id)
        .expect("trusted portal grant override");
    fixture
        .admin
        .put_portal_grant_override(
            &fixture.bootstrap_url,
            portal_id,
            &participant_id,
            Some(version),
            capabilities,
        )
        .await
        .expect("update trusted portal policy");
}

async fn wait_for_no_connections(fixture: &mut Fixture, session_id: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !list_connections(fixture, session_id).await.is_empty() {
        assert!(
            Instant::now() < deadline,
            "physical connections were not removed"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_for_reconnect_denied(reconnect: &trellis_test::TrellisTestClientReconnect) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let outcome = match reconnect.connect_bound_only().await {
            Err(error) => {
                let message = error.to_string().to_ascii_lowercase();
                if message.contains("authorization")
                    || message.contains("revoked")
                    || message.contains("auth_required")
                {
                    return;
                }
                format!("error: {error}")
            }
            Ok(client) => {
                drop(client);
                "connected".to_owned()
            }
        };
        assert!(
            Instant::now() < deadline,
            "revoked session continued to reconnect; last outcome: {outcome}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_for_authority(
    runtime: &trellis_test::TrellisTestRuntime,
    session_id: &str,
    state: &str,
    capabilities: &[&str],
) -> Map<String, Value> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let observed = authority_rows(runtime, session_id);
        if let Some(row) = observed.first().cloned() {
            let selected = row["desired_capabilities_json"]
                .as_str()
                .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
                .unwrap_or_default();
            if row["state"] == state && selected == capabilities {
                return row;
            }
        }
        assert!(
            Instant::now() < deadline,
            "authority did not converge: {observed:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn call_value(client: &Caller, value: &str) -> Result<ValueMessage, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match client
            .call::<ValueGet>(&ValueMessage {
                value: value.to_owned(),
            })
            .await
        {
            Ok(response) => return Ok(response),
            Err(_) if Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

#[tokio::test]
async fn trusted_local_registration_applies_portal_policy() {
    assert_runtime_case_registered(
        "auth.trusted-local-registration-applies-portal-policy",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "trusted-local-user",
            "trusted-local-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("trusted local registration connects without consent");

    drop(client);
    assert_eq!(
        wait_for_authority(
            &fixture.runtime,
            reconnect.session_id(),
            "accepted",
            &[fixture.read_capability.as_str()]
        )
        .await["version"],
        1
    );
    let bindings = binding_rows(&fixture.runtime, reconnect.session_id());
    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0]["provider_id"], "local");
    assert_eq!(bindings[0]["roles_json"], "[]");
    assert_eq!(bindings[0]["authority_version"], 1);
    assert!(!reconnect.session_id().is_empty());
}

#[tokio::test]
async fn portal_policy_removal_requires_new_login() {
    assert_runtime_case_registered(
        "auth.portal-policy-removal-requires-new-login",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let (_, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "policy-removal-user",
            "policy-removal-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("trusted local registration");
    let session_id = reconnect.session_id().to_owned();
    let participant_id = fixture.client_contract.id().to_owned();
    let version = portal_policy_version(&fixture.runtime, &fixture.portal_id, &participant_id)
        .expect("trusted portal grant override");

    fixture
        .admin
        .remove_portal_grant_override(
            &fixture.bootstrap_url,
            &fixture.portal_id,
            &participant_id,
            version,
        )
        .await
        .expect("remove trusted portal policy");

    let revoked = wait_for_authority(
        &fixture.runtime,
        &session_id,
        "revoked",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert!(binding_rows(&fixture.runtime, &session_id).is_empty());
    assert!(context_states(&fixture.runtime, &session_id)
        .iter()
        .all(|state| state == "revoked"));
    assert!(reconnect.connect_bound_only().await.is_err());

    fixture
        .admin
        .put_portal_grant_override(
            &fixture.bootstrap_url,
            &fixture.portal_id,
            &participant_id,
            None,
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("restore trusted portal policy");
    tokio::time::sleep(Duration::from_secs(2)).await;
    let still_revoked = authority_rows(&fixture.runtime, &session_id)
        .into_iter()
        .next()
        .expect("retained revoked authority");
    assert_eq!(still_revoked["state"], "revoked");
    assert_eq!(still_revoked["version"], revoked["version"]);
    assert!(binding_rows(&fixture.runtime, &session_id).is_empty());

    let (_, fresh) = fixture
        .admin
        .connect_local_user_for_portal_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "policy-removal-user",
            "policy-removal-password-123",
        )
        .await
        .expect("fresh verified login restores authority");
    let restored = wait_for_authority(
        &fixture.runtime,
        fresh.session_id(),
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert!(restored["version"].as_i64() > revoked["version"].as_i64());
    assert_eq!(binding_rows(&fixture.runtime, fresh.session_id()).len(), 1);
}

#[tokio::test]
async fn portal_policy_reduction_and_expansion_converge() {
    assert_runtime_case_registered(
        "auth.portal-policy-reduction-and-expansion-converge",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "policy-convergence-user",
            "policy-convergence-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("trusted local registration");
    let session_id = reconnect.session_id().to_owned();

    update_policy(&mut fixture, Vec::new()).await;
    let reduced = wait_for_authority(&fixture.runtime, &session_id, "accepted", &[]).await;
    assert_eq!(session_count(&fixture.runtime, &session_id), 1);

    let read_capability = fixture.read_capability.clone();
    update_policy(&mut fixture, vec![read_capability]).await;
    let expanded = wait_for_authority(
        &fixture.runtime,
        &session_id,
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert!(expanded["version"].as_i64() > reduced["version"].as_i64());
    assert_eq!(
        call_value(&client, "expanded").await.unwrap().value,
        "expanded"
    );
    drop(client);
    wait_for_no_connections(&mut fixture, &session_id).await;
    let deadline = Instant::now() + Duration::from_secs(10);
    let client = loop {
        match reconnect.connect_bound_only().await {
            Ok(client) => break client,
            Err(error)
                if error.to_string().contains("authorization_pending")
                    && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(error) => panic!("reconnect after expanded policy context is published: {error}"),
        }
    };
    assert_eq!(
        call_value(&client, "expanded").await.unwrap().value,
        "expanded"
    );
    assert_eq!(session_count(&fixture.runtime, &session_id), 1);
}

#[tokio::test]
async fn hostile_old_context_is_denied_after_reduction() {
    assert_runtime_case_registered(
        "auth.hostile-old-context-and-proofs-are-denied",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let service_contract = trellis_test::TrellisTestContract::from_native_api_json(
        SERVICE_ID,
        API_SOURCE,
        trellis_rs::contracts::ContractKind::Service,
    )
    .expect("build replay service contract");
    let listener_contract =
        trellis_test::TrellisTestContract::from_builder_with_referenced_contracts(
            trellis_rs::contracts::ContractBuilder::authoring(
                "integration.trusted-portal-listener@v1",
                "integration.trusted-portal-listener@v1",
                "1.0.0",
                "Trusted Portal Replay Listener",
                "Receives trusted-portal replay attempts through local proof validation.",
                trellis_rs::contracts::ContractKind::Service,
            )
            .use_ref(
                "service",
                trellis_rs::contracts::use_contract(SERVICE_ID)
                    .with_event_subscribe(["Value.Changed"]),
            ),
            &[&service_contract],
        )
        .expect("build trusted-portal replay listener contract");
    let listener_key = fixture
        .admin
        .provision_service_instance(
            &fixture.bootstrap_url,
            &listener_contract,
            Some("trusted-portal-replay-listener"),
            None,
        )
        .await
        .expect("provision trusted-portal replay listener");
    let listener_service = trellis_test::connect_service_runtime::<TrustedPortalListenerContract>(
        fixture.runtime.trellis_url(),
        &listener_key,
    )
    .await
    .expect("connect trusted-portal replay listener");
    let delivered = Arc::new(AtomicUsize::new(0));
    let handler_delivered = Arc::clone(&delivered);
    let listener = listener_service
        .listen_event_with_api_id::<ValueChanged, _, _>(
            SERVICE_ID,
            move |_, _| {
                let handler_delivered = Arc::clone(&handler_delivered);
                async move {
                    handler_delivered.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }
            },
            ServiceEventListenOptions {
                mode: ServiceEventListenerMode::Ephemeral,
                group: None,
                durable_name: None,
                concurrency: 1,
            },
        )
        .await
        .expect("start trusted-portal replay listener");
    let _listener = listener;

    let observer = async_nats::ConnectOptions::new()
        .credentials_file(
            fixture
                .runtime
                .workdir()
                .join("nats/creds/trellis-auth.creds"),
        )
        .await
        .expect("load trusted-portal observer credentials")
        .connect(fixture.runtime.nats_url())
        .await
        .expect("connect trusted-portal raw observer");
    let mut rpc_observer = observer
        .subscribe(ValueGet::SUBJECT)
        .await
        .expect("subscribe to raw RPC requests");
    let mut event_observer = observer
        .subscribe(ValueChanged::SUBJECT)
        .await
        .expect("subscribe to raw events");
    observer.flush().await.expect("flush raw observers");

    let capabilities = vec![
        fixture.read_capability.clone(),
        fixture.publish_capability.clone(),
    ];
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "hostile-context-user",
            "hostile-context-password-123",
            capabilities,
        )
        .await
        .expect("trusted local registration");
    let session_id = reconnect.session_id().to_owned();
    let old_contexts = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT context_digest FROM auth_authorization_contexts WHERE session_id = ? AND state = 'active'",
            [&session_id],
        )
        .expect("query old authorization context");
    assert_eq!(old_contexts.len(), 1);
    let old_context_digest = old_contexts[0]["context_digest"]
        .as_str()
        .expect("old authorization context digest")
        .to_owned();
    assert_eq!(
        call_value(&client, "before-reduction").await.unwrap().value,
        "before-reduction"
    );
    let signed_rpc = tokio::time::timeout(Duration::from_secs(5), rpc_observer.next())
        .await
        .expect("observe signed RPC request")
        .expect("signed RPC message");
    client
        .publish::<ValueChanged>(&ValueMessage {
            value: "before-reduction".to_owned(),
        })
        .await
        .expect("publish signed event before reduction");
    let signed_event = tokio::time::timeout(Duration::from_secs(5), event_observer.next())
        .await
        .expect("observe signed event")
        .expect("signed event message");
    let deadline = Instant::now() + Duration::from_secs(5);
    while delivered.load(Ordering::SeqCst) != 1 {
        assert!(
            Instant::now() < deadline,
            "fresh signed event was not delivered"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    update_policy(&mut fixture, Vec::new()).await;
    wait_for_authority(&fixture.runtime, &session_id, "accepted", &[]).await;
    wait_for_no_connections(&mut fixture, &session_id).await;
    let old_context = fixture
        .runtime
        .control_plane_sqlite()
        .query(
            "SELECT state FROM auth_authorization_contexts WHERE context_digest = ?",
            [&old_context_digest],
        )
        .expect("query old authorization context state");
    assert_eq!(old_context.len(), 1);
    assert_eq!(old_context[0]["state"], "revoked");
    drop(client);
    assert!(reconnect
        .connect_captured_admission(old_contexts[0]["context_digest"].as_str().unwrap())
        .await
        .is_err());
    assert!(list_connections(&mut fixture, &session_id).await.is_empty());
    let reply = signed_rpc.reply.expect("signed RPC reply subject");
    let mut reply_observer = observer
        .subscribe(reply.clone())
        .await
        .expect("subscribe to replay reply");
    observer
        .publish_with_reply_and_headers(
            signed_rpc.subject,
            reply,
            signed_rpc.headers.expect("signed RPC headers"),
            signed_rpc.payload,
        )
        .await
        .expect("replay exact signed RPC request");
    if let Ok(Some(response)) =
        tokio::time::timeout(Duration::from_secs(1), reply_observer.next()).await
    {
        assert_ne!(
            serde_json::from_slice::<ValueMessage>(&response.payload).ok(),
            Some(ValueMessage {
                value: "before-reduction".to_owned(),
            }),
            "stale signed RPC proof reached the handler"
        );
    }
    observer
        .publish_with_headers(
            signed_event.subject,
            signed_event.headers.expect("signed event headers"),
            signed_event.payload,
        )
        .await
        .expect("replay exact signed event");
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(
        delivered.load(Ordering::SeqCst),
        1,
        "stale signed event proof reached the handler"
    );
    assert_eq!(session_count(&fixture.runtime, &session_id), 1);
}

#[tokio::test]
async fn portal_reconciliation_converges_a_b_a() {
    assert_runtime_case_registered("auth.portal-reconciliation-a-b-a-converges", "auth", "auth");
    let mut fixture = start_fixture(None, false).await;
    let (_, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "aba-user",
            "aba-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("trusted local registration");
    let session_id = reconnect.session_id().to_owned();
    let a1 = wait_for_authority(
        &fixture.runtime,
        &session_id,
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    update_policy(&mut fixture, Vec::new()).await;
    let b = wait_for_authority(&fixture.runtime, &session_id, "accepted", &[]).await;
    let read_capability = fixture.read_capability.clone();
    update_policy(&mut fixture, vec![read_capability]).await;
    let a2 = wait_for_authority(
        &fixture.runtime,
        &session_id,
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert!(a1["version"].as_i64() < b["version"].as_i64());
    assert!(b["version"].as_i64() < a2["version"].as_i64());
    assert_eq!(binding_rows(&fixture.runtime, &session_id).len(), 1);
}

#[tokio::test]
async fn concurrent_portal_provenance_converges() {
    assert_runtime_case_registered(
        "auth.concurrent-portal-provenance-converges",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(None, false).await;
    let (_, initial) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "concurrent-user",
            "concurrent-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("trusted local registration");
    let initial_authority = wait_for_authority(
        &fixture.runtime,
        initial.session_id(),
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    let mut first_admin = fixture.runtime.admin();
    let mut second_admin = fixture.runtime.admin();
    let first_login = first_admin.connect_local_user_for_portal_reconnectable(
        &fixture.bootstrap_url,
        &fixture.client_contract,
        "concurrent-user",
        "concurrent-password-123",
    );
    let second_login = second_admin.connect_local_user_for_portal_reconnectable(
        &fixture.bootstrap_url,
        &fixture.client_contract,
        "concurrent-user",
        "concurrent-password-123",
    );
    let (first, second) = tokio::join!(first_login, second_login);
    let (_, first) = first.expect("first concurrent verified login");
    let (_, second) = second.expect("second concurrent verified login");
    let authority = wait_for_authority(
        &fixture.runtime,
        second.session_id(),
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert_eq!(authority["version"], initial_authority["version"]);
    assert_eq!(binding_rows(&fixture.runtime, first.session_id()).len(), 1);
    assert_eq!(binding_rows(&fixture.runtime, second.session_id()).len(), 1);
}

#[tokio::test]
async fn oidc_role_mapping_converges_authority() {
    assert_runtime_case_registered("auth.oidc-role-mapping-converges-authority", "auth", "auth");
    let mut fixture = start_fixture(None, true).await;
    let participant_id = fixture.client_contract.id().to_owned();
    let suffix = ulid::Ulid::new().to_string().to_ascii_lowercase();
    let leaf = format!("oidc-leaf-{suffix}");
    let parent = format!("oidc-parent-{suffix}");
    fixture
        .admin
        .put_capability_group(
            &fixture.bootstrap_url,
            &leaf,
            vec![fixture.read_capability.clone()],
            Vec::new(),
        )
        .await
        .expect("put OIDC leaf capability group");
    fixture
        .admin
        .put_capability_group(&fixture.bootstrap_url, &parent, Vec::new(), vec![leaf])
        .await
        .expect("put recursive OIDC capability group");
    fixture
        .admin
        .put_portal_role_mappings(
            &fixture.bootstrap_url,
            &fixture.portal_id,
            &participant_id,
            None,
            vec![
                auth_sdk::types::AuthPortalsGrantOverridesPutRequestRoleMappingsItem {
                    capability_group_keys: Vec::new(),
                    direct_capabilities: vec![fixture.read_capability.clone()],
                    provider_id: "test-oidc".to_owned(),
                    role: "direct".to_owned(),
                },
                auth_sdk::types::AuthPortalsGrantOverridesPutRequestRoleMappingsItem {
                    capability_group_keys: vec![parent],
                    direct_capabilities: Vec::new(),
                    provider_id: "test-oidc".to_owned(),
                    role: "group".to_owned(),
                },
                auth_sdk::types::AuthPortalsGrantOverridesPutRequestRoleMappingsItem {
                    capability_group_keys: Vec::new(),
                    direct_capabilities: vec![fixture.read_capability.clone()],
                    provider_id: "test-oidc".to_owned(),
                    role: "same-authority".to_owned(),
                },
                auth_sdk::types::AuthPortalsGrantOverridesPutRequestRoleMappingsItem {
                    capability_group_keys: Vec::new(),
                    direct_capabilities: vec![fixture.read_capability.clone()],
                    provider_id: "other-oidc".to_owned(),
                    role: "provider-scoped".to_owned(),
                },
            ],
        )
        .await
        .expect("put OIDC role mappings");

    fixture
        .admin
        .set_test_oidc_claims(serde_json::json!({ "roles": ["direct"] }))
        .await
        .expect("set direct OIDC role");
    let (_, direct) = fixture
        .admin
        .connect_oidc_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "test-oidc",
        )
        .await
        .expect("connect direct-role OIDC user");
    let direct_authority = wait_for_authority(
        &fixture.runtime,
        direct.session_id(),
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    let direct_binding = binding_rows(&fixture.runtime, direct.session_id());
    assert_eq!(direct_binding[0]["provider_id"], "test-oidc");
    assert_eq!(direct_binding[0]["roles_json"], "[\"direct\"]");

    fixture
        .admin
        .set_test_oidc_claims(serde_json::json!({ "roles": ["group"] }))
        .await
        .expect("set recursive-group OIDC role");
    let (_, grouped) = fixture
        .admin
        .connect_oidc_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "test-oidc",
        )
        .await
        .expect("connect recursive-group OIDC user");
    let grouped_authority = wait_for_authority(
        &fixture.runtime,
        grouped.session_id(),
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert_eq!(grouped_authority["version"], direct_authority["version"]);
    assert_eq!(
        binding_rows(&fixture.runtime, grouped.session_id())[0]["roles_json"],
        "[\"group\"]"
    );

    fixture
        .admin
        .set_test_oidc_claims(serde_json::json!({ "roles": ["same-authority"] }))
        .await
        .expect("set authority-equivalent OIDC role");
    let (_, equivalent) = fixture
        .admin
        .connect_oidc_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "test-oidc",
        )
        .await
        .expect("connect authority-equivalent OIDC user");
    let equivalent_authority = wait_for_authority(
        &fixture.runtime,
        equivalent.session_id(),
        "accepted",
        &[fixture.read_capability.as_str()],
    )
    .await;
    assert_eq!(equivalent_authority["version"], direct_authority["version"]);
    assert_eq!(
        binding_rows(&fixture.runtime, equivalent.session_id())[0]["roles_json"],
        "[\"same-authority\"]"
    );

    fixture
        .admin
        .set_test_oidc_claims(serde_json::json!({ "roles": ["provider-scoped"] }))
        .await
        .expect("set provider-scoped OIDC role");
    let (_, scoped) = fixture
        .admin
        .connect_oidc_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "test-oidc",
        )
        .await
        .expect("connect provider-scoped OIDC user");
    wait_for_authority(&fixture.runtime, scoped.session_id(), "accepted", &[]).await;

    fixture
        .admin
        .set_test_oidc_claims(serde_json::json!({ "roles": { "invalid": true } }))
        .await
        .expect("set malformed OIDC role claim");
    assert!(fixture
        .admin
        .connect_oidc_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            "test-oidc",
        )
        .await
        .is_err());
}

#[tokio::test]
async fn same_session_connections_are_kicked() {
    assert_runtime_case_registered(
        "auth.same-session-multiple-connections-are-kicked",
        "auth",
        "auth",
    );
    let mut fixture = start_fixture(Some(10_000), false).await;
    assert_eq!(
        fixture
            .runtime
            .auth_connection_presence_status()
            .await
            .expect("inspect connection-presence bucket")
            .max_age,
        Duration::from_secs(70)
    );
    let (first, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "presence-user",
            "presence-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("trusted local registration");
    let second = reconnect
        .connect_bound_only()
        .await
        .expect("second physical connection");
    let session_id = reconnect.session_id().to_owned();
    let initial = list_connections(&mut fixture, &session_id).await;
    assert_eq!(initial.len(), 2);
    assert_ne!(initial[0].connection_id, initial[1].connection_id);

    update_policy(&mut fixture, Vec::new()).await;
    wait_for_authority(&fixture.runtime, &session_id, "accepted", &[]).await;
    let deadline = Instant::now() + Duration::from_secs(10);
    while !list_connections(&mut fixture, &session_id).await.is_empty() {
        assert!(
            Instant::now() < deadline,
            "physical connections were not removed"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    drop((first, second));
    assert_eq!(session_count(&fixture.runtime, &session_id), 1);
}

#[tokio::test]
async fn native_offline_restart_refreshes_before_connect() {
    assert_runtime_case_registered(
        "auth.native-offline-restart-refreshes-before-connect",
        "auth",
        "auth",
    );
    let mut options = trellis_test::TrellisTestRuntimeOptions::repo_platform();
    options.rotatable_nats_proxy = true;
    let mut fixture = start_fixture_with_options(options).await;
    let (client, reconnect) = fixture
        .admin
        .connect_new_trusted_local_user_reconnectable(
            &fixture.bootstrap_url,
            &fixture.client_contract,
            &fixture.portal_id,
            "native-refresh-user",
            "native-refresh-password-123",
            vec![fixture.read_capability.clone()],
        )
        .await
        .expect("connect native user through endpoint A");
    auth_sdk::AuthClient::new(&client)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("authenticate through endpoint A");
    let initial = reconnect
        .authorization_state()
        .expect("load initial durable authorization state")
        .expect("initial durable authorization state exists");
    let initial_servers = initial.runtime.transports.native.nats_servers;

    client
        .integration_test_close_native_connection()
        .await
        .expect("stop native client on endpoint A");
    drop(client);

    let ((retired_url, replacement_url), _) = fixture
        .runtime
        .rotate_nats_proxy()
        .await
        .expect("restart runtime on endpoint B");
    assert_eq!(initial_servers, vec![retired_url.clone()]);
    let retired_address = retired_url.trim_start_matches("nats://");
    let deadline = Instant::now() + Duration::from_secs(5);
    while tokio::net::TcpStream::connect(retired_address)
        .await
        .is_ok()
    {
        assert!(Instant::now() < deadline, "endpoint A remained usable");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    let reconnected = reconnect
        .connect_bound_only()
        .await
        .expect("refresh over HTTP before reconnecting to endpoint B");
    let durable = reconnect
        .authorization_state()
        .expect("load restart-refreshed durable authorization state")
        .expect("restart-refreshed durable authorization state exists");
    assert_eq!(
        durable.runtime.transports.native.nats_servers,
        vec![replacement_url]
    );
    auth_sdk::AuthClient::new(&reconnected)
        .rpc()
        .auth()
        .sessions_me()
        .await
        .expect("authenticate after offline endpoint-B restart");
}
