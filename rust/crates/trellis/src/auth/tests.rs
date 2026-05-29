use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use super::browser_login::{
    build_auth_start_signature_payload, contract_digest, detached_login_redirect_to,
    poll_agent_flow_until_ready, DETACHED_LOGIN_POLL_INTERVAL,
};
use super::{
    build_device_activation_payload, build_device_wait_proof_input, clear_admin_session,
    derive_device_confirmation_code, derive_device_identity, get_device_connect_info,
    load_admin_session, parse_device_activation_payload, save_admin_session,
    sign_device_wait_request, start_admin_reauth, start_agent_login,
    start_device_activation_request, verify_device_confirmation_code,
    wait_for_device_activation_response, AdminSessionState, AgentLoginChallenge,
    AuthRequestsValidateRequest, DeviceActivationLocalState, DeviceActivationSession,
    DeviceActivationSessionBuilder, DeviceActivationStartResponse, DeviceActivationStatus,
    GetDeviceConnectInfoOpts, StartAgentLoginOpts, TrellisAuthError,
    WaitForDeviceActivationResponse,
};
use crate::client::SessionAuth;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("trellis-auth-{label}-{nanos}"))
}

fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

#[test]
fn auth_validate_request_omits_absent_capabilities() {
    let request = AuthRequestsValidateRequest {
        capabilities: None,
        iat: 123,
        payload_hash: "hash".to_string(),
        proof: "proof".to_string(),
        request_id: "request-1".to_string(),
        session_key: "session".to_string(),
        subject: "rpc.v1.Jobs.ListServices".to_string(),
    };

    let encoded = serde_json::to_value(request).expect("serialize request");

    assert_eq!(encoded.get("capabilities"), None);
}

#[test]
fn auth_start_signature_payload_matches_js_canonicalization() {
    let contract = serde_json::json!({
        "displayName": "Agent",
        "id": "trellis.agent@v1",
        "capabilities": ["admin", { "nested": true }],
        "meta": {
            "z": 1,
            "a": [3, 2, 1],
        },
    });
    let context = serde_json::json!({
        "redirectHint": "/admin",
        "flags": { "beta": false, "alpha": true },
    });

    let payload = build_auth_start_signature_payload(
        "https://trellis.example.test/_trellis/portal/users/login",
        Some("github"),
        &contract,
        Some(&context),
    )
    .expect("build signature payload");

    assert_eq!(
        payload,
        "https://trellis.example.test/_trellis/portal/users/login:github:{\"capabilities\":[\"admin\",{\"nested\":true}],\"displayName\":\"Agent\",\"id\":\"trellis.agent@v1\",\"meta\":{\"a\":[3,2,1],\"z\":1}}:{\"flags\":{\"alpha\":true,\"beta\":false},\"redirectHint\":\"/admin\"}"
    );
}

#[test]
fn auth_start_signature_payload_uses_empty_provider_and_null_context_when_absent() {
    let contract = serde_json::json!({ "id": "trellis.agent@v1" });

    let payload = build_auth_start_signature_payload(
        "https://trellis.example.test/_trellis/portal/users/login",
        None,
        &contract,
        None,
    )
    .expect("build signature payload");

    assert_eq!(
        payload,
        "https://trellis.example.test/_trellis/portal/users/login::{\"id\":\"trellis.agent@v1\"}:null"
    );
}

#[test]
fn contract_digest_matches_canonical_json_not_raw_text() {
    let compact = r#"{"format":"trellis.contract.v1","id":"trellis.agent@v1","kind":"agent","displayName":"Trellis Agent","description":"Admin agent"}"#;
    let reordered_pretty = r#"
    {
      "description": "Admin agent",
      "format": "trellis.contract.v1",
      "kind": "agent",
      "id": "trellis.agent@v1",
      "displayName": "Trellis Agent"
    }
    "#;

    let compact_digest = contract_digest(compact).expect("compact digest");
    let reordered_digest = contract_digest(reordered_pretty).expect("reordered digest");

    assert_eq!(compact_digest, reordered_digest);
}

#[test]
fn contract_digest_ignores_display_metadata_changes() {
    let baseline = r#"{
      "format": "trellis.contract.v1",
      "id": "trellis.agent@v1",
      "kind": "agent",
      "displayName": "Trellis Agent",
      "description": "Admin agent",
      "uses": {
        "required": {
          "auth": {
            "contract": "trellis.auth@v1",
            "rpc": { "call": ["Auth.Sessions.Me", "Auth.Sessions.Logout"] }
          }
        }
      }
    }"#;
    let metadata_changed = r#"{
      "format": "trellis.contract.v1",
      "id": "trellis.agent@v1",
      "kind": "agent",
      "displayName": "Renamed Agent",
      "description": "Updated display-only copy",
      "uses": {
        "required": {
          "auth": {
            "contract": "trellis.auth@v1",
            "rpc": { "call": ["Auth.Sessions.Me", "Auth.Sessions.Logout"] }
          }
        }
      }
    }"#;

    assert_eq!(
        contract_digest(baseline).expect("baseline digest"),
        contract_digest(metadata_changed).expect("metadata changed digest")
    );
}

#[test]
fn contract_digest_changes_for_identity_fields() {
    let baseline = r#"{
      "format": "trellis.contract.v1",
      "id": "trellis.agent@v1",
      "kind": "agent",
      "displayName": "Trellis Agent",
      "description": "Admin agent",
      "uses": {
        "required": {
          "auth": {
            "contract": "trellis.auth@v1",
            "rpc": { "call": ["Auth.Sessions.Me", "Auth.Sessions.Logout"] }
          }
        }
      }
    }"#;
    let identity_changed = r#"{
      "format": "trellis.contract.v1",
      "id": "trellis.agent@v1",
      "kind": "agent",
      "displayName": "Trellis Agent",
      "description": "Admin agent",
      "uses": {
        "required": {
          "auth": {
            "contract": "trellis.auth@v1",
            "rpc": { "call": ["Auth.Sessions.Me", "Auth.Sessions.Logout", "Auth.IdentityGrants.List"] }
          }
        }
      }
    }"#;

    assert_ne!(
        contract_digest(baseline).expect("baseline digest"),
        contract_digest(identity_changed).expect("identity changed digest")
    );
}

#[test]
fn contract_digest_changes_for_capability_metadata() {
    let baseline = r#"{
      "format": "trellis.contract.v1",
      "id": "trellis.agent@v1",
      "kind": "agent",
      "displayName": "Trellis Agent",
      "description": "Admin agent",
      "capabilities": {
        "agent.admin": {
          "displayName": "Admin access",
          "description": "Manage the deployment."
        }
      },
      "uses": {
        "required": {
          "auth": {
            "contract": "trellis.auth@v1",
            "rpc": { "call": ["Auth.Sessions.Me"] }
          }
        }
      }
    }"#;
    let capability_changed = r#"{
      "format": "trellis.contract.v1",
      "id": "trellis.agent@v1",
      "kind": "agent",
      "displayName": "Trellis Agent",
      "description": "Admin agent",
      "capabilities": {
        "agent.admin": {
          "displayName": "Admin access",
          "description": "Manage the deployment.",
          "consequence": "Can change runtime state."
        }
      },
      "uses": {
        "required": {
          "auth": {
            "contract": "trellis.auth@v1",
            "rpc": { "call": ["Auth.Sessions.Me"] }
          }
        }
      }
    }"#;

    assert_ne!(
        contract_digest(baseline).expect("baseline digest"),
        contract_digest(capability_changed).expect("capability changed digest")
    );
}

#[test]
fn detached_login_redirect_target_is_relative_portal_login_path() {
    let redirect_to = detached_login_redirect_to().expect("build detached redirect target");

    assert_eq!(redirect_to, "/_trellis/portal/users/login");
}

#[test]
fn detached_login_poll_interval_is_rate_limit_friendly() {
    assert_eq!(
        DETACHED_LOGIN_POLL_INTERVAL,
        std::time::Duration::from_secs(2)
    );
}

#[tokio::test]
async fn start_agent_login_posts_detached_portal_redirect_target() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).await.expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
        assert!(request.starts_with("POST /auth/requests HTTP/1.1\r\n"));
        assert!(request.contains("\"redirectTo\":\"/_trellis/portal/users/login\""));
        assert!(!request.contains("/callback"));
        let body = r#"{"status":"flow_started","flowId":"flow_123","loginUrl":"https://auth.example.test/_trellis/portal/users/login?flowId=flow_123"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let challenge = start_agent_login(&StartAgentLoginOpts {
        trellis_url: &format!("http://{address}"),
        contract_json: r#"{"format":"trellis.contract.v1","id":"trellis.agent@v1","kind":"agent","displayName":"Trellis Agent","description":"Admin agent"}"#,
    })
    .await
    .expect("start agent login");

    assert_eq!(
        challenge.login_url(),
        "https://auth.example.test/_trellis/portal/users/login?flowId=flow_123"
    );
    server.await.expect("server task");
}

#[tokio::test]
async fn start_admin_reauth_flow_uses_detached_portal_redirect_target() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).await.expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
        assert!(request.starts_with("POST /auth/requests HTTP/1.1\r\n"));
        assert!(request.contains("\"redirectTo\":\"/_trellis/portal/users/login\""));
        assert!(!request.contains("/callback"));
        let body = r#"{"status":"flow_started","flowId":"flow_456","loginUrl":"https://auth.example.test/_trellis/portal/users/login?flowId=flow_456"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let (session_seed, session_key) = super::generate_session_keypair();
    let state = AdminSessionState {
        trellis_url: format!("http://{address}"),
        nats_servers: "nats://127.0.0.1:4222".to_string(),
        session_seed,
        session_key,
        contract_digest: "digest".to_string(),
        sentinel_jwt: "jwt".to_string(),
        sentinel_seed: "seed".to_string(),
        expires: "2026-01-01T00:00:00Z".to_string(),
    };

    let outcome = start_admin_reauth(
        &state,
        r#"{"format":"trellis.contract.v1","id":"trellis.agent@v1","kind":"agent","displayName":"Trellis Agent","description":"Admin agent"}"#,
    )
    .await
    .expect("start admin reauth");

    match outcome {
        super::AdminReauthOutcome::Flow(challenge) => {
            assert_eq!(
                challenge.login_url(),
                "https://auth.example.test/_trellis/portal/users/login?flowId=flow_456"
            );
        }
        super::AdminReauthOutcome::Bound(_) => panic!("expected flow outcome"),
    }

    server.await.expect("server task");
}

#[tokio::test]
async fn agent_login_complete_polls_detached_flow_then_binds() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        for response_body in [
            r#"{"status":"approval_required"}"#,
            r#"{"status":"redirect","location":"http://127.0.0.1:7777/_trellis/portal/users/login?flowId=flow_ready"}"#,
            r#"{"status":"bound","inboxPrefix":"admin.user","expires":"2026-01-01T00:00:00Z","sentinel":{"jwt":"jwt","seed":"seed"},"transports":{"native":{"natsServers":["nats://127.0.0.1:4222"]}}}"#,
        ] {
            let (mut stream, _) = listener.accept().await.expect("accept connection");
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).await.expect("read request");
            let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
            let status_line = if request.starts_with("POST /auth/flow/flow_ready/bind HTTP/1.1\r\n")
            {
                "200 OK"
            } else {
                assert!(request.starts_with("GET /auth/flow/flow_ready HTTP/1.1\r\n"));
                "200 OK"
            };
            let response = format!(
                "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write response");
        }
    });

    let (session_seed, _) = super::generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed).expect("session auth");
    let challenge = AgentLoginChallenge {
        flow_id: "flow_ready".to_string(),
        login_url: "https://auth.example.test/_trellis/portal/users/login?flowId=flow_ready"
            .to_string(),
        session_seed,
        contract_digest: "digest".to_string(),
        auth,
    };

    let error = challenge
        .complete(&format!("http://{address}"))
        .await
        .err()
        .expect("me request should fail after successful bind");
    assert!(matches!(
        error,
        super::TrellisAuthError::Http(_) | super::TrellisAuthError::TrellisClient(_)
    ));

    server.await.expect("server task");
}

#[tokio::test]
async fn agent_flow_polling_waits_for_redirect_status() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let requests = Arc::new(Mutex::new(Vec::new()));
    let requests_for_server = Arc::clone(&requests);
    let server = tokio::spawn(async move {
        for response_body in [
            r#"{"status":"choose_provider","flowId":"flow_123","providers":[],"app":{"contractId":"trellis.agent@v1","contractDigest":"digest","displayName":"Trellis Agent","description":"Agent"}}"#,
            r#"{"status":"approval_required","flowId":"flow_123","user":{"origin":"github","id":"octocat"},"approval":{"contractId":"trellis.agent@v1","contractDigest":"digest","displayName":"Trellis Agent","description":"Agent","capabilities":["admin"]}}"#,
            r#"{"status":"redirect","location":"https://trellis.example.test/_trellis/portal/users/login?flowId=flow_123"}"#,
        ] {
            let (mut stream, _) = listener.accept().await.expect("accept connection");
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).await.expect("read request");
            let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
            requests_for_server
                .lock()
                .expect("lock requests")
                .push(request);
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("write response");
        }
    });

    let flow_id = poll_agent_flow_until_ready(
        &format!("http://{address}"),
        "flow_123",
        std::time::Duration::from_millis(5),
        std::time::Duration::from_secs(10),
    )
    .await
    .expect("poll flow");

    assert_eq!(flow_id, "flow_123");
    let recorded = requests.lock().expect("lock requests");
    assert_eq!(recorded.len(), 3);
    assert!(recorded
        .iter()
        .all(|request| request.starts_with("GET /auth/flow/flow_123 HTTP/1.1\r\n")));

    server.await.expect("server task");
}

#[test]
fn admin_session_round_trips_through_private_file() {
    let _env_lock = env_lock();
    let test_dir = unique_test_dir("session-store");
    fs::create_dir_all(&test_dir).expect("create test dir");
    unsafe {
        env::set_var("XDG_CONFIG_HOME", &test_dir);
    }

    let state = AdminSessionState {
        trellis_url: "http://localhost:3000".to_string(),
        nats_servers: "localhost".to_string(),
        session_seed: "seed".to_string(),
        session_key: "key".to_string(),
        contract_digest: "digest".to_string(),
        sentinel_jwt: "jwt".to_string(),
        sentinel_seed: "sentinel".to_string(),
        expires: "2026-01-01T00:00:00Z".to_string(),
    };

    save_admin_session(&state).expect("save admin session");
    let persisted = fs::read_to_string(test_dir.join("trellis").join("admin-session.json"))
        .expect("read persisted session");
    assert!(persisted.contains("\"trellis_url\""));
    assert!(!persisted.contains("\"auth_url\""));

    let loaded = load_admin_session().expect("load admin session");
    assert_eq!(loaded.session_key, state.session_key);
    assert!(clear_admin_session().expect("clear admin session"));

    unsafe {
        env::remove_var("XDG_CONFIG_HOME");
    }
    let _ = fs::remove_dir_all(test_dir);
}

#[test]
fn legacy_admin_session_key_is_rejected() {
    let _env_lock = env_lock();
    let test_dir = unique_test_dir("legacy-session-store");
    let config_dir = test_dir.join("trellis");
    fs::create_dir_all(&config_dir).expect("create test dir");
    unsafe {
        env::set_var("XDG_CONFIG_HOME", &test_dir);
    }

    let legacy_state = serde_json::json!({
        "auth_url": "http://localhost:3000",
        "nats_servers": "localhost",
        "session_seed": "seed",
        "session_key": "key",
        "binding_token": "token",
        "sentinel_jwt": "jwt",
        "sentinel_seed": "sentinel",
        "expires": "2026-01-01T00:00:00Z"
    });
    fs::write(
        config_dir.join("admin-session.json"),
        serde_json::to_string(&legacy_state).expect("serialize legacy state"),
    )
    .expect("write legacy session");

    let error = load_admin_session().expect_err("legacy admin session should fail to load");
    assert!(matches!(error, super::TrellisAuthError::ContractJson(_)));

    unsafe {
        env::remove_var("XDG_CONFIG_HOME");
    }
    let _ = fs::remove_dir_all(test_dir);
}

#[test]
fn device_activation_payload_round_trips() {
    let identity = derive_device_identity(&[7u8; 32]).expect("derive device identity");
    let payload = build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        "nonce_123",
    )
    .expect("build payload");
    let encoded = super::encode_device_activation_payload(&payload).expect("encode payload");
    assert_eq!(
        parse_device_activation_payload(&encoded).expect("parse payload"),
        payload
    );
}

#[test]
fn device_wait_proof_input_includes_contract_digest_length_and_content() {
    let proof_input = build_device_wait_proof_input(
        "flow_123",
        "public-key",
        "nonce_123",
        1_701_000_000,
        Some("digest-abc"),
    );

    let mut offset = 0;
    let read_part = |bytes: &[u8], offset: &mut usize| {
        let len = u32::from_be_bytes(bytes[*offset..*offset + 4].try_into().expect("read length"))
            as usize;
        *offset += 4;
        let part = std::str::from_utf8(&bytes[*offset..*offset + len]).expect("utf8 part");
        *offset += len;
        part.to_string()
    };

    assert_eq!(read_part(&proof_input, &mut offset), "flow_123");
    assert_eq!(read_part(&proof_input, &mut offset), "public-key");
    assert_eq!(read_part(&proof_input, &mut offset), "nonce_123");
    assert_eq!(read_part(&proof_input, &mut offset), "1701000000");
    assert_eq!(read_part(&proof_input, &mut offset), "digest-abc");
    assert_eq!(offset, proof_input.len());
}

#[test]
fn device_wait_signature_changes_when_contract_digest_changes() {
    let identity = derive_device_identity(&[19u8; 32]).expect("derive device identity");
    let first = sign_device_wait_request(
        "flow_123",
        &identity.public_identity_key,
        "nonce_123",
        &identity.identity_seed_base64url,
        Some("digest-a"),
        1_701_000_000,
    )
    .expect("sign first wait request");
    let second = sign_device_wait_request(
        "flow_123",
        &identity.public_identity_key,
        "nonce_123",
        &identity.identity_seed_base64url,
        Some("digest-b"),
        1_701_000_000,
    )
    .expect("sign second wait request");

    assert_ne!(first.sig, second.sig);
}

#[test]
fn device_activation_session_builder_exposes_request_free_payload_details() {
    let builder = DeviceActivationSessionBuilder::new(&[13u8; 32], "nonce_123")
        .expect("build activation session builder");
    let identity = derive_device_identity(&[13u8; 32]).expect("derive device identity");

    assert_eq!(builder.public_identity_key(), identity.public_identity_key);
    assert_eq!(
        parse_device_activation_payload(builder.encoded_payload()).expect("parse encoded payload"),
        builder.payload().clone()
    );
    assert_eq!(builder.confirmation_code().len(), 8);
    assert!(verify_device_confirmation_code(
        &identity.activation_key_base64url,
        builder.public_identity_key(),
        "nonce_123",
        builder.confirmation_code(),
    )
    .expect("verify confirmation code"));
}

#[test]
fn device_activation_session_tracks_pending_state_and_signs_wait_requests() {
    let builder = DeviceActivationSessionBuilder::new(&[15u8; 32], "nonce_456")
        .expect("build activation session builder");
    let session = builder
        .pending_session(
            "https://trellis.example.test",
            "digest-abc",
            DeviceActivationStartResponse {
                flow_id: "flow_123".to_string(),
                instance_id: "dev_123".to_string(),
                deployment_id: "reader.default".to_string(),
                activation_url:
                    "https://trellis.example.test/_trellis/portal/devices/activate?flowId=flow_123"
                        .to_string(),
            },
        )
        .expect("build pending session");

    assert_eq!(
        session.activation_url(),
        "https://trellis.example.test/_trellis/portal/devices/activate?flowId=flow_123"
    );
    assert_eq!(
        session.local_state().status,
        DeviceActivationStatus::Pending
    );
    assert_eq!(session.local_state().contract_digest, "digest-abc");
    assert_eq!(session.local_state().flow_id, "flow_123");
    assert_eq!(session.local_state().instance_id, "dev_123");

    let wait_request = session.build_wait_request(1234).expect("sign wait request");
    assert_eq!(wait_request.flow_id, "flow_123");
    assert_eq!(
        wait_request.public_identity_key,
        session.public_identity_key()
    );
    assert_eq!(wait_request.nonce, "nonce_456");
    assert_eq!(wait_request.contract_digest.as_deref(), Some("digest-abc"));
    assert_eq!(wait_request.iat, 1234);
}

#[test]
fn device_activation_local_state_round_trips_flow_id_json() {
    let state = DeviceActivationLocalState {
        status: DeviceActivationStatus::Pending,
        contract_digest: "digest-abc".to_string(),
        public_identity_key: "public-key".to_string(),
        flow_id: "flow_123".to_string(),
        instance_id: "dev_123".to_string(),
        deployment_id: "reader.default".to_string(),
        nonce: "nonce_123".to_string(),
        activation_url: "https://trellis.example.test/activate".to_string(),
    };

    let encoded = serde_json::to_string(&state).expect("serialize local state");
    assert!(encoded.contains("\"flowId\":\"flow_123\""));
    assert!(!encoded.contains("flow_id"));

    let decoded: DeviceActivationLocalState =
        serde_json::from_str(&encoded).expect("deserialize local state");
    assert_eq!(decoded, state);
}

#[test]
fn device_activation_session_resumes_from_matching_local_state() {
    let root_secret = [21u8; 32];
    let builder = DeviceActivationSessionBuilder::new(&root_secret, "nonce_123")
        .expect("build activation session builder");
    let mut original = builder
        .pending_session(
            "https://trellis.example.test",
            "digest-abc",
            DeviceActivationStartResponse {
                flow_id: "flow_123".to_string(),
                instance_id: "dev_123".to_string(),
                deployment_id: "reader.default".to_string(),
                activation_url: "https://trellis.example.test/activate".to_string(),
            },
        )
        .expect("build pending session");
    let confirmation_code = original.confirmation_code().to_string();
    original
        .accept_confirmation_code(&confirmation_code)
        .expect("accept confirmation code");
    let local_state = original.local_state().clone();

    let resumed = DeviceActivationSession::from_local_state(
        "https://trellis.example.test",
        &root_secret,
        "digest-abc",
        local_state.clone(),
    )
    .expect("resume session");

    assert_eq!(resumed.local_state(), &local_state);
    assert_eq!(
        resumed.public_identity_key(),
        local_state.public_identity_key
    );
    assert_eq!(resumed.confirmation_code(), confirmation_code);
}

#[test]
fn device_activation_session_resume_rejects_wrong_root_secret() {
    let root_secret = [23u8; 32];
    let builder = DeviceActivationSessionBuilder::new(&root_secret, "nonce_123")
        .expect("build activation session builder");
    let local_state = builder
        .pending_session(
            "https://trellis.example.test",
            "digest-abc",
            DeviceActivationStartResponse {
                flow_id: "flow_123".to_string(),
                instance_id: "dev_123".to_string(),
                deployment_id: "reader.default".to_string(),
                activation_url: "https://trellis.example.test/activate".to_string(),
            },
        )
        .expect("build pending session")
        .local_state()
        .clone();

    let error = DeviceActivationSession::from_local_state(
        "https://trellis.example.test",
        &[24u8; 32],
        "digest-abc",
        local_state,
    )
    .expect_err("wrong root secret should fail");

    assert!(
        matches!(error, TrellisAuthError::InvalidArgument(message) if message.contains("public identity key mismatch"))
    );
}

#[test]
fn device_activation_session_resume_rejects_wrong_contract_digest() {
    let root_secret = [25u8; 32];
    let builder = DeviceActivationSessionBuilder::new(&root_secret, "nonce_123")
        .expect("build activation session builder");
    let local_state = builder
        .pending_session(
            "https://trellis.example.test",
            "digest-abc",
            DeviceActivationStartResponse {
                flow_id: "flow_123".to_string(),
                instance_id: "dev_123".to_string(),
                deployment_id: "reader.default".to_string(),
                activation_url: "https://trellis.example.test/activate".to_string(),
            },
        )
        .expect("build pending session")
        .local_state()
        .clone();

    let error = DeviceActivationSession::from_local_state(
        "https://trellis.example.test",
        &root_secret,
        "digest-def",
        local_state,
    )
    .expect_err("wrong contract digest should fail");

    assert!(
        matches!(error, TrellisAuthError::InvalidArgument(message) if message.contains("contract digest mismatch"))
    );
}

#[test]
fn device_activation_session_accepts_local_confirmation_code() {
    let builder = DeviceActivationSessionBuilder::new(&[17u8; 32], "nonce_789")
        .expect("build activation session builder");
    let mut session = builder
        .pending_session(
            "https://trellis.example.test",
            "digest-def",
            DeviceActivationStartResponse {
                flow_id: "flow_456".to_string(),
                instance_id: "dev_456".to_string(),
                deployment_id: "reader.secondary".to_string(),
                activation_url:
                    "https://trellis.example.test/_trellis/portal/devices/activate?flowId=flow_456"
                        .to_string(),
            },
        )
        .expect("build pending session");

    let confirmation_code = session.confirmation_code().to_string();
    session
        .accept_confirmation_code(&confirmation_code)
        .expect("accept confirmation code");

    assert_eq!(
        session.local_state().status,
        DeviceActivationStatus::Activated
    );
    assert_eq!(session.local_state().instance_id, "dev_456");
    assert!(session.accept_confirmation_code("WRONG").is_err());
}

#[tokio::test]
async fn device_activation_start_posts_to_request_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).await.expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(
            request.starts_with("POST /auth/devices/activate/requests HTTP/1.1\r\n"),
            "unexpected request line: {request}"
        );

        let body = r#"{"flowId":"flow_123","instanceId":"dev_123","deploymentId":"reader.default","activationUrl":"https://auth.example.com/_trellis/portal/devices/activate?flowId=flow_123"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let identity = derive_device_identity(&[9u8; 32]).expect("derive device identity");
    let payload = build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        "nonce_123",
    )
    .expect("build payload");
    let response = start_device_activation_request(&format!("http://{}", address), &payload)
        .await
        .expect("start activation request");
    assert_eq!(response.flow_id, "flow_123");
    assert_eq!(response.deployment_id, "reader.default");
    assert_eq!(
        response.activation_url,
        "https://auth.example.com/_trellis/portal/devices/activate?flowId=flow_123"
    );

    server.await.expect("server task");
}

#[tokio::test]
async fn device_activation_wait_posts_to_activate_wait_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).await.expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(
            request.starts_with("POST /auth/devices/activate/wait HTTP/1.1\r\n"),
            "unexpected request line: {request}"
        );

        let body = r#"{"status":"pending"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let identity = derive_device_identity(&[11u8; 32]).expect("derive device identity");
    let request = sign_device_wait_request(
        "flow_123",
        &identity.public_identity_key,
        "nonce_123",
        &identity.identity_seed_base64url,
        Some("digest-a"),
        123,
    )
    .expect("sign wait request");

    let response = wait_for_device_activation_response(&format!("http://{address}"), &request)
        .await
        .expect("wait response");
    assert!(matches!(response, WaitForDeviceActivationResponse::Pending));

    server.await.expect("server finished");
}

async fn get_device_connect_info_from_body(
    identity: &super::DeviceIdentity,
    contract_digest: &str,
    body: serde_json::Value,
) -> Result<super::DeviceConnectInfoResponse, TrellisAuthError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 2048];
        let _ = stream.read(&mut buffer).await.expect("read request");
        let body = serde_json::to_string(&body).expect("serialize response body");
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let result = get_device_connect_info(GetDeviceConnectInfoOpts {
        trellis_url: &format!("http://{address}"),
        public_identity_key: &identity.public_identity_key,
        identity_seed_base64url: &identity.identity_seed_base64url,
        contract_digest,
        iat: 456,
    })
    .await;

    server.await.expect("server finished");
    result
}

fn ready_device_connect_info_body(overrides: serde_json::Value) -> serde_json::Value {
    let mut body = serde_json::json!({
        "status": "ready",
        "connectInfo": {
            "instanceId": "dev_123",
            "deploymentId": "reader.default",
            "contractId": "acme.reader@v1",
            "contractDigest": "digest-a",
            "transports": { "native": { "natsServers": ["nats://127.0.0.1:4222"] } },
            "transport": { "sentinel": { "jwt": "jwt", "seed": "seed" } },
            "auth": { "mode": "device_identity", "iatSkewSeconds": 30 }
        }
    });
    merge_json(&mut body, overrides);
    body
}

fn merge_json(target: &mut serde_json::Value, patch: serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(target), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(target.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (target, patch) => *target = patch,
    }
}

#[tokio::test]
async fn device_connect_info_posts_signed_connect_info_request_and_parses_ready_response() {
    let identity = derive_device_identity(&[31u8; 32]).expect("derive device identity");
    let expected = sign_device_wait_request(
        "connect-info",
        &identity.public_identity_key,
        "connect-info",
        &identity.identity_seed_base64url,
        Some("digest-a"),
        456,
    )
    .expect("sign expected request");
    let expected_public_identity_key = identity.public_identity_key.clone();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 4096];
        let read = stream.read(&mut buffer).await.expect("read request");
        let request = String::from_utf8_lossy(&buffer[..read]);
        assert!(
            request.starts_with("POST /auth/devices/connect-info HTTP/1.1\r\n"),
            "unexpected request line: {request}"
        );
        assert!(request.contains(&format!(
            "\"publicIdentityKey\":\"{}\"",
            expected.public_identity_key
        )));
        assert!(request.contains("\"contractDigest\":\"digest-a\""));
        assert!(request.contains("\"iat\":456"));
        assert!(request.contains(&format!("\"sig\":\"{}\"", expected.sig)));
        assert!(!request.contains("\"nonce\""));

        let body = format!(
            r#"{{"status":"ready","connectInfo":{{"instanceId":"dev_123","deploymentId":"reader.default","contractId":"acme.reader@v1","contractDigest":"digest-a","transports":{{"native":{{"natsServers":["nats://127.0.0.1:4222"]}}}},"transport":{{"sentinel":{{"jwt":"jwt","seed":"seed"}}}},"auth":{{"mode":"device_identity","iatSkewSeconds":30}}}}}}"#
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let response = get_device_connect_info(GetDeviceConnectInfoOpts {
        trellis_url: &format!("http://{address}"),
        public_identity_key: &expected_public_identity_key,
        identity_seed_base64url: &identity.identity_seed_base64url,
        contract_digest: "digest-a",
        iat: 456,
    })
    .await
    .expect("get connect info");

    assert_eq!(response.status, "ready");
    assert_eq!(response.connect_info.contract_digest, "digest-a");
    assert_eq!(
        response.connect_info.auth.mode,
        super::DeviceConnectInfoAuthMode::DeviceIdentity
    );
    assert_eq!(response.connect_info.auth.iat_skew_seconds, 30);
    assert_eq!(
        response
            .connect_info
            .transports
            .native
            .expect("native transport")
            .nats_servers,
        vec!["nats://127.0.0.1:4222".to_string()]
    );

    server.await.expect("server finished");
}

#[tokio::test]
async fn device_connect_info_rejects_contract_digest_mismatch() {
    let identity = derive_device_identity(&[34u8; 32]).expect("derive device identity");

    let error = get_device_connect_info_from_body(
        &identity,
        "digest-a",
        ready_device_connect_info_body(serde_json::json!({
            "connectInfo": { "contractDigest": "digest-b" }
        })),
    )
    .await
    .expect_err("digest mismatch should fail");

    assert!(matches!(
        error,
        TrellisAuthError::InvalidArgument(message) if message.contains("contract digest mismatch")
    ));
}

#[tokio::test]
async fn device_connect_info_rejects_bad_auth_mode() {
    let identity = derive_device_identity(&[35u8; 32]).expect("derive device identity");

    let error = get_device_connect_info_from_body(
        &identity,
        "digest-a",
        ready_device_connect_info_body(serde_json::json!({
            "connectInfo": { "auth": { "mode": "session" } }
        })),
    )
    .await
    .expect_err("bad auth mode should fail");

    assert!(matches!(error, TrellisAuthError::Http(_)));
}

#[tokio::test]
async fn device_connect_info_rejects_missing_native_transport() {
    let identity = derive_device_identity(&[36u8; 32]).expect("derive device identity");

    let error = get_device_connect_info_from_body(
        &identity,
        "digest-a",
        ready_device_connect_info_body(serde_json::json!({
            "connectInfo": { "transports": { "native": null } }
        })),
    )
    .await
    .expect_err("missing native transport should fail");

    assert!(matches!(
        error,
        TrellisAuthError::InvalidArgument(message) if message.contains("missing native NATS transport")
    ));
}

#[tokio::test]
async fn device_connect_info_rejects_empty_native_transport() {
    let identity = derive_device_identity(&[37u8; 32]).expect("derive device identity");

    let error = get_device_connect_info_from_body(
        &identity,
        "digest-a",
        ready_device_connect_info_body(serde_json::json!({
            "connectInfo": { "transports": { "native": { "natsServers": [] } } }
        })),
    )
    .await
    .expect_err("empty native transport should fail");

    assert!(matches!(
        error,
        TrellisAuthError::InvalidArgument(message) if message.contains("native NATS transport has no servers")
    ));
}

#[tokio::test]
async fn device_connect_info_requires_identity_protocol_fields() {
    let identity = derive_device_identity(&[38u8; 32]).expect("derive device identity");
    let mut body = ready_device_connect_info_body(serde_json::json!({}));
    body["connectInfo"]
        .as_object_mut()
        .expect("connect info object")
        .remove("instanceId");

    let error = get_device_connect_info_from_body(&identity, "digest-a", body)
        .await
        .expect_err("missing instanceId should fail");

    assert!(matches!(error, TrellisAuthError::Http(_)));
}

#[tokio::test]
async fn device_connect_info_rejects_unexpected_ready_status() {
    let identity = derive_device_identity(&[33u8; 32]).expect("derive device identity");
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let address = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept connection");
        let mut buffer = [0u8; 2048];
        let _ = stream.read(&mut buffer).await.expect("read request");
        let body = r#"{"status":"not_ready","connectInfo":{"instanceId":"dev_123","deploymentId":"reader.default","contractId":"acme.reader@v1","contractDigest":"digest-a","transports":{"native":{"natsServers":["nats://127.0.0.1:4222"]}},"transport":{"sentinel":{"jwt":"jwt","seed":"seed"}},"auth":{"mode":"device_identity","iatSkewSeconds":30}}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    });

    let error = get_device_connect_info(GetDeviceConnectInfoOpts {
        trellis_url: &format!("http://{address}"),
        public_identity_key: &identity.public_identity_key,
        identity_seed_base64url: &identity.identity_seed_base64url,
        contract_digest: "digest-a",
        iat: 456,
    })
    .await
    .expect_err("non-ready status should fail");

    assert!(matches!(
        error,
        TrellisAuthError::UnexpectedDeviceConnectInfoStatus(status) if status == "not_ready"
    ));
    server.await.expect("server finished");
}

#[test]
fn device_confirmation_codes_verify_locally() {
    let identity = derive_device_identity(&[9u8; 32]).expect("derive device identity");
    let confirmation_code = derive_device_confirmation_code(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        "nonce_123",
    )
    .expect("derive confirmation code");
    assert_eq!(confirmation_code.len(), 8);
    assert!(verify_device_confirmation_code(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        "nonce_123",
        &confirmation_code.to_lowercase(),
    )
    .expect("verify confirmation code"));
}
