use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::browser_login::{
    build_auth_start_signature_payload, contract_digest, detached_login_redirect_to,
    poll_agent_flow_until_ready, DETACHED_LOGIN_POLL_INTERVAL,
};
use crate::{
    build_device_activation_payload, clear_admin_session, derive_device_confirmation_code,
    derive_device_identity, load_admin_session, parse_device_activation_payload,
    save_admin_session, sign_device_wait_request, start_admin_reauth, start_agent_login,
    start_device_activation_request, AgentLoginChallenge,
    verify_device_confirmation_code, wait_for_device_activation_response, AdminSessionState,
    StartAgentLoginOpts, WaitForDeviceActivationResponse,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use trellis_client::SessionAuth;

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("trellis-auth-{label}-{nanos}"))
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
        "https://trellis.example.test/_trellis/portal/login",
        Some("github"),
        &contract,
        Some(&context),
    )
    .expect("build signature payload");

    assert_eq!(
        payload,
        "https://trellis.example.test/_trellis/portal/login:github:{\"capabilities\":[\"admin\",{\"nested\":true}],\"displayName\":\"Agent\",\"id\":\"trellis.agent@v1\",\"meta\":{\"a\":[3,2,1],\"z\":1}}:{\"flags\":{\"alpha\":true,\"beta\":false},\"redirectHint\":\"/admin\"}"
    );
}

#[test]
fn auth_start_signature_payload_uses_empty_provider_and_null_context_when_absent() {
    let contract = serde_json::json!({ "id": "trellis.agent@v1" });

    let payload = build_auth_start_signature_payload(
        "https://trellis.example.test/_trellis/portal/login",
        None,
        &contract,
        None,
    )
    .expect("build signature payload");

    assert_eq!(
        payload,
        "https://trellis.example.test/_trellis/portal/login::{\"id\":\"trellis.agent@v1\"}:null"
    );
}

#[test]
fn contract_digest_matches_canonical_json_not_raw_text() {
    let compact =
        r#"{"id":"trellis.agent@v1","displayName":"Trellis Agent","description":"Admin agent"}"#;
    let reordered_pretty = r#"
    {
      "description": "Admin agent",
      "id": "trellis.agent@v1",
      "displayName": "Trellis Agent"
    }
    "#;

    let compact_digest = contract_digest(compact).expect("compact digest");
    let reordered_digest = contract_digest(reordered_pretty).expect("reordered digest");

    assert_eq!(compact_digest, reordered_digest);
}

#[test]
fn detached_login_redirect_target_is_relative_portal_login_path() {
    let redirect_to = detached_login_redirect_to().expect("build detached redirect target");

    assert_eq!(redirect_to, "/_trellis/portal/login");
}

#[test]
fn detached_login_poll_interval_is_rate_limit_friendly() {
    assert_eq!(DETACHED_LOGIN_POLL_INTERVAL, std::time::Duration::from_secs(2));
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
        assert!(request.contains("\"redirectTo\":\"/_trellis/portal/login\""));
        assert!(!request.contains("/callback"));
        let body = r#"{"status":"flow_started","flowId":"flow_123","loginUrl":"https://auth.example.test/_trellis/portal/login?flowId=flow_123"}"#;
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
        auth_url: &format!("http://{address}"),
        contract_json: r#"{"id":"trellis.agent@v1","displayName":"Trellis Agent"}"#,
    })
    .await
    .expect("start agent login");

    assert_eq!(challenge.login_url(), "https://auth.example.test/_trellis/portal/login?flowId=flow_123");
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
        assert!(request.contains("\"redirectTo\":\"/_trellis/portal/login\""));
        assert!(!request.contains("/callback"));
        let body = r#"{"status":"flow_started","flowId":"flow_456","loginUrl":"https://auth.example.test/_trellis/portal/login?flowId=flow_456"}"#;
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

    let (session_seed, session_key) = crate::generate_session_keypair();
    let state = AdminSessionState {
        auth_url: format!("http://{address}"),
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
        r#"{"id":"trellis.agent@v1","displayName":"Trellis Agent"}"#,
    )
    .await
    .expect("start admin reauth");

    match outcome {
        crate::AdminReauthOutcome::Flow(challenge) => {
            assert_eq!(
                challenge.login_url(),
                "https://auth.example.test/_trellis/portal/login?flowId=flow_456"
            );
        }
        crate::AdminReauthOutcome::Bound(_) => panic!("expected flow outcome"),
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
            r#"{"status":"redirect","location":"http://127.0.0.1:7777/_trellis/portal/login?flowId=flow_ready"}"#,
            r#"{"status":"bound","inboxPrefix":"admin.user","expires":"2026-01-01T00:00:00Z","sentinel":{"jwt":"jwt","seed":"seed"},"transports":{"native":{"natsServers":["nats://127.0.0.1:4222"]}}}"#,
        ] {
            let (mut stream, _) = listener.accept().await.expect("accept connection");
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).await.expect("read request");
            let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
            let status_line = if request.starts_with("POST /auth/flow/flow_ready/bind HTTP/1.1\r\n") {
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

    let (session_seed, _) = crate::generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed).expect("session auth");
    let challenge = AgentLoginChallenge {
        flow_id: "flow_ready".to_string(),
        login_url: "https://auth.example.test/_trellis/portal/login?flowId=flow_ready".to_string(),
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
        crate::TrellisAuthError::Http(_) | crate::TrellisAuthError::TrellisClient(_)
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
            r#"{"status":"redirect","location":"https://trellis.example.test/_trellis/portal/login?flowId=flow_123"}"#,
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
        std::time::Duration::from_secs(1),
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
    let test_dir = unique_test_dir("session-store");
    fs::create_dir_all(&test_dir).expect("create test dir");
    unsafe {
        env::set_var("XDG_CONFIG_HOME", &test_dir);
    }

    let state = AdminSessionState {
        auth_url: "http://localhost:3000".to_string(),
        nats_servers: "localhost".to_string(),
        session_seed: "seed".to_string(),
        session_key: "key".to_string(),
        contract_digest: "digest".to_string(),
        sentinel_jwt: "jwt".to_string(),
        sentinel_seed: "sentinel".to_string(),
        expires: "2026-01-01T00:00:00Z".to_string(),
    };

    save_admin_session(&state).expect("save admin session");
    let loaded = load_admin_session().expect("load admin session");
    assert_eq!(loaded.session_key, state.session_key);
    assert!(clear_admin_session().expect("clear admin session"));

    unsafe {
        env::remove_var("XDG_CONFIG_HOME");
    }
    let _ = fs::remove_dir_all(test_dir);
}

#[test]
fn legacy_admin_session_loads_and_forces_reauth() {
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

    let loaded = load_admin_session().expect("load legacy admin session");
    assert_eq!(loaded.session_key, "key");
    assert!(loaded.contract_digest.is_empty());

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
    let encoded = crate::encode_device_activation_payload(&payload).expect("encode payload");
    assert_eq!(
        parse_device_activation_payload(&encoded).expect("parse payload"),
        payload
    );
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

        let body = r#"{"flowId":"flow_123","instanceId":"dev_123","profileId":"reader.default","activationUrl":"https://auth.example.com/_trellis/portal/activate?flowId=flow_123"}"#;
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
    assert_eq!(
        response.activation_url,
        "https://auth.example.com/_trellis/portal/activate?flowId=flow_123"
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
