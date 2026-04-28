use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::SigningKey;
use reqwest::Client as HttpClient;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

use crate::client::{connect_admin_client_async, AuthClient};
use crate::models::{
    AdminLoginOutcome, AdminReauthOutcome, AdminSessionState, AgentLoginChallenge, BindResponse,
    BindResponseBound, BoundSession, StartAgentLoginOpts,
};
use crate::TrellisAuthError;
use crate::{AuthStartRequest, AuthStartResponse, ClientTransportsRecord};
use trellis_client::SessionAuth;

pub(crate) const DETACHED_LOGIN_POLL_INTERVAL: Duration = Duration::from_secs(2);

fn canonicalize_json_value(value: &Value) -> Result<String, TrellisAuthError> {
    match value {
        Value::Null => Ok("null".to_string()),
        Value::Bool(value) => Ok(if *value { "true" } else { "false" }.to_string()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => Ok(serde_json::to_string(value)?),
        Value::Array(values) => {
            let mut canonical = String::from("[");
            for (index, entry) in values.iter().enumerate() {
                if index > 0 {
                    canonical.push(',');
                }
                canonical.push_str(&canonicalize_json_value(entry)?);
            }
            canonical.push(']');
            Ok(canonical)
        }
        Value::Object(values) => {
            let mut entries = values.iter().collect::<Vec<_>>();
            entries.sort_by(|(left, _), (right, _)| left.cmp(right));

            let mut canonical = String::from("{");
            for (index, (key, entry)) in entries.into_iter().enumerate() {
                if index > 0 {
                    canonical.push(',');
                }
                canonical.push_str(&serde_json::to_string(key)?);
                canonical.push(':');
                canonical.push_str(&canonicalize_json_value(entry)?);
            }
            canonical.push('}');
            Ok(canonical)
        }
    }
}

pub(crate) fn build_auth_start_signature_payload(
    redirect_to: &str,
    provider: Option<&str>,
    contract: &Value,
    context: Option<&Value>,
) -> Result<String, TrellisAuthError> {
    Ok(format!(
        "{}:{}:{}:{}",
        redirect_to,
        provider.unwrap_or_default(),
        canonicalize_json_value(contract)?,
        canonicalize_json_value(context.unwrap_or(&Value::Null))?,
    ))
}

fn join_native_nats_servers(
    transports: &ClientTransportsRecord,
) -> Result<String, TrellisAuthError> {
    let Some(native) = &transports.native else {
        return Err(TrellisAuthError::UnexpectedBindStatus(
            "missing_native_transport".to_string(),
        ));
    };
    let servers = &native.nats_servers;
    if servers.is_empty() {
        return Err(TrellisAuthError::UnexpectedBindStatus(
            "missing_native_transport".to_string(),
        ));
    }
    Ok(servers.join(","))
}

fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn object_entries(value: Option<&Value>) -> Option<&Map<String, Value>> {
    value.and_then(Value::as_object)
}

fn collect_schema_ref(reachable: &mut BTreeSet<String>, value: Option<&Value>) {
    let Some(schema) = value
        .and_then(Value::as_object)
        .and_then(|object| object.get("schema"))
        .and_then(Value::as_str)
    else {
        return;
    };
    reachable.insert(schema.to_string());
}

fn collect_reachable_schema_names(contract: &Map<String, Value>) -> BTreeSet<String> {
    let mut reachable = BTreeSet::new();

    for store in object_entries(contract.get("state"))
        .map(Map::values)
        .into_iter()
        .flatten()
    {
        collect_schema_ref(
            &mut reachable,
            store.as_object().and_then(|object| object.get("schema")),
        );
        for accepted in object_entries(
            store
                .as_object()
                .and_then(|object| object.get("acceptedVersions")),
        )
        .map(Map::values)
        .into_iter()
        .flatten()
        {
            collect_schema_ref(&mut reachable, Some(accepted));
        }
    }

    for method in object_entries(contract.get("rpc"))
        .map(Map::values)
        .into_iter()
        .flatten()
    {
        let method = method.as_object();
        collect_schema_ref(
            &mut reachable,
            method.and_then(|object| object.get("input")),
        );
        collect_schema_ref(
            &mut reachable,
            method.and_then(|object| object.get("output")),
        );
        for error in method
            .and_then(|object| object.get("errors"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(error_type) = error
                .as_object()
                .and_then(|object| object.get("type"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let declaration = object_entries(contract.get("errors"))
                .and_then(|errors| {
                    errors.values().find(|declaration| {
                        declaration
                            .as_object()
                            .and_then(|object| object.get("type"))
                            .and_then(Value::as_str)
                            == Some(error_type)
                    })
                })
                .and_then(Value::as_object);
            collect_schema_ref(
                &mut reachable,
                declaration.and_then(|object| object.get("schema")),
            );
        }
    }

    for operation in object_entries(contract.get("operations"))
        .map(Map::values)
        .into_iter()
        .flatten()
    {
        let operation = operation.as_object();
        collect_schema_ref(
            &mut reachable,
            operation.and_then(|object| object.get("input")),
        );
        collect_schema_ref(
            &mut reachable,
            operation.and_then(|object| object.get("progress")),
        );
        collect_schema_ref(
            &mut reachable,
            operation.and_then(|object| object.get("output")),
        );
    }

    for event in object_entries(contract.get("events"))
        .map(Map::values)
        .into_iter()
        .flatten()
    {
        collect_schema_ref(
            &mut reachable,
            event.as_object().and_then(|object| object.get("event")),
        );
    }

    for job in object_entries(contract.get("jobs"))
        .map(Map::values)
        .into_iter()
        .flatten()
    {
        let job = job.as_object();
        collect_schema_ref(&mut reachable, job.and_then(|object| object.get("payload")));
        collect_schema_ref(&mut reachable, job.and_then(|object| object.get("result")));
    }

    for resource in object_entries(
        contract
            .get("resources")
            .and_then(Value::as_object)
            .and_then(|object| object.get("kv")),
    )
    .map(Map::values)
    .into_iter()
    .flatten()
    {
        collect_schema_ref(
            &mut reachable,
            resource.as_object().and_then(|object| object.get("schema")),
        );
    }

    reachable
}

fn sorted_unique_strings(value: &Value) -> Result<Vec<Value>, TrellisAuthError> {
    let values = value.as_array().ok_or_else(|| {
        TrellisAuthError::InvalidArgument("contract list must be an array".to_string())
    })?;
    let mut unique = BTreeSet::new();
    for value in values {
        let Some(value) = value.as_str() else {
            return Err(TrellisAuthError::InvalidArgument(
                "contract list entries must be strings".to_string(),
            ));
        };
        unique.insert(value.to_string());
    }
    Ok(unique.into_iter().map(Value::String).collect())
}

fn insert_sorted_list(
    target: &mut Map<String, Value>,
    key: &str,
    source: Option<&Value>,
) -> Result<(), TrellisAuthError> {
    if let Some(source) = source {
        target.insert(
            key.to_string(),
            Value::Array(sorted_unique_strings(source)?),
        );
    }
    Ok(())
}

fn project_digest_uses(value: Option<&Value>) -> Result<Option<Value>, TrellisAuthError> {
    let Some(uses) = object_entries(value) else {
        return Ok(None);
    };
    let mut projected_uses = Map::new();
    for (alias, contract_use) in uses {
        let Some(contract_use) = contract_use.as_object() else {
            return Err(TrellisAuthError::InvalidArgument(
                "contract uses entries must be objects".to_string(),
            ));
        };
        let mut projected = Map::new();
        if let Some(contract) = contract_use.get("contract") {
            projected.insert("contract".to_string(), contract.clone());
        }
        if let Some(call) = contract_use
            .get("rpc")
            .and_then(Value::as_object)
            .and_then(|rpc| rpc.get("call"))
        {
            let mut rpc = Map::new();
            insert_sorted_list(&mut rpc, "call", Some(call))?;
            projected.insert("rpc".to_string(), Value::Object(rpc));
        }
        if let Some(call) = contract_use
            .get("operations")
            .and_then(Value::as_object)
            .and_then(|operations| operations.get("call"))
        {
            let mut operations = Map::new();
            insert_sorted_list(&mut operations, "call", Some(call))?;
            projected.insert("operations".to_string(), Value::Object(operations));
        }
        let events = contract_use.get("events").and_then(Value::as_object);
        let mut projected_events = Map::new();
        insert_sorted_list(
            &mut projected_events,
            "publish",
            events.and_then(|events| events.get("publish")),
        )?;
        insert_sorted_list(
            &mut projected_events,
            "subscribe",
            events.and_then(|events| events.get("subscribe")),
        )?;
        if !projected_events.is_empty() {
            projected.insert("events".to_string(), Value::Object(projected_events));
        }
        projected_uses.insert(alias.clone(), Value::Object(projected));
    }
    Ok(Some(Value::Object(projected_uses)))
}

fn project_capabilities(
    capabilities: Option<&Map<String, Value>>,
    keys: &[&str],
) -> Result<Option<Value>, TrellisAuthError> {
    let mut projected = Map::new();
    for key in keys {
        insert_sorted_list(
            &mut projected,
            key,
            capabilities.and_then(|capabilities| capabilities.get(*key)),
        )?;
    }
    Ok((!projected.is_empty()).then_some(Value::Object(projected)))
}

fn project_digest_rpc(value: Option<&Value>) -> Result<Option<Value>, TrellisAuthError> {
    let Some(rpc) = object_entries(value) else {
        return Ok(None);
    };
    let mut projected_rpc = Map::new();
    for (name, method) in rpc {
        let Some(method) = method.as_object() else {
            return Err(TrellisAuthError::InvalidArgument(
                "contract rpc entries must be objects".to_string(),
            ));
        };
        let mut projected = method.clone();
        if let Some(capabilities) = project_capabilities(
            method.get("capabilities").and_then(Value::as_object),
            &["call"],
        )? {
            projected.insert("capabilities".to_string(), capabilities);
        }
        if let Some(errors) = method.get("errors") {
            let sorted = sorted_unique_strings(&Value::Array(
                errors
                    .as_array()
                    .ok_or_else(|| {
                        TrellisAuthError::InvalidArgument(
                            "contract rpc errors must be an array".to_string(),
                        )
                    })?
                    .iter()
                    .filter_map(|error| {
                        error
                            .as_object()
                            .and_then(|object| object.get("type"))
                            .and_then(Value::as_str)
                            .map(|error_type| Value::String(error_type.to_string()))
                    })
                    .collect(),
            ))?;
            projected.insert(
                "errors".to_string(),
                Value::Array(
                    sorted
                        .into_iter()
                        .map(|error_type| {
                            let mut error = Map::new();
                            error.insert("type".to_string(), error_type);
                            Value::Object(error)
                        })
                        .collect(),
                ),
            );
        }
        projected_rpc.insert(name.clone(), Value::Object(projected));
    }
    Ok(Some(Value::Object(projected_rpc)))
}

fn project_digest_operations(value: Option<&Value>) -> Result<Option<Value>, TrellisAuthError> {
    let Some(operations) = object_entries(value) else {
        return Ok(None);
    };
    let mut projected_operations = Map::new();
    for (name, operation) in operations {
        let Some(operation) = operation.as_object() else {
            return Err(TrellisAuthError::InvalidArgument(
                "contract operation entries must be objects".to_string(),
            ));
        };
        let mut projected = operation.clone();
        if let Some(capabilities) = project_capabilities(
            operation.get("capabilities").and_then(Value::as_object),
            &["call", "read", "cancel"],
        )? {
            projected.insert("capabilities".to_string(), capabilities);
        }
        projected_operations.insert(name.clone(), Value::Object(projected));
    }
    Ok(Some(Value::Object(projected_operations)))
}

fn project_digest_events(value: Option<&Value>) -> Result<Option<Value>, TrellisAuthError> {
    let Some(events) = object_entries(value) else {
        return Ok(None);
    };
    let mut projected_events = Map::new();
    for (name, event) in events {
        let Some(event) = event.as_object() else {
            return Err(TrellisAuthError::InvalidArgument(
                "contract event entries must be objects".to_string(),
            ));
        };
        let mut projected = event.clone();
        if let Some(capabilities) = project_capabilities(
            event.get("capabilities").and_then(Value::as_object),
            &["publish", "subscribe"],
        )? {
            projected.insert("capabilities".to_string(), capabilities);
        }
        projected_events.insert(name.clone(), Value::Object(projected));
    }
    Ok(Some(Value::Object(projected_events)))
}

fn project_contract_digest_manifest(
    contract: &Map<String, Value>,
) -> Result<Value, TrellisAuthError> {
    let mut projected = Map::new();
    for key in ["format", "id", "kind"] {
        if let Some(value) = contract.get(key) {
            projected.insert(key.to_string(), value.clone());
        }
    }

    let reachable_schemas = collect_reachable_schema_names(contract);
    if let Some(schemas) = object_entries(contract.get("schemas")) {
        let schemas = schemas
            .iter()
            .filter(|(name, _)| reachable_schemas.contains(*name))
            .map(|(name, schema)| (name.clone(), schema.clone()))
            .collect::<Map<_, _>>();
        if !schemas.is_empty() {
            projected.insert("schemas".to_string(), Value::Object(schemas));
        }
    }

    if let Some(state) = contract.get("state") {
        projected.insert("state".to_string(), state.clone());
    }
    if let Some(uses) = project_digest_uses(contract.get("uses"))? {
        projected.insert("uses".to_string(), uses);
    }
    if let Some(rpc) = project_digest_rpc(contract.get("rpc"))? {
        projected.insert("rpc".to_string(), rpc);
    }
    if let Some(operations) = project_digest_operations(contract.get("operations"))? {
        projected.insert("operations".to_string(), operations);
    }
    if let Some(events) = project_digest_events(contract.get("events"))? {
        projected.insert("events".to_string(), events);
    }
    if let Some(errors) = object_entries(contract.get("errors")) {
        let declared_error_types = object_entries(contract.get("rpc"))
            .map(|rpc| {
                rpc.values()
                    .filter_map(Value::as_object)
                    .filter_map(|method| method.get("errors"))
                    .filter_map(Value::as_array)
                    .flatten()
                    .filter_map(|error| {
                        error
                            .as_object()
                            .and_then(|object| object.get("type"))
                            .and_then(Value::as_str)
                    })
                    .map(str::to_string)
                    .collect::<BTreeSet<_>>()
            })
            .unwrap_or_default();
        let errors = errors
            .iter()
            .filter(|(_, error)| {
                error
                    .as_object()
                    .and_then(|object| object.get("type"))
                    .and_then(Value::as_str)
                    .is_some_and(|error_type| declared_error_types.contains(error_type))
            })
            .map(|(name, error)| (name.clone(), error.clone()))
            .collect::<Map<_, _>>();
        if !errors.is_empty() {
            projected.insert("errors".to_string(), Value::Object(errors));
        }
    }
    if let Some(jobs) = contract.get("jobs") {
        projected.insert("jobs".to_string(), jobs.clone());
    }
    if let Some(resources) = object_entries(contract.get("resources")) {
        let mut projected_resources = Map::new();
        if let Some(kv) = resources.get("kv") {
            projected_resources.insert("kv".to_string(), kv.clone());
        }
        if let Some(store) = resources.get("store") {
            projected_resources.insert("store".to_string(), store.clone());
        }
        if !projected_resources.is_empty() {
            projected.insert("resources".to_string(), Value::Object(projected_resources));
        }
    }

    Ok(Value::Object(projected))
}

/// Compute the canonical Trellis contract digest for a JSON contract document.
pub fn contract_digest(contract_json: &str) -> Result<String, TrellisAuthError> {
    let contract: Value = serde_json::from_str(contract_json)?;
    let Some(contract) = contract.as_object() else {
        return Err(TrellisAuthError::InvalidArgument(
            "contract json must be an object".to_string(),
        ));
    };
    let canonical = canonicalize_json_value(&project_contract_digest_manifest(contract)?)?;
    Ok(base64url_encode(&Sha256::digest(canonical.as_bytes())))
}

/// Generate a new base64url-encoded Ed25519 session seed and public key.
pub fn generate_session_keypair() -> (String, String) {
    let seed: [u8; 32] = rand::random();
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key = signing_key.verifying_key().to_bytes();
    (base64url_encode(&seed), base64url_encode(&public_key))
}

pub(crate) fn detached_login_redirect_to() -> Result<String, TrellisAuthError> {
    Ok("/_trellis/portal/users/login".to_string())
}

async fn start_auth_request(
    trellis_url: &str,
    redirect_to: &str,
    auth: &SessionAuth,
    contract_json: &str,
) -> Result<AuthStartResponse, TrellisAuthError> {
    let contract: Value = serde_json::from_str(contract_json)?;
    let contract = contract.as_object().cloned().ok_or_else(|| {
        TrellisAuthError::InvalidArgument("contract json must be an object".to_string())
    })?;
    let sig = auth.sign_sha256_domain(
        "oauth-init",
        &build_auth_start_signature_payload(
            redirect_to,
            None,
            &Value::Object(contract.clone()),
            None,
        )?,
    );
    let client = HttpClient::builder().build()?;
    let response = client
        .post(format!(
            "{}/auth/requests",
            trellis_url.trim_end_matches('/')
        ))
        .json(&AuthStartRequest {
            provider: None,
            redirect_to: redirect_to.to_string(),
            session_key: auth.session_key.clone(),
            sig,
            contract: contract.into_iter().collect(),
            context: None,
        })
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::AuthRequestHttpFailure(
            status.as_u16(),
            text,
        ));
    }
    Ok(serde_json::from_str::<AuthStartResponse>(&text)?)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum AgentFlowStatusResponse {
    Redirect { location: String },
    ChooseProvider,
    ApprovalRequired,
    ApprovalDenied,
    InsufficientCapabilities,
    Expired,
}

async fn fetch_agent_flow_status(
    trellis_url: &str,
    flow_id: &str,
) -> Result<AgentFlowStatusResponse, TrellisAuthError> {
    let client = HttpClient::builder().build()?;
    let response = client
        .get(format!(
            "{}/auth/flow/{}",
            trellis_url.trim_end_matches('/'),
            flow_id
        ))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::AuthRequestHttpFailure(
            status.as_u16(),
            text,
        ));
    }
    Ok(serde_json::from_str::<AgentFlowStatusResponse>(&text)?)
}

pub(crate) async fn poll_agent_flow_until_ready(
    trellis_url: &str,
    flow_id: &str,
    poll_interval: Duration,
    timeout_after: Duration,
) -> Result<String, TrellisAuthError> {
    let deadline = tokio::time::Instant::now() + timeout_after;
    loop {
        match fetch_agent_flow_status(trellis_url, flow_id).await? {
            AgentFlowStatusResponse::Redirect { location } => {
                let _ = location;
                return Ok(flow_id.to_string());
            }
            AgentFlowStatusResponse::ChooseProvider | AgentFlowStatusResponse::ApprovalRequired => {
            }
            AgentFlowStatusResponse::ApprovalDenied => {
                return Err(TrellisAuthError::AuthFlowFailed(
                    "approval_denied".to_string(),
                ));
            }
            AgentFlowStatusResponse::InsufficientCapabilities => {
                return Err(TrellisAuthError::AuthFlowFailed(
                    "insufficient_capabilities".to_string(),
                ));
            }
            AgentFlowStatusResponse::Expired => {
                return Err(TrellisAuthError::AuthFlowFailed("expired".to_string()));
            }
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(TrellisAuthError::LoginTimedOut);
        }
        tokio::time::sleep(poll_interval).await;
    }
}

async fn bind_session(
    trellis_url: &str,
    auth: &SessionAuth,
    flow_id: &str,
) -> Result<BoundSession, TrellisAuthError> {
    let client = HttpClient::builder().build()?;
    let bind_url = format!(
        "{}/auth/flow/{}/bind",
        trellis_url.trim_end_matches('/'),
        flow_id
    );
    let sig = auth.sign_sha256_domain("bind-flow", flow_id);
    let response = client
        .post(bind_url)
        .json(&json!({
            "sessionKey": auth.session_key,
            "sig": sig,
        }))
        .send()
        .await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        return Err(TrellisAuthError::BindHttpFailure(status.as_u16(), text));
    }

    match serde_json::from_str::<BindResponse>(&text)? {
        BindResponse::Bound(BindResponseBound {
            inbox_prefix,
            expires,
            sentinel,
            transports,
        }) => Ok(BoundSession {
            inbox_prefix,
            expires,
            nats_servers: join_native_nats_servers(&transports)?,
            sentinel,
        }),
        BindResponse::ApprovalRequired { approval } => Err(TrellisAuthError::UnexpectedBindStatus(
            format!("approval_required:{approval}"),
        )),
        BindResponse::ApprovalDenied { approval } => Err(TrellisAuthError::UnexpectedBindStatus(
            format!("approval_denied:{approval}"),
        )),
        BindResponse::InsufficientCapabilities {
            approval,
            missing_capabilities,
        } => Err(TrellisAuthError::UnexpectedBindStatus(format!(
            "insufficient_capabilities:{approval}:{missing_capabilities:?}"
        ))),
    }
}

impl AgentLoginChallenge {
    /// Return the URL the user should open to complete login.
    pub fn login_url(&self) -> &str {
        &self.login_url
    }

    /// Wait for detached portal completion, then bind the session.
    pub async fn complete(self, trellis_url: &str) -> Result<AdminLoginOutcome, TrellisAuthError> {
        let AgentLoginChallenge {
            flow_id,
            login_url: _,
            session_seed,
            contract_digest,
            auth,
        } = self;
        let flow_id = poll_agent_flow_until_ready(
            trellis_url,
            &flow_id,
            DETACHED_LOGIN_POLL_INTERVAL,
            Duration::from_secs(300),
        )
        .await?;
        let bound = bind_session(trellis_url, &auth, &flow_id).await?;
        let state = AdminSessionState {
            trellis_url: trellis_url.to_string(),
            nats_servers: bound.nats_servers.clone(),
            session_seed,
            session_key: auth.session_key.clone(),
            contract_digest,
            sentinel_jwt: bound.sentinel.jwt,
            sentinel_seed: bound.sentinel.seed,
            expires: bound.expires,
        };

        let client = connect_admin_client_async(&state).await?;
        let auth_client = AuthClient::new(&client);
        let user = auth_client.me().await?;
        if !user
            .capabilities
            .iter()
            .any(|capability| capability == "admin")
        {
            return Err(TrellisAuthError::NotAdmin);
        }

        Ok(AdminLoginOutcome { state, user })
    }
}

/// Start the agent login flow against the detached Trellis portal.
pub async fn start_agent_login(
    opts: &StartAgentLoginOpts<'_>,
) -> Result<AgentLoginChallenge, TrellisAuthError> {
    let (session_seed, _session_key) = generate_session_keypair();
    let auth = SessionAuth::from_seed_base64url(&session_seed)?;
    let redirect_to = detached_login_redirect_to()?;
    let (flow_id, login_url) = match start_auth_request(
        opts.trellis_url,
        &redirect_to,
        &auth,
        opts.contract_json,
    )
    .await?
    {
        AuthStartResponse::FlowStarted { flow_id, login_url } => (flow_id, login_url),
        AuthStartResponse::Bound { .. } => {
            return Err(TrellisAuthError::UnexpectedAuthRequestStatus(
                "bound_without_existing_session".to_string(),
            ));
        }
    };

    Ok(AgentLoginChallenge {
        flow_id,
        login_url,
        session_seed,
        contract_digest: contract_digest(opts.contract_json)?,
        auth,
    })
}

/// Start admin reauthentication for a changed contract using the stored session key.
pub async fn start_admin_reauth(
    state: &AdminSessionState,
    contract_json: &str,
) -> Result<AdminReauthOutcome, TrellisAuthError> {
    let auth = SessionAuth::from_seed_base64url(&state.session_seed)?;
    let redirect_to = detached_login_redirect_to()?;
    match start_auth_request(&state.trellis_url, &redirect_to, &auth, contract_json).await? {
        AuthStartResponse::Bound {
            inbox_prefix: _,
            expires,
            sentinel,
            transports,
        } => {
            let next_state = AdminSessionState {
                trellis_url: state.trellis_url.clone(),
                nats_servers: join_native_nats_servers(&transports)?,
                session_seed: state.session_seed.clone(),
                session_key: auth.session_key.clone(),
                contract_digest: contract_digest(contract_json)?,
                sentinel_jwt: sentinel.jwt,
                sentinel_seed: sentinel.seed,
                expires,
            };
            let client = connect_admin_client_async(&next_state).await?;
            let auth_client = AuthClient::new(&client);
            let user = auth_client.me().await?;
            if !user
                .capabilities
                .iter()
                .any(|capability| capability == "admin")
            {
                return Err(TrellisAuthError::NotAdmin);
            }
            Ok(AdminReauthOutcome::Bound(AdminLoginOutcome {
                state: next_state,
                user,
            }))
        }
        AuthStartResponse::FlowStarted { flow_id, login_url } => {
            Ok(AdminReauthOutcome::Flow(AgentLoginChallenge {
                flow_id,
                login_url,
                session_seed: state.session_seed.clone(),
                contract_digest: contract_digest(contract_json)?,
                auth,
            }))
        }
    }
}
