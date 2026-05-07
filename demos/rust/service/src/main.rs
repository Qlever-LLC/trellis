use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use clap::Parser;
use futures_util::{stream, Stream, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::json;
use trellis_auth_adapters::{AuthRequestValidatorAdapter, AuthRequestValidatorClientPort};
use trellis_client::{ServiceConnectOptions, TrellisClient};
use trellis_core_bootstrap::CoreBootstrapBinding;
use trellis_sdk_core::types::TrellisBindingsGetResponseBinding;
use trellis_sdk_demo_service::types::{
    ActivityLiveEvent, ActivityRecordedEvent, AssignmentsListRequest, AssignmentsListResponse,
    AssignmentsListResponseAssignmentsItem, EvidenceDeleteRequest, EvidenceDeleteResponse,
    EvidenceDownloadRequest, EvidenceDownloadResponse, EvidenceDownloadResponseTransfer,
    EvidenceDownloadResponseTransferInfo, EvidenceListRequest, EvidenceListResponse,
    EvidenceListResponseEvidenceItem, EvidenceUploadInput, EvidenceUploadOutput,
    EvidenceUploadProgress, EvidenceUploadedEvent, ReportsGenerateInput, ReportsGenerateOutput,
    ReportsGenerateProgress, ReportsListRequest, ReportsListResponse,
    ReportsListResponseReportsItem, ReportsPublishedEvent, SitesGetRequest, SitesGetResponse,
    SitesGetResponseSite, SitesListRequest, SitesListResponse, SitesListResponseSitesItem,
    SitesRefreshInput, SitesRefreshOutput, SitesRefreshOutputSite, SitesRefreshProgress,
    SitesRefreshedEvent,
};
use trellis_sdk_demo_service::{operations as sdk_operations, server};
use trellis_service::{
    bootstrap_service_host, plan_download_transfer_grant, plan_upload_transfer_grant,
    spawn_download_transfer_endpoint, spawn_upload_transfer_endpoint_with_progress,
    AcceptedOperation, BootstrapBindingInfo, DownloadTransferGrant, EventPublisher,
    FileTransferInfo, InMemoryOperationRuntime, KvResourceClient, NatsKvResourceClient,
    OperationFailure, OperationRefData, OperationSnapshot, OperationState,
    OperationTransferProgress, RequestContext, RequestValidator, ResourceRuntimeClient, Router,
    ServerError, ServiceOperation, ServiceResourceBindings, StoreResourceClient,
    TransferDownloadGrantArgs, TransferUploadGrantArgs, UploadTransferGrant, UploadTransferSession,
};

const REFRESH_SITE_SUMMARY_JOB: &str = "refreshSiteSummary";

const SERVICE_NAME: &str = "rust-field-ops-demo";
const FIXED_NOW: &str = "2026-05-02T00:00:00.000Z";
const TRANSFER_EXPIRES_AT: &str = "2099-01-01T00:00:00.000Z";
const TRANSFER_CHUNK_BYTES: u64 = 65_536;
const UPLOADS_STORE: &str = "uploads";
const SITE_SUMMARIES_KV: &str = "siteSummaries";
const MAX_UPLOAD_BYTES: i64 = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS: u64 = 5_000;
const REFRESH_JOB_WAIT_TIMEOUT_MS: u64 = 30_000;
const REFRESH_QUEUE_PAUSE_MS: u64 = 900;
const REFRESH_JOB_CREATE_PAUSE_MS: u64 = 700;
const REFRESH_COMPLETE_PAUSE_MS: u64 = 700;
const REFRESH_ACTIVITY_PAUSE_MS: u64 = 700;
const ACTIVITY_LIVE_SOURCE_EVENTS: &[(&str, &str)] = &[
    ("Activity.Recorded", "events.v1.Activity.Recorded"),
    ("Reports.Published", "events.v1.Reports.Published"),
    ("Evidence.Uploaded", "events.v1.Evidence.Uploaded"),
    ("Sites.Refreshed", "events.v1.Sites.Refreshed"),
];

fn now_iso() -> String {
    match time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339) {
        Ok(value) => value,
        Err(_) => FIXED_NOW.to_string(),
    }
}
const REFRESH_JOB_LOAD_PAUSE_MS: u64 = 1_200;
const REFRESH_JOB_STORE_PAUSE_MS: u64 = 1_000;
const REFRESH_JOB_PROGRESS_PAUSE_MS: u64 = 700;
const OPERATION_WAIT_TIMEOUT_MS: u64 = 60_000;
const OPERATION_WAIT_POLL_MS: u64 = 100;

#[derive(Debug, Parser)]
struct Args {
    /// Print the generated contract identity and exit.
    #[arg(long)]
    contract: bool,

    /// Trellis HTTP base URL for authenticated service bootstrap.
    #[arg(long, env = "TRELLIS_URL")]
    trellis_url: Option<String>,

    /// Base64url service instance seed for authenticated bootstrap.
    #[arg(long, env = "TRELLIS_SEED")]
    seed: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RuntimeMode {
    Authenticated { trellis_url: String, seed: String },
    Idle,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Site {
    site_id: String,
    site_name: String,
    open_inspections: i64,
    overdue_inspections: i64,
    latest_status: String,
    last_report_at: String,
}

#[derive(Debug, Clone)]
struct Assignment {
    inspection_id: String,
    site_id: String,
    site_name: String,
    asset_name: String,
    checklist_name: String,
    priority: String,
    scheduled_for: String,
}

#[derive(Debug, Clone)]
struct Evidence {
    evidence_id: String,
    key: String,
    size: i64,
    content_type: Option<String>,
    evidence_type: String,
    file_name: Option<String>,
    uploaded_at: String,
}

#[derive(Debug, Clone)]
struct PendingUpload {
    evidence_id: String,
}

#[derive(Debug, Default)]
struct AppState {
    sites: Vec<Site>,
    assignments: Vec<Assignment>,
    evidence: Vec<Evidence>,
    reports: Vec<ReportsListResponseReportsItem>,
    operations: BTreeMap<String, serde_json::Value>,
    operation_history: BTreeMap<String, Vec<serde_json::Value>>,
    pending_uploads: BTreeMap<String, PendingUpload>,
    next_operation_sequence: u64,
    next_evidence_sequence: u64,
    next_transfer_sequence: u64,
}

type SharedState = Arc<Mutex<AppState>>;

#[derive(Clone)]
struct AppContext {
    state: SharedState,
    store: EvidenceStore,
    site_summaries: SiteSummaryStore,
    resources: ServiceResourceBindings,
    nats: Option<async_nats::Client>,
    publisher: Option<EventPublisher>,
    service_session_key: String,
    refresh_jobs: RefreshJobManager,
    refresh_operations: ServiceOperation<sdk_operations::SitesRefreshOperation>,
    refresh_worker_wait: Option<trellis_jobs::NatsJobWaiter>,
    transfer_validator: DemoRequestValidator,
}

type RefreshJobManager = trellis_jobs::manager::JobManager<DemoJobPublisher, DemoJobMetaSource>;

#[derive(Debug, Clone, PartialEq, Eq)]
struct RecordedJobPublish {
    subject: String,
    event_type: trellis_jobs::JobEventType,
}

#[derive(Debug, Clone, Default)]
struct DemoJobPublisher {
    nats: Option<async_nats::Client>,
    recorded: Option<Arc<Mutex<Vec<RecordedJobPublish>>>>,
}

#[derive(Debug, Clone, Default)]
struct DemoJobMetaSource {
    next_id: Arc<AtomicU64>,
}

impl DemoJobMetaSource {
    fn new() -> Self {
        Self {
            next_id: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl trellis_jobs::manager::JobMetaSource for DemoJobMetaSource {
    fn next_job_id(&self) -> String {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        format!("job-refresh-site-summary-{id}")
    }

    fn now_iso(&self) -> String {
        FIXED_NOW.to_string()
    }
}

impl trellis_jobs::publisher::JobEventPublisher for DemoJobPublisher {
    type Error = String;

    fn publish(
        &self,
        subject: String,
        payload: Vec<u8>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let nats = self.nats.clone();
        let recorded = self.recorded.clone();
        async move {
            let event: trellis_jobs::JobEvent = serde_json::from_slice(&payload)
                .map_err(|error| format!("decode job event: {error}"))?;
            if let Some(recorded) = recorded {
                recorded
                    .lock()
                    .expect("demo job publisher lock")
                    .push(RecordedJobPublish {
                        subject: subject.clone(),
                        event_type: event.event_type,
                    });
            }
            if let Some(nats) = nats {
                nats.publish(subject, Bytes::from(payload))
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Default)]
struct DemoStore {
    objects: Arc<Mutex<BTreeMap<String, Bytes>>>,
}

#[derive(Debug, Clone)]
enum SiteSummaryStore {
    Memory(SharedState),
    Nats(NatsKvResourceClient),
}

impl SiteSummaryStore {
    async fn seed_missing_sample_sites(&self) -> Result<(), ServerError> {
        for site in sample_sites() {
            self.put(&site).await?;
        }
        Ok(())
    }

    async fn list(&self) -> Result<Vec<Site>, ServerError> {
        match self {
            Self::Memory(state) => Ok(state.lock().expect("demo state lock").sites.clone()),
            Self::Nats(kv) => {
                let mut sites = Vec::new();
                for key in kv.list().await? {
                    if let Some(value) = kv.get(&key).await? {
                        sites.push(serde_json::from_slice(&value)?);
                    }
                }
                sites.sort_by(|left: &Site, right: &Site| left.site_name.cmp(&right.site_name));
                Ok(sites)
            }
        }
    }

    async fn get(&self, site_id: &str) -> Result<Option<Site>, ServerError> {
        match self {
            Self::Memory(state) => Ok(state
                .lock()
                .expect("demo state lock")
                .sites
                .iter()
                .find(|site| site.site_id == site_id)
                .cloned()),
            Self::Nats(kv) => kv
                .get(site_id)
                .await?
                .map(|value| serde_json::from_slice(&value))
                .transpose()
                .map_err(ServerError::from),
        }
    }

    async fn put(&self, site: &Site) -> Result<(), ServerError> {
        match self {
            Self::Memory(state) => {
                let mut state = state.lock().expect("demo state lock");
                if let Some(existing) = state
                    .sites
                    .iter_mut()
                    .find(|existing| existing.site_id == site.site_id)
                {
                    *existing = site.clone();
                } else {
                    state.sites.push(site.clone());
                }
                Ok(())
            }
            Self::Nats(kv) => {
                kv.put(&site.site_id, Bytes::from(serde_json::to_vec(site)?))
                    .await
            }
        }
    }
}

#[derive(Debug, Clone)]
enum SelectedEvidenceStore {
    Demo(DemoStore),
    Nats(trellis_service::NatsStoreResourceClient),
}

#[derive(Debug, Clone)]
struct EvidenceStore {
    inner: SelectedEvidenceStore,
    state: SharedState,
    upload_evidence_id: Option<String>,
    upload_operation_id: Option<String>,
    publisher: Option<EventPublisher>,
}

#[cfg(test)]
#[derive(Debug, Clone)]
struct AllowValidator;

#[cfg(test)]
impl RequestValidator for AllowValidator {
    fn validate<'a>(
        &'a self,
        _subject: &'a str,
        _payload: &'a Bytes,
        _context: &'a RequestContext,
    ) -> Pin<Box<dyn Future<Output = Result<bool, ServerError>> + Send + 'a>> {
        Box::pin(async { Ok(true) })
    }
}

#[derive(Clone)]
enum DemoRequestValidator<C = Arc<TrellisClient>> {
    #[cfg(test)]
    Allow(AllowValidator),
    Auth(AuthRequestValidatorAdapter<C>),
}

#[cfg(test)]
impl<C> DemoRequestValidator<C> {
    fn allow() -> Self {
        Self::Allow(AllowValidator)
    }
}

impl<C> RequestValidator for DemoRequestValidator<C>
where
    C: AuthRequestValidatorClientPort,
{
    fn validate<'a>(
        &'a self,
        subject: &'a str,
        payload: &'a Bytes,
        context: &'a RequestContext,
    ) -> Pin<Box<dyn Future<Output = Result<bool, ServerError>> + Send + 'a>> {
        match self {
            #[cfg(test)]
            Self::Allow(validator) => validator.validate(subject, payload, context),
            Self::Auth(validator) => validator.validate(subject, payload, context),
        }
    }
}

impl<C> std::fmt::Debug for DemoRequestValidator<C> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            #[cfg(test)]
            Self::Allow(_) => f.write_str("DemoRequestValidator::Allow"),
            Self::Auth(_) => f.write_str("DemoRequestValidator::Auth"),
        }
    }
}

impl StoreResourceClient for DemoStore {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        let objects = self.objects.lock().expect("demo store lock");
        Ok(objects.get(key).cloned())
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        let mut objects = self.objects.lock().expect("demo store lock");
        objects.insert(key.to_string(), value);
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        let objects = self.objects.lock().expect("demo store lock");
        Ok(objects.keys().cloned().collect())
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        let mut objects = self.objects.lock().expect("demo store lock");
        objects.remove(key);
        Ok(())
    }
}

impl StoreResourceClient for SelectedEvidenceStore {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        match self {
            Self::Demo(store) => store.read(key).await,
            Self::Nats(store) => store.read(key).await,
        }
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        match self {
            Self::Demo(store) => store.write(key, value).await,
            Self::Nats(store) => store.write(key, value).await,
        }
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        match self {
            Self::Demo(store) => store.list().await,
            Self::Nats(store) => store.list().await,
        }
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        match self {
            Self::Demo(store) => store.delete(key).await,
            Self::Nats(store) => store.delete(key).await,
        }
    }
}

impl StoreResourceClient for EvidenceStore {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        self.inner.read(key).await
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        self.inner.write(key, value.clone()).await?;
        let updated = {
            let mut state = self.state.lock().expect("demo state lock");
            let upload_evidence_id = self.upload_evidence_id.clone().or_else(|| {
                state
                    .pending_uploads
                    .remove(key)
                    .map(|pending| pending.evidence_id)
            });
            let updated = if let Some(evidence) = state.evidence.iter_mut().find(|evidence| {
                upload_evidence_id
                    .as_ref()
                    .is_some_and(|evidence_id| evidence_id == &evidence.evidence_id)
                    || (upload_evidence_id.is_none() && evidence.key == key)
            }) {
                evidence.size = value.len() as i64;
                evidence.uploaded_at = now_iso();
                if evidence.file_name.is_none() {
                    evidence.file_name = key.rsplit('/').next().map(ToString::to_string);
                }
                Some(evidence.clone())
            } else {
                None
            };
            tracing::info!(
                key,
                bytes = value.len(),
                evidence_id = upload_evidence_id.as_deref().unwrap_or("<unknown>"),
                operation_id = self.upload_operation_id.as_deref().unwrap_or("<none>"),
                "evidence bytes stored"
            );
            if let (Some(operation_id), Some(evidence)) =
                (&self.upload_operation_id, updated.as_ref())
            {
                complete_upload_operation(&mut state, operation_id, evidence);
            }
            updated
        };
        if let Some(evidence) = updated.as_ref() {
            publish_evidence_upload_events(self.publisher.as_ref(), evidence).await;
        }
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        self.inner.list().await
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.inner.delete(key).await
    }
}

impl EvidenceStore {
    fn for_upload(&self, evidence_id: String, operation_id: String) -> Self {
        Self {
            state: Arc::clone(&self.state),
            inner: self.inner.clone(),
            upload_evidence_id: Some(evidence_id),
            upload_operation_id: Some(operation_id),
            publisher: self.publisher.clone(),
        }
    }
}

#[cfg(test)]
async fn demo_pause(_ms: u64) {
    tokio::time::sleep(Duration::from_millis(1)).await;
}

#[cfg(not(test))]
async fn demo_pause(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_logging();
    let args = Args::parse();
    if args.contract {
        println!(
            "{} {}",
            trellis_sdk_demo_service::CONTRACT_ID,
            trellis_sdk_demo_service::CONTRACT_DIGEST
        );
        return Ok(());
    }

    match runtime_mode(&args)? {
        RuntimeMode::Authenticated { trellis_url, seed } => {
            tracing::info!(trellis_url = %trellis_url, "starting authenticated Rust demo service");
            run_authenticated_service(&trellis_url, &seed).await?
        }
        RuntimeMode::Idle => {
            println!(
                "Rust demo service handlers are ready. Pass --trellis-url and --seed for authenticated bootstrap."
            );
        }
    }
    Ok(())
}

fn init_logging() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new(
            "trellis_rust_demo_service=info,trellis_service=info,trellis_jobs=info",
        )
    });
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init();
}

fn runtime_mode(args: &Args) -> anyhow::Result<RuntimeMode> {
    if args.trellis_url.is_some() || args.seed.is_some() {
        let trellis_url = args
            .trellis_url
            .clone()
            .ok_or_else(|| anyhow::anyhow!("--trellis-url is required for authenticated mode"))?;
        let seed = args
            .seed
            .clone()
            .ok_or_else(|| anyhow::anyhow!("--seed is required for authenticated mode"))?;
        return Ok(RuntimeMode::Authenticated { trellis_url, seed });
    }

    Ok(RuntimeMode::Idle)
}

async fn run_authenticated_service(trellis_url: &str, seed: &str) -> anyhow::Result<()> {
    let client = Arc::new(
        TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: trellis_sdk_demo_service::CONTRACT_ID,
            contract_digest: trellis_sdk_demo_service::CONTRACT_DIGEST,
            session_key_seed_base64url: seed,
            timeout_ms: REQUEST_TIMEOUT_MS,
        })
        .await?,
    );
    tracing::info!(
        session_prefix = %client.auth().session_key.chars().take(16).collect::<String>(),
        "Rust demo service connected"
    );
    let validator = AuthRequestValidatorAdapter::new(Arc::clone(&client));

    let binding = service_bootstrap_binding(client.as_ref())?;
    let resources = binding.resource_bindings();
    tracing::info!(
        has_jobs = resources.jobs.is_some(),
        store_count = resources.store.len(),
        kv_count = resources.kv.len(),
        "resolved service bootstrap resources"
    );
    let store = match resources.store.get(UPLOADS_STORE) {
        Some(binding) => Some(client.nats().open_store(binding).await?),
        None => None,
    };
    let site_summaries = match resources.kv.get(SITE_SUMMARIES_KV) {
        Some(binding) => Some(client.nats().open_kv(binding).await?),
        None => None,
    };
    if let Some(site_summaries) = &site_summaries {
        SiteSummaryStore::Nats(site_summaries.clone())
            .seed_missing_sample_sites()
            .await?;
    }
    let refresh_worker_host = match (
        refresh_jobs_runtime_binding(&resources),
        site_summaries.clone(),
    ) {
        (Some(runtime_binding), Some(site_summaries)) => Some(
            start_refresh_worker_host(
                client.nats().clone(),
                runtime_binding,
                SiteSummaryStore::Nats(site_summaries),
            )
            .await?,
        ),
        _ => None,
    };
    tracing::info!(
        refresh_worker = refresh_worker_host.is_some(),
        "starting Rust demo service request loop"
    );
    let host = bootstrap_service_host(
        SERVICE_NAME,
        binding.bootstrap_binding(),
        build_router_with_nats_resources_store_jobs_and_validator(
            Some(client.nats().clone()),
            resources,
            store,
            site_summaries,
            Some(client.nats().clone()),
            client.auth().session_key.clone(),
            None,
            DemoRequestValidator::Auth(validator.clone()),
        ),
        validator,
    );

    let service_result =
        trellis_service::run_multi_subject_service(client.nats().clone(), service_subjects(), host)
            .await;
    if let Some(worker_host) = refresh_worker_host {
        worker_host.stop().await?;
    }
    service_result?;
    Ok(())
}

fn service_bootstrap_binding(client: &TrellisClient) -> anyhow::Result<CoreBootstrapBinding> {
    let binding = client
        .service_bootstrap_binding()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("service bootstrap response did not include bindings"))?;
    Ok(CoreBootstrapBinding::new(serde_json::from_value::<
        TrellisBindingsGetResponseBinding,
    >(binding)?))
}

fn service_subjects() -> &'static [&'static str] {
    &[
        "rpc.v1.Assignments.List",
        "rpc.v1.Evidence.Delete",
        "rpc.v1.Evidence.Download",
        "rpc.v1.Evidence.List",
        "rpc.v1.Reports.List",
        "rpc.v1.Sites.Get",
        "rpc.v1.Sites.List",
        "operations.v1.Evidence.Upload",
        "operations.v1.Evidence.Upload.control",
        "operations.v1.Reports.Generate",
        "operations.v1.Reports.Generate.control",
        "operations.v1.Sites.Refresh",
        "operations.v1.Sites.Refresh.control",
        "feeds.v1.Activity.Live",
    ]
}

enum ActivityLiveStreamState {
    Init(async_nats::Client),
    Streaming(Pin<Box<dyn Stream<Item = async_nats::Message> + Send>>),
    Done,
}

fn activity_live_stream(
    nats: async_nats::Client,
) -> impl Stream<Item = Result<ActivityLiveEvent, ServerError>> + Send + 'static {
    stream::unfold(ActivityLiveStreamState::Init(nats), |state| async move {
        let mut event_stream = match state {
            ActivityLiveStreamState::Init(nats) => {
                match subscribe_activity_live_sources(&nats).await {
                    Ok(stream) => {
                        Box::pin(stream) as Pin<Box<dyn Stream<Item = async_nats::Message> + Send>>
                    }
                    Err(error) => return Some((Err(error), ActivityLiveStreamState::Done)),
                }
            }
            ActivityLiveStreamState::Streaming(stream) => stream,
            ActivityLiveStreamState::Done => return None,
        };

        loop {
            let event_message = event_stream.next().await?;
            let subject = event_message.subject.to_string();
            let Some(name) = activity_live_source_name(&subject) else {
                continue;
            };
            let event = match serde_json::from_slice::<serde_json::Value>(&event_message.payload) {
                Ok(event) => event,
                Err(error) => {
                    return Some((Err(ServerError::Json(error)), ActivityLiveStreamState::Done));
                }
            };
            let frame = ActivityLiveEvent(json!({ "name": name, "event": event }));
            return Some((Ok(frame), ActivityLiveStreamState::Streaming(event_stream)));
        }
    })
}

async fn subscribe_activity_live_sources(
    nats: &async_nats::Client,
) -> Result<impl futures_util::Stream<Item = async_nats::Message>, ServerError> {
    let mut subscribers = Vec::with_capacity(ACTIVITY_LIVE_SOURCE_EVENTS.len());
    for (_, subject) in ACTIVITY_LIVE_SOURCE_EVENTS {
        subscribers.push(
            nats.subscribe((*subject).to_string())
                .await
                .map_err(|error| {
                    ServerError::Nats(format!(
                        "failed to subscribe to Activity.Live source event {subject}: {error}"
                    ))
                })?,
        );
    }
    nats.flush()
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))?;
    Ok(futures_util::stream::select_all(subscribers))
}

fn activity_live_source_name(subject: &str) -> Option<&'static str> {
    ACTIVITY_LIVE_SOURCE_EVENTS
        .iter()
        .find_map(|(name, event_subject)| (*event_subject == subject).then_some(*name))
}

#[cfg(test)]
fn build_router() -> Router {
    build_router_with_nats(None)
}

#[cfg(test)]
fn build_router_with_nats(nats: Option<async_nats::Client>) -> Router {
    build_router_with_nats_and_resources(nats, demo_resources())
}

#[cfg(test)]
fn build_router_with_nats_and_resources(
    nats: Option<async_nats::Client>,
    resources: ServiceResourceBindings,
) -> Router {
    build_router_with_nats_resources_and_store(nats, resources, None)
}

#[cfg(test)]
fn build_router_with_nats_resources_and_store(
    nats: Option<async_nats::Client>,
    resources: ServiceResourceBindings,
    nats_store: Option<trellis_service::NatsStoreResourceClient>,
) -> Router {
    build_router_with_nats_resources_store_and_jobs(nats, resources, nats_store, None, None, None)
}

#[cfg(test)]
fn build_router_with_nats_resources_store_and_jobs(
    nats: Option<async_nats::Client>,
    resources: ServiceResourceBindings,
    nats_store: Option<trellis_service::NatsStoreResourceClient>,
    nats_site_summaries: Option<NatsKvResourceClient>,
    jobs_nats: Option<async_nats::Client>,
    recorded_jobs: Option<Arc<Mutex<Vec<RecordedJobPublish>>>>,
) -> Router {
    build_router_with_nats_resources_store_jobs_and_validator(
        nats,
        resources,
        nats_store,
        nats_site_summaries,
        jobs_nats,
        "demo-service-session".to_string(),
        recorded_jobs,
        DemoRequestValidator::allow(),
    )
}

fn build_router_with_nats_resources_store_jobs_and_validator(
    nats: Option<async_nats::Client>,
    resources: ServiceResourceBindings,
    nats_store: Option<trellis_service::NatsStoreResourceClient>,
    nats_site_summaries: Option<NatsKvResourceClient>,
    jobs_nats: Option<async_nats::Client>,
    service_session_key: String,
    recorded_jobs: Option<Arc<Mutex<Vec<RecordedJobPublish>>>>,
    transfer_validator: DemoRequestValidator,
) -> Router {
    let demo_store = DemoStore {
        objects: Arc::new(Mutex::new(sample_store_objects())),
    };
    let store = nats_store.map_or_else(
        || SelectedEvidenceStore::Demo(demo_store),
        SelectedEvidenceStore::Nats,
    );
    build_router_with_selected_evidence_store_and_jobs(
        nats,
        resources,
        store,
        nats_site_summaries,
        jobs_nats,
        service_session_key,
        recorded_jobs,
        transfer_validator,
    )
}

#[cfg(test)]
fn build_router_with_selected_evidence_store(
    nats: Option<async_nats::Client>,
    resources: ServiceResourceBindings,
    inner: SelectedEvidenceStore,
) -> Router {
    build_router_with_selected_evidence_store_and_jobs(
        nats,
        resources,
        inner,
        None,
        None,
        "demo-service-session".to_string(),
        None,
        DemoRequestValidator::allow(),
    )
}

fn build_router_with_selected_evidence_store_and_jobs(
    nats: Option<async_nats::Client>,
    resources: ServiceResourceBindings,
    inner: SelectedEvidenceStore,
    nats_site_summaries: Option<NatsKvResourceClient>,
    jobs_nats: Option<async_nats::Client>,
    service_session_key: String,
    recorded_jobs: Option<Arc<Mutex<Vec<RecordedJobPublish>>>>,
    transfer_validator: DemoRequestValidator,
) -> Router {
    let state = Arc::new(Mutex::new(sample_state()));
    let publisher = nats.clone().map(EventPublisher::new);
    let store = EvidenceStore {
        inner,
        state: Arc::clone(&state),
        upload_evidence_id: None,
        upload_operation_id: None,
        publisher: publisher.clone(),
    };
    let use_worker_wait = nats_site_summaries.is_some();
    let site_summaries = nats_site_summaries.map_or_else(
        || SiteSummaryStore::Memory(Arc::clone(&state)),
        SiteSummaryStore::Nats,
    );
    let refresh_operations = InMemoryOperationRuntime::new(SERVICE_NAME)
        .operation::<sdk_operations::SitesRefreshOperation>();
    let context = AppContext {
        state,
        store,
        site_summaries,
        refresh_jobs: refresh_job_manager(&resources, jobs_nats, recorded_jobs),
        refresh_operations,
        refresh_worker_wait: if use_worker_wait {
            refresh_worker_wait_strategy(&resources, nats.clone())
        } else {
            None
        },
        resources,
        nats,
        publisher,
        service_session_key,
        transfer_validator,
    };
    let mut router = Router::new();

    server::register_assignments_list(&mut router, {
        let state = Arc::clone(&context.state);
        move |_ctx, input| assignments_list(Arc::clone(&state), input)
    });
    server::register_sites_list(&mut router, {
        let site_summaries = context.site_summaries.clone();
        move |_ctx, input| sites_list(site_summaries.clone(), input)
    });
    server::register_sites_get(&mut router, {
        let site_summaries = context.site_summaries.clone();
        move |_ctx, input| sites_get(site_summaries.clone(), input)
    });
    server::register_evidence_list(&mut router, {
        let state = Arc::clone(&context.state);
        move |_ctx, input| evidence_list(Arc::clone(&state), input)
    });
    server::register_evidence_download(&mut router, {
        let context = context.clone();
        move |ctx, input| evidence_download(context.clone(), ctx, input)
    });
    server::register_evidence_delete(&mut router, {
        let context = context.clone();
        move |_ctx, input| evidence_delete(context.clone(), input)
    });
    server::register_reports_list(&mut router, {
        let state = Arc::clone(&context.state);
        move |_ctx, input| reports_list(Arc::clone(&state), input)
    });

    router.register_operation_with_watch::<sdk_operations::SitesRefreshOperation, _, _, _, _, _, _, _>(
        {
            let context = context.clone();
            move |ctx, input| sites_refresh_start(context.clone(), ctx, input)
        },
        {
            let refresh_operations = context.refresh_operations.clone();
            move |_ctx, operation_id| {
                let refresh_operations = refresh_operations.clone();
                async move { refresh_operations.get(operation_id).await }
            }
        },
        {
            let refresh_operations = context.refresh_operations.clone();
            move |_ctx, operation_id| {
                let refresh_operations = refresh_operations.clone();
                sites_refresh_watch(refresh_operations, operation_id)
            }
        },
        {
            let refresh_operations = context.refresh_operations.clone();
            move |_ctx, operation_id| {
                let refresh_operations = refresh_operations.clone();
                async move { refresh_operations.cancel(operation_id).await }
            }
        },
    );
    server::register_reports_generate(
        &mut router,
        {
            let context = context.clone();
            move |ctx, input| reports_generate_start(context.clone(), ctx, input)
        },
        {
            let state = Arc::clone(&context.state);
            move |_ctx, operation_id| {
                operation_get::<ReportsGenerateProgress, ReportsGenerateOutput>(
                    Arc::clone(&state),
                    operation_id,
                )
            }
        },
        {
            let state = Arc::clone(&context.state);
            move |_ctx, operation_id| {
                operation_wait::<ReportsGenerateProgress, ReportsGenerateOutput>(
                    Arc::clone(&state),
                    operation_id,
                )
            }
        },
        operation_cancel::<ReportsGenerateProgress, ReportsGenerateOutput>,
    );
    if let Some(nats) = context.nats.clone() {
        server::register_activity_live(&mut router, move |_ctx, _input| {
            activity_live_stream(nats.clone())
        });
    }
    router.register_operation_with_watch::<sdk_operations::EvidenceUploadOperation, _, _, _, _, _, _, _>(
        {
            let context = context.clone();
            move |ctx, input| evidence_upload_start(context.clone(), ctx, input)
        },
        {
            let state = Arc::clone(&context.state);
            move |_ctx, operation_id| {
                operation_get::<EvidenceUploadProgress, EvidenceUploadOutput>(
                    Arc::clone(&state),
                    operation_id,
                )
            }
        },
        {
            let state = Arc::clone(&context.state);
            move |_ctx, operation_id| {
                operation_watch::<EvidenceUploadProgress, EvidenceUploadOutput>(
                    Arc::clone(&state),
                    operation_id,
                )
            }
        },
        operation_cancel::<EvidenceUploadProgress, EvidenceUploadOutput>,
    );

    router
}

fn refresh_job_manager(
    resources: &ServiceResourceBindings,
    nats: Option<async_nats::Client>,
    recorded: Option<Arc<Mutex<Vec<RecordedJobPublish>>>>,
) -> RefreshJobManager {
    trellis_jobs::manager::JobManager::new(
        DemoJobPublisher { nats, recorded },
        refresh_jobs_binding(resources),
        DemoJobMetaSource::new(),
    )
}

fn refresh_jobs_binding(
    resources: &ServiceResourceBindings,
) -> trellis_jobs::bindings::JobsBinding {
    if let Some(jobs) = &resources.jobs {
        let queues = jobs
            .queues
            .iter()
            .map(|(queue_type, queue)| {
                (
                    queue_type.clone(),
                    trellis_jobs::bindings::JobsQueueBinding {
                        queue_type: queue.queue_type.clone(),
                        publish_prefix: queue.publish_prefix.clone(),
                        work_subject: queue.work_subject.clone(),
                        consumer_name: queue.consumer_name.clone(),
                        max_deliver: queue.max_deliver.max(0) as u64,
                        backoff_ms: queue
                            .backoff_ms
                            .iter()
                            .map(|value| (*value).max(0) as u64)
                            .collect(),
                        ack_wait_ms: queue.ack_wait_ms.max(0) as u64,
                        default_deadline_ms: queue
                            .default_deadline_ms
                            .map(|value| value.max(0) as u64),
                        progress: queue.progress,
                        logs: queue.logs,
                        concurrency: queue.concurrency.max(0) as u32,
                    },
                )
            })
            .collect();
        return trellis_jobs::bindings::JobsBinding {
            namespace: jobs.namespace.clone(),
            queues,
        };
    }

    demo_refresh_jobs_binding()
}

fn refresh_jobs_runtime_binding(
    resources: &ServiceResourceBindings,
) -> Option<trellis_jobs::bindings::JobsRuntimeBinding> {
    let work_stream = resources.jobs.as_ref()?.work_stream.clone()?;
    let jobs = refresh_jobs_binding(resources);
    if !jobs.queues.contains_key(REFRESH_SITE_SUMMARY_JOB) {
        return None;
    }
    Some(trellis_jobs::bindings::JobsRuntimeBinding { jobs, work_stream })
}

fn refresh_worker_wait_strategy(
    resources: &ServiceResourceBindings,
    nats: Option<async_nats::Client>,
) -> Option<trellis_jobs::NatsJobWaiter> {
    let nats = nats?;
    let runtime_binding = refresh_jobs_runtime_binding(resources)?;
    let queue = runtime_binding
        .jobs
        .queues
        .get(REFRESH_SITE_SUMMARY_JOB)?
        .clone();
    Some(trellis_jobs::NatsJobWaiter::new(
        nats,
        queue,
        Duration::from_millis(REFRESH_JOB_WAIT_TIMEOUT_MS),
    ))
}

async fn start_refresh_worker_host(
    nats: async_nats::Client,
    binding: trellis_jobs::bindings::JobsRuntimeBinding,
    site_summaries: SiteSummaryStore,
) -> anyhow::Result<trellis_jobs::WorkerHostHandle> {
    let publisher_nats = nats.clone();
    let worker_site_summaries = site_summaries.clone();
    let host = trellis_jobs::runtime_worker::start_worker_host_from_binding(
        nats,
        binding,
        format!("{SERVICE_NAME}-refresh-worker"),
        move || DemoJobPublisher {
            nats: Some(publisher_nats.clone()),
            recorded: None,
        },
        |_queue_type, _worker_index| DemoJobMetaSource::new(),
        move |active_job| {
            let site_summaries = worker_site_summaries.clone();
            async move { process_refresh_site_summary_job(site_summaries, active_job).await }
        },
        trellis_jobs::WorkerHostOptions {
            queue_types: Some(vec![REFRESH_SITE_SUMMARY_JOB.to_string()]),
            ..trellis_jobs::WorkerHostOptions::default()
        },
    )
    .await?;
    Ok(host)
}

async fn process_refresh_site_summary_job(
    site_summaries: SiteSummaryStore,
    active_job: trellis_jobs::active_job::ActiveJob<DemoJobPublisher, DemoJobMetaSource>,
) -> Result<serde_json::Value, trellis_jobs::manager::JobProcessError<String>> {
    let input: SitesRefreshInput = serde_json::from_value(active_job.job().payload.clone())
        .map_err(|error| trellis_jobs::manager::JobProcessError::failed(error.to_string()))?;
    tracing::info!(job_id = %active_job.job().id, site_id = %input.site_id, "refreshSiteSummary job started");
    active_job
        .update_progress(
            1,
            2,
            Some(format!(
                "Loading latest field summary for {}",
                input.site_id
            )),
        )
        .await
        .map_err(|error| trellis_jobs::manager::JobProcessError::failed(error.to_string()))?;
    demo_pause(REFRESH_JOB_LOAD_PAUSE_MS).await;
    let refresh_id = active_job.job().id.clone();
    let output = refresh_site_summary(site_summaries, input, refresh_id)
        .await
        .map_err(trellis_jobs::manager::JobProcessError::failed)?;
    demo_pause(REFRESH_JOB_STORE_PAUSE_MS).await;
    active_job
        .update_progress(
            2,
            2,
            Some(format!(
                "Stored refreshed summary for {}",
                output.site.site_name
            )),
        )
        .await
        .map_err(|error| trellis_jobs::manager::JobProcessError::failed(error.to_string()))?;
    demo_pause(REFRESH_JOB_PROGRESS_PAUSE_MS).await;
    tracing::info!(job_id = %active_job.job().id, site_id = %output.site.site_id, "refreshSiteSummary job completed");
    serde_json::to_value(output)
        .map_err(|error| trellis_jobs::manager::JobProcessError::failed(error.to_string()))
}

fn demo_refresh_jobs_binding() -> trellis_jobs::bindings::JobsBinding {
    trellis_jobs::bindings::JobsBinding {
        namespace: SERVICE_NAME.to_string(),
        queues: BTreeMap::from([(
            REFRESH_SITE_SUMMARY_JOB.to_string(),
            trellis_jobs::bindings::JobsQueueBinding {
                queue_type: REFRESH_SITE_SUMMARY_JOB.to_string(),
                publish_prefix: format!("trellis.jobs.{SERVICE_NAME}.{REFRESH_SITE_SUMMARY_JOB}"),
                work_subject: format!("trellis.work.{SERVICE_NAME}.{REFRESH_SITE_SUMMARY_JOB}"),
                consumer_name: format!("{SERVICE_NAME}-{REFRESH_SITE_SUMMARY_JOB}"),
                max_deliver: 1,
                backoff_ms: Vec::new(),
                ack_wait_ms: 30_000,
                default_deadline_ms: None,
                progress: true,
                logs: false,
                concurrency: 1,
            },
        )]),
    }
}

async fn assignments_list(
    state: SharedState,
    _input: AssignmentsListRequest,
) -> Result<AssignmentsListResponse, ServerError> {
    let state = state.lock().expect("demo state lock");
    Ok(AssignmentsListResponse {
        assignments: state
            .assignments
            .iter()
            .map(assignment_to_response)
            .collect(),
    })
}

async fn sites_list(
    site_summaries: SiteSummaryStore,
    _input: SitesListRequest,
) -> Result<SitesListResponse, ServerError> {
    Ok(SitesListResponse {
        sites: site_summaries
            .list()
            .await?
            .iter()
            .map(site_to_list_response)
            .collect(),
    })
}

async fn sites_get(
    site_summaries: SiteSummaryStore,
    input: SitesGetRequest,
) -> Result<SitesGetResponse, ServerError> {
    Ok(SitesGetResponse {
        site: site_summaries
            .get(&input.site_id)
            .await?
            .as_ref()
            .map(site_to_get_response),
    })
}

async fn evidence_list(
    state: SharedState,
    input: EvidenceListRequest,
) -> Result<EvidenceListResponse, ServerError> {
    let state = state.lock().expect("demo state lock");
    Ok(EvidenceListResponse {
        evidence: state
            .evidence
            .iter()
            .filter(|evidence| {
                input
                    .prefix
                    .as_ref()
                    .is_none_or(|prefix| evidence.key.starts_with(prefix))
            })
            .map(evidence_to_response)
            .collect(),
    })
}

async fn evidence_download(
    context: AppContext,
    ctx: RequestContext,
    input: EvidenceDownloadRequest,
) -> Result<EvidenceDownloadResponse, ServerError> {
    let Some((evidence, transfer_id)) = ({
        let mut state = context.state.lock().expect("demo state lock");
        let evidence = state
            .evidence
            .iter()
            .find(|evidence| evidence.key == input.key)
            .cloned();
        evidence.map(|evidence| {
            let transfer_id = allocate_transfer_id(&mut state, "download");
            (evidence, transfer_id)
        })
    }) else {
        return Err(ServerError::TransferObjectMissing {
            store: UPLOADS_STORE.to_string(),
            key: input.key,
        });
    };
    let mut plan = plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: SERVICE_NAME,
        session_key: &context.service_session_key,
        resources: &context.resources,
        store: UPLOADS_STORE,
        transfer_id: &transfer_id,
        expires_at: TRANSFER_EXPIRES_AT,
        chunk_bytes: TRANSFER_CHUNK_BYTES,
        info: FileTransferInfo {
            key: evidence.key,
            size: evidence.size as u64,
            updated_at: evidence.uploaded_at,
            digest: None,
            content_type: evidence.content_type,
            metadata: BTreeMap::new(),
        },
    })?;
    plan.grant.session_key = session_key(&ctx).to_string();
    if context.store.read(&plan.grant.info.key).await?.is_none() {
        return Err(ServerError::TransferObjectMissing {
            store: UPLOADS_STORE.to_string(),
            key: plan.grant.info.key.clone(),
        });
    }

    spawn_download_transfer(&context, plan.clone()).await?;

    Ok(EvidenceDownloadResponse {
        transfer: download_transfer_to_response(plan.grant),
    })
}

async fn evidence_delete(
    context: AppContext,
    input: EvidenceDeleteRequest,
) -> Result<EvidenceDeleteResponse, ServerError> {
    let key = input.key.clone();
    let deleted = {
        let mut state = context.state.lock().expect("demo state lock");
        let before = state.evidence.len();
        state.evidence.retain(|evidence| evidence.key != key);
        before != state.evidence.len()
    };
    context.store.delete(&key).await?;
    publish_activity_event(
        context.publisher.as_ref(),
        ActivityRecordedEvent {
            activity_id: format!("activity-evidence-deleted-{key}"),
            kind: "evidence-deleted".to_string(),
            message: format!("Deleted evidence upload {key}"),
            occurred_at: now_iso(),
            related_site_id: None,
            related_inspection_id: None,
        },
        "Evidence.Delete activity",
    )
    .await;
    Ok(EvidenceDeleteResponse { key, deleted })
}

async fn reports_list(
    state: SharedState,
    _input: ReportsListRequest,
) -> Result<ReportsListResponse, ServerError> {
    let state = state.lock().expect("demo state lock");
    Ok(ReportsListResponse {
        reports: state.reports.clone(),
    })
}

async fn sites_refresh_start(
    context: AppContext,
    _ctx: RequestContext,
    input: SitesRefreshInput,
) -> Result<AcceptedOperation<SitesRefreshProgress, SitesRefreshOutput>, ServerError> {
    let operation_id = {
        let mut state = context.state.lock().expect("demo state lock");
        allocate_operation_id(&mut state, "op-sites-refresh")
    };
    let mut accepted = context
        .refresh_operations
        .accept(operation_id.clone())
        .await?;
    let queued = context
        .refresh_operations
        .control(operation_id.clone())
        .await?
        .progress(SitesRefreshProgress {
            stage: "queued".to_string(),
            message: format!("Queued summary refresh for {}", input.site_id),
        })
        .await?;
    accepted.snapshot = queued;
    tracing::info!(
        operation_id = %operation_id,
        site_id = %input.site_id,
        worker_wait = context.refresh_worker_wait.is_some(),
        "Sites.Refresh accepted"
    );
    let refresh_operations = context.refresh_operations.clone();
    let operation_id_for_failure = operation_id.clone();
    let context_for_task = context.clone();
    tokio::spawn(async move {
        if let Err(error) = run_sites_refresh(context_for_task, operation_id, input).await {
            if let Ok(control) = refresh_operations.control(operation_id_for_failure).await {
                let _ = control
                    .fail(OperationFailure {
                        message: error.to_string(),
                    })
                    .await;
            }
        }
    });
    Ok(accepted)
}

fn sites_refresh_watch(
    refresh_operations: ServiceOperation<sdk_operations::SitesRefreshOperation>,
    operation_id: String,
) -> Pin<
    Box<
        dyn Stream<
                Item = Result<
                    OperationSnapshot<SitesRefreshProgress, SitesRefreshOutput>,
                    ServerError,
                >,
            > + Send,
    >,
> {
    enum WatchState {
        Init {
            refresh_operations: ServiceOperation<sdk_operations::SitesRefreshOperation>,
            operation_id: String,
        },
        Streaming {
            snapshots: Pin<
                Box<
                    dyn Stream<
                            Item = Result<
                                OperationSnapshot<SitesRefreshProgress, SitesRefreshOutput>,
                                ServerError,
                            >,
                        > + Send,
                >,
            >,
        },
    }

    Box::pin(stream::unfold(
        WatchState::Init {
            refresh_operations,
            operation_id,
        },
        |state| async move {
            match state {
                WatchState::Init {
                    refresh_operations,
                    operation_id,
                } => match refresh_operations.watch(operation_id).await {
                    Ok(mut snapshots) => snapshots
                        .next()
                        .await
                        .map(|snapshot| (snapshot, WatchState::Streaming { snapshots })),
                    Err(error) => Some((
                        Err(error),
                        WatchState::Streaming {
                            snapshots: Box::pin(stream::empty()),
                        },
                    )),
                },
                WatchState::Streaming { mut snapshots } => snapshots
                    .next()
                    .await
                    .map(|snapshot| (snapshot, WatchState::Streaming { snapshots })),
            }
        },
    ))
}

async fn run_sites_refresh(
    context: AppContext,
    operation_id: String,
    input: SitesRefreshInput,
) -> Result<(), ServerError> {
    let site_id = input.site_id.clone();
    tracing::info!(
        operation_id = %operation_id,
        site_id = %site_id,
        "Sites.Refresh background task started"
    );
    {
        context
            .refresh_operations
            .control(operation_id.clone())
            .await?
            .progress(SitesRefreshProgress {
                stage: "queued".to_string(),
                message: format!("Queued summary refresh for {site_id}"),
            })
            .await?;
    }
    if let Some(wait_strategy) = context.refresh_worker_wait.clone() {
        demo_pause(REFRESH_QUEUE_PAUSE_MS).await;
        let job = context
            .refresh_jobs
            .create(REFRESH_SITE_SUMMARY_JOB, input)
            .await
            .map_err(job_manager_error)?;
        tracing::info!(operation_id = %operation_id, job_id = %job.id, "Sites.Refresh job created");
        demo_pause(REFRESH_JOB_CREATE_PAUSE_MS).await;
        {
            context
                .refresh_operations
                .control(operation_id.clone())
                .await?
                .progress(SitesRefreshProgress {
                    stage: "refreshing".to_string(),
                    message: format!("Refreshing field status for {site_id}"),
                })
                .await?;
        }
        let terminal = wait_strategy
            .wait_for_terminal(job)
            .await
            .map_err(job_wait_error)?;
        tracing::info!(operation_id = %operation_id, job_id = %terminal.id, state = ?terminal.state, "Sites.Refresh job wait returned");
        let output = refresh_output_from_terminal_job(&terminal)?;
        demo_pause(REFRESH_COMPLETE_PAUSE_MS).await;
        let output_for_events = output.clone();
        context
            .refresh_operations
            .control(operation_id.clone())
            .await?
            .complete(output)
            .await?;
        publish_sites_refresh_events(&context, &output_for_events).await;
        demo_pause(REFRESH_ACTIVITY_PAUSE_MS).await;
        return Ok(());
    }

    demo_pause(REFRESH_QUEUE_PAUSE_MS).await;
    let job = context
        .refresh_jobs
        .create(REFRESH_SITE_SUMMARY_JOB, input.clone())
        .await
        .map_err(job_manager_error)?;
    tracing::info!(operation_id = %operation_id, job_id = %job.id, "Sites.Refresh inline job created");
    demo_pause(REFRESH_JOB_CREATE_PAUSE_MS).await;
    {
        context
            .refresh_operations
            .control(operation_id.clone())
            .await?
            .progress(SitesRefreshProgress {
                stage: "refreshing".to_string(),
                message: format!("Refreshing field status for {site_id}"),
            })
            .await?;
    }
    let site_summaries = context.site_summaries.clone();
    let outcome = context
        .refresh_jobs
        .process(
            job,
            trellis_jobs::runtime_worker::JobCancellationToken::new(),
            move |job| async move {
                job.update_progress(1, 1, Some("Refreshing site summary".to_string()))
                    .await
                    .map_err(|error| {
                        trellis_jobs::manager::JobProcessError::failed(error.to_string())
                    })?;
                refresh_site_summary(site_summaries.clone(), input, job.job().id.clone())
                    .await
                    .map_err(trellis_jobs::manager::JobProcessError::failed)
            },
        )
        .await
        .map_err(job_manager_error)?;
    let output = match outcome {
        trellis_jobs::manager::JobProcessOutcome::Completed { result, .. } => result,
        other => {
            return Err(ServerError::Nats(format!(
                "refresh job did not complete: {other:?}"
            )))
        }
    };
    demo_pause(REFRESH_COMPLETE_PAUSE_MS).await;
    let output_for_events = output.clone();
    context
        .refresh_operations
        .control(operation_id.clone())
        .await?
        .complete(output)
        .await?;
    publish_sites_refresh_events(&context, &output_for_events).await;
    demo_pause(REFRESH_ACTIVITY_PAUSE_MS).await;
    Ok(())
}

async fn publish_sites_refresh_events(context: &AppContext, output: &SitesRefreshOutput) {
    let Some(publisher) = &context.publisher else {
        return;
    };

    let refreshed = sites_refreshed_event_from_output(output);
    if let Err(error) = server::publish_sites_refreshed(publisher, &refreshed).await {
        tracing::warn!(error = %error, "failed to publish Sites.Refreshed");
    }

    let occurred_at = now_iso();
    let activity = ActivityRecordedEvent {
        activity_id: format!("activity-refresh-{}", output.site.site_id),
        kind: "site-refreshed".to_string(),
        message: format!("Refreshed {}", output.site.site_name),
        occurred_at,
        related_site_id: Some(output.site.site_id.clone()),
        related_inspection_id: None,
    };
    if let Err(error) = server::publish_activity_recorded(publisher, &activity).await {
        tracing::warn!(error = %error, "failed to publish Activity.Recorded");
    }
}

fn refresh_output_from_terminal_job(
    job: &trellis_jobs::Job,
) -> Result<SitesRefreshOutput, ServerError> {
    match job.state {
        trellis_jobs::JobState::Completed => {
            serde_json::from_value(job.result.clone().ok_or_else(|| {
                ServerError::Nats(format!("refresh job '{}' missing result", job.id))
            })?)
            .map_err(ServerError::from)
        }
        _ => Err(ServerError::Nats(format!(
            "refresh job '{}' ended in state {:?}: {}",
            job.id,
            job.state,
            job.last_error.as_deref().unwrap_or("no error detail")
        ))),
    }
}

async fn refresh_site_summary(
    site_summaries: SiteSummaryStore,
    input: SitesRefreshInput,
    refresh_id: String,
) -> Result<SitesRefreshOutput, String> {
    tracing::debug!(site_id = %input.site_id, "refreshing site summary store");
    let mut site = site_summaries
        .get(&input.site_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Unknown site '{}'", input.site_id))?;
    site.last_report_at = FIXED_NOW.to_string();
    site_summaries
        .put(&site)
        .await
        .map_err(|error| error.to_string())?;
    tracing::debug!(site_id = %site.site_id, last_report_at = %site.last_report_at, "site summary stored");
    let output = SitesRefreshOutput {
        refresh_id,
        site: site_to_refresh_output(&site),
        status: "completed".to_string(),
    };
    Ok(output)
}

fn job_manager_error(error: trellis_jobs::manager::JobManagerError<String>) -> ServerError {
    ServerError::Nats(format!("refresh job error: {error}"))
}

fn job_wait_error(error: trellis_jobs::JobsError) -> ServerError {
    ServerError::Nats(format!("refresh job wait error: {error}"))
}

async fn reports_generate_start(
    context: AppContext,
    _ctx: RequestContext,
    input: ReportsGenerateInput,
) -> Result<AcceptedOperation<ReportsGenerateProgress, ReportsGenerateOutput>, ServerError> {
    let report_id = format!("closeout-{}", input.inspection_id);
    let inspection_id = input.inspection_id.clone();
    let report_comment = input.report_comment.clone();
    let (accepted_operation, assignment) = {
        let mut state = context.state.lock().expect("demo state lock");
        let assignment = state
            .assignments
            .iter()
            .find(|candidate| candidate.inspection_id == input.inspection_id)
            .cloned();
        let site_id = assignment
            .as_ref()
            .map(|assignment| assignment.site_id.clone());
        let site_name = assignment.as_ref().map_or_else(
            || "Unknown site".to_string(),
            |assignment| assignment.site_name.clone(),
        );
        let asset_name = assignment.as_ref().map_or_else(
            || "Unknown asset".to_string(),
            |assignment| assignment.asset_name.clone(),
        );
        let summary = assignment.as_ref().map_or_else(
            || format!("Closeout report for {}.", input.inspection_id),
            |assignment| {
                format!(
                    "{} closeout for {}.",
                    assignment.checklist_name, assignment.site_name
                )
            },
        );
        state.reports.push(ReportsListResponseReportsItem {
            report_id: report_id.clone(),
            inspection_id: input.inspection_id.clone(),
            site_id,
            site_name,
            asset_name,
            status: "published".to_string(),
            published_at: now_iso(),
            report_comment: report_comment.trim().to_string(),
            summary,
            readiness: "Site context reconciled before closeout.".to_string(),
            evidence_status: "Evidence review completed in the inspection workflow.".to_string(),
        });

        let accepted_operation = accepted(
            &mut state,
            "Reports.Generate",
            ReportsGenerateOutput {
                report_id: report_id.clone(),
                inspection_id: input.inspection_id,
                status: "published".to_string(),
            },
            ReportsGenerateProgress {
                stage: "complete".to_string(),
                message: "Report generated".to_string(),
            },
        );
        (accepted_operation, assignment)
    };

    publish_reports_generate_events(&context, report_id, inspection_id, assignment).await;
    Ok(accepted_operation)
}

async fn publish_reports_generate_events(
    context: &AppContext,
    report_id: String,
    inspection_id: String,
    assignment: Option<Assignment>,
) {
    let Some(publisher) = &context.publisher else {
        return;
    };

    let published = ReportsPublishedEvent {
        report_id,
        inspection_id: inspection_id.clone(),
        site_id: assignment
            .as_ref()
            .map(|assignment| assignment.site_id.clone()),
        published_at: now_iso(),
    };
    if let Err(error) = server::publish_reports_published(publisher, &published).await {
        tracing::warn!(error = %error, "failed to publish Reports.Published");
    }

    let inspection_label = assignment.as_ref().map_or_else(
        || inspection_id.clone(),
        |assignment| format!("{} / {}", assignment.site_name, assignment.asset_name),
    );
    let activity = ActivityRecordedEvent {
        activity_id: format!("activity-closeout-{inspection_id}"),
        kind: "closeout-published".to_string(),
        message: format!("Published closeout status for {inspection_label}"),
        occurred_at: now_iso(),
        related_site_id: assignment.map(|assignment| assignment.site_id),
        related_inspection_id: Some(inspection_id),
    };
    if let Err(error) = server::publish_activity_recorded(publisher, &activity).await {
        tracing::warn!(error = %error, "failed to publish Activity.Recorded");
    }
}

async fn publish_evidence_upload_events(publisher: Option<&EventPublisher>, evidence: &Evidence) {
    let Some(publisher) = publisher else {
        return;
    };

    let uploaded = EvidenceUploadedEvent {
        evidence_id: evidence.evidence_id.clone(),
        key: evidence.key.clone(),
        size: evidence.size,
        content_type: evidence.content_type.clone(),
        file_name: evidence.file_name.clone(),
        evidence_type: evidence.evidence_type.clone(),
        uploaded_at: evidence.uploaded_at.clone(),
    };
    if let Err(error) = server::publish_evidence_uploaded(publisher, &uploaded).await {
        tracing::warn!(error = %error, "failed to publish Evidence.Uploaded");
    }

    publish_activity_event(
        Some(publisher),
        ActivityRecordedEvent {
            activity_id: format!("activity-evidence-uploaded-{}", evidence.evidence_id),
            kind: "evidence-uploaded".to_string(),
            message: format!(
                "Uploaded {} evidence from {}",
                evidence.evidence_type, evidence.key
            ),
            occurred_at: now_iso(),
            related_site_id: None,
            related_inspection_id: None,
        },
        "Evidence.Upload activity",
    )
    .await;
}

async fn publish_activity_event(
    publisher: Option<&EventPublisher>,
    activity: ActivityRecordedEvent,
    context: &str,
) {
    let Some(publisher) = publisher else {
        return;
    };

    if let Err(error) = server::publish_activity_recorded(publisher, &activity).await {
        tracing::warn!(error = %error, context, "failed to publish Activity.Recorded");
    }
}

async fn evidence_upload_start(
    context: AppContext,
    ctx: RequestContext,
    input: EvidenceUploadInput,
) -> Result<AcceptedOperation<EvidenceUploadProgress, EvidenceUploadOutput>, ServerError> {
    let (accepted, plan, evidence_id, operation_id) = {
        let mut state = context.state.lock().expect("demo state lock");
        let metadata = input.metadata.clone().unwrap_or_default();
        let file_name = metadata
            .get("fileName")
            .cloned()
            .or_else(|| input.key.rsplit('/').next().map(ToString::to_string));
        let evidence_id = if let Some(existing) = state
            .evidence
            .iter_mut()
            .find(|evidence| evidence.key == input.key)
        {
            existing.size = 0;
            existing.content_type = input.content_type.clone();
            existing.evidence_type = input.evidence_type;
            existing.file_name = file_name.clone();
            existing.uploaded_at = FIXED_NOW.to_string();
            existing.evidence_id.clone()
        } else {
            let evidence_id = metadata
                .get("evidenceId")
                .cloned()
                .unwrap_or_else(|| allocate_evidence_id(&mut state));
            state.evidence.push(Evidence {
                evidence_id: evidence_id.clone(),
                key: input.key.clone(),
                size: 0,
                content_type: input.content_type.clone(),
                evidence_type: input.evidence_type,
                file_name: file_name.clone(),
                uploaded_at: FIXED_NOW.to_string(),
            });
            evidence_id
        };
        state.pending_uploads.insert(
            input.key.clone(),
            PendingUpload {
                evidence_id: evidence_id.clone(),
            },
        );
        let transfer_id = allocate_transfer_id(&mut state, "upload");

        let mut plan = plan_upload_transfer_grant(TransferUploadGrantArgs {
            service_name: SERVICE_NAME,
            session_key: &context.service_session_key,
            resources: &context.resources,
            store: UPLOADS_STORE,
            key: &input.key,
            transfer_id: &transfer_id,
            expires_at: TRANSFER_EXPIRES_AT,
            chunk_bytes: TRANSFER_CHUNK_BYTES,
            max_bytes: Some(MAX_UPLOAD_BYTES as u64),
            content_type: input.content_type.as_deref(),
            metadata,
        })?;
        plan.grant.session_key = session_key(&ctx).to_string();

        let accepted = accepted_with_transfer_state(
            &mut state,
            "Evidence.Upload",
            OperationState::Running,
            None,
            EvidenceUploadProgress {
                stage: "transfer".to_string(),
                message: "Upload transfer grant is ready".to_string(),
            },
            Some(plan.grant.clone()),
        );
        let operation_id = accepted.operation_ref.id.clone();
        tracing::info!(
            operation_id = %operation_id,
            key = %plan.key,
            transfer_subject = %plan.grant.subject,
            caller_session_prefix = %plan.grant.session_key.chars().take(16).collect::<String>(),
            "Evidence.Upload accepted"
        );
        (accepted, plan, evidence_id, operation_id)
    };

    spawn_upload_transfer(&context, plan, evidence_id, operation_id).await?;
    Ok(accepted)
}

async fn operation_get<TProgress, TOutput>(
    state: SharedState,
    operation_id: String,
) -> Result<OperationSnapshot<TProgress, TOutput>, ServerError>
where
    TProgress: DeserializeOwned,
    TOutput: DeserializeOwned,
{
    let state = state.lock().expect("demo state lock");
    let value = state
        .operations
        .get(&operation_id)
        .cloned()
        .ok_or_else(|| ServerError::OperationNotFound {
            operation_id: operation_id.clone(),
        })?;
    let snapshot: OperationSnapshot<TProgress, TOutput> = serde_json::from_value(value)?;
    tracing::debug!(
        operation_id = %operation_id,
        state = ?snapshot.state,
        revision = snapshot.revision,
        "operation get"
    );
    Ok(snapshot)
}

async fn operation_wait<TProgress, TOutput>(
    state: SharedState,
    operation_id: String,
) -> Result<OperationSnapshot<TProgress, TOutput>, ServerError>
where
    TProgress: DeserializeOwned,
    TOutput: DeserializeOwned,
{
    let deadline = Instant::now() + Duration::from_millis(OPERATION_WAIT_TIMEOUT_MS);
    tracing::debug!(operation_id = %operation_id, "operation wait started");
    loop {
        let snapshot =
            operation_get::<TProgress, TOutput>(Arc::clone(&state), operation_id.clone()).await?;
        if matches!(
            snapshot.state,
            OperationState::Completed | OperationState::Failed | OperationState::Cancelled
        ) || Instant::now() >= deadline
        {
            tracing::debug!(
                operation_id = %operation_id,
                state = ?snapshot.state,
                revision = snapshot.revision,
                "operation wait returning"
            );
            return Ok(snapshot);
        }
        tokio::time::sleep(Duration::from_millis(OPERATION_WAIT_POLL_MS)).await;
    }
}

fn operation_watch<TProgress, TOutput>(
    state: SharedState,
    operation_id: String,
) -> Pin<Box<dyn Stream<Item = Result<OperationSnapshot<TProgress, TOutput>, ServerError>> + Send>>
where
    TProgress: DeserializeOwned + Send + 'static,
    TOutput: DeserializeOwned + Send + 'static,
{
    let deadline = Instant::now() + Duration::from_millis(OPERATION_WAIT_TIMEOUT_MS);
    tracing::debug!(operation_id = %operation_id, "operation watch started");
    Box::pin(futures_util::stream::unfold(
        (state, operation_id, 0_u64, false, deadline),
        |(state, operation_id, last_revision, done, deadline)| async move {
            if done {
                return None;
            }

            loop {
                let next: Result<Option<OperationSnapshot<TProgress, TOutput>>, ServerError> = {
                    let state_guard = state.lock().expect("demo state lock");
                    if let Some(history) = state_guard.operation_history.get(&operation_id) {
                        history
                            .iter()
                            .find_map(|value| {
                                let snapshot: OperationSnapshot<TProgress, TOutput> =
                                    serde_json::from_value(value.clone()).ok()?;
                                (snapshot.revision > last_revision).then_some(snapshot)
                            })
                            .map_or(Ok(None), |snapshot| Ok(Some(snapshot)))
                    } else {
                        Err(ServerError::OperationNotFound {
                            operation_id: operation_id.clone(),
                        })
                    }
                };

                let next = match next {
                    Ok(next) => next,
                    Err(error) => {
                        return Some((
                            Err(error),
                            (state, operation_id, last_revision, true, deadline),
                        ))
                    }
                };

                if let Some(snapshot) = next {
                    let revision = snapshot.revision;
                    let terminal = snapshot.state.is_terminal();
                    if terminal {
                        tracing::debug!(
                            operation_id = %operation_id,
                            revision,
                            "operation watch terminal frame"
                        );
                    }
                    return Some((
                        Ok(snapshot),
                        (state, operation_id, revision, terminal, deadline),
                    ));
                }

                if Instant::now() >= deadline {
                    tracing::debug!(
                        operation_id = %operation_id,
                        "operation watch timeout closing non-terminal stream"
                    );
                    return None;
                }

                tokio::time::sleep(Duration::from_millis(OPERATION_WAIT_POLL_MS)).await;
            }
        },
    ))
}

async fn operation_cancel<TProgress, TOutput>(
    _ctx: RequestContext,
    _operation_id: String,
) -> Result<OperationSnapshot<TProgress, TOutput>, ServerError> {
    Ok(OperationSnapshot {
        revision: 1,
        state: OperationState::Cancelled,
        progress: None,
        transfer: None,
        output: None,
        ..Default::default()
    })
}

fn accepted<TProgress, TOutput>(
    state: &mut AppState,
    operation: &str,
    output: TOutput,
    progress: TProgress,
) -> AcceptedOperation<TProgress, TOutput>
where
    TProgress: Clone + Serialize,
    TOutput: Clone + Serialize,
{
    accepted_with_transfer(state, operation, output, progress, None)
}

fn accepted_with_transfer<TProgress, TOutput>(
    state: &mut AppState,
    operation: &str,
    output: TOutput,
    progress: TProgress,
    transfer: Option<UploadTransferGrant>,
) -> AcceptedOperation<TProgress, TOutput>
where
    TProgress: Clone + Serialize,
    TOutput: Clone + Serialize,
{
    accepted_with_transfer_state(
        state,
        operation,
        OperationState::Completed,
        Some(output),
        progress,
        transfer,
    )
}

fn accepted_with_transfer_state<TProgress, TOutput>(
    state: &mut AppState,
    operation: &str,
    operation_state: OperationState,
    output: Option<TOutput>,
    progress: TProgress,
    transfer: Option<UploadTransferGrant>,
) -> AcceptedOperation<TProgress, TOutput>
where
    TProgress: Clone + Serialize,
    TOutput: Clone + Serialize,
{
    let operation_id = format!("op-{}", operation.replace('.', "-").to_ascii_lowercase());
    let operation_id = unique_operation_id(state, &operation_id);
    let snapshot = OperationSnapshot {
        id: Some(operation_id.clone()),
        service: Some(SERVICE_NAME.to_string()),
        operation: Some(operation.to_string()),
        revision: 1,
        state: operation_state,
        created_at: Some(now_iso()),
        updated_at: Some(now_iso()),
        progress: Some(progress),
        transfer: None,
        output,
        ..Default::default()
    };
    record_operation_snapshot(state, &operation_id, &snapshot);

    AcceptedOperation {
        kind: "accepted".to_string(),
        operation_ref: OperationRefData {
            id: operation_id,
            service: SERVICE_NAME.to_string(),
            operation: operation.to_string(),
        },
        snapshot,
        transfer,
    }
}

fn record_operation_snapshot<TProgress, TOutput>(
    state: &mut AppState,
    operation_id: &str,
    snapshot: &OperationSnapshot<TProgress, TOutput>,
) where
    TProgress: Serialize,
    TOutput: Serialize,
{
    let mut value =
        serde_json::to_value(snapshot).expect("demo operation snapshot should serialize");
    if let serde_json::Value::Object(ref mut object) = value {
        object
            .entry("id".to_string())
            .or_insert_with(|| serde_json::Value::String(operation_id.to_string()));
        object
            .entry("service".to_string())
            .or_insert_with(|| serde_json::Value::String(SERVICE_NAME.to_string()));
        if !object.contains_key("operation") {
            if let Some(operation) = state
                .operations
                .get(operation_id)
                .and_then(|snapshot| snapshot.get("operation"))
                .cloned()
            {
                object.insert("operation".to_string(), operation);
            }
        }
        if !object.contains_key("createdAt") {
            let created_at = state
                .operations
                .get(operation_id)
                .and_then(|snapshot| snapshot.get("createdAt"))
                .cloned()
                .unwrap_or_else(|| serde_json::Value::String(now_iso()));
            object.insert("createdAt".to_string(), created_at);
        }
        object.insert(
            "updatedAt".to_string(),
            serde_json::Value::String(now_iso()),
        );
        if matches!(
            object.get("state").and_then(serde_json::Value::as_str),
            Some("completed" | "failed" | "cancelled")
        ) {
            object
                .entry("completedAt".to_string())
                .or_insert_with(|| serde_json::Value::String(now_iso()));
        }
        if !object.contains_key("progress") {
            if let Some(progress) = state
                .operations
                .get(operation_id)
                .and_then(|snapshot| snapshot.get("progress"))
                .cloned()
            {
                object.insert("progress".to_string(), progress);
            }
        }
        if !object.contains_key("output") {
            if let Some(output) = state
                .operations
                .get(operation_id)
                .and_then(|snapshot| snapshot.get("output"))
                .cloned()
            {
                object.insert("output".to_string(), output);
            }
        }
    }
    state
        .operations
        .insert(operation_id.to_string(), value.clone());
    state
        .operation_history
        .entry(operation_id.to_string())
        .or_default()
        .push(value);
}

fn next_operation_revision(state: &AppState, operation_id: &str) -> u64 {
    state
        .operation_history
        .get(operation_id)
        .and_then(|history| history.last())
        .and_then(|snapshot| snapshot.get("revision"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
        + 1
}

fn complete_upload_operation(state: &mut AppState, operation_id: &str, evidence: &Evidence) {
    tracing::info!(
        operation_id,
        evidence_id = %evidence.evidence_id,
        key = %evidence.key,
        size = evidence.size,
        "Evidence.Upload completed"
    );
    let snapshot = OperationSnapshot {
        revision: next_operation_revision(state, operation_id),
        state: OperationState::Completed,
        progress: Some(EvidenceUploadProgress {
            stage: "indexed".to_string(),
            message: format!("Indexed evidence blocks from {}", evidence.key),
        }),
        transfer: None,
        output: Some(EvidenceUploadOutput {
            evidence_id: evidence.evidence_id.clone(),
            key: evidence.key.clone(),
            size: evidence.size,
            content_type: evidence.content_type.clone(),
            file_name: evidence.file_name.clone(),
            disposition: "ready-for-review".to_string(),
        }),
        ..Default::default()
    };
    record_operation_snapshot(state, operation_id, &snapshot);
}

fn progress_upload_transfer_operation(
    state: &mut AppState,
    operation_id: &str,
    transfer: OperationTransferProgress,
) {
    let snapshot: OperationSnapshot<EvidenceUploadProgress, EvidenceUploadOutput> =
        OperationSnapshot {
            revision: next_operation_revision(state, operation_id),
            state: OperationState::Running,
            progress: None,
            transfer: Some(transfer),
            output: None,
            ..Default::default()
        };
    record_operation_snapshot(state, operation_id, &snapshot);
}

fn unique_operation_id(state: &AppState, base: &str) -> String {
    if !state.operations.contains_key(base) {
        return base.to_string();
    }

    for suffix in 2.. {
        let candidate = format!("{base}-{suffix}");
        if !state.operations.contains_key(&candidate) {
            return candidate;
        }
    }

    unreachable!("unbounded suffix search always returns")
}

fn allocate_operation_id(state: &mut AppState, prefix: &str) -> String {
    state.next_operation_sequence += 1;
    format!("{prefix}-{}", state.next_operation_sequence)
}

fn allocate_evidence_id(state: &mut AppState) -> String {
    let evidence_id = format!("ev-{}", state.next_evidence_sequence);
    state.next_evidence_sequence += 1;
    evidence_id
}

fn allocate_transfer_id(state: &mut AppState, prefix: &str) -> String {
    let transfer_id = format!("{prefix}-{}", state.next_transfer_sequence);
    state.next_transfer_sequence += 1;
    transfer_id
}

fn session_key(ctx: &RequestContext) -> &str {
    ctx.session_key.as_deref().unwrap_or("demo-session")
}

#[cfg(test)]
fn demo_resources() -> ServiceResourceBindings {
    let mut store = BTreeMap::new();
    store.insert(
        UPLOADS_STORE.to_string(),
        trellis_service::StoreResourceBinding {
            name: "demo-uploads".to_string(),
            max_object_bytes: Some(MAX_UPLOAD_BYTES),
            max_total_bytes: None,
            ttl_ms: 0,
        },
    );
    ServiceResourceBindings {
        store,
        ..ServiceResourceBindings::default()
    }
}

async fn spawn_upload_transfer(
    context: &AppContext,
    plan: trellis_service::UploadTransferGrantPlan,
    evidence_id: String,
    operation_id: String,
) -> Result<(), ServerError> {
    let Some(nats) = context.nats.clone() else {
        tracing::debug!(operation_id = %operation_id, "upload transfer endpoint skipped without NATS");
        return Ok(());
    };
    tracing::info!(
        operation_id = %operation_id,
        evidence_id = %evidence_id,
        subject = %plan.grant.subject,
        "starting upload transfer endpoint"
    );
    let session = UploadTransferSession::new(plan, FIXED_NOW);
    let store = context.store.for_upload(evidence_id, operation_id.clone());
    let validator = context.transfer_validator.clone();
    let state = Arc::clone(&context.state);
    spawn_upload_transfer_endpoint_with_progress(nats, session, store, validator, move |progress| {
        let mut state = state.lock().expect("demo state lock");
        progress_upload_transfer_operation(&mut state, &operation_id, progress);
    })
    .await
}

async fn spawn_download_transfer(
    context: &AppContext,
    plan: trellis_service::DownloadTransferGrantPlan,
) -> Result<(), ServerError> {
    let Some(nats) = context.nats.clone() else {
        tracing::debug!(subject = %plan.grant.subject, "download transfer endpoint skipped without NATS");
        return Ok(());
    };
    tracing::info!(subject = %plan.grant.subject, key = %plan.grant.info.key, "starting download transfer endpoint");
    let store = context.store.clone();
    let validator = context.transfer_validator.clone();
    spawn_download_transfer_endpoint(nats, plan, store, validator).await
}

fn download_transfer_to_response(grant: DownloadTransferGrant) -> EvidenceDownloadResponseTransfer {
    EvidenceDownloadResponseTransfer {
        r#type: grant.type_name,
        direction: grant.direction,
        service: grant.service,
        session_key: grant.session_key,
        transfer_id: grant.transfer_id,
        subject: grant.subject,
        expires_at: grant.expires_at,
        chunk_bytes: grant.chunk_bytes as i64,
        info: EvidenceDownloadResponseTransferInfo {
            key: grant.info.key,
            size: grant.info.size as i64,
            updated_at: grant.info.updated_at,
            digest: grant.info.digest,
            content_type: grant.info.content_type,
            metadata: grant.info.metadata,
        },
    }
}

fn sample_state() -> AppState {
    AppState {
        sites: sample_sites(),
        assignments: vec![
            Assignment {
                inspection_id: "insp-west-001".to_string(),
                site_id: "site-west-yard".to_string(),
                site_name: "West Yard".to_string(),
                asset_name: "Pump Station 7".to_string(),
                checklist_name: "Leak and vibration check".to_string(),
                priority: "high".to_string(),
                scheduled_for: "2026-04-18T09:00:00.000Z".to_string(),
            },
            Assignment {
                inspection_id: "insp-ridge-002".to_string(),
                site_id: "site-ridge-line".to_string(),
                site_name: "Ridge Line".to_string(),
                asset_name: "Backup Generator 2".to_string(),
                checklist_name: "Run test and battery review".to_string(),
                priority: "medium".to_string(),
                scheduled_for: "2026-04-18T13:30:00.000Z".to_string(),
            },
            Assignment {
                inspection_id: "insp-harbor-003".to_string(),
                site_id: "site-harbor-gate".to_string(),
                site_name: "Harbor Gate".to_string(),
                asset_name: "Security Gate Controller".to_string(),
                checklist_name: "Ingress log verification".to_string(),
                priority: "low".to_string(),
                scheduled_for: "2026-04-19T08:15:00.000Z".to_string(),
            },
        ],
        evidence: vec![Evidence {
            evidence_id: "ev-1001".to_string(),
            key: "site-north/transformer-a/photo.txt".to_string(),
            size: 42,
            content_type: Some("text/plain".to_string()),
            evidence_type: "photo".to_string(),
            file_name: Some("photo.txt".to_string()),
            uploaded_at: "2026-05-01T12:00:00.000Z".to_string(),
        }],
        reports: Vec::new(),
        operations: BTreeMap::new(),
        operation_history: BTreeMap::new(),
        pending_uploads: BTreeMap::new(),
        next_operation_sequence: 1,
        next_evidence_sequence: 1002,
        next_transfer_sequence: 1,
    }
}

fn sample_sites() -> Vec<Site> {
    vec![
        Site {
            site_id: "site-west-yard".to_string(),
            site_name: "West Yard".to_string(),
            open_inspections: 3,
            overdue_inspections: 1,
            latest_status: "attention-needed".to_string(),
            last_report_at: "2026-04-17T18:12:00.000Z".to_string(),
        },
        Site {
            site_id: "site-ridge-line".to_string(),
            site_name: "Ridge Line".to_string(),
            open_inspections: 2,
            overdue_inspections: 0,
            latest_status: "on-track".to_string(),
            last_report_at: "2026-04-17T11:45:00.000Z".to_string(),
        },
        Site {
            site_id: "site-harbor-gate".to_string(),
            site_name: "Harbor Gate".to_string(),
            open_inspections: 1,
            overdue_inspections: 0,
            latest_status: "ready".to_string(),
            last_report_at: "2026-04-16T15:05:00.000Z".to_string(),
        },
    ]
}

fn sample_store_objects() -> BTreeMap<String, Bytes> {
    BTreeMap::from([(
        "site-north/transformer-a/photo.txt".to_string(),
        Bytes::from_static(b"012345678901234567890123456789012345678901"),
    )])
}

fn assignment_to_response(assignment: &Assignment) -> AssignmentsListResponseAssignmentsItem {
    AssignmentsListResponseAssignmentsItem {
        inspection_id: assignment.inspection_id.clone(),
        site_id: assignment.site_id.clone(),
        site_name: assignment.site_name.clone(),
        asset_name: assignment.asset_name.clone(),
        checklist_name: assignment.checklist_name.clone(),
        priority: json!(assignment.priority),
        scheduled_for: assignment.scheduled_for.clone(),
    }
}

fn site_to_list_response(site: &Site) -> SitesListResponseSitesItem {
    SitesListResponseSitesItem {
        site_id: site.site_id.clone(),
        site_name: site.site_name.clone(),
        open_inspections: site.open_inspections,
        overdue_inspections: site.overdue_inspections,
        latest_status: site.latest_status.clone(),
        last_report_at: site.last_report_at.clone(),
    }
}

fn site_to_get_response(site: &Site) -> SitesGetResponseSite {
    SitesGetResponseSite {
        site_id: site.site_id.clone(),
        site_name: site.site_name.clone(),
        open_inspections: site.open_inspections,
        overdue_inspections: site.overdue_inspections,
        latest_status: site.latest_status.clone(),
        last_report_at: site.last_report_at.clone(),
    }
}

fn site_to_refresh_output(site: &Site) -> SitesRefreshOutputSite {
    SitesRefreshOutputSite {
        site_id: site.site_id.clone(),
        site_name: site.site_name.clone(),
        open_inspections: site.open_inspections,
        overdue_inspections: site.overdue_inspections,
        latest_status: site.latest_status.clone(),
        last_report_at: site.last_report_at.clone(),
    }
}

fn evidence_to_response(evidence: &Evidence) -> EvidenceListResponseEvidenceItem {
    EvidenceListResponseEvidenceItem {
        evidence_id: evidence.evidence_id.clone(),
        key: evidence.key.clone(),
        size: evidence.size,
        content_type: evidence.content_type.clone(),
        evidence_type: evidence.evidence_type.clone(),
        file_name: evidence.file_name.clone(),
        uploaded_at: evidence.uploaded_at.clone(),
    }
}

#[allow(dead_code)]
fn activity_event(message: impl Into<String>) -> ActivityRecordedEvent {
    ActivityRecordedEvent {
        activity_id: "activity-rust-demo".to_string(),
        kind: "demo".to_string(),
        message: message.into(),
        occurred_at: FIXED_NOW.to_string(),
        related_site_id: Some("site-north".to_string()),
        related_inspection_id: Some("insp-1001".to_string()),
    }
}

#[allow(dead_code)]
fn report_published_event(report_id: String, inspection_id: String) -> ReportsPublishedEvent {
    ReportsPublishedEvent {
        report_id,
        inspection_id,
        site_id: Some("site-north".to_string()),
        published_at: FIXED_NOW.to_string(),
    }
}

#[allow(dead_code)]
fn site_refreshed_event(site: &Site) -> SitesRefreshedEvent {
    SitesRefreshedEvent {
        refresh_id: format!("refresh-{}", site.site_id),
        site: trellis_sdk_demo_service::types::SitesRefreshedEventSite {
            site_id: site.site_id.clone(),
            site_name: site.site_name.clone(),
            open_inspections: site.open_inspections,
            overdue_inspections: site.overdue_inspections,
            latest_status: site.latest_status.clone(),
            last_report_at: site.last_report_at.clone(),
        },
        refreshed_at: now_iso(),
    }
}

fn sites_refreshed_event_from_output(output: &SitesRefreshOutput) -> SitesRefreshedEvent {
    SitesRefreshedEvent {
        refresh_id: output.refresh_id.clone(),
        site: trellis_sdk_demo_service::types::SitesRefreshedEventSite {
            site_id: output.site.site_id.clone(),
            site_name: output.site.site_name.clone(),
            open_inspections: output.site.open_inspections,
            overdue_inspections: output.site.overdue_inspections,
            latest_status: output.site.latest_status.clone(),
            last_report_at: output.site.last_report_at.clone(),
        },
        refreshed_at: now_iso(),
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use futures_util::StreamExt;
    use serde::de::DeserializeOwned;
    use serde::Serialize;
    use trellis_auth::{AuthValidateRequestRequest, AuthValidateRequestResponse};
    use trellis_client::TrellisClientError;
    use trellis_sdk_demo_service::operations;
    use trellis_sdk_demo_service::rpc;
    use trellis_service::{OperationDescriptor, RpcDescriptor, UploadTransferChunk};

    use super::*;

    fn args() -> Args {
        Args {
            contract: false,
            trellis_url: None,
            seed: None,
        }
    }

    #[derive(Clone)]
    struct FakeAuthValidatorClient {
        allowed: bool,
        seen_subjects: Arc<Mutex<Vec<String>>>,
    }

    impl AuthRequestValidatorClientPort for FakeAuthValidatorClient {
        fn auth_validate_request<'a>(
            &'a self,
            input: &'a AuthValidateRequestRequest,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<AuthValidateRequestResponse, TrellisClientError>>
                    + Send
                    + 'a,
            >,
        > {
            self.seen_subjects
                .lock()
                .expect("seen subjects lock")
                .push(input.subject.clone());
            Box::pin(async move {
                Ok(AuthValidateRequestResponse {
                    allowed: self.allowed,
                    caller: serde_json::json!({ "type": "service", "id": "demo" }),
                    inbox_prefix: "_INBOX.demo".to_string(),
                })
            })
        }
    }

    #[tokio::test]
    async fn demo_request_validator_auth_variant_delegates_to_auth_adapter() {
        let seen_subjects = Arc::new(Mutex::new(Vec::new()));
        let validator =
            DemoRequestValidator::Auth(AuthRequestValidatorAdapter::new(FakeAuthValidatorClient {
                allowed: true,
                seen_subjects: Arc::clone(&seen_subjects),
            }));

        let allowed = validator
            .validate(
                "transfer.v1.Upload.demo",
                &Bytes::from_static(b"chunk"),
                &RequestContext {
                    subject: "transfer.v1.Upload.demo".to_string(),
                    session_key: Some("demo-session".to_string()),
                    proof: Some("proof".to_string()),
                    reply_to: None,
                },
            )
            .await
            .expect("auth adapter result");

        assert!(allowed);
        assert_eq!(
            seen_subjects.lock().expect("seen subjects lock").as_slice(),
            ["transfer.v1.Upload.demo"]
        );
    }

    #[test]
    fn runtime_mode_accepts_authenticated_args() {
        let mut args = args();
        args.trellis_url = Some("http://localhost:5173".to_string());
        args.seed = Some("seed".to_string());

        assert_eq!(
            runtime_mode(&args).expect("runtime mode"),
            RuntimeMode::Authenticated {
                trellis_url: "http://localhost:5173".to_string(),
                seed: "seed".to_string(),
            }
        );
    }

    #[test]
    fn runtime_mode_requires_complete_authenticated_args() {
        let mut args = args();
        args.trellis_url = Some("http://localhost:5173".to_string());

        let error = runtime_mode(&args).expect_err("missing seed should fail");

        assert!(error.to_string().contains("--seed"));
    }

    async fn call<D>(router: &Router, input: D::Input) -> D::Output
    where
        D: RpcDescriptor,
        D::Input: Serialize,
        D::Output: DeserializeOwned,
    {
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));
        let response = router
            .handle_request(D::SUBJECT, payload, RequestContext::default())
            .await
            .expect("handler response");
        serde_json::from_slice(&response).expect("response json")
    }

    async fn wait_operation(
        router: &Router,
        subject: &str,
        operation_id: String,
    ) -> serde_json::Value {
        let payload = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "action": "wait",
                "operationId": operation_id,
            }))
            .expect("control json"),
        );
        let response = router
            .handle_request(
                &trellis_service::control_subject(subject),
                payload,
                RequestContext::default(),
            )
            .await
            .expect("wait response");
        serde_json::from_slice(&response).expect("wait json")
    }

    async fn watch_operation(
        router: &Router,
        subject: &str,
        operation_id: String,
    ) -> Vec<serde_json::Value> {
        let payload = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "action": "watch",
                "operationId": operation_id,
            }))
            .expect("control json"),
        );
        router
            .handle_request_frames(
                &trellis_service::control_subject(subject),
                payload,
                RequestContext::default(),
            )
            .await
            .expect("watch response")
            .into_iter()
            .map(|frame| serde_json::from_slice(&frame).expect("watch json"))
            .collect()
    }

    #[tokio::test]
    async fn router_serves_generated_rpc_descriptors() {
        let router = build_router();
        let response: SitesListResponse =
            call::<rpc::SitesListRpc>(&router, SitesListRequest(BTreeMap::new())).await;

        assert_eq!(response.sites[0].site_id, "site-west-yard");
    }

    #[tokio::test]
    async fn router_returns_download_grant_shape() {
        let router = build_router();
        let response: EvidenceDownloadResponse = call::<rpc::EvidenceDownloadRpc>(
            &router,
            EvidenceDownloadRequest {
                key: "site-north/transformer-a/photo.txt".to_string(),
            },
        )
        .await;

        assert_eq!(response.transfer.direction, "receive");
        assert_eq!(response.transfer.info.size, 42);
    }

    #[tokio::test]
    async fn repeated_downloads_return_distinct_transfer_subjects() {
        let router = build_router();
        let first: EvidenceDownloadResponse = call::<rpc::EvidenceDownloadRpc>(
            &router,
            EvidenceDownloadRequest {
                key: "site-north/transformer-a/photo.txt".to_string(),
            },
        )
        .await;
        let second: EvidenceDownloadResponse = call::<rpc::EvidenceDownloadRpc>(
            &router,
            EvidenceDownloadRequest {
                key: "site-north/transformer-a/photo.txt".to_string(),
            },
        )
        .await;

        assert_ne!(first.transfer.transfer_id, second.transfer.transfer_id);
        assert_ne!(first.transfer.subject, second.transfer.subject);
    }

    #[tokio::test]
    async fn router_rejects_missing_download_before_grant() {
        let router = build_router();
        let payload = Bytes::from(
            serde_json::to_vec(&EvidenceDownloadRequest {
                key: "missing/photo.txt".to_string(),
            })
            .expect("request json"),
        );

        let error = router
            .handle_request(
                rpc::EvidenceDownloadRpc::SUBJECT,
                payload,
                RequestContext::default(),
            )
            .await
            .expect_err("missing object");

        assert!(matches!(
            error,
            ServerError::TransferObjectMissing { store, key }
                if store == UPLOADS_STORE && key == "missing/photo.txt"
        ));
    }

    #[tokio::test]
    async fn router_uses_injected_evidence_store_for_download_bytes() {
        let router = build_router_with_selected_evidence_store(
            None,
            demo_resources(),
            SelectedEvidenceStore::Demo(DemoStore {
                objects: Arc::new(Mutex::new(BTreeMap::new())),
            }),
        );
        let payload = Bytes::from(
            serde_json::to_vec(&EvidenceDownloadRequest {
                key: "site-north/transformer-a/photo.txt".to_string(),
            })
            .expect("request json"),
        );

        let error = router
            .handle_request(
                rpc::EvidenceDownloadRpc::SUBJECT,
                payload,
                RequestContext::default(),
            )
            .await
            .expect_err("selected store is empty");

        assert!(matches!(
            error,
            ServerError::TransferObjectMissing { store, key }
                if store == UPLOADS_STORE && key == "site-north/transformer-a/photo.txt"
        ));
    }

    #[tokio::test]
    async fn router_returns_upload_transfer_in_accepted_envelope() {
        let router = build_router();
        let input = EvidenceUploadInput {
            key: "site-north/transformer-a/new-photo.txt".to_string(),
            content_type: Some("text/plain".to_string()),
            evidence_type: "photo".to_string(),
            metadata: None,
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));
        let response = router
            .handle_request(
                operations::EvidenceUploadOperation::SUBJECT,
                payload,
                RequestContext {
                    subject: operations::EvidenceUploadOperation::SUBJECT.to_string(),
                    session_key: Some("demo-session".to_string()),
                    proof: Some("proof".to_string()),
                    reply_to: None,
                },
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");

        assert_eq!(body["kind"], "accepted");
        assert_eq!(body["transfer"]["direction"], "send");
        assert_eq!(body["transfer"]["sessionKey"], "demo-session");
        assert_eq!(body["transfer"]["contentType"], "text/plain");
    }

    #[tokio::test]
    async fn router_uses_injected_resource_bindings_for_transfer_limits() {
        let mut resources = demo_resources();
        resources
            .store
            .get_mut(UPLOADS_STORE)
            .expect("uploads binding")
            .max_object_bytes = Some(1024);
        let router = build_router_with_nats_and_resources(None, resources);
        let input = EvidenceUploadInput {
            key: "site-north/transformer-a/injected-limit.txt".to_string(),
            content_type: Some("text/plain".to_string()),
            evidence_type: "photo".to_string(),
            metadata: None,
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));

        let response = router
            .handle_request(
                operations::EvidenceUploadOperation::SUBJECT,
                payload,
                RequestContext {
                    subject: operations::EvidenceUploadOperation::SUBJECT.to_string(),
                    session_key: Some("demo-session".to_string()),
                    proof: Some("proof".to_string()),
                    reply_to: None,
                },
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");

        assert_eq!(body["transfer"]["maxBytes"], 1024);
    }

    #[tokio::test]
    async fn repeated_upload_starts_return_distinct_operation_ids() {
        let router = build_router();

        async fn start_upload(router: &Router, key: &str) -> serde_json::Value {
            let input = EvidenceUploadInput {
                key: key.to_string(),
                content_type: Some("text/plain".to_string()),
                evidence_type: "photo".to_string(),
                metadata: None,
            };
            let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));
            let response = router
                .handle_request(
                    operations::EvidenceUploadOperation::SUBJECT,
                    payload,
                    RequestContext {
                        subject: operations::EvidenceUploadOperation::SUBJECT.to_string(),
                        session_key: Some("demo-session".to_string()),
                        proof: Some("proof".to_string()),
                        reply_to: None,
                    },
                )
                .await
                .expect("handler response");
            serde_json::from_slice(&response).expect("response json")
        }

        let first = start_upload(&router, "uploads/first.txt").await;
        let second = start_upload(&router, "uploads/second.txt").await;

        assert_ne!(first["ref"]["id"], second["ref"]["id"]);
        assert_ne!(first["transfer"]["subject"], second["transfer"]["subject"]);
    }

    #[tokio::test]
    async fn upload_existing_key_reuses_existing_evidence_row() {
        let router = build_router();
        let input = EvidenceUploadInput {
            key: "site-north/transformer-a/photo.txt".to_string(),
            content_type: Some("text/plain".to_string()),
            evidence_type: "photo".to_string(),
            metadata: None,
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));
        let response = router
            .handle_request(
                operations::EvidenceUploadOperation::SUBJECT,
                payload,
                RequestContext {
                    subject: operations::EvidenceUploadOperation::SUBJECT.to_string(),
                    session_key: Some("demo-session".to_string()),
                    proof: Some("proof".to_string()),
                    reply_to: None,
                },
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");
        assert_eq!(body["snapshot"]["state"], "running");
        assert_eq!(body["snapshot"]["output"], serde_json::Value::Null);

        let evidence: EvidenceListResponse = call::<rpc::EvidenceListRpc>(
            &router,
            EvidenceListRequest {
                prefix: Some("site-north/transformer-a/photo.txt".to_string()),
            },
        )
        .await;
        assert_eq!(evidence.evidence.len(), 1);
        assert_eq!(evidence.evidence[0].evidence_id, "ev-1001");
    }

    #[tokio::test]
    async fn sites_refresh_uses_private_refresh_job_path() {
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let router = build_router_with_nats_resources_store_and_jobs(
            None,
            demo_resources(),
            None,
            None,
            None,
            Some(Arc::clone(&recorded)),
        );
        let input = SitesRefreshInput {
            site_id: "site-west-yard".to_string(),
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));

        let response = router
            .handle_request(
                operations::SitesRefreshOperation::SUBJECT,
                payload,
                RequestContext::default(),
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");

        assert_eq!(body["kind"], "accepted");
        assert_eq!(body["snapshot"]["state"], "running");
        let operation_id = body["ref"]["id"]
            .as_str()
            .expect("operation id")
            .to_string();
        let terminal = wait_operation(
            &router,
            operations::SitesRefreshOperation::SUBJECT,
            operation_id,
        )
        .await;
        assert_eq!(
            terminal["snapshot"]["output"]["site"]["lastReportAt"],
            FIXED_NOW
        );
        let calls = recorded.lock().expect("recorded jobs lock").clone();
        let event_types: Vec<_> = calls.iter().map(|call| call.event_type).collect();
        assert_eq!(
            event_types,
            vec![
                trellis_jobs::JobEventType::Created,
                trellis_jobs::JobEventType::Started,
                trellis_jobs::JobEventType::Progress,
                trellis_jobs::JobEventType::Completed,
            ]
        );
        assert!(calls
            .iter()
            .all(|call| call.subject.contains(REFRESH_SITE_SUMMARY_JOB)));
    }

    #[tokio::test]
    async fn sites_refresh_watch_emits_progress_and_completed_frames() {
        let router = build_router();
        let input = SitesRefreshInput {
            site_id: "site-west-yard".to_string(),
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));

        let response = router
            .handle_request(
                operations::SitesRefreshOperation::SUBJECT,
                payload,
                RequestContext::default(),
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");
        let frames = watch_operation(
            &router,
            operations::SitesRefreshOperation::SUBJECT,
            body["ref"]["id"]
                .as_str()
                .expect("operation id")
                .to_string(),
        )
        .await;

        assert_eq!(frames[0]["kind"], "snapshot");
        let event_types: Vec<_> = frames
            .iter()
            .filter_map(|frame| frame["event"]["type"].as_str())
            .collect();
        assert!(event_types.contains(&"progress"));
        assert_eq!(event_types.last(), Some(&"completed"));
        assert!(frames
            .iter()
            .any(|frame| { frame["event"]["progress"]["stage"] == "refreshing" }));
    }

    #[tokio::test]
    async fn sites_refresh_updates_selected_memory_site_summary_store() {
        let router = build_router();
        let input = SitesRefreshInput {
            site_id: "site-west-yard".to_string(),
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));

        let response = router
            .handle_request(
                operations::SitesRefreshOperation::SUBJECT,
                payload,
                RequestContext::default(),
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");
        wait_operation(
            &router,
            operations::SitesRefreshOperation::SUBJECT,
            body["ref"]["id"]
                .as_str()
                .expect("operation id")
                .to_string(),
        )
        .await;

        let listed: SitesListResponse =
            call::<rpc::SitesListRpc>(&router, SitesListRequest(BTreeMap::new())).await;
        assert_eq!(listed.sites[0].last_report_at, FIXED_NOW);

        let fetched: SitesGetResponse = call::<rpc::SitesGetRpc>(
            &router,
            SitesGetRequest {
                site_id: "site-west-yard".to_string(),
            },
        )
        .await;
        assert_eq!(fetched.site.expect("site exists").last_report_at, FIXED_NOW);
    }

    #[tokio::test]
    async fn upload_after_delete_allocates_new_evidence_id() {
        let router = build_router();
        let _: EvidenceDeleteResponse = call::<rpc::EvidenceDeleteRpc>(
            &router,
            EvidenceDeleteRequest {
                key: "site-north/transformer-a/photo.txt".to_string(),
            },
        )
        .await;

        let input = EvidenceUploadInput {
            key: "site-north/transformer-a/replacement.txt".to_string(),
            content_type: Some("text/plain".to_string()),
            evidence_type: "photo".to_string(),
            metadata: None,
        };
        let payload = Bytes::from(serde_json::to_vec(&input).expect("request json"));
        let response = router
            .handle_request(
                operations::EvidenceUploadOperation::SUBJECT,
                payload,
                RequestContext {
                    subject: operations::EvidenceUploadOperation::SUBJECT.to_string(),
                    session_key: Some("demo-session".to_string()),
                    proof: Some("proof".to_string()),
                    reply_to: None,
                },
            )
            .await
            .expect("handler response");
        let body: serde_json::Value = serde_json::from_slice(&response).expect("response json");

        assert_eq!(body["snapshot"]["state"], "running");
        assert_eq!(body["snapshot"]["output"], serde_json::Value::Null);
    }

    #[tokio::test]
    async fn unknown_operation_id_returns_not_found() {
        let router = build_router();
        let payload = Bytes::from(
            serde_json::to_vec(&serde_json::json!({
                "action": "get",
                "operationId": "op-missing"
            }))
            .expect("request json"),
        );

        let error = router
            .handle_request(
                "operations.v1.Evidence.Upload.control",
                payload,
                RequestContext::default(),
            )
            .await
            .expect_err("missing operation");

        assert!(matches!(
            error,
            ServerError::OperationNotFound { operation_id } if operation_id == "op-missing"
        ));
    }

    #[tokio::test]
    async fn upload_transfer_session_writes_store_and_updates_evidence_size() {
        let state = Arc::new(Mutex::new(sample_state()));
        {
            let mut state = state.lock().expect("demo state lock");
            state.evidence.push(Evidence {
                evidence_id: "ev-test".to_string(),
                key: "uploads/test.txt".to_string(),
                size: 0,
                content_type: Some("text/plain".to_string()),
                evidence_type: "photo".to_string(),
                file_name: None,
                uploaded_at: FIXED_NOW.to_string(),
            });
            let snapshot: OperationSnapshot<EvidenceUploadProgress, EvidenceUploadOutput> =
                OperationSnapshot {
                    revision: 1,
                    state: OperationState::Running,
                    progress: Some(EvidenceUploadProgress {
                        stage: "transfer".to_string(),
                        message: "Upload transfer grant is ready".to_string(),
                    }),
                    transfer: None,
                    output: None,
                    ..Default::default()
                };
            state.operations.insert(
                "op-upload-test".to_string(),
                serde_json::to_value(&snapshot).expect("snapshot json"),
            );
            state.operation_history.insert(
                "op-upload-test".to_string(),
                vec![serde_json::to_value(snapshot).expect("snapshot json")],
            );
        }
        let store = EvidenceStore {
            inner: SelectedEvidenceStore::Demo(DemoStore {
                objects: Arc::new(Mutex::new(BTreeMap::new())),
            }),
            state: Arc::clone(&state),
            upload_evidence_id: Some("ev-test".to_string()),
            upload_operation_id: Some("op-upload-test".to_string()),
            publisher: None,
        };
        let plan = plan_upload_transfer_grant(TransferUploadGrantArgs {
            service_name: SERVICE_NAME,
            session_key: "demo-session",
            resources: &demo_resources(),
            store: UPLOADS_STORE,
            key: "uploads/test.txt",
            transfer_id: "upload-ev-test",
            expires_at: TRANSFER_EXPIRES_AT,
            chunk_bytes: TRANSFER_CHUNK_BYTES,
            max_bytes: Some(MAX_UPLOAD_BYTES as u64),
            content_type: Some("text/plain"),
            metadata: BTreeMap::new(),
        })
        .expect("upload plan");
        let mut session = UploadTransferSession::new(plan, FIXED_NOW);

        let body_chunk = UploadTransferChunk {
            seq: 0,
            payload: Bytes::from_static(b"hello transfer"),
            eof: false,
        };
        let progress = session.progress_for_chunk(&body_chunk);
        session
            .receive(&store, body_chunk)
            .await
            .expect("transfer body chunk");
        {
            let mut state_guard = state.lock().expect("demo state lock");
            progress_upload_transfer_operation(&mut state_guard, "op-upload-test", progress);
        }
        session
            .receive(
                &store,
                UploadTransferChunk {
                    seq: 1,
                    payload: Bytes::new(),
                    eof: true,
                },
            )
            .await
            .expect("transfer eof");

        let state_guard = state.lock().expect("demo state lock");
        let evidence = state_guard
            .evidence
            .iter()
            .find(|evidence| evidence.key == "uploads/test.txt")
            .expect("evidence exists");
        assert_eq!(evidence.size, 14);
        assert_eq!(evidence.file_name.as_deref(), Some("test.txt"));
        assert_eq!(
            state_guard.operations["op-upload-test"]["state"],
            "completed"
        );
        assert_eq!(
            state_guard.operations["op-upload-test"]["output"]["size"],
            14
        );
        let history = state_guard
            .operation_history
            .get("op-upload-test")
            .expect("upload operation history");
        assert_eq!(
            history.last().expect("terminal snapshot")["state"],
            "completed"
        );
        assert_eq!(history[1]["state"], "running");
        assert_eq!(history[1]["transfer"]["chunkIndex"], 0);
        assert_eq!(history[1]["transfer"]["chunkBytes"], 14);
        assert_eq!(history[1]["transfer"]["transferredBytes"], 14);
        drop(state_guard);

        let mut watch = operation_watch::<EvidenceUploadProgress, EvidenceUploadOutput>(
            Arc::clone(&state),
            "op-upload-test".to_string(),
        );
        let first = watch
            .next()
            .await
            .expect("initial upload snapshot")
            .expect("initial snapshot ok");
        let second = watch
            .next()
            .await
            .expect("transfer upload snapshot")
            .expect("transfer snapshot ok");
        let third = watch
            .next()
            .await
            .expect("terminal upload snapshot")
            .expect("terminal snapshot ok");
        assert_eq!(first.state, OperationState::Running);
        assert_eq!(second.state, OperationState::Running);
        assert_eq!(
            second
                .transfer
                .expect("transfer progress")
                .transferred_bytes,
            14
        );
        assert_eq!(third.state, OperationState::Completed);
    }

    #[tokio::test]
    async fn upload_transfer_updates_pending_duplicate_key_evidence() {
        let state = Arc::new(Mutex::new(sample_state()));
        let store = EvidenceStore {
            inner: SelectedEvidenceStore::Demo(DemoStore {
                objects: Arc::new(Mutex::new(sample_store_objects())),
            }),
            state: Arc::clone(&state),
            upload_evidence_id: Some("ev-duplicate".to_string()),
            upload_operation_id: None,
            publisher: None,
        };
        let duplicate_key = "site-north/transformer-a/photo.txt";
        {
            let mut state = state.lock().expect("demo state lock");
            state.evidence.push(Evidence {
                evidence_id: "ev-duplicate".to_string(),
                key: duplicate_key.to_string(),
                size: 0,
                content_type: Some("text/plain".to_string()),
                evidence_type: "photo".to_string(),
                file_name: None,
                uploaded_at: FIXED_NOW.to_string(),
            });
        }

        store
            .write(duplicate_key, Bytes::from_static(b"replacement"))
            .await
            .expect("write duplicate");

        let state = state.lock().expect("demo state lock");
        let original = state
            .evidence
            .iter()
            .find(|evidence| evidence.evidence_id == "ev-1001")
            .expect("original evidence");
        let duplicate = state
            .evidence
            .iter()
            .find(|evidence| evidence.evidence_id == "ev-duplicate")
            .expect("duplicate evidence");

        assert_eq!(original.size, 42);
        assert_eq!(duplicate.size, 11);
    }
}
