use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde_json::Value;
use url::Url;

use crate::browser_login::callback_page_html;
use crate::{
    build_auth_login_url, clear_admin_session, generate_session_keypair, load_admin_session,
    save_admin_session, AdminSessionState,
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
        "github",
        "http://127.0.0.1:1234/callback",
        &auth,
        contract_json,
    )
    .expect("login url");

    let parsed = Url::parse(&url).expect("parse login url");
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
    assert!(html.contains("JSON.stringify({ authToken, authError })"));
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
