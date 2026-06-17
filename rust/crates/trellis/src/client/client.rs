use async_nats::header::HeaderMap;
use async_nats::jetstream::{self, consumer, AckKind};
use async_nats::ConnectOptions;
use bytes::Bytes;
use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use nkeys::KeyPair;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use super::events::{EVENT_ID_HEADER, EVENT_TIME_HEADER};
use crate::client::operations::{OperationDescriptor, OperationInvoker, OperationTransport};
use crate::client::proof::{new_request_id, now_iat_seconds};
use crate::client::transfer::{
    get_download_grant, put_upload_grant, DownloadTransferGrant, FileInfo, UploadTransferGrant,
};
use crate::client::{
    prepare_event, prepare_event_value, EventDescriptor, FeedDescriptor, PreparedTrellisEvent,
    RpcDescriptor, RpcErrorPayload, SessionAuth, TrellisClientError,
};

const HEALTH_HEARTBEAT_SUBJECT: &str = "events.v1.Health.Heartbeat";
const HEALTH_HEARTBEAT_INTERVAL_MS: u64 = 30_000;
const DEFAULT_EVENT_STREAM: &str = "trellis";
const DEFAULT_AUTHORITY_RETRY_DELAY_MS: u64 = 1_000;
const DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS: u64 = 60_000;
static HEALTH_HEARTBEAT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static FEED_INBOX_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub(crate) fn signed_headers(auth: &SessionAuth, subject: &str, payload: &[u8]) -> HeaderMap {
    let iat = now_iat_seconds() as i64;
    let request_id = new_request_id();
    let proof = auth.create_proof(subject, payload, iat, &request_id);
    let mut headers = HeaderMap::new();
    headers.insert("session-key", auth.session_key.as_str());
    headers.insert("proof", proof.as_str());
    headers.insert("iat", iat.to_string().as_str());
    headers.insert("request-id", request_id.as_str());
    headers
}

/// Connection options for a Trellis service/session-key principal.
pub struct ServiceConnectOptions<'a> {
    pub trellis_url: &'a str,
    pub contract_id: &'a str,
    pub contract_digest: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

/// Connection options for a Trellis service that can present its contract manifest during bootstrap.
pub struct ServiceConnectWithContractOptions<'a> {
    pub trellis_url: &'a str,
    pub contract_id: &'a str,
    pub contract_digest: &'a str,
    pub contract_json: &'a str,
    pub session_key_seed_base64url: &'a str,
    pub timeout_ms: u64,
    pub retry_delay_ms: u64,
    pub authority_pending_timeout_ms: u64,
}

/// Connection options for an activated device principal.
pub struct DeviceConnectOptions<'a> {
    pub trellis_url: &'a str,
    pub contract_digest: &'a str,
    pub public_identity_key: &'a str,
    pub identity_seed_base64url: &'a str,
    pub timeout_ms: u64,
}

/// Whether an event subscription uses a durable or ephemeral JetStream consumer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EventSubscriptionMode {
    /// Reuse a named durable consumer and retain delivery state across reconnects.
    Durable,
    /// Create an unnamed consumer that ends when the subscription is dropped.
    #[default]
    Ephemeral,
}

/// Initial delivery position for a descriptor-backed event subscription.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EventReplayPolicy {
    /// Deliver all retained events visible to the consumer.
    All,
    /// Deliver only events published after the consumer is created.
    #[default]
    New,
}

/// Options for descriptor-backed event subscriptions.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventSubscribeOptions {
    /// Durable or ephemeral consumer mode.
    pub mode: EventSubscriptionMode,
    /// Initial delivery position for a newly created consumer.
    pub replay: EventReplayPolicy,
    /// Optional durable name. Ignored for ephemeral subscriptions.
    pub durable_name: Option<String>,
}

/// One descriptor-backed event message with explicit JetStream acknowledgement controls.
#[derive(Debug)]
pub struct EventMessage<T> {
    message: jetstream::Message,
    _event: PhantomData<fn() -> T>,
}

impl<T> EventMessage<T> {
    /// Return the raw NATS headers delivered with the event message, if present.
    pub fn headers(&self) -> Option<&HeaderMap> {
        self.message.headers.as_ref()
    }

    /// Return the Trellis event id from the `Nats-Msg-Id` header, when present.
    pub fn event_id(&self) -> Option<&str> {
        self.headers()
            .and_then(|headers| headers.get(EVENT_ID_HEADER))
            .map(|value| value.as_str())
    }

    /// Return the Trellis event timestamp from the `Trellis-Event-Time` header, when present.
    pub fn event_time(&self) -> Option<&str> {
        self.headers()
            .and_then(|headers| headers.get(EVENT_TIME_HEADER))
            .map(|value| value.as_str())
    }

    /// Return the raw JSON payload bytes.
    pub fn payload(&self) -> &[u8] {
        &self.message.payload
    }

    /// Decode the message payload as the descriptor's typed event payload.
    pub fn decode(&self) -> Result<T, TrellisClientError>
    where
        T: for<'de> Deserialize<'de>,
    {
        Ok(serde_json::from_slice(&self.message.payload)?)
    }

    /// Acknowledge successful handling of the message.
    pub async fn ack(&self) -> Result<(), TrellisClientError> {
        self.message
            .ack()
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))
    }

    /// Negatively acknowledge the message so JetStream may redeliver it.
    pub async fn nak(&self) -> Result<(), TrellisClientError> {
        self.message
            .ack_with(AckKind::Nak(None))
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))
    }

    /// Terminate the message without successful acknowledgement or redelivery.
    pub async fn term(&self) -> Result<(), TrellisClientError> {
        self.message
            .ack_with(AckKind::Term)
            .await
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceBootstrapRequest<'a> {
    session_key: &'a str,
    contract_id: &'a str,
    contract_digest: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    contract: Option<&'a Value>,
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

#[derive(Debug)]
struct ServiceBootstrapFetchOptions<'a> {
    trellis_url: &'a str,
    contract_id: &'a str,
    contract_digest: &'a str,
    contract: Option<&'a Value>,
    timeout_ms: u64,
    retry_delay_ms: Option<u64>,
    authority_pending_timeout_ms: Option<u64>,
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
    service: HealthHeartbeatService,
    status: &'static str,
    checks: Vec<HealthHeartbeatCheck>,
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
    contract: Option<&'a Value>,
    iat: u64,
) -> ServiceBootstrapRequest<'a> {
    ServiceBootstrapRequest {
        session_key: &auth.session_key,
        contract_id,
        contract_digest,
        contract,
        iat,
        sig: auth.sign_sha256_domain("nats-connect", &format!("{iat}:{contract_digest}")),
    }
}

async fn fetch_service_bootstrap(
    auth: &SessionAuth,
    opts: &ServiceConnectOptions<'_>,
) -> Result<ServiceBootstrapResult, TrellisClientError> {
    fetch_service_bootstrap_inner(
        auth,
        &ServiceBootstrapFetchOptions {
            trellis_url: opts.trellis_url,
            contract_id: opts.contract_id,
            contract_digest: opts.contract_digest,
            contract: None,
            timeout_ms: opts.timeout_ms,
            retry_delay_ms: Some(DEFAULT_AUTHORITY_RETRY_DELAY_MS),
            authority_pending_timeout_ms: Some(DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS),
        },
    )
    .await
}

async fn fetch_service_bootstrap_with_contract(
    auth: &SessionAuth,
    opts: &ServiceConnectWithContractOptions<'_>,
    contract: &Value,
) -> Result<ServiceBootstrapResult, TrellisClientError> {
    fetch_service_bootstrap_inner(
        auth,
        &ServiceBootstrapFetchOptions {
            trellis_url: opts.trellis_url,
            contract_id: opts.contract_id,
            contract_digest: opts.contract_digest,
            contract: Some(contract),
            timeout_ms: opts.timeout_ms,
            retry_delay_ms: Some(opts.retry_delay_ms),
            authority_pending_timeout_ms: Some(opts.authority_pending_timeout_ms),
        },
    )
    .await
}

async fn fetch_service_bootstrap_inner(
    auth: &SessionAuth,
    opts: &ServiceBootstrapFetchOptions<'_>,
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

    let mut include_contract = false;
    let mut adjusted_iat = false;
    let authority_pending_deadline = opts.authority_pending_timeout_ms.map(|timeout_ms| {
        tokio::time::Instant::now() + std::time::Duration::from_millis(timeout_ms)
    });
    loop {
        let request_started_at = now_iat_seconds();
        let request = build_service_bootstrap_request(
            auth,
            opts.contract_id,
            opts.contract_digest,
            include_contract.then_some(()).and(opts.contract),
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

        if let Ok(failure) = serde_json::from_str::<ServiceBootstrapFailure>(&body) {
            if failure.reason == "iat_out_of_range" {
                if !adjusted_iat
                    && adjust_iat_after_out_of_range(
                        &body,
                        &mut iat_clock,
                        request_started_at,
                        request_ended_at,
                    )
                {
                    adjusted_iat = true;
                    continue;
                }
            } else if failure.reason == "manifest_required"
                && opts.contract.is_some()
                && !include_contract
            {
                include_contract = true;
                continue;
            } else if (failure.reason == "authority_reconciliation_pending"
                || (matches!(
                    failure.reason.as_str(),
                    "authority_update_required" | "authority_migration_required"
                ) && opts.contract.is_some()))
                && opts.retry_delay_ms.is_some()
            {
                if opts.contract.is_some() {
                    include_contract = true;
                }
                let retry_delay =
                    std::time::Duration::from_millis(opts.retry_delay_ms.unwrap_or(1).max(1));
                if let Some(deadline) = authority_pending_deadline {
                    let now = tokio::time::Instant::now();
                    if now >= deadline {
                        return Err(TrellisClientError::Bootstrap(
                            "timed out waiting for service deployment authority".into(),
                        ));
                    }
                    tokio::time::sleep(retry_delay.min(deadline.saturating_duration_since(now)))
                        .await;
                } else {
                    tokio::time::sleep(retry_delay).await;
                }
                continue;
            } else if failure.reason == "contract_activation_pending" && opts.contract.is_some() {
                let retry_delay =
                    std::time::Duration::from_millis(opts.retry_delay_ms.unwrap_or(1_000).max(1));
                if let Some(deadline) = authority_pending_deadline {
                    let now = tokio::time::Instant::now();
                    if now >= deadline {
                        return Err(TrellisClientError::Bootstrap(
                            "timed out waiting for service contract activation".into(),
                        ));
                    }
                    tokio::time::sleep(retry_delay.min(deadline.saturating_duration_since(now)))
                        .await;
                } else {
                    tokio::time::sleep(retry_delay).await;
                }
                continue;
            }

            return Err(TrellisClientError::BootstrapHttp {
                status: status.as_u16(),
                body,
            });
        }

        if !status.is_success() {
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
    let flow_id = b"connect-info";
    let public_identity_key = public_identity_key.as_bytes();
    let nonce = b"connect-info";
    let iat = iat.to_string();
    let iat = iat.as_bytes();
    let contract_digest = contract_digest.as_bytes();

    let mut out = Vec::with_capacity(
        4 + flow_id.len()
            + 4
            + public_identity_key.len()
            + 4
            + nonce.len()
            + 4
            + iat.len()
            + 4
            + contract_digest.len(),
    );
    out.extend_from_slice(&(flow_id.len() as u32).to_be_bytes());
    out.extend_from_slice(flow_id);
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

        if status != reqwest::StatusCode::OK {
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

fn health_heartbeat_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(EVENT_ID_HEADER, next_health_heartbeat_id());
    headers.insert(EVENT_TIME_HEADER, now_rfc3339());
    headers
}

async fn publish_health_heartbeat(nats: &async_nats::Client, config: &HealthHeartbeatConfig) {
    let heartbeat = build_health_heartbeat(config);
    let Ok(payload) = serde_json::to_vec(&heartbeat) else {
        return;
    };
    let _ = nats
        .publish_with_headers(
            HEALTH_HEARTBEAT_SUBJECT.to_string(),
            health_heartbeat_headers(),
            Bytes::from(payload),
        )
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

async fn connect_bootstrapped_service(
    auth: SessionAuth,
    session_key_seed_base64url: &str,
    contract_id: &str,
    contract_digest: &str,
    timeout_ms: u64,
    bootstrap_result: ServiceBootstrapResult,
) -> Result<TrellisClient, TrellisClientError> {
    let bootstrap = bootstrap_result.response;
    let iat_clock = bootstrap_result.iat_clock;
    validate_service_bootstrap_contract_digest(
        contract_digest,
        &bootstrap.connect_info.contract_digest,
    )?;
    let native = bootstrap
        .connect_info
        .transports
        .native
        .ok_or_else(|| TrellisClientError::Bootstrap("missing native NATS transport".into()))?;
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
        session_key_seed_base64url,
    )?);
    let key_pair = std::sync::Arc::new(
        KeyPair::from_seed(&bootstrap.connect_info.transport.sentinel.seed)
            .map_err(|error| TrellisClientError::NatsConnect(error.to_string()))?,
    );
    let sentinel_jwt = bootstrap.connect_info.transport.sentinel.jwt;
    let callback_contract_digest = bootstrap.connect_info.contract_digest;

    let nats = ConnectOptions::with_auth_callback(move |nonce| {
        let auth = callback_auth.clone();
        let key_pair = key_pair.clone();
        let sentinel_jwt = sentinel_jwt.clone();
        let contract_digest = callback_contract_digest.clone();
        async move {
            let mut credentials = async_nats::Auth::new();
            credentials.jwt = Some(sentinel_jwt);
            credentials.signature = Some(key_pair.sign(&nonce).map_err(async_nats::AuthError::new)?);
            credentials.token = Some(auth.nats_connect_token(iat_clock.current_iat(), &contract_digest));
            Ok(credentials)
        }
    })
    .custom_inbox_prefix(inbox_prefix)
    .connect(native.nats_servers)
    .await
    .map_err(|error| {
        TrellisClientError::NatsConnect(format!(
            "service runtime connect failed for contract '{contract_id}' digest '{contract_digest}': {error}"
        ))
    })?;

    let health_heartbeat_config = HealthHeartbeatConfig {
        service_name: contract_id.to_string(),
        kind: HealthHeartbeatServiceKind::Service,
        instance_id: new_service_instance_id(),
        contract_id: contract_id.to_string(),
        contract_digest: contract_digest.to_string(),
        started_at: now_rfc3339(),
        publish_interval_ms: HEALTH_HEARTBEAT_INTERVAL_MS,
        info: None,
    };
    publish_health_heartbeat(&nats, &health_heartbeat_config).await;
    let health_heartbeat_task = Some(spawn_health_heartbeat_task(
        nats.clone(),
        health_heartbeat_config,
    ));

    Ok(TrellisClient {
        nats,
        auth,
        timeout_ms,
        service_bootstrap_binding,
        health_heartbeat_task,
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
    pub(crate) fn nats(&self) -> &async_nats::Client {
        &self.nats
    }

    #[doc(hidden)]
    pub fn internal_nats(&self) -> &async_nats::Client {
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

    /// Flush pending client protocol operations to the runtime.
    pub async fn flush(&self) -> Result<(), TrellisClientError> {
        timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.flush(),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))
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
        connect_bootstrapped_service(
            auth,
            opts.session_key_seed_base64url,
            opts.contract_id,
            opts.contract_digest,
            opts.timeout_ms,
            bootstrap_result,
        )
        .await
    }

    /// Connect using service bootstrap, presenting the contract manifest and waiting while authority is pending.
    pub async fn connect_service_with_contract(
        opts: ServiceConnectWithContractOptions<'_>,
    ) -> Result<Self, TrellisClientError> {
        let auth = SessionAuth::from_seed_base64url(opts.session_key_seed_base64url)?;
        let contract = serde_json::from_str(opts.contract_json)?;
        let bootstrap_result =
            fetch_service_bootstrap_with_contract(&auth, &opts, &contract).await?;
        connect_bootstrapped_service(
            auth,
            opts.session_key_seed_base64url,
            opts.contract_id,
            opts.contract_digest,
            opts.timeout_ms,
            bootstrap_result,
        )
        .await
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
        let headers = self.signed_headers(subject, &payload);

        let future = self
            .nats
            .request_with_headers(subject.to_string(), headers, payload);
        let message = timeout(std::time::Duration::from_millis(self.timeout_ms), future)
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(message)
    }

    pub(crate) fn signed_headers(&self, subject: &str, payload: &[u8]) -> HeaderMap {
        signed_headers(&self.auth, subject, payload)
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
        let prepared = prepare_event::<D>(event)?;
        self.publish_prepared(&prepared).await
    }

    /// Prepare one descriptor-backed event without publishing it.
    pub fn prepare_event<D>(
        &self,
        event: &D::Event,
    ) -> Result<PreparedTrellisEvent, TrellisClientError>
    where
        D: EventDescriptor,
    {
        Ok(prepare_event::<D>(event)?)
    }

    /// Prepare one generic JSON-serializable event for a concrete subject.
    pub fn prepare_event_value<T>(
        &self,
        subject: &str,
        event: &T,
    ) -> Result<PreparedTrellisEvent, TrellisClientError>
    where
        T: Serialize + ?Sized,
    {
        Ok(prepare_event_value(subject, event)?)
    }

    /// Publish an event that was already prepared, preserving its subject, payload, and message id.
    pub async fn publish_prepared(
        &self,
        event: &PreparedTrellisEvent,
    ) -> Result<(), TrellisClientError> {
        let jetstream = jetstream::new(self.nats.clone());
        let publish = async {
            jetstream
                .publish_with_headers(
                    event.subject().to_string(),
                    event.publish_headers(),
                    event.payload_bytes(),
                )
                .await
        };
        let ack = timeout(std::time::Duration::from_millis(self.timeout_ms), publish)
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        timeout(std::time::Duration::from_millis(self.timeout_ms), ack)
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;
        Ok(())
    }

    /// Subscribe to one descriptor-backed event subject from the default JetStream event stream.
    pub async fn subscribe<D>(
        &self,
    ) -> Result<BoxStream<'static, Result<D::Event, TrellisClientError>>, TrellisClientError>
    where
        D: EventDescriptor,
        D::Event: Send + 'static,
    {
        self.subscribe_with_options::<D>(EventSubscribeOptions::default())
            .await
    }

    /// Subscribe to one descriptor-backed event subject with explicit subscription options.
    pub async fn subscribe_with_options<D>(
        &self,
        options: EventSubscribeOptions,
    ) -> Result<BoxStream<'static, Result<D::Event, TrellisClientError>>, TrellisClientError>
    where
        D: EventDescriptor,
        D::Event: Send + 'static,
    {
        if options.mode == EventSubscriptionMode::Ephemeral {
            return self.subscribe_live::<D>().await;
        }

        let messages = self.subscribe_messages::<D>(options).await?;
        let stream = stream::try_unfold(messages, |mut messages| async move {
            match messages.next().await {
                Some(Ok(event_message)) => {
                    let event = event_message.decode()?;
                    event_message.ack().await?;
                    Ok(Some((event, messages)))
                }
                Some(Err(error)) => Err(error),
                None => Ok(None),
            }
        });

        Ok(Box::pin(stream) as BoxStream<'static, Result<D::Event, TrellisClientError>>)
    }

    async fn subscribe_live<D>(
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

    /// Subscribe to descriptor-backed event messages with explicit ack/nak/term control.
    pub async fn subscribe_messages<D>(
        &self,
        options: EventSubscribeOptions,
    ) -> Result<
        BoxStream<'static, Result<EventMessage<D::Event>, TrellisClientError>>,
        TrellisClientError,
    >
    where
        D: EventDescriptor,
        D::Event: Send + 'static,
    {
        let jetstream = jetstream::new(self.nats.clone());
        let event_stream = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            jetstream.get_stream_no_info(DEFAULT_EVENT_STREAM),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        if options.mode == EventSubscriptionMode::Durable && options.durable_name.is_none() {
            return Err(TrellisClientError::EventSubscriptionProtocol(
                "durable event subscriptions require a pre-provisioned durable name".to_string(),
            ));
        }

        let config = event_consumer_config::<D>(&options);
        let durable_name = config.durable_name.clone();
        let consumer = match durable_name.as_deref() {
            Some(name) => timeout(
                std::time::Duration::from_millis(self.timeout_ms),
                event_stream.get_consumer(name),
            )
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?,
            None => timeout(
                std::time::Duration::from_millis(self.timeout_ms),
                event_stream.create_consumer(config),
            )
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?,
        };

        let messages = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            consumer.messages(),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        let stream = stream::try_unfold(messages, |mut messages| async move {
            match messages.next().await {
                Some(Ok(message)) => {
                    let event_message = EventMessage {
                        message,
                        _event: PhantomData,
                    };
                    Ok(Some((event_message, messages)))
                }
                Some(Err(error)) => Err(TrellisClientError::NatsRequest(error.to_string())),
                None => Ok(None),
            }
        });

        Ok(Box::pin(stream)
            as BoxStream<
                'static,
                Result<EventMessage<D::Event>, TrellisClientError>,
            >)
    }

    /// Subscribe to one descriptor-backed feed and decode event payloads.
    pub async fn feed<D>(
        &self,
        input: &D::Input,
    ) -> Result<BoxStream<'static, Result<D::Event, TrellisClientError>>, TrellisClientError>
    where
        D: FeedDescriptor,
        D::Event: Send + 'static,
    {
        let payload = Bytes::from(serde_json::to_vec(input)?);
        let headers = self.signed_headers(D::SUBJECT, &payload);

        let inbox = format!(
            "{}.{}",
            self.auth.inbox_prefix(),
            FEED_INBOX_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let mut subscriber = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.subscribe(inbox.clone()),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.publish_with_reply_and_headers(
                D::SUBJECT.to_string(),
                inbox,
                headers,
                payload,
            ),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            self.nats.flush(),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        let first = timeout(
            std::time::Duration::from_millis(self.timeout_ms),
            subscriber.next(),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .ok_or(TrellisClientError::Timeout)?;

        let first_event = decode_feed_message::<D>(first)?;
        let stream = stream::try_unfold(
            (subscriber, first_event),
            |(mut subscriber, first_event)| async move {
                if let Some(event) = first_event {
                    return Ok(Some((event, (subscriber, None))));
                }

                match subscriber.next().await {
                    Some(message) => {
                        let event = decode_feed_message::<D>(message)?.ok_or_else(|| {
                            TrellisClientError::NatsRequest(
                                "feed emitted duplicate ready acknowledgement".to_string(),
                            )
                        })?;
                        Ok(Some((event, (subscriber, None))))
                    }
                    None => Ok(None),
                }
            },
        );

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
        let headers = self.signed_headers(&subject, &payload);

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
            return Err(TrellisClientError::RpcError(
                RpcErrorPayload::from_json_slice(&message.payload)?,
            ));
        }
    }

    Ok(serde_json::from_slice(&message.payload)?)
}

fn decode_watch_message(message: async_nats::Message) -> Result<Value, TrellisClientError> {
    decode_json_message(message)
}

fn decode_feed_message<D>(
    message: async_nats::Message,
) -> Result<Option<D::Event>, TrellisClientError>
where
    D: FeedDescriptor,
{
    decode_feed_frame::<D>(message.headers.as_ref(), &message.payload)
}

fn decode_feed_frame<D>(
    headers: Option<&HeaderMap>,
    payload: &[u8],
) -> Result<Option<D::Event>, TrellisClientError>
where
    D: FeedDescriptor,
{
    if let Some(headers) = headers {
        if headers
            .get("status")
            .is_some_and(|status| status.as_str() == "error")
        {
            return Err(TrellisClientError::RpcError(
                RpcErrorPayload::from_json_slice(payload)?,
            ));
        }
        if headers
            .get("feed-status")
            .is_some_and(|status| status.as_str() == "ready")
        {
            return Ok(None);
        }
    }

    Ok(Some(serde_json::from_slice(payload)?))
}

fn is_terminal_event(event: &Value) -> bool {
    matches!(
        event.get("type").and_then(Value::as_str),
        Some("completed" | "failed" | "cancelled")
    )
}

fn event_consumer_config<D>(options: &EventSubscribeOptions) -> consumer::pull::Config
where
    D: EventDescriptor,
{
    consumer::pull::Config {
        durable_name: match options.mode {
            EventSubscriptionMode::Durable => options.durable_name.clone(),
            EventSubscriptionMode::Ephemeral => None,
        },
        deliver_policy: match options.replay {
            EventReplayPolicy::All => consumer::DeliverPolicy::All,
            EventReplayPolicy::New => consumer::DeliverPolicy::New,
        },
        ack_policy: consumer::AckPolicy::Explicit,
        filter_subject: D::SUBJECT.to_string(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundInput {
        charge_id: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct RefundOutput {
        refund_id: String,
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    struct PaymentCaptured {
        payment_id: String,
    }

    struct PaymentCapturedEvent;

    impl EventDescriptor for PaymentCapturedEvent {
        type Event = PaymentCaptured;

        const KEY: &'static str = "Payment.Captured";
        const SUBJECT: &'static str = "events.v1.Payment.Captured";
        const PUBLISH_CAPABILITIES: &'static [&'static str] = &["payments.write"];
        const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["payments.read"];
    }

    struct RefundFeed;

    impl FeedDescriptor for RefundFeed {
        type Input = RefundInput;
        type Event = RefundOutput;

        const KEY: &'static str = "Refund.Live";
        const SUBJECT: &'static str = "feeds.v1.Refund.Live";
        const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["refunds.read"];
        const INPUT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
        const EVENT_SCHEMA_JSON: &'static str =
            r#"{"type":"object","properties":{},"required":[]}"#;
    }

    #[test]
    fn event_consumer_config_uses_named_durable_filtered_consumer() {
        let config =
            event_consumer_config::<PaymentCapturedEvent>(&EventSubscribeOptions::default());

        assert_eq!(config.filter_subject, PaymentCapturedEvent::SUBJECT);
        assert_eq!(config.deliver_policy, consumer::DeliverPolicy::New);
        assert_eq!(config.ack_policy, consumer::AckPolicy::Explicit);
        assert_eq!(config.durable_name, None);

        let config = event_consumer_config::<PaymentCapturedEvent>(&EventSubscribeOptions {
            mode: EventSubscriptionMode::Durable,
            replay: EventReplayPolicy::All,
            durable_name: Some("payments_capture_projection".to_string()),
        });

        assert_eq!(
            config.durable_name.as_deref(),
            Some("payments_capture_projection")
        );
        assert_eq!(config.deliver_policy, consumer::DeliverPolicy::All);
    }

    #[test]
    fn event_consumer_config_supports_ephemeral_new_events() {
        let config = event_consumer_config::<PaymentCapturedEvent>(&EventSubscribeOptions {
            mode: EventSubscriptionMode::Ephemeral,
            replay: EventReplayPolicy::New,
            durable_name: Some("ignored".to_string()),
        });

        assert_eq!(config.filter_subject, PaymentCapturedEvent::SUBJECT);
        assert_eq!(config.deliver_policy, consumer::DeliverPolicy::New);
        assert_eq!(config.ack_policy, consumer::AckPolicy::Explicit);
        assert_eq!(config.durable_name, None);
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
        assert!(value.get("header").is_none());
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
    fn health_heartbeat_metadata_uses_event_headers() {
        let headers = health_heartbeat_headers();

        assert!(headers
            .get(EVENT_ID_HEADER)
            .is_some_and(|id| !id.as_str().is_empty()));
        assert!(headers
            .get(EVENT_TIME_HEADER)
            .is_some_and(|time| time.as_str().ends_with('Z')));
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
    fn feed_handshake_ready_frame_is_not_yielded_as_event() {
        let mut headers = HeaderMap::new();
        headers.insert("feed-status", "ready");

        let decoded = decode_feed_frame::<RefundFeed>(Some(&headers), &[])
            .expect("ready frame should decode");

        assert!(decoded.is_none());
    }

    #[test]
    fn feed_first_event_frame_is_yielded() {
        let decoded = decode_feed_frame::<RefundFeed>(None, br#"{"refund_id":"refund_123"}"#)
            .expect("event frame should decode");

        assert_eq!(
            decoded,
            Some(RefundOutput {
                refund_id: "refund_123".to_string(),
            })
        );
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

    #[tokio::test]
    async fn device_connect_info_reports_authority_reconciliation_pending_response() {
        let error = fetch_device_connect_info_single_response_error(
            "202 Accepted",
            json!({ "reason": "authority_reconciliation_pending" }),
        )
        .await;

        match error {
            TrellisClientError::BootstrapHttp { status, body } => {
                assert_eq!(status, 202);
                assert!(body.contains("authority_reconciliation_pending"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn device_connect_info_reports_authority_reconciliation_failed_response() {
        let error = fetch_device_connect_info_single_response_error(
            "202 Accepted",
            json!({
                "reason": "authority_reconciliation_failed",
                "reconciliationError": "bucket update failed"
            }),
        )
        .await;

        match error {
            TrellisClientError::BootstrapHttp { status, body } => {
                assert_eq!(status, 202);
                assert!(body.contains("authority_reconciliation_failed"));
                assert!(body.contains("bucket update failed"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn device_iat_clock_applies_connect_info_skew() {
        let clock = IatClock::from_offset_seconds(30);

        assert_eq!(clock.iat_at(1_701_000_000), 1_701_000_030);
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

    async fn fetch_device_connect_info_single_response_error(
        status: &'static str,
        body: Value,
    ) -> TrellisClientError {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind connect-info server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("connect-info request");
            let _request = read_json_http_request(&mut stream).await;
            write_json_http_response(&mut stream, status, body).await;
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

        let error = fetch_device_connect_info(&auth, &opts)
            .await
            .expect_err("connect-info response should fail");
        server_task.await.expect("server task");
        error
    }

    async fn write_ready_service_bootstrap(stream: &mut TcpStream) {
        write_json_http_response(
            stream,
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
                "serverNow": now_iat_seconds()
            }),
        )
        .await;
    }

    #[test]
    fn service_bootstrap_request_uses_iat_contract_digest_signature() {
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let request = build_service_bootstrap_request(
            &auth,
            "trellis.jobs@v1",
            "digest-alpha",
            None,
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
    async fn service_bootstrap_retries_with_manifest_when_manifest_required() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("first bootstrap request");
            let first_request = read_json_http_request(&mut first).await;
            write_json_http_response(
                &mut first,
                "409 Conflict",
                json!({ "reason": "manifest_required" }),
            )
            .await;

            let (mut second, _) = listener.accept().await.expect("second bootstrap request");
            let second_request = read_json_http_request(&mut second).await;
            write_ready_service_bootstrap(&mut second).await;
            (first_request, second_request)
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = ServiceConnectWithContractOptions {
            trellis_url: &url,
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            contract_json: r#"{"id":"trellis.jobs@v1"}"#,
            session_key_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
            retry_delay_ms: 1,
            authority_pending_timeout_ms: 2_000,
        };
        let contract: Value = serde_json::from_str(opts.contract_json).expect("contract json");

        fetch_service_bootstrap_with_contract(&auth, &opts, &contract)
            .await
            .expect("bootstrap retry succeeds");
        let (first_request, second_request) = server_task.await.expect("server task");

        assert!(first_request.get("contract").is_none());
        assert_eq!(
            second_request["contract"],
            json!({ "id": "trellis.jobs@v1" })
        );
    }

    #[tokio::test]
    async fn service_bootstrap_returns_error_when_manifest_remains_required() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.expect("bootstrap request");
                let _request = read_json_http_request(&mut stream).await;
                write_json_http_response(
                    &mut stream,
                    "409 Conflict",
                    json!({ "reason": "manifest_required" }),
                )
                .await;
            }
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = ServiceConnectWithContractOptions {
            trellis_url: &url,
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            contract_json: r#"{"id":"trellis.jobs@v1"}"#,
            session_key_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
            retry_delay_ms: 1,
            authority_pending_timeout_ms: 2_000,
        };
        let contract: Value = serde_json::from_str(opts.contract_json).expect("contract json");

        let error = fetch_service_bootstrap_with_contract(&auth, &opts, &contract)
            .await
            .expect_err("repeated manifest_required should fail");
        server_task.await.expect("server task");

        match error {
            TrellisClientError::BootstrapHttp { status, body } => {
                assert_eq!(status, 409);
                assert!(body.contains("manifest_required"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn service_bootstrap_without_contract_reports_pending_response() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("bootstrap request");
            let _request = read_json_http_request(&mut stream).await;
            write_json_http_response(
                &mut stream,
                "202 Accepted",
                json!({ "reason": "authority_update_required" }),
            )
            .await;
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

        let error = fetch_service_bootstrap(&auth, &opts)
            .await
            .expect_err("pending bootstrap should not parse as ready");
        server_task.await.expect("server task");

        match error {
            TrellisClientError::BootstrapHttp { status, body } => {
                assert_eq!(status, 202);
                assert!(body.contains("authority_update_required"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn service_bootstrap_without_contract_waits_for_authority_reconciliation() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("first bootstrap request");
            let first_request = read_json_http_request(&mut first).await;
            write_json_http_response(
                &mut first,
                "202 Accepted",
                json!({ "reason": "authority_reconciliation_pending" }),
            )
            .await;

            let (mut second, _) = listener.accept().await.expect("second bootstrap request");
            let second_request = read_json_http_request(&mut second).await;
            write_ready_service_bootstrap(&mut second).await;
            (first_request, second_request)
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        fetch_service_bootstrap_inner(
            &auth,
            &ServiceBootstrapFetchOptions {
                trellis_url: &url,
                contract_id: "trellis.jobs@v1",
                contract_digest: "digest-alpha",
                contract: None,
                timeout_ms: 2_000,
                retry_delay_ms: Some(1),
                authority_pending_timeout_ms: None,
            },
        )
        .await
        .expect("bootstrap retry succeeds");
        let (first_request, second_request) = server_task.await.expect("server task");

        assert!(first_request.get("contract").is_none());
        assert!(second_request.get("contract").is_none());
    }

    #[tokio::test]
    async fn service_bootstrap_without_contract_times_out_waiting_for_authority_reconciliation() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let mut requests = 0usize;
            while let Ok(Ok((mut stream, _))) =
                tokio::time::timeout(std::time::Duration::from_millis(100), listener.accept()).await
            {
                requests += 1;
                let _request = read_json_http_request(&mut stream).await;
                write_json_http_response(
                    &mut stream,
                    "202 Accepted",
                    json!({ "reason": "authority_reconciliation_pending" }),
                )
                .await;
            }
            requests
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");

        let error = fetch_service_bootstrap_inner(
            &auth,
            &ServiceBootstrapFetchOptions {
                trellis_url: &url,
                contract_id: "trellis.jobs@v1",
                contract_digest: "digest-alpha",
                contract: None,
                timeout_ms: 2_000,
                retry_delay_ms: Some(1),
                authority_pending_timeout_ms: Some(5),
            },
        )
        .await
        .expect_err("pending reconciliation should time out");
        let requests = server_task.await.expect("server task");

        match error {
            TrellisClientError::Bootstrap(message) => {
                assert!(message.contains("timed out waiting for service deployment authority"));
            }
            other => panic!("unexpected error: {other}"),
        }
        assert!(requests >= 1);
    }

    #[tokio::test]
    async fn service_bootstrap_waits_for_authority_update() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.expect("first bootstrap request");
            let first_request = read_json_http_request(&mut first).await;
            write_json_http_response(
                &mut first,
                "202 Accepted",
                json!({ "reason": "authority_update_required" }),
            )
            .await;

            let (mut second, _) = listener.accept().await.expect("second bootstrap request");
            let second_request = read_json_http_request(&mut second).await;
            write_ready_service_bootstrap(&mut second).await;
            (first_request, second_request)
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = ServiceConnectWithContractOptions {
            trellis_url: &url,
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            contract_json: r#"{"id":"trellis.jobs@v1"}"#,
            session_key_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
            retry_delay_ms: 1,
            authority_pending_timeout_ms: 2_000,
        };
        let contract: Value = serde_json::from_str(opts.contract_json).expect("contract json");

        fetch_service_bootstrap_with_contract(&auth, &opts, &contract)
            .await
            .expect("bootstrap retry succeeds");
        let (first_request, second_request) = server_task.await.expect("server task");

        assert!(first_request.get("contract").is_none());
        assert_eq!(
            second_request["contract"],
            json!({ "id": "trellis.jobs@v1" })
        );
    }

    #[tokio::test]
    async fn service_bootstrap_times_out_waiting_for_authority_update() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let mut request_count = 0;
            loop {
                let Ok(Ok((mut stream, _))) =
                    tokio::time::timeout(std::time::Duration::from_millis(100), listener.accept())
                        .await
                else {
                    break request_count;
                };
                request_count += 1;
                let _request = read_json_http_request(&mut stream).await;
                write_json_http_response(
                    &mut stream,
                    "202 Accepted",
                    json!({ "reason": "authority_update_required" }),
                )
                .await;
            }
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = ServiceConnectWithContractOptions {
            trellis_url: &url,
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            contract_json: r#"{"id":"trellis.jobs@v1"}"#,
            session_key_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
            retry_delay_ms: 1,
            authority_pending_timeout_ms: 5,
        };
        let contract: Value = serde_json::from_str(opts.contract_json).expect("contract json");

        let error = fetch_service_bootstrap_with_contract(&auth, &opts, &contract)
            .await
            .expect_err("pending authority update should time out");
        let request_count = server_task.await.expect("server task");

        match error {
            TrellisClientError::Bootstrap(message) => {
                assert!(message.contains("timed out waiting"));
            }
            other => panic!("unexpected error: {other}"),
        }
        assert!(request_count >= 1);
    }

    #[tokio::test]
    async fn service_bootstrap_reports_reconciliation_failure_without_retrying() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind bootstrap server");
        let url = format!("http://{}", listener.local_addr().expect("local addr"));
        let server_task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("bootstrap request");
            let _request = read_json_http_request(&mut stream).await;
            write_json_http_response(
                &mut stream,
                "202 Accepted",
                json!({
                    "reason": "authority_reconciliation_failed",
                    "reconciliationError": "bucket update failed"
                }),
            )
            .await;
        });
        let auth = SessionAuth::from_seed_base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")
            .expect("session auth");
        let opts = ServiceConnectWithContractOptions {
            trellis_url: &url,
            contract_id: "trellis.jobs@v1",
            contract_digest: "digest-alpha",
            contract_json: r#"{"id":"trellis.jobs@v1"}"#,
            session_key_seed_base64url: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            timeout_ms: 2_000,
            retry_delay_ms: 1,
            authority_pending_timeout_ms: 2_000,
        };
        let contract: Value = serde_json::from_str(opts.contract_json).expect("contract json");

        let error = fetch_service_bootstrap_with_contract(&auth, &opts, &contract)
            .await
            .expect_err("reconciliation failure should be surfaced");
        server_task.await.expect("server task");

        match error {
            TrellisClientError::BootstrapHttp { status, body } => {
                assert_eq!(status, 202);
                assert!(body.contains("authority_reconciliation_failed"));
                assert!(body.contains("bucket update failed"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }
}
