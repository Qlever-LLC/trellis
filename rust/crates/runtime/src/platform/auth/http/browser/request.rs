use super::super::*;
use axum::body::Body;
use axum::http::header::CONTENT_SECURITY_POLICY;
use axum::http::{HeaderValue, Request};
use tower::ServiceExt as _;

const PROXY_CONTENT_SECURITY_POLICY: &str = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::platform::auth::http) struct AuthStartRequest {
    request_id: String,
    issued_at: i64,
    session_public_key: String,
    session_nkey: String,
    participant_id: String,
    participant_artifact_digest: String,
    participant_artifact: Option<Value>,
    #[serde(default)]
    referenced_api_artifacts: Vec<Value>,
    redirect_target: String,
    proof: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStartResponse {
    flow_id: String,
    login_url: String,
}

pub(crate) async fn start_auth<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Json(raw): Json<Value>,
) -> Result<Json<AuthStartResponse>, HttpError>
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    let request: AuthStartRequest = serde_json::from_value(raw.clone()).map_err(|error| {
        tracing::warn!(%error, "invalid auth request shape");
        HttpError::bad_request("invalid_auth_request")
    })?;
    if ulid::Ulid::from_string(&request.request_id)
        .map(|parsed| parsed.to_string() != request.request_id)
        .unwrap_or(true)
    {
        return Err(HttpError::bad_request("invalid_auth_request"));
    }
    validate_redirect(&request.redirect_target, &state.allowed_redirect_origins)?;
    let request_digest = proof_request_digest(&raw).map_err(|error| {
        tracing::warn!(%error, "invalid auth request proof envelope");
        HttpError::bad_request("invalid_auth_request")
    })?;
    let input = SessionProofInput::user_auth_request(UserAuthRequestSessionProofInput {
        request_id: request.request_id.clone(),
        issued_at: request.issued_at,
        session_public_key: request.session_public_key.clone(),
        session_nkey: request.session_nkey.clone(),
        participant_id: request.participant_id.clone(),
        participant_digest: request.participant_artifact_digest.clone(),
        redirect_target: request.redirect_target.clone(),
        request_digest: request_digest.clone(),
    })
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let proof = parse_session_proof(&request.proof)
        .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    let now = now_ms()?;
    let (portal, _) = select_login_portal(
        state.service.repository(),
        &request.participant_id,
        &request.redirect_target,
    )
    .await?;
    verify_session_proof(
        &input,
        &proof,
        &request.session_public_key,
        now,
        state.proof_policy,
    )
    .map_err(|_| HttpError::unauthorized("invalid_proof"))?;
    if let Some(participant_value) = &request.participant_artifact {
        let participant = parse_participant(participant_value)
            .map_err(|_| HttpError::bad_request("invalid_participant_artifact"))?;
        super::super::super::builtins::validate_participant_namespace(participant.id())
            .map_err(|_| HttpError::bad_request("reserved_participant"))?;
        let mut apis = BTreeMap::new();
        let mut api_values = BTreeMap::new();
        for value in &request.referenced_api_artifacts {
            let api =
                parse_api(value).map_err(|_| HttpError::bad_request("invalid_api_artifact"))?;
            let api_digest = api
                .digest()
                .map_err(|_| HttpError::bad_request("invalid_api_artifact"))?;
            if api.id().starts_with("trellis.")
                && !super::super::super::builtins::is_platform_api(api.id(), &api_digest)
            {
                return Err(HttpError::bad_request("reserved_api_namespace"));
            }
            api_values.insert(
                api.id().to_owned(),
                api.normalized_value()
                    .map_err(|_| HttpError::bad_request("invalid_api_artifact"))?,
            );
            apis.insert(api.id().to_owned(), api);
        }
        let resolved = resolve_participant(&participant, &apis)
            .map_err(|_| HttpError::bad_request("participant_resolution_failed"))?;
        let needs_digest = resolved
            .needs()
            .digest()
            .map_err(|_| HttpError::bad_request("participant_resolution_failed"))?;
        if resolved.participant_id() != request.participant_id
            || resolved.participant_digest() != request.participant_artifact_digest
        {
            tracing::warn!(
                participant_id = %request.participant_id,
                "auth request participant presentation does not match its declared digests"
            );
            return Err(HttpError::bad_request("participant_binding_mismatch"));
        }
        let binding = ParticipantBindingRecord {
            participant_id: resolved.participant_id().to_owned(),
            participant_kind: resolved.participant_kind(),
            artifact_digest: resolved.participant_digest().to_owned(),
            needs_digest,
            participant_json: participant
                .canonical_json()
                .map_err(|_| HttpError::bad_request("invalid_participant_artifact"))?,
            api_artifacts_json: canonicalize_json(
                &serde_json::to_value(api_values)
                    .map_err(|_| HttpError::bad_request("invalid_api_artifact"))?,
            )
            .map_err(|_| HttpError::bad_request("invalid_api_artifact"))?,
            resolved_at: now,
            state: ParticipantBindingState::Resolved,
            error: None,
        };
        super::super::super::builtins::validate_binding_namespace(&binding)
            .map_err(|_| HttpError::bad_request("reserved_artifact_namespace"))?;
        state
            .service
            .repository()
            .put_participant_binding(binding)
            .await?;
    }
    let binding = state
        .service
        .repository()
        .get_participant_binding(
            &request.participant_id,
            &request.participant_artifact_digest,
        )
        .await?
        .ok_or_else(|| {
            tracing::warn!(participant_id = %request.participant_id, "auth request participant binding is unknown");
            HttpError::bad_request("participant_binding_unknown")
        })?;
    if binding.state != ParticipantBindingState::Resolved {
        tracing::warn!(participant_id = %request.participant_id, "auth request participant binding is unresolved");
        return Err(HttpError::bad_request("participant_binding_mismatch"));
    }
    let consent = browser_consent(&binding)?;
    let flow_id = request.request_id.clone();
    let flow = AuthBrowserFlow {
        format: BROWSER_FLOW_FORMAT.to_owned(),
        flow_id: flow_id.clone(),
        kind: AuthBrowserFlowKind::UserAuth,
        state: AuthBrowserFlowState::ChooseProvider,
        request_id: request.request_id,
        request_digest,
        participant_id: request.participant_id,
        participant_artifact_digest: request.participant_artifact_digest,
        participant_needs_digest: binding.needs_digest,
        consent,
        session_public_key: request.session_public_key,
        session_nkey: request.session_nkey,
        portal_id: portal.portal_id.clone(),
        redirect_target: Some(request.redirect_target),
        principal_id: None,
        authenticated_provider_id: None,
        authenticated_roles: Vec::new(),
        portal_binding_digest: None,
        claim_owner: None,
        claimed_at: None,
        durable_result_digest: None,
        completed_at: None,
        created_at: now,
        expires_at: checked_add(now, FLOW_TTL_MS)?,
        version: 1,
    };
    match state.ephemeral.create_browser_flow(flow.clone()).await {
        Ok(()) => {}
        Err(AuthorizationStateError::StorageConflict) => {
            let existing = state
                .ephemeral
                .get_browser_flow(&flow_id)
                .await?
                .ok_or_else(|| HttpError::conflict("proof_replay"))?;
            if existing.request_digest != flow.request_digest
                || existing.session_public_key != flow.session_public_key
            {
                return Err(HttpError::conflict("proof_replay"));
            }
        }
        Err(error) => return Err(error.into()),
    }
    Ok(Json(AuthStartResponse {
        flow_id: flow_id.clone(),
        login_url: portal_url(&portal, &state.public_origin, &flow_id)?,
    }))
}

async fn select_login_portal(
    repository: &impl PortalRepository,
    participant_id: &str,
    redirect_target: &str,
) -> Result<(LoginPortalRecord, LoginSettingsRecord), HttpError> {
    let origin = canonical_origin(redirect_target)
        .map_err(|_| HttpError::bad_request("invalid_redirect_target"))?;
    for route in repository.list_portal_routes().await? {
        if route.deployment_id.is_some()
            || route
                .participant_id
                .as_deref()
                .is_some_and(|value| value != participant_id)
            || route.origin.as_deref().is_some_and(|value| value != origin)
        {
            continue;
        }
        if let Some((portal, settings)) = repository.get_login_portal(&route.portal_id).await? {
            if !portal.disabled && !portal.removed {
                return Ok((portal, settings));
            }
        }
    }
    repository
        .get_login_portal("builtin")
        .await?
        .filter(|(portal, _)| !portal.disabled && !portal.removed)
        .ok_or_else(|| HttpError::internal("builtin_portal_unavailable"))
}

pub(crate) async fn select_device_portal(
    repository: &impl PortalRepository,
    participant_id: &str,
    deployment_id: &str,
) -> Result<LoginPortalRecord, HttpError> {
    for route in repository.list_portal_routes().await? {
        if route.origin.is_some()
            || route
                .participant_id
                .as_deref()
                .is_some_and(|value| value != participant_id)
            || route
                .deployment_id
                .as_deref()
                .is_some_and(|value| value != deployment_id)
        {
            continue;
        }
        if let Some((portal, _)) = repository.get_login_portal(&route.portal_id).await? {
            if !portal.disabled && !portal.removed {
                return Ok(portal);
            }
        }
    }
    repository
        .get_login_portal("builtin")
        .await?
        .map(|(portal, _)| portal)
        .filter(|portal| !portal.disabled && !portal.removed)
        .ok_or_else(|| HttpError::internal("builtin_portal_unavailable"))
}

pub(super) fn portal_url(
    portal: &LoginPortalRecord,
    public_origin: &str,
    flow_id: &str,
) -> Result<String, HttpError> {
    let entry = portal.entry_url.as_deref().map_or_else(
        || format!("{}/login", public_origin.trim_end_matches('/')),
        ToOwned::to_owned,
    );
    let mut url = Url::parse(&entry).map_err(|_| HttpError::internal("portal_entry_invalid"))?;
    url.query_pairs_mut().append_pair("flowId", flow_id);
    Ok(url.into())
}

pub(crate) async fn portal_index<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    request: Request<Body>,
) -> Response
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    serve_source(&state.portal_source, "200.html", Some("200.html"), request).await
}

pub(crate) async fn portal_page<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Response
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    if !embedded_path_is_safe(&path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let fallback = (!path.starts_with("assets/") && (path.contains('/') || !path.contains('.')))
        .then_some("200.html");
    serve_source(
        &state.portal_source,
        &format!("login/{path}"),
        fallback,
        request,
    )
    .await
}

pub(crate) async fn portal_asset<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Response
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    serve_source(
        &state.portal_source,
        &format!("assets/login/{path}"),
        None,
        request,
    )
    .await
}

pub(crate) async fn console_index<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    request: Request<Body>,
) -> Response
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    serve_source(
        &state.console_source,
        "index.html",
        Some("200.html"),
        request,
    )
    .await
}

pub(crate) async fn console_page<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Response
where
    R: AccountRepository
        + AuthorityEvidenceRepository
        + AuthorityRepository
        + ContextRepository
        + DeploymentRepository
        + OutboxRepository
        + PortalRepository
        + ProvisioningRepository
        + SessionRepository
        + Clone
        + Send
        + Sync
        + 'static,
    E: AuthEphemeralRepository + Clone,
{
    let fallback = (!path.starts_with("assets/") && (path.contains('/') || !path.contains('.')))
        .then_some(if state.console_source_is_override {
            "index.html"
        } else {
            "200.html"
        });
    let source_path = if state.console_source_is_override {
        path
    } else {
        format!("console/{path}")
    };
    serve_source(&state.console_source, &source_path, fallback, request).await
}

pub(crate) async fn web_fallback<R, E>(
    State(state): State<AuthHttpState<R, E>>,
    request: Request<Body>,
) -> Response {
    let uri = request.uri().clone();
    if matches!(uri.path(), "/auth" | "/bootstrap")
        || uri.path().starts_with("/auth/")
        || uri.path().starts_with("/bootstrap/")
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = uri.path().trim_start_matches('/');
    let fallback = (!path.starts_with("assets/") && !path.contains('.')).then_some("200.html");
    serve_source(&state.web_source, path, fallback, request).await
}

async fn serve_source(
    source: &WebSource,
    path: &str,
    fallback: Option<&str>,
    request: Request<Body>,
) -> Response {
    if let WebSource::Proxy(proxy) = source {
        return proxy_request(proxy, request).await;
    }
    if !embedded_path_is_safe(path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let response = match source {
        WebSource::Embedded => embedded_file(EMBEDDED_WEB_ASSETS, path),
        WebSource::Directory(directory) => directory_file(directory, path).await,
        WebSource::Proxy(_) => unreachable!(),
    };
    if response.status() == StatusCode::NOT_FOUND {
        if let Some(fallback) = fallback {
            return match source {
                WebSource::Embedded => embedded_file(EMBEDDED_WEB_ASSETS, fallback),
                WebSource::Directory(directory) => directory_file(directory, fallback).await,
                WebSource::Proxy(_) => unreachable!(),
            };
        }
    }
    response
}

async fn proxy_request(proxy: &axum::Router, request: Request<Body>) -> Response {
    let Ok(mut response) = proxy.clone().oneshot(request).await;
    response
        .headers_mut()
        .entry(CONTENT_SECURITY_POLICY)
        .or_insert(HeaderValue::from_static(PROXY_CONTENT_SECURITY_POLICY));
    response
}

async fn directory_file(directory: &std::path::Path, path: &str) -> Response {
    match tokio::fs::read(directory.join(path)).await {
        Ok(bytes) => embedded_response(path, bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            StatusCode::NOT_FOUND.into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn embedded_file(assets: &[(&str, &[u8])], path: &str) -> Response {
    if !embedded_path_is_safe(path) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(bytes) = assets
        .iter()
        .find_map(|(asset_path, bytes)| (*asset_path == path).then(|| bytes.to_vec()))
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    embedded_response(path, bytes)
}

fn embedded_path_is_safe(path: &str) -> bool {
    std::path::Path::new(path)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn embedded_response(path: &str, bytes: Vec<u8>) -> Response {
    let content_type = match path.rsplit_once('.').map(|(_, extension)| extension) {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("ico") => "image/x-icon",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("txt") => "text/plain; charset=utf-8",
        Some("webp") => "image/webp",
        Some("wasm") => "application/wasm",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    };
    ([(CONTENT_TYPE, content_type)], bytes).into_response()
}

#[cfg(test)]
mod tests {
    #[test]
    fn start_response_has_one_final_shape() {
        assert_eq!(
            serde_json::to_value(super::AuthStartResponse {
                flow_id: "flow_01".to_owned(),
                login_url: "https://auth.example/login?flowId=flow_01".to_owned(),
            })
            .unwrap(),
            serde_json::json!({
                "flowId": "flow_01",
                "loginUrl": "https://auth.example/login?flowId=flow_01",
            })
        );
    }
}
