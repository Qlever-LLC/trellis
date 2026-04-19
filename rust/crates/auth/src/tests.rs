use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::browser_login::callback_page_html;
use crate::{
    build_device_activation_payload, clear_admin_session, derive_device_confirmation_code,
    derive_device_identity, load_admin_session, parse_device_activation_payload,
    save_admin_session, sign_device_wait_request, start_device_activation_request,
    verify_device_confirmation_code, wait_for_device_activation_response, AdminSessionState,
    WaitForDeviceActivationResponse,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("trellis-auth-{label}-{nanos}"))
}

#[test]
fn callback_page_html_posts_auth_error_results() {
    let html = callback_page_html();
    assert!(html.contains("authError"));
    assert!(html.contains("JSON.stringify({ flowId, authError })"));
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
