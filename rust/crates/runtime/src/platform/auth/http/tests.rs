use axum::response::IntoResponse;

use super::{
    canonical_origin, first_admin_token_hash, oauth_cookie_header, oauth_cookie_name,
    oidc_portal_policy_digest, project_service_resource_bindings, require_oauth_browser_binding,
    select_browser_authority, validate_redirect, NatsBootstrapIssuer, EMBEDDED_WEB_ASSETS,
};
use crate::platform::auth::AuthorizationStateError;
use crate::platform::auth::{
    ephemeral::{AuthOAuthKind, AuthOAuthState, AuthOAuthStatus, BrowserConsentProposal},
    LoginPortalRecord, LoginSettingsRecord, ResourceBindingEvidence, ResourceBindingState,
    ResourceProviderIdentity,
};
use axum::http::header::COOKIE;
use axum::http::{HeaderMap, HeaderValue};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use nats_jwt_rs::user::User;
use nats_jwt_rs::Claims;
use nkeys::KeyPair;
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
use std::sync::Arc;
use trellis_protocol::{
    ApiSurfaceKind, GrantSet, ParticipantResourceKind, PermissionAction, PermissionAtom,
    PermissionTarget,
};

const DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

fn permission(target: PermissionTarget, action: PermissionAction) -> PermissionAtom {
    PermissionAtom::new(target, action).unwrap()
}

fn consent_with_view(view: serde_json::Value) -> BrowserConsentProposal {
    let required = permission(
        PermissionTarget::api_surface("example.api@v1", ApiSurfaceKind::Rpc, "Read").unwrap(),
        PermissionAction::Call,
    );
    let optional = permission(
        PermissionTarget::api_surface("example.api@v1", ApiSurfaceKind::Event, "Updated").unwrap(),
        PermissionAction::Subscribe,
    );
    let required_grant_set = GrantSet::new(vec![required]);
    let optional_grant_bundles =
        BTreeMap::from([("events".to_owned(), GrantSet::new(vec![optional]))]);
    let required_capabilities = vec!["read".to_owned()];
    let optional_capability_definitions = BTreeMap::new();
    BrowserConsentProposal {
        participant_id: "app-1".to_owned(),
        participant_artifact_digest: DIGEST.to_owned(),
        participant_needs_digest: DIGEST.to_owned(),
        consent_view_digest: trellis_protocol::digest_json(&view).unwrap(),
        proposal_digest: trellis_protocol::digest_json(&serde_json::json!({
            "participantId": "app-1",
            "participantArtifactDigest": DIGEST,
            "participantNeedsDigest": DIGEST,
            "requiredGrantSet": required_grant_set,
            "optionalGrantBundles": optional_grant_bundles,
            "requiredCapabilities": required_capabilities,
            "optionalCapabilityDefinitions": optional_capability_definitions,
        }))
        .unwrap(),
        consent_view: view,
        required_grant_set,
        optional_grant_bundles,
        required_capabilities,
        optional_capability_definitions,
    }
}

#[test]
fn browser_security_boundaries_are_exact() {
    let allowed = vec!["https://app.example".to_owned()];
    assert!(validate_redirect("https://app.example/complete", &allowed).is_ok());
    assert!(validate_redirect("https://evil.example/complete", &allowed).is_err());
    assert!(validate_redirect("https://app.example/complete#secret", &allowed).is_err());
    assert_eq!(
        canonical_origin("https://app.example:443/path").unwrap(),
        "https://app.example"
    );

    let token = URL_SAFE_NO_PAD.encode([7_u8; 32]);
    let digest = first_admin_token_hash(&token).unwrap();
    assert_eq!(digest.len(), 43);
    assert!(!digest.contains(&token));
}

#[test]
fn browser_approval_accepts_only_server_owned_optional_bundles() {
    let consent = consent_with_view(serde_json::json!({ "title": "Read data" }));
    let (required, capabilities, selected) = select_browser_authority(&consent, &[]).unwrap();
    assert_eq!(required, consent.required_grant_set);
    assert_eq!(capabilities, vec!["read"]);
    assert!(selected.is_empty());

    let (with_optional, _, selected) =
        select_browser_authority(&consent, &["events".to_owned()]).unwrap();
    assert_eq!(with_optional.permissions().len(), 2);
    assert!(selected.contains("events"));
    assert_eq!(
        select_browser_authority(&consent, &["unknown".to_owned()])
            .unwrap_err()
            .code,
        "unknown_optional_bundle"
    );
}

#[tokio::test]
async fn http_errors_never_expose_internal_causes() {
    let secret = "postgres://admin:secret@internal/auth";
    let response =
        super::HttpError::from(AuthorizationStateError::Storage(secret.to_owned())).into_response();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let encoded = String::from_utf8(body.to_vec()).unwrap();
    assert!(!encoded.contains(secret));
    assert!(encoded.contains("internal_error"));
}

#[tokio::test]
async fn issuance_errors_have_stable_machine_codes() {
    for (error, expected) in [
        (AuthorizationStateError::SessionMissing, "session_not_found"),
        (AuthorizationStateError::SessionExpired, "session_expired"),
        (AuthorizationStateError::SessionRevoked, "session_revoked"),
        (
            AuthorizationStateError::AuthorityPending,
            "approval_required",
        ),
        (
            AuthorizationStateError::MaterializationStale,
            "authorization_pending",
        ),
    ] {
        let response = super::map_issuance_error(error).into_response();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({ "error": { "code": expected } })
        );
    }
}

#[test]
fn stale_authority_issuance_is_retryable() {
    assert_eq!(
        super::map_issuance_error(AuthorizationStateError::AuthorityStale).status,
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
    );
    assert_eq!(
        super::map_issuance_error(AuthorizationStateError::MaterializationStale).status,
        axum::http::StatusCode::SERVICE_UNAVAILABLE,
    );
}

#[test]
fn consent_wording_does_not_change_machine_authority() {
    let before = consent_with_view(serde_json::json!({ "title": "Read data" }));
    let after = consent_with_view(serde_json::json!({ "title": "View data" }));
    assert_eq!(before.proposal_digest, after.proposal_digest);
    assert_ne!(before.consent_view_digest, after.consent_view_digest);
}

#[test]
fn oauth_cookie_binds_one_browser_and_uses_callback_security_policy() {
    let state_id = "oauth-state";
    let secret = "browser-secret";
    let state = AuthOAuthState {
        format: "trellis.auth-oauth-state.v1".to_owned(),
        state_id: state_id.to_owned(),
        provider_id: "provider".to_owned(),
        kind: AuthOAuthKind::Browser,
        flow_id: "flow".to_owned(),
        status: AuthOAuthStatus::Pending,
        pkce_verifier: "verifier".to_owned(),
        nonce: "nonce".to_owned(),
        redirect_uri: "https://auth.example/auth/callback/provider".to_owned(),
        browser_binding_digest: URL_SAFE_NO_PAD.encode(Sha256::digest(secret.as_bytes())),
        portal_binding_digest: Some(DIGEST.to_owned()),
        browser_flow_id: None,
        portal_id: Some("builtin".to_owned()),
        portal_policy_digest: Some(super::digest_parts(&["policy"])),
        claim_owner: None,
        result_digest: None,
        authenticated_principal_id: None,
        authenticated_provider_subject: None,
        authenticated_email: None,
        authenticated_roles: Vec::new(),
        created_at: 1,
        expires_at: 2,
        version: 1,
    };
    let mut headers = HeaderMap::new();
    assert!(require_oauth_browser_binding(state_id, &state, &headers).is_err());
    headers.insert(
        COOKIE,
        HeaderValue::from_str(&format!("{}=wrong", oauth_cookie_name(state_id))).unwrap(),
    );
    assert!(require_oauth_browser_binding(state_id, &state, &headers).is_err());
    headers.insert(
        COOKIE,
        HeaderValue::from_str(&format!("{}={secret}", oauth_cookie_name(state_id))).unwrap(),
    );
    require_oauth_browser_binding(state_id, &state, &headers).unwrap();
    assert!(require_oauth_browser_binding("another-state", &state, &headers).is_err());

    let cookie = oauth_cookie_header("binding", secret, "provider", true, 900)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cookie.contains("Path=/auth/callback/provider"));
    assert!(cookie.contains("Max-Age=900"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Secure"));
}

#[test]
fn oauth_portal_policy_digest_tracks_policy_not_wording() {
    let portal = LoginPortalRecord {
        portal_id: "builtin".to_owned(),
        display_name: "Trellis".to_owned(),
        entry_url: None,
        builtin: true,
        disabled: false,
        removed: false,
        local_registration_enabled: false,
        provider_ids: vec!["oidc".to_owned()],
        created_at: 1,
        updated_at: 1,
        version: 1,
    };
    let settings = LoginSettingsRecord {
        portal_id: "builtin".to_owned(),
        default_provider_id: Some("oidc".to_owned()),
        local_login_enabled: true,
        federated_registration_enabled: false,
        provider_selection_enabled: false,
        updated_at: 1,
        version: 1,
    };
    let digest = oidc_portal_policy_digest(&portal, &settings).unwrap();
    let mut wording = portal.clone();
    wording.display_name = "Renamed portal".to_owned();
    assert_eq!(
        oidc_portal_policy_digest(&wording, &settings).unwrap(),
        digest
    );
    let mut registration = settings.clone();
    registration.federated_registration_enabled = true;
    registration.version += 1;
    assert_ne!(
        oidc_portal_policy_digest(&portal, &registration).unwrap(),
        digest
    );
    let mut provider = portal.clone();
    provider.provider_ids.clear();
    provider.version += 1;
    assert_ne!(
        oidc_portal_policy_digest(&provider, &settings).unwrap(),
        digest
    );
}

#[test]
fn embedded_web_app_contains_fallback_and_assets() {
    let shell = EMBEDDED_WEB_ASSETS
        .iter()
        .find_map(|(path, bytes)| (*path == "200.html").then_some(*bytes))
        .expect("embedded web fallback");
    let shell = std::str::from_utf8(shell).expect("web fallback UTF-8");
    assert!(!shell.contains("<script>"));
    assert!(shell.contains("/assets/web/bootstrap.js"));
    assert!(shell.contains("/assets/web/trellis-logo.svg"));
    assert!(EMBEDDED_WEB_ASSETS
        .iter()
        .any(|(path, bytes)| path.starts_with("assets/login/") && !bytes.is_empty()));
    assert!(EMBEDDED_WEB_ASSETS
        .iter()
        .any(|(path, bytes)| path.starts_with("assets/") && !bytes.is_empty()));
}

#[test]
fn bootstrap_projects_exact_physical_resource_binding() {
    let participant = serde_json::json!({
        "resources": {
            "kv": {
                "cache": {
                    "history": 2,
                    "ttlMs": 60000,
                    "maxValueBytes": 4096
                }
            }
        },
        "jobQueues": {},
        "eventConsumers": {}
    });
    let evidence = ResourceBindingEvidence {
        resource_kind: "kv".to_owned(),
        local_name: "cache".to_owned(),
        binding_id: "bind_cache".to_owned(),
        owner_participant_id: "example".to_owned(),
        provider_identity: ResourceProviderIdentity::Kv {
            bucket: "KV_EXAMPLE_CACHE".to_owned(),
        },
        state: ResourceBindingState::Available,
        materialized_at: 1,
        error: None,
    };

    let projected =
        project_service_resource_bindings(&participant.to_string(), &[evidence], "example")
            .expect("resource binding");
    assert_eq!(projected.kv["cache"].bucket, "KV_EXAMPLE_CACHE");
    assert_eq!(projected.kv["cache"].history, 2);
}

#[test]
fn bootstrap_jwt_is_session_keyed_and_deny_all() {
    let signing_key = KeyPair::new_account();
    let auth_account = KeyPair::new_account().public_key();
    let session_key = KeyPair::new_user().public_key();
    let issuer = NatsBootstrapIssuer {
        signing_key: Arc::new(signing_key),
        auth_account: auth_account.clone(),
        maximum_lifetime_seconds: 300,
    };
    let jwt = issuer.deny_all_user_jwt(&session_key, 10_000, 100).unwrap();
    assert_eq!(jwt.expires_at, 400);
    let claims = Claims::<User>::decode(&jwt.jwt).unwrap();
    assert_eq!(
        claims.payload().issuer_account.as_deref(),
        Some(auth_account.as_str())
    );
    assert_eq!(serde_json::to_value(&claims).unwrap()["sub"], session_key);
    assert_eq!(claims.exp, Some(400));
    assert!(claims
        .payload()
        .permissions
        .permissions
        .publish
        .allow
        .is_empty());
    assert_eq!(
        claims.payload().permissions.permissions.publish.deny,
        vec![">".to_owned()]
    );
    assert!(claims
        .payload()
        .permissions
        .permissions
        .subscribe
        .allow
        .is_empty());
}

#[test]
fn refresh_transport_metadata_omits_unconfigured_native_transport() {
    let value = serde_json::to_value(super::NatsBootstrapResponse::new(
        super::IssuedBootstrapJwt {
            jwt: "jwt".to_owned(),
            expires_at: 10,
        },
        Vec::new(),
        vec!["ws://localhost:8080".to_owned()],
    ))
    .unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "jwt": "jwt",
            "jwtExpiresAt": 10,
            "transports": {
                "websocket": { "natsServers": ["ws://localhost:8080"] },
            },
        })
    );
    assert!(value["transports"].get("native").is_none());
    assert_eq!(
        value["transports"]["websocket"]["natsServers"],
        serde_json::json!(["ws://localhost:8080"])
    );
    assert!(value.get("servers").is_none());
}
#[test]
fn administrator_grants_include_optional_console_surfaces() {
    let binding = super::super::cli_participant_binding(0).expect("CLI participant binding");
    let (grants, capabilities) = super::browser::complete_participant_authority(&binding)
        .unwrap_or_else(|_| panic!("complete administration grant set"));
    let json = serde_json::to_string(&grants).expect("serialize administration grants");
    assert!(json.contains("Health.Query"));
    assert!(json.contains("Health.Watch"));
    assert!(json.contains("EventLog.Query"));
    assert!(capabilities.contains(&"trellis.jobs::read".to_owned()));
    assert!(capabilities.contains(&"trellis.jobs::mutate".to_owned()));
    assert!(capabilities.contains(&"trellis.jobs::stream".to_owned()));
    assert!(capabilities.contains(&"trellis.eventlog::read".to_owned()));
    assert!(capabilities.contains(&"trellis.eventlog::stream".to_owned()));
    assert!(
        capabilities.contains(&"trellis.auth::capabilities.delegate".to_owned()),
        "{capabilities:?}"
    );
    assert!(capabilities.contains(&"trellis.health::read".to_owned()));
}
