use async_nats::header::HeaderMap;
use async_nats::ConnectOptions;
use bytes::Bytes;
use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use nkeys::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use crate::operations::{OperationDescriptor, OperationInvoker, OperationTransport};
use crate::proof::now_iat_seconds;
use crate::transfer::{
    get_download_grant, put_upload_grant, DownloadTransferGrant, FileInfo, UploadTransferGrant,
};
use crate::{EventDescriptor, RpcDescriptor, SessionAuth, TrellisClientError};

const HEALTH_HEARTBEAT_SUBJECT: &str = "events.v1.Health.Heartbeat";
const HEALTH_HEARTBEAT_INTERVAL_MS: u64 = 30_000;
static HEALTH_HEARTBEAT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Connection options for a Trellis service/session-key principal.
pub struct ServiceConnectOptions<'a> {
    pub trellis_url: &'a str,
    pub contract_id: &'a str,
    pub contract_digest: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

/// Connection options for an activated device principal.
pub struct DeviceConnectOptions<'a> {
    pub trellis_url: &'a str,
    pub contract_digest: &'a str,
    pub public_identity_key: &'a str,
    pub identity_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBootstrapRequest<'a> {
    session_key: &'a str,
    contract_id: &'a str,
    contract_digest: &'a str,
    iat: u64,
    sig: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBootstrapResponse {
    status: String,
    connect_info: ServiceBootstrapConnectInfo,
    binding: Value,
    server_now: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBootstrapFailure {
    reason: String,
    server_now: Option<u64>,
}

#[derive(Debug)]
struct ServiceBootstrapResult {
    response: ServiceBootstrapResponse,
    iat_clock: IatClock,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceConnectInfoRequest<'a> {
    public_identity_key: &'a str,
    contract_digest: &'a str,
    iat: u64,
    sig: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceConnectInfoResponse {
    status: String,
    connect_info: DeviceConnectInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceConnectInfo {
    instance_id: String,
    deployment_id: String,
    contract_id: String,
    contract_digest: String,
    transports: DeviceConnectInfoTransports,
    transport: DeviceConnectInfoTransport,
    auth: DeviceConnectInfoAuth,
}

#[derive(Debug, Deserialize)]
struct DeviceConnectInfoTransports {
    native: Option<DeviceConnectInfoNatsTransport>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceConnectInfoNatsTransport {
    nats_servers: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceConnectInfoTransport {
    sentinel: DeviceConnectInfoSentinel,
}

#[derive(Debug, Deserialize)]
struct DeviceConnectInfoSentinel {
    jwt: String,
    seed: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceConnectInfoAuth {
    mode: String,
    iat_skew_seconds: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct IatClock {
    offset_seconds: i64,
}

#[derive(Clone, Debug)]
struct HealthHeartbeatConfig {
    service_name: String,
    kind: HealthHeartbeatServiceKind,
    instance_id: String,
    contract_id: String,
    contract_digest: String,
    started_at: String,
    publish_interval_ms: u64,
    info: Option<Value>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum HealthHeartbeatServiceKind {
    Service,
    Device,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthHeartbeat {
    header: HealthHeartbeatHeader,
    service: HealthHeartbeatService,
    status: &'static str,
    checks: Vec<HealthHeartbeatCheck>,
}

#[derive(Debug, Serialize)]
struct HealthHeartbeatHeader {
    id: String,
    time: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthHeartbeatService {
    name: String,
    kind: HealthHeartbeatServiceKind,
    instance_id: String,
    contract_id: String,
    contract_digest: String,
    started_at: String,
    publish_interval_ms: u64,
    runtime: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    info: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthHeartbeatCheck {
    name: &'static str,
    status: &'static str,
    latency_ms: u64,
}

impl IatClock {
    fn current_iat(self) -> u64 {
        self.iat_at(now_iat_seconds())
    }

    fn iat_at(self, local_now: u64) -> u64 {
        if self.offset_seconds >= 0 {
            local_now.saturating_add(self.offset_seconds as u64)
        } else {
            local_now.saturating_sub(self.offset_seconds.unsigned_abs())
        }
    }

    fn adjust_from_server_now(
        &mut self,
        request_started_at: u64,
        request_ended_at: u64,
        server_now: u64,
    ) {
        let midpoint = request_started_at
            .saturating_add(request_ended_at.saturating_sub(request_started_at) / 2);
        self.offset_seconds = (server_now as i128 - midpoint as i128)
            .clamp(i64::MIN as i128, i64::MAX as i128) as i64;
    }

    fn from_offset_seconds(offset_seconds: i64) -> Self {
        Self { offset_seconds }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBootstrapConnectInfo {
    contract_digest: String,
    transports: ServiceBootstrapTransports,
    transport: ServiceBootstrapTransport,
}

#[derive(Debug, Deserialize)]
struct ServiceBootstrapTransports {
    native: Option<ServiceBootstrapNatsTransport>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBootstrapNatsTransport {
    nats_servers: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ServiceBootstrapTransport {
    sentinel: ServiceBootstrapSentinel,
}

#[derive(Debug, Deserialize)]
struct ServiceBootstrapSentinel {
    jwt: String,
    seed: String,
}

fn build_service_bootstrap_request<'a>(
    auth: &'a SessionAuth,
    contract_id: &'a str,
    contract_digest: &'a str,
    iat: u64,
) -> ServiceBootstrapRequest<'a> {
    ServiceBootstrapRequest {
        session_key: &auth.session_key,
        contract_id,
        contract_digest,
        iat,
        sig: auth.sign_sha256_domain("nats-connect", &format!("{iat}:{contract_digest}")),
    }
}

async fn fetch_service_bootstrap(
    auth: &SessionAuth,
    opts: &ServiceConnectOptions<'_>,
) -> Result<ServiceBootstrapResult, TrellisClientError> {
    let mut url = reqwest::Url::parse(opts.trellis_url)
        .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
    url.set_path("/bootstrap/service");
    url.set_query(None);
    url.set_fragment(None);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(opts.timeout_ms))
        .build()
        .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
    let mut iat_clock = IatClock::default();

    for attempt in 0..2 {
        let request_started_at = now_iat_seconds();
        let request = build_service_bootstrap_request(
            auth,
            opts.contract_id,
            opts.contract_digest,
            iat_clock.current_iat(),
        );
        let response = client
            .post(url.clone())
            .json(&request)
            .send()
            .await
            .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
        let request_ended_at = now_iat_seconds();

        if !status.is_success() {
            if attempt == 0
                && adjust_iat_after_out_of_range(
                    &body,
                    &mut iat_clock,
                    request_started_at,
                    request_ended_at,
                )
            {
                continue;
            }
            return Err(TrellisClientError::BootstrapHttp {
                status: status.as_u16(),
                body,
            });
        }

        let response: ServiceBootstrapResponse = serde_json::from_str(&body)?;
        if let Some(server_now) = response.server_now {
            iat_clock.adjust_from_server_now(request_started_at, request_ended_at, server_now);
        }
        return Ok(ServiceBootstrapResult {
            response,
            iat_clock,
        });
    }

    unreachable!("service bootstrap retry loop is bounded")
}

fn adjust_iat_after_out_of_range(
    body: &str,
    iat_clock: &mut IatClock,
    request_started_at: u64,
    request_ended_at: u64,
) -> bool {
    let Ok(failure) = serde_json::from_str::<ServiceBootstrapFailure>(body) else {
        return false;
    };
    let Some(server_now) = failure.server_now else {
        return false;
    };
    if failure.reason != "iat_out_of_range" {
        return false;
    }
    iat_clock.adjust_from_server_now(request_started_at, request_ended_at, server_now);
    true
}

fn validate_service_bootstrap_contract_digest(
    expected: &str,
    actual: &str,
) -> Result<(), TrellisClientError> {
    if actual == expected {
        return Ok(());
    }

    Err(TrellisClientError::Bootstrap(format!(
        "service bootstrap contract digest mismatch: expected '{expected}', got '{actual}'"
    )))
}

fn build_device_connect_info_proof_input(
    public_identity_key: &str,
    iat: u64,
    contract_digest: &str,
) -> Vec<u8> {
    let public_identity_key = public_identity_key.as_bytes();
    let nonce = b"connect-info";
    let iat = iat.to_string();
    let iat = iat.as_bytes();
    let contract_digest = contract_digest.as_bytes();

    let mut out = Vec::with_capacity(
        4 + public_identity_key.len() + 4 + nonce.len() + 4 + iat.len() + 4 + contract_digest.len(),
    );
    out.extend_from_slice(&(public_identity_key.len() as u32).to_be_bytes());
    out.extend_from_slice(public_identity_key);
    out.extend_from_slice(&(nonce.len() as u32).to_be_bytes());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&(iat.len() as u32).to_be_bytes());
    out.extend_from_slice(iat);
    out.extend_from_slice(&(contract_digest.len() as u32).to_be_bytes());
    out.extend_from_slice(contract_digest);
    out
}

fn build_device_connect_info_request<'a>(
    auth: &SessionAuth,
    public_identity_key: &'a str,
    contract_digest: &'a str,
    iat: u64,
) -> DeviceConnectInfoRequest<'a> {
    DeviceConnectInfoRequest {
        public_identity_key,
        contract_digest,
        iat,
        sig: auth.sign_sha256_bytes(&build_device_connect_info_proof_input(
            public_identity_key,
            iat,
            contract_digest,
        )),
    }
}

async fn fetch_device_connect_info(
    auth: &SessionAuth,
    opts: &DeviceConnectOptions<'_>,
) -> Result<DeviceConnectInfoResponse, TrellisClientError> {
    let mut url = reqwest::Url::parse(opts.trellis_url)
        .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
    url.set_path("/auth/devices/connect-info");
    url.set_query(None);
    url.set_fragment(None);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(opts.timeout_ms))
        .build()
        .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
    let mut iat_clock = IatClock::default();

    for attempt in 0..2 {
        let request_started_at = now_iat_seconds();
        let request = build_device_connect_info_request(
            auth,
            opts.public_identity_key,
            opts.contract_digest,
            iat_clock.current_iat(),
        );
        let response = client
            .post(url.clone())
            .json(&request)
            .send()
            .await
            .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| TrellisClientError::Bootstrap(error.to_string()))?;
        let request_ended_at = now_iat_seconds();

        if !status.is_success() {
            if attempt == 0
                && adjust_iat_after_out_of_range(
                    &body,
                    &mut iat_clock,
                    request_started_at,
                    request_ended_at,
                )
            {
                continue;
            }
            return Err(TrellisClientError::BootstrapHttp {
                status: status.as_u16(),
                body,
            });
        }

        return Ok(serde_json::from_str(&body)?);
    }

    unreachable!("device connect-info retry loop is bounded")
}

fn validate_device_connect_info(
    expected_contract_digest: &str,
    connect_info: &DeviceConnectInfo,
) -> Result<(), TrellisClientError> {
    if connect_info.contract_digest != expected_contract_digest {
        return Err(TrellisClientError::Bootstrap(format!(
            "device connect info contract digest mismatch: expected '{expected_contract_digest}', got '{}'",
            connect_info.contract_digest
        )));
    }
    if connect_info.instance_id.is_empty()
        || connect_info.deployment_id.is_empty()
        || connect_info.contract_id.is_empty()
    {
        return Err(TrellisClientError::Bootstrap(
            "device connect info missing protocol identity fields".into(),
        ));
    }
    if connect_info.auth.mode != "device_identity" {
        return Err(TrellisClientError::Bootstrap(format!(
            "unexpected device auth mode '{}'",
            connect_info.auth.mode
        )));
    }
    Ok(())
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn next_health_heartbeat_id() -> String {
    let sequence = HEALTH_HEARTBEAT_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = OffsetDateTime::now_utc().unix_timestamp_nanos();
    format!("rust-{}-{now}-{sequence}", std::process::id())
}

fn new_service_instance_id() -> String {
    format!(
        "rust-{}-{}",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    )
}

fn build_health_heartbeat(config: &HealthHeartbeatConfig) -> HealthHeartbeat {
    HealthHeartbeat {
        header: HealthHeartbeatHeader {
            id: next_health_heartbeat_id(),
            time: now_rfc3339(),
        },
        service: HealthHeartbeatService {
            name: config.service_name.clone(),
            kind: config.kind,
            instance_id: config.instance_id.clone(),
            contract_id: config.contract_id.clone(),
            contract_digest: config.contract_digest.clone(),
            started_at: config.started_at.clone(),
            publish_interval_ms: config.publish_interval_ms,
            runtime: "rust",
            info: config.info.clone(),
        },
        status: "healthy",
        checks: vec![HealthHeartbeatCheck {
            name: "nats",
            status: "ok",
            latency_ms: 0,
        }],
    }
}

async fn publish_health_heartbeat(nats: &async_nats::Client, config: &HealthHeartbeatConfig) {
    let heartbeat = build_health_heartbeat(config);
    let Ok(payload) = serde_json::to_vec(&heartbeat) else {
        return;
    };
    let _ = nats
        .publish(HEALTH_HEARTBEAT_SUBJECT.to_string(), Bytes::from(payload))
        .await;
}

fn spawn_health_heartbeat_task(
    nats: async_nats::Client,
    config: HealthHeartbeatConfig,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(config.publish_interval_ms));
        interval.tick().await;
        loop {
            interval.tick().await;
            publish_health_heartbeat(&nats, &config).await;
        }
    })
}

/// Connection options for a user/session-key principal.
pub struct UserConnectOptions<'a> {
    pub servers: &'a str,
    pub sentinel_jwt: &'a str,
    pub sentinel_seed: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub contract_digest: &'a str,
    pub timeout_ms: u64,
}

/// A low-level Trellis client over NATS request/reply and publish primitives.
pub struct TrellisClient {
    nats: async_nats::Client,
    auth: SessionAuth,
    timeout_ms: u64,
    service_bootstrap_binding: Option<Value>,
    health_heartbeat_task: Option<JoinHandle<()>>,
}

impl TrellisClient {
    /// Construct a client from an existing NATS connection and session auth.
    pub fn from_native(nats: async_nats::Client, auth: SessionAuth, timeout_ms: u64) -> Self {
        Self {
            nats,
            auth,
            timeout_ms,
            service_bootstrap_binding: None,
            health_heartbeat_task: None,
        }
    }

    /// Expose the underlying NATS client for advanced use.
    pub fn nats(&self) -> &async_nats::Client {
        &self.nats
    }

    /// Return the session auth helper used by this client.
    pub fn auth(&self) -> &SessionAuth {
        &self.auth
    }

    /// Return the request timeout configured for this client.
    pub fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    /// Return the resource binding supplied by service HTTP bootstrap, if this is a service client.
    pub fn service_bootstrap_binding(&self) -> Option<&Value> {
        self.service_bootstrap_binding.as_ref()
    }

    /// Connect using Trellis service bootstrap and reconnect-safe runtime auth.
    pub async fn connect_service(
        opts: ServiceConnectOptions<'_>,
    ) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let bootstrap_result = fetch_service_bootstrap(&auth, &opts).await?;
        let bootstrap = bootstrap_result.response;
        let iat_clock = bootstrap_result.iat_clock;
        validate_service_bootstrap_contract_digest(
            opts.contract_digest,
            &bootstrap.connect_info.contract_digest,
        )?;
        let native =
            bootstrap.connect_info.transports.native.ok_or_else(|| {
                TrellisClientError::Bootstrap("missing native NATS transport".into())
            })?;
        if native.nats_servers.is_empty() {
            return Err(TrellisClientError::Bootstrap(
                "native NATS transport has no servers".into(),
            ));
        }
        if bootstrap.status != "ready" {
            return Err(TrellisClientError::Bootstrap(format!(
                "unexpected service bootstrap status '{}'",
                bootstrap.status
            )));
        }
        let service_bootstrap_binding = Some(bootstrap.binding);
        let inbox_prefix = auth.inbox_prefix();
        let callback_auth = std::sync::Arc::new(SessionAuth::from_seed_base64url(
            opts.session_key_seed_base64url,
        )?);
        let key_pair = std::sync::Arc::new(
            KeyPair::from_seed(&bootstrap.connect_info.transport.sentinel.seed)
                .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?,
        );
        let sentinel_jwt = bootstrap.connect_info.transport.sentinel.jwt;
        let contract_digest = bootstrap.connect_info.contract_digest;

        let nats = ConnectOptions::with_auth_callback(move |nonce| {
            let auth = callback_auth.clone();
            let key_pair = key_pair.clone();
            let sentinel_jwt = sentinel_jwt.clone();
            let contract_digest = contract_digest.clone();
            async move {
                let mut credentials = async_nats::Auth::new();
                credentials.jwt = Some(sentinel_jwt);
                credentials.signature =
                    Some(key_pair.sign(&nonce).map_err(async_nats::AuthError::new)?);
                credentials.token =
                    Some(auth.nats_connect_token(iat_clock.current_iat(), &contract_digest));
                Ok(credentials)
            }
        })
        .custom_inbox_prefix(inbox_prefix)
        .connect(native.nats_servers)
        .await
        .map_err(|error| {
            TrellisClientError::NatsConnect(format!(
                "service runtime connect failed for contract '{}' digest '{}': {error}",
                opts.contract_id, opts.contract_digest
            ))
        })?;

        let health_heartbeat_config = HealthHeartbeatConfig {
            service_name: opts.contract_id.to_string(),
            kind: HealthHeartbeatServiceKind::Service,
            instance_id: new_service_instance_id(),
            contract_id: opts.contract_id.to_string(),
            contract_digest: opts.contract_digest.to_string(),
            started_at: now_rfc3339(),
            publish_interval_ms: HEALTH_HEARTBEAT_INTERVAL_MS,
            info: None,
        };
        publish_health_heartbeat(&nats, &health_heartbeat_config).await;
        let health_heartbeat_task = Some(spawn_health_heartbeat_task(
            nats.clone(),
            health_heartbeat_config,
        ));

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
            service_bootstrap_binding,
            health_heartbeat_task,
        })
    }

    /// Connect an activated device using refreshed auth-owned connect info.
    pub async fn connect_device(
        opts: DeviceConnectOptions<'_>,
    ) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.identity_seed_base64url)?;
        if auth.session_key != opts.public_identity_key {
            return Err(TrellisClientError::Bootstrap(
                "device public identity key does not match identity seed".into(),
            ));
        }

        let response = fetch_device_connect_info(&auth, &opts).await?;
        if response.status != "ready" {
            return Err(TrellisClientError::Bootstrap(format!(
                "unexpected device connect info status '{}'",
                response.status
            )));
        }
        validate_device_connect_info(opts.contract_digest, &response.connect_info)?;

        let native =
            response.connect_info.transports.native.ok_or_else(|| {
                TrellisClientError::Bootstrap("missing native NATS transport".into())
            })?;
        if native.nats_servers.is_empty() {
            return Err(TrellisClientError::Bootstrap(
                "native NATS transport has no servers".into(),
            ));
        }

        let inbox_prefix = auth.inbox_prefix();
        let callback_auth = std::sync::Arc::new(SessionAuth::from_seed_base64url(
            opts.identity_seed_base64url,
        )?);
        let key_pair = std::sync::Arc::new(
            KeyPair::from_seed(&response.connect_info.transport.sentinel.seed)
                .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?,
        );
        let sentinel_jwt = response.connect_info.transport.sentinel.jwt;
        let contract_id = response.connect_info.contract_id.clone();
        let contract_digest = response.connect_info.contract_digest.clone();
        let instance_id = response.connect_info.instance_id.clone();
        let deployment_id = response.connect_info.deployment_id.clone();
        let iat_clock = IatClock::from_offset_seconds(response.connect_info.auth.iat_skew_seconds);
        let callback_contract_digest = contract_digest.clone();

        let nats = ConnectOptions::with_auth_callback(move |nonce| {
            let auth = callback_auth.clone();
            let key_pair = key_pair.clone();
            let sentinel_jwt = sentinel_jwt.clone();
            let contract_digest = callback_contract_digest.clone();
            async move {
                let mut credentials = async_nats::Auth::new();
                credentials.jwt = Some(sentinel_jwt);
                credentials.signature =
                    Some(key_pair.sign(&nonce).map_err(async_nats::AuthError::new)?);
                credentials.token =
                    Some(auth.nats_connect_token(iat_clock.current_iat(), &contract_digest));
                Ok(credentials)
            }
        })
        .custom_inbox_prefix(inbox_prefix)
        .connect(native.nats_servers)
        .await
        .map_err(|error| {
            TrellisClientError::NatsConnect(format!(
                "device runtime connect failed for contract '{contract_id}' digest '{contract_digest}': {error}"
            ))
        })?;

        let health_heartbeat_config = HealthHeartbeatConfig {
            service_name: contract_id.clone(),
            kind: HealthHeartbeatServiceKind::Device,
            instance_id,
            contract_id,
            contract_digest,
            started_at: now_rfc3339(),
            publish_interval_ms: HEALTH_HEARTBEAT_INTERVAL_MS,
            info: Some(serde_json::json!({ "deploymentId": deployment_id })),
        };
        publish_health_heartbeat(&nats, &health_heartbeat_config).await;
        let health_heartbeat_task = Some(spawn_health_heartbeat_task(
            nats.clone(),
            health_heartbeat_config,
        ));

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
            service_bootstrap_binding: None,
            health_heartbeat_task,
        })
    }

    /// Connect using reconnect-safe session-key runtime auth for one contract digest.
    pub async fn connect_user(opts: UserConnectOptions<'_>) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let inbox_prefix = auth.inbox_prefix();
        let callback_auth = std::sync::Arc::new(SessionAuth::from_seed_base64url(
            opts.session_key_seed_base64url,
        )?);
        let key_pair = std::sync::Arc::new(
            KeyPair::from_seed(opts.sentinel_seed)
                .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?,
        );
        let sentinel_jwt = opts.sentinel_jwt.to_string();
        let contract_digest = opts.contract_digest.to_string();

        let nats = ConnectOptions::with_auth_callback(move |nonce| {
            let auth = callback_auth.clone();
            let key_pair = key_pair.clone();
            let sentinel_jwt = sentinel_jwt.clone();
            let contract_digest = contract_digest.clone();
            async move {
                let mut credentials = async_nats::Auth::new();
                credentials.jwt = Some(sentinel_jwt);
                credentials.signature =
                    Some(key_pair.sign(&nonce).map_err(async_nats::AuthError::new)?);
                credentials.token =
                    Some(auth.nats_connect_user_token(now_iat_seconds(), &contract_digest));
                Ok(credentials)
            }
        })
        .custom_inbox_prefix(inbox_prefix)
        .connect(opts.servers)
        .await
        .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?;

        Ok(Self {
            nats,
            auth,
            timeout_ms: opts.timeout_ms,
            service_bootstrap_binding: None,
            health_heartbeat_task: None,
        })
    }

    async fn request(
        &self,
        subject: &str,
        payload: Bytes,
    ) -> Result<async_nats::Message, TrellisClientError> {
        let proof = self.auth.create_proof(subject, &payload);

        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.auth.session_key.as_str());
        headers.insert("proof", proof.as_str());

        let future = self
            .nats
            .request_with_headers(subject.to_string(), headers, payload);
        let message = timeout(std::time::Duration::from_millis(self.timeout_ms), future)
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(message)
    }

    async fn request_json(&self, subject: &str, body: Value) -> Result<Value, TrellisClientError> {
        let payload = Bytes::from(serde_json::to_vec(&body)?);
        let message = self.request(subject, payload).await?;

        decode_json_message(message)
    }

    /// Call a raw subject with a JSON value payload.
    pub async fn request_json_value(
        &self,
        subject: &str,
        body: &Value,
    ) -> Result<Value, TrellisClientError> {
        self.request_json(subject, body.clone()).await
    }

    /// Call one descriptor-backed RPC.
    pub async fn call<D>(&self, input: &D::Input) -> Result<D::Output, TrellisClientError>
    where
        D: RpcDescriptor,
    {
        let value = serde_json::to_value(input)?;
        let response = self.request_json(D::SUBJECT, value).await?;
        Ok(serde_json::from_value(response)?)
    }

    /// Publish one descriptor-backed event.
    pub async fn publish<D>(&self, event: &D::Event) -> Result<(), TrellisClientError>
    where
        D: EventDescriptor,
    {
        let payload = Bytes::from(serde_json::to_vec(event)?);
        self.nats
            .publish(D::SUBJECT.to_string(), payload)
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(())
    }

    /// Subscribe to one descriptor-backed event subject and decode event payloads.
    pub async fn subscribe<D>(
        &self,
    ) -> Result<BoxStream<'static, Result<D::Event, TrellisClientError>>, TrellisClientError>
    where
        D: EventDescriptor,
        D::Event: Send + 'static,
    {
        let subscriber = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.subscribe(D::SUBJECT.to_string()),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        let stream = stream::try_unfold(subscriber, |mut subscriber| async move {
            match subscriber.next().await {
                Some(message) => {
                    let event: D::Event = serde_json::from_slice(&message.payload)?;
                    Ok(Some((event, subscriber)))
                }
                None => Ok(None),
            }
        });

        Ok(Box::pin(stream) as BoxStream<'static, Result<D::Event, TrellisClientError>>)
    }

    /// Download the bytes exposed by a receive transfer grant.
    pub async fn download_transfer(
        &self,
        grant: &DownloadTransferGrant,
    ) -> Result<Vec<u8>, TrellisClientError> {
        get_download_grant(self, grant).await
    }

    /// Start or control one descriptor-backed operation.
    pub fn operation<D>(&self) -> OperationInvoker<'_, Self, D>
    where
        D: OperationDescriptor,
    {
        OperationInvoker::new(self)
    }
}

impl Drop for TrellisClient {
    fn drop(&mut self) {
        if let Some(task) = self.health_heartbeat_task.take() {
            task.abort();
        }
    }
}

impl OperationTransport for TrellisClient {
    async fn request_json_value(
        &self,
        subject: String,
        body: Value,
    ) -> Result<Value, TrellisClientError> {
        TrellisClient::request_json_value(self, &subject, &body).await
    }

    async fn watch_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError> {
        let payload = Bytes::from(serde_json::to_vec(&body)?);
        let proof = self.auth.create_proof(&subject, &payload);

        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.auth.session_key.as_str());
        headers.insert("proof", proof.as_str());

        let inbox = self.nats.new_inbox();
        let subscriber = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.subscribe(inbox.clone()),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats
                .publish_with_reply_and_headers(subject, inbox, headers, payload),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        let stream = stream::try_unfold((subscriber, false), |(mut subscriber, done)| async move {
            if done {
                return Ok(None);
            }

            match subscriber.next().await {
                Some(message) => {
                    let event = decode_watch_message(message)?;
                    let terminal = is_terminal_event(&event);
                    Ok(Some((event, (subscriber, terminal))))
                }
                None => Ok(None),
            }
        });

        Ok(Box::pin(stream) as BoxStream<'a, Result<Value, TrellisClientError>>)
    }

    async fn put_upload_transfer<'a>(
        &'a self,
        grant: UploadTransferGrant,
        body: Vec<u8>,
    ) -> Result<FileInfo, TrellisClientError> {
        put_upload_grant(self, &grant, body).await
    }
}

fn decode_json_message(message: async_nats::Message) -> Result<Value, TrellisClientError> {
    if let Some(headers) = &message.headers {
        if headers
            .get("status")
            .is_some_and(|status| status.as_str() == "error")
        {
            let value: Value = serde_json::from_slice(&message.payload)?;
            return Err(TrellisClientError::RpcError(value.to_string()));
        }
    }

    Ok(serde_json::from_slice(&message.payload)?)
}

fn decode_watch_message(message: async_nats::Message) -> Result<Value, TrellisClientError> {
    decode_json_message(message)
}

fn is_terminal_event(event: &Value) -> bool {
    matches!(
        event.get("type").and_then(Value::as_str),
        Some("completed" | "failed" | "cancelled")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use bytes::Bytes;
    use futures_util::StreamExt;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use std::process::Command;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    use crate::control_subject;
    use crate::operations::OperationEvent;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundInput {
        charge_id: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundProgress {
        message: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundOutput {
        refund_id: String,
    }

    fn ready_device_connect_info(contract_digest: &str) -> DeviceConnectInfo {
        DeviceConnectInfo {
            instance_id: "dev_123".to_string(),
            deployment_id: "reader.default".to_string(),
            contract_id: "acme.reader@v1".to_string(),
            contract_digest: contract_digest.to_string(),
            transports: DeviceConnectInfoTransports {
                native: Some(DeviceConnectInfoNatsTransport {
                    nats_servers: vec!["nats://127.0.0.1:4222".to_string()],
                }),
            },
            transport: DeviceConnectInfoTransport {
                sentinel: DeviceConnectInfoSentinel {
                    jwt: "jwt".to_string(),
                    seed: "seed".to_string(),
                },
            },
            auth: DeviceConnectInfoAuth {
                mode: "device_identity".to_string(),
                iat_skew_seconds: 30,
            },
        }
    }

    #[test]
    fn service_health_heartbeat_matches_wire_shape() {
        let heartbeat = build_health_heartbeat(&HealthHeartbeatConfig {
            service_name: "trellis.jobs@v1".to_string(),
            kind: HealthHeartbeatServiceKind::Service,
            instance_id: "rust-1".to_string(),
            contract_id: "trellis.jobs@v1".to_string(),
            contract_digest: "digest-alpha".to_string(),
            started_at: "2026-01-02T03:04:05Z".to_string(),
            publish_interval_ms: HEALTH_HEARTBEAT_INTERVAL_MS,
            info: None,
        });
        let value = serde_json::to_value(&heartbeat).expect("heartbeat json");

        assert_eq!(HEALTH_HEARTBEAT_SUBJECT, "events.v1.Health.Heartbeat");
        assert!(value["header"]["id"]
            .as_str()
            .is_some_and(|id| !id.is_empty()));
        assert!(value["header"]["time"]
            .as_str()
            .is_some_and(|time| time.ends_with('Z')));
        assert_eq!(
            value["service"],
            json!({
                "name": "trellis.jobs@v1",
                "kind": "service",
                "instanceId": "rust-1",
                "contractId": "trellis.jobs@v1",
                "contractDigest": "digest-alpha",
                "startedAt": "2026-01-02T03:04:05Z",
                "publishIntervalMs": 30_000,
                "runtime": "rust"
            })
        );
        assert_eq!(value["status"], "healthy");
        assert_eq!(
            value["checks"],
            json!([{ "name": "nats", "status": "ok", "latencyMs": 0 }])
        );
        assert!(value.get("summary").is_none());
    }

    #[test]
    fn device_health_heartbeat_uses_connect_info_identity() {
        let heartbeat = build_health_heartbeat(&HealthHeartbeatConfig {
            service_name: "acme.reader@v1".to_string(),
            kind: HealthHeartbeatServiceKind::Device,
            instance_id: "dev_123".to_string(),
            contract_id: "acme.reader@v1".to_string(),
            contract_digest: "digest-a".to_string(),
            started_at: "2026-01-02T03:04:05Z".to_string(),
            publish_interval_ms: HEALTH_HEARTBEAT_INTERVAL_MS,
            info: Some(json!({ "deploymentId": "reader.default" })),
        });
        let value = serde_json::to_value(&heartbeat).expect("heartbeat json");

        assert_eq!(value["service"]["name"], "acme.reader@v1");
        assert_eq!(value["service"]["kind"], "device");
        assert_eq!(value["service"]["instanceId"], "dev_123");
        assert_eq!(value["service"]["contractId"], "acme.reader@v1");
        assert_eq!(value["service"]["contractDigest"], "digest-a");
        assert_eq!(
            value["service"]["info"],
            json!({ "deploymentId": "reader.default" })
        );
    }

    #[test]
    fn device_connect_info_validation_rejects_contract_digest_mismatch() {
        let connect_info = ready_device_connect_info("digest-b");

        let error = validate_device_connect_info("digest-a", &connect_info)
            .expect_err("mismatched digest should fail");

        assert!(matches!(
            error,
            TrellisClientError::Bootstrap(message) if message.contains("contract digest mismatch")
        ));
    }

    #[test]
    fn device_connect_info_validation_requires_device_identity_mode() {
        let mut connect_info = ready_device_connect_info("digest-a");
        connect_info.auth.mode = "session".to_string();

        let error = validate_device_connect_info("digest-a", &connect_info)
            .expect_err("wrong mode should fail");

        assert!(matches!(
            error,
            TrellisClientError::Bootstrap(message) if message.contains("unexpected device auth mode")
        ));
    }

    #[test]
    fn device_connect_info_requires_protocol_identity_fields() {
        let missing_instance_id = json!({
            "status": "ready",
            "connectInfo": {
                "deploymentId": "reader.default",
                "contractId": "acme.reader@v1",
                "contractDigest": "digest-a",
                "transports": { "native": { "natsServers": ["nats://127.0.0.1:4222"] } },
                "transport": { "sentinel": { "jwt": "jwt", "seed": "seed" } },
                "auth": { "mode": "device_identity", "iatSkewSeconds": 30 }
            }
        });

        let error = serde_json::from_value::<DeviceConnectInfoResponse>(missing_instance_id)
            .expect_err("missing instanceId should fail deserialization");

        assert!(error.to_string().contains("instanceId"));
    }

    #[test]
    fn device_connect_info_retains_protocol_identity_fields() {
        let response: DeviceConnectInfoResponse = serde_json::from_value(json!({
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
        }))
        .expect("deserialize connect info");

        assert_eq!(response.connect_info.instance_id, "dev_123");
        assert_eq!(response.connect_info.deployment_id, "reader.default");
        assert_eq!(response.connect_info.contract_id, "acme.reader@v1");
    }

    #[tokio::test]
    async fn device_connect_info_retries_iat_out_of_range_with_corrected_signature() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind connect-info server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_now = now_iat_seconds().saturating_add(120);
        let server_task = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("first connect-info request");
            let first_request = read_json_http_request(&mut first).await;
            write_json_http_response(
                &mut first,
                "401 Unauthorized",
                json!({
                    "reason": "iat_out_of_range",
                    "serverNow": server_now
                }),
            )
            .await;

            let (mut second, _) = listener
                .accept()
                .await
                .expect("second connect-info request");
            let second_request = read_json_http_request(&mut second).await;
            write_json_http_response(
                &mut second,
                "200 OK",
                json!({
                    "status": "ready",
                    "connectInfo": {
                        "instanceId": "dev_123",
                        "deploymentId": "reader.default",
                        "contractId": "acme.reader@v1",
                        "contractDigest": "digest-alpha",
                        "transports": {
                            "native": {
                                "natsServers": ["127.0.0.1:4222"]
                            }
                        },
                        "transport": {
                            "sentinel": {
                                "jwt": "sentinel.jwt",
                                "seed": "unused-by-fetch"
                            }
                        },
                        "auth": {
                            "mode": "device_identity",
                            "iatSkewSeconds": 120
                        }
                    }
                }),
            )
            .await;
            (first_request, second_request)
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = DeviceConnectOptions {
            trellis_url: &url,
            contract_digest: "digest-alpha",
            public_identity_key: &auth.session_key,
            identity_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
        };

        let response = fetch_device_connect_info(&auth, &opts)
            .await
            .expect("connect-info retry succeeds");
        let (first_request, second_request) = server_task.await.expect("server task");
        let first_iat = first_request["iat"].as_u64().expect("first iat");
        let second_iat = second_request["iat"].as_u64().expect("second iat");
        let second_sig = second_request["sig"].as_str().expect("second sig");

        assert_ne!(first_iat, second_iat);
        assert!(second_iat.abs_diff(server_now) <= 1);
        assert_eq!(
            second_sig,
            auth.sign_sha256_bytes(&build_device_connect_info_proof_input(
                &auth.session_key,
                second_iat,
                "digest-alpha",
            ))
        );
        assert_eq!(response.connect_info.instance_id, "dev_123");
    }

    #[test]
    fn device_iat_clock_applies_connect_info_skew() {
        let clock = IatClock::from_offset_seconds(30);

        assert_eq!(clock.iat_at(1_701_000_000), 1_701_000_030);
    }

    struct RefundOperation;

    impl OperationDescriptor for RefundOperation {
        type Input = RefundInput;
        type Progress = RefundProgress;
        type Output = RefundOutput;

        const KEY: &'static str = "Billing.Refund";
        const SUBJECT: &'static str = "operations.v1.Billing.Refund";
        const CALLER_CAPABILITIES: &'static [&'static str] = &["billing.refund"];
        const READ_CAPABILITIES: &'static [&'static str] = &["billing.read"];
        const CANCEL_CAPABILITIES: &'static [&'static str] = &["billing.cancel"];
        const CANCELABLE: bool = true;
    }

    struct RuntimeContainer {
        runtime: String,
        name: String,
    }

    impl Drop for RuntimeContainer {
        fn drop(&mut self) {
            let _ = Command::new(&self.runtime)
                .args(["rm", "-f", &self.name])
                .output();
        }
    }

    fn detect_runtime() -> Option<&'static str> {
        for runtime in ["podman", "docker"] {
            let status = Command::new(runtime).arg("--version").status().ok()?;
            if status.success() {
                return Some(runtime);
            }
        }
        None
    }

    fn run_command(runtime: &str, args: &[&str]) -> String {
        let output = Command::new(runtime)
            .args(args)
            .output()
            .expect("runtime command should execute");
        if !output.status.success() {
            panic!(
                "runtime command failed: {} {}\nstdout: {}\nstderr: {}",
                runtime,
                args.join(" "),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            );
        }
        String::from_utf8(output.stdout)
            .expect("stdout should be utf-8")
            .trim()
            .to_string()
    }

    fn start_nats_container() -> (RuntimeContainer, String) {
        let runtime = detect_runtime().expect("podman or docker runtime is required");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let name = format!("trellis-client-watch-it-{}-{}", std::process::id(), now);

        run_command(
            runtime,
            &[
                "run",
                "-d",
                "--rm",
                "--name",
                &name,
                "-p",
                "127.0.0.1::4222",
                "docker.io/library/nats:2.10-alpine",
            ],
        );

        let mapping = run_command(runtime, &["port", &name, "4222/tcp"]);
        let host_port = mapping
            .split(':')
            .next_back()
            .expect("port mapping should include ':'")
            .trim()
            .to_string();
        let server = format!("127.0.0.1:{}", host_port);

        (
            RuntimeContainer {
                runtime: runtime.to_string(),
                name,
            },
            server,
        )
    }

    async fn connect_with_retry(server: &str) -> async_nats::Client {
        let mut last_error = None;
        for _ in 0..30 {
            match async_nats::connect(server).await {
                Ok(client) => return client,
                Err(error) => {
                    last_error = Some(error.to_string());
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        panic!(
            "failed to connect to nats server {}: {}",
            server,
            last_error.unwrap_or_else(|| "unknown error".to_string())
        );
    }

    fn test_auth() -> SessionAuth {
        SessionAuth::from_seed_base64url(&crate::proof::base64url_encode(&[7u8; 32]))
            .expect("session auth")
    }

    fn http_header_end(bytes: &[u8]) -> Option<usize> {
        bytes.windows(4).position(|window| window == b"\r\n\r\n")
    }

    async fn read_json_http_request(stream: &mut TcpStream) -> Value {
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0_u8; 1024];
            let read = stream.read(&mut chunk).await.expect("read request");
            assert_ne!(read, 0, "request ended before body was complete");
            bytes.extend_from_slice(&chunk[..read]);

            let Some(header_end) = http_header_end(&bytes) else {
                continue;
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().expect("content length"))
                })
                .expect("content-length header");
            let body_start = header_end + 4;
            if bytes.len() >= body_start + content_length {
                return serde_json::from_slice(&bytes[body_start..body_start + content_length])
                    .expect("request json");
            }
        }
    }

    async fn write_json_http_response(stream: &mut TcpStream, status: &str, body: Value) {
        let body = serde_json::to_string(&body).expect("response json");
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .await
            .expect("write response");
    }

    #[test]
    fn service_bootstrap_request_uses_iat_contract_digest_signature() {
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let request = build_service_bootstrap_request(
            &auth,
            "trellis.jobs@v1",
            "digest-alpha",
            1_735_689_600,
        );

        assert_eq!(
            request.session_key,
            "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg"
        );
        assert_eq!(request.contract_id, "trellis.jobs@v1");
        assert_eq!(request.contract_digest, "digest-alpha");
        assert_eq!(request.iat, 1_735_689_600);
        assert_eq!(
            request.sig,
            "ozEDPb29KBrlEZh4iOsSNUL1yjyUA-1rgy8VOZD4UIbE5LpCtj7OYqAG5SzeBdFBYOkEz5mCgLzaNk-AhwjABg"
        );
        assert_eq!(
            serde_json::to_value(&request).expect("request json"),
            json!({
                "sessionKey": "A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg",
                "contractId": "trellis.jobs@v1",
                "contractDigest": "digest-alpha",
                "iat": 1_735_689_600_u64,
                "sig": "ozEDPb29KBrlEZh4iOsSNUL1yjyUA-1rgy8VOZD4UIbE5LpCtj7OYqAG5SzeBdFBYOkEz5mCgLzaNk-AhwjABg"
            })
        );
    }

    #[test]
    fn corrected_iat_clock_applies_server_offset() {
        let mut clock = IatClock::default();

        clock.adjust_from_server_now(1_000, 1_004, 1_122);

        assert_eq!(clock.iat_at(2_000), 2_120);
    }

    #[test]
    fn service_bootstrap_contract_digest_mismatch_is_rejected() {
        let error = validate_service_bootstrap_contract_digest("digest-expected", "digest-actual")
            .expect_err("digest mismatch should fail");

        match error {
            TrellisClientError::Bootstrap(message) => {
                assert!(message.contains("contract digest mismatch"));
                assert!(message.contains("digest-expected"));
                assert!(message.contains("digest-actual"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn service_bootstrap_retries_iat_out_of_range_with_corrected_signature() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_now = now_iat_seconds().saturating_add(120);
        let server_task = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("first bootstrap request");
            let first_request = read_json_http_request(&mut first).await;
            write_json_http_response(
                &mut first,
                "401 Unauthorized",
                json!({
                    "reason": "iat_out_of_range",
                    "serverNow": server_now
                }),
            )
            .await;

            let (mut second, _) = listener.accept().await.expect("second bootstrap request");
            let second_request = read_json_http_request(&mut second).await;
            write_json_http_response(
                &mut second,
                "200 OK",
                json!({
                    "status": "ready",
                    "connectInfo": {
                        "contractDigest": "digest-alpha",
                        "transports": {
                            "native": {
                                "natsServers": ["127.0.0.1:4222"]
                            }
                        },
                        "transport": {
                            "sentinel": {
                                "jwt": "sentinel.jwt",
                                "seed": "unused-by-fetch"
                            }
                        }
                    },
                    "binding": {},
                    "serverNow": server_now
                }),
            )
            .await;
            (first_request, second_request)
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = ServiceConnectOptions {
            trellis_url: &url,
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            session_key_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
        };

        let result = fetch_service_bootstrap(&auth, &opts)
            .await
            .expect("bootstrap retry succeeds");
        let (first_request, second_request) = server_task.await.expect("server task");
        let first_iat = first_request["iat"].as_u64().expect("first iat");
        let second_iat = second_request["iat"].as_u64().expect("second iat");
        let second_sig = second_request["sig"].as_str().expect("second sig");

        assert_ne!(first_iat, second_iat);
        assert!(second_iat.abs_diff(server_now) <= 1);
        assert_eq!(
            second_sig,
            auth.sign_sha256_domain("nats-connect", &format!("{second_iat}:digest-alpha"))
        );
        assert!(result.iat_clock.current_iat().abs_diff(server_now) <= 1);
    }

    #[tokio::test]
    #[ignore = "needs podman/docker runtime"]
    async fn watch_stream_uses_reply_subject_and_stops_after_terminal_event() {
        let (_container, server) = start_nats_container();

        let service_client = connect_with_retry(&server).await;
        let requester_client = connect_with_retry(&server).await;
        let auth = test_auth();
        let client = TrellisClient::from_native(requester_client, auth, 2_000);

        let mut start_sub = service_client
            .subscribe(RefundOperation::SUBJECT.to_string())
            .await
            .expect("subscribe start subject");
        let mut control_sub = service_client
            .subscribe(control_subject(RefundOperation::SUBJECT))
            .await
            .expect("subscribe control subject");

        let service_for_start = service_client.clone();
        let start_task = tokio::spawn(async move {
            if let Some(msg) = start_sub.next().await {
                let body: Value = serde_json::from_slice(&msg.payload).expect("start request json");
                assert_eq!(body["charge_id"], "ch_123");
                let accepted = json!({
                    "kind": "accepted",
                    "ref": {
                        "id": "op_123",
                        "service": "billing",
                        "operation": "Billing.Refund"
                    },
                    "snapshot": {
                        "revision": 1,
                        "state": "pending"
                    }
                });
                let reply = msg.reply.as_ref().expect("start reply subject").clone();
                service_for_start
                    .publish(
                        reply,
                        Bytes::from(serde_json::to_vec(&accepted).expect("serialize accepted")),
                    )
                    .await
                    .expect("publish accepted reply");
            }
        });

        let service_for_control = service_client.clone();
        let control_task = tokio::spawn(async move {
            if let Some(msg) = control_sub.next().await {
                let body: Value =
                    serde_json::from_slice(&msg.payload).expect("control request json");
                assert_eq!(body["action"], "watch");
                assert_eq!(body["operationId"], "op_123");

                let reply = msg.reply.as_ref().expect("watch reply subject").clone();
                let frames = [
                    json!({
                        "kind": "snapshot",
                        "snapshot": {
                            "revision": 2,
                            "state": "running",
                            "progress": {
                                "message": "working"
                            }
                        }
                    }),
                    json!({
                        "kind": "event",
                        "event": {
                            "type": "progress",
                            "snapshot": {
                                "revision": 3,
                                "state": "running",
                                "progress": {
                                    "message": "almost there"
                                }
                            }
                        }
                    }),
                    json!({"kind": "keepalive"}),
                    json!({
                        "kind": "event",
                        "event": {
                            "type": "completed",
                            "snapshot": {
                                "revision": 4,
                                "state": "completed",
                                "output": {
                                    "refund_id": "rf_123"
                                }
                            }
                        }
                    }),
                    json!({
                        "kind": "event",
                        "event": {
                            "type": "progress",
                            "snapshot": {
                                "revision": 5,
                                "state": "running",
                                "progress": {
                                    "message": "ignored"
                                }
                            }
                        }
                    }),
                ];

                for frame in frames {
                    service_for_control
                        .publish(
                            reply.clone(),
                            Bytes::from(serde_json::to_vec(&frame).expect("serialize frame")),
                        )
                        .await
                        .expect("publish watch frame");
                }
            }
        });

        tokio::time::sleep(Duration::from_millis(100)).await;

        let operation = client
            .operation::<RefundOperation>()
            .start(&RefundInput {
                charge_id: "ch_123".to_string(),
            })
            .await
            .expect("start should succeed");
        let stream = operation.watch().await.expect("watch should succeed");
        let events: Vec<_> = stream.collect().await;

        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], Ok(OperationEvent::Started { .. })));
        assert!(matches!(events[1], Ok(OperationEvent::Progress { .. })));
        assert!(matches!(events[2], Ok(OperationEvent::Completed { .. })));

        start_task.await.expect("start task should complete");
        control_task.await.expect("control task should complete");
    }
}
