use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

use crate::browser_login::callback_page_html;
use crate::{
    build_auth_login_url, build_device_activation_payload, build_device_activation_url,
    clear_admin_session, derive_device_confirmation_code, derive_device_identity,
    generate_session_keypair, load_admin_session, parse_device_activation_payload,
    save_admin_session, sign_device_wait_request, verify_device_confirmation_code,
    wait_for_device_activation_response, AdminSessionState, WaitForDeviceActivationResponse,
};
use trellis_client::SessionAuth;

fn unique_test_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("trellis-auth-{label}-{nanos}"))
}

#[test]
fn build_auth_login_url_includes_encoded_contract() {
    let (seed, _) = generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&seed).expect("session auth");
    let contract_json = r#"{"format":"trellis.contract.v1","id":"trellis.cli@v1","displayName":"Trellis CLI","description":"CLI","kind":"cli"}"#;

    let url = build_auth_login_url(
        "http://localhost:3000",
        "http://127.0.0.1:1234/callback",
        &auth,
        contract_json,
    )
    .expect("login url");

    let parsed = Url::parse(&url).expect("parse login url");
    assert_eq!(parsed.path(), "/auth/login");
    let sig = parsed
        .query_pairs()
        .find(|(key, _)| key == "sig")
        .map(|(_, value)| value.into_owned())
        .expect("sig query present");
    assert_eq!(
        sig,
        auth.sign_sha256_domain("oauth-init", "http://127.0.0.1:1234/callback:null")
    );
    let contract = parsed
        .query_pairs()
        .find(|(key, _)| key == "contract")
        .map(|(_, value)| value.into_owned())
        .expect("contract query present");
    let decoded = URL_SAFE_NO_PAD.decode(contract).expect("decode contract");
    let json: Value = serde_json::from_slice(&decoded).expect("parse encoded contract json");
    assert_eq!(
        json.get("id"),
        Some(&Value::String("trellis.cli@v1".to_string()))
    );
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
        binding_token: "token".to_string(),
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
fn device_activation_payload_round_trips() {
    let identity = derive_device_identity(&[7u8; 32]).expect("derive device identity");
    let payload = build_device_activation_payload(
        &identity.activation_key_base64url,
        &identity.public_identity_key,
        "nonce_123",
    )
    .expect("build payload");
    let url = build_device_activation_url("https://auth.example.com/base", &payload)
        .expect("build url");
    let payload_param = Url::parse(&url)
        .expect("parse activation url")
        .query_pairs()
        .find(|(key, _)| key == "payload")
        .map(|(_, value)| value.into_owned())
        .expect("payload query param");
    assert_eq!(
        parse_device_activation_payload(&payload_param).expect("parse payload"),
        payload
    );
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

    let response = wait_for_device_activation_response(
        &format!("http://{address}"),
        &request,
    )
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
