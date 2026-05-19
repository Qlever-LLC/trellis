use std::{
    collections::BTreeMap,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use time::OffsetDateTime;
use tokio::sync::{mpsc, Mutex};
use trellis_service::{
    BootstrapBinding, BootstrapBindingInfo, ConnectedService, JobsQueueResourceBinding,
    JobsResourceBinding, JobsSchemaRef, KvResourceBinding, KvResourceClient, KvResourceEntry,
    KvResourceOperation, ResourceRuntimeClient, ServerError, ServiceResourceBindings,
    StoreResourceBinding, StoreResourceClient, StoreWaitOptions,
};

#[derive(Debug, Clone)]
struct BoundService {
    binding: BootstrapBinding,
    resources: ServiceResourceBindings,
}

impl BootstrapBindingInfo for BoundService {
    fn bootstrap_binding(&self) -> BootstrapBinding {
        self.binding.clone()
    }

    fn resource_bindings(&self) -> ServiceResourceBindings {
        self.resources.clone()
    }
}

fn resources() -> ServiceResourceBindings {
    ServiceResourceBindings {
        kv: BTreeMap::from([(
            "drafts".to_string(),
            KvResourceBinding {
                bucket: "svc_drafts".to_string(),
                history: 10,
                max_value_bytes: Some(16_384),
                ttl_ms: 86_400_000,
            },
        )]),
        store: BTreeMap::from([(
            "evidence".to_string(),
            StoreResourceBinding {
                name: "svc_evidence".to_string(),
                max_object_bytes: Some(10_485_760),
                max_total_bytes: None,
                ttl_ms: 0,
            },
        )]),
        jobs: Some(JobsResourceBinding {
            namespace: "field-ops".to_string(),
            work_stream: Some("JOBS_WORK".to_string()),
            queues: BTreeMap::from([(
                "report-finalize".to_string(),
                JobsQueueResourceBinding {
                    queue_type: "report-finalize".to_string(),
                    publish_prefix: "trellis.jobs.field-ops.report-finalize".to_string(),
                    work_subject: "trellis.work.field-ops.report-finalize".to_string(),
                    consumer_name: "field-ops-report-finalize".to_string(),
                    payload: JobsSchemaRef {
                        schema: "ReportFinalizePayload".to_string(),
                    },
                    result: Some(JobsSchemaRef {
                        schema: "ReportFinalizeResult".to_string(),
                    }),
                    max_deliver: 5,
                    backoff_ms: vec![5_000, 30_000],
                    ack_wait_ms: 60_000,
                    default_deadline_ms: Some(120_000),
                    progress: true,
                    logs: true,
                    dlq: true,
                    concurrency: 2,
                },
            )]),
        }),
    }
}

fn connected_service() -> ConnectedService<'static, BoundService, (), ()> {
    let binding = BootstrapBinding {
        contract_id: "field-ops@v1".to_string(),
        digest: "sha256:fieldops".to_string(),
    };
    ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding,
            resources: resources(),
        },
        (),
        (),
    )
}

fn connected_service_with_runtime(
    runtime: FakeRuntime,
) -> ConnectedService<'static, BoundService, (), FakeRuntime> {
    let binding = BootstrapBinding {
        contract_id: "field-ops@v1".to_string(),
        digest: "sha256:fieldops".to_string(),
    };
    ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding,
            resources: resources(),
        },
        runtime,
        (),
    )
}

#[derive(Debug, Clone, Default)]
struct FakeRuntime {
    kv: FakeKvClient,
    store: FakeStoreClient,
}

impl ResourceRuntimeClient for FakeRuntime {
    type Kv = FakeKvClient;
    type Store = FakeStoreClient;

    async fn open_kv(&self, binding: &KvResourceBinding) -> Result<Self::Kv, ServerError> {
        assert_eq!(binding.bucket, "svc_drafts");
        Ok(self.kv.clone())
    }

    async fn open_store(&self, binding: &StoreResourceBinding) -> Result<Self::Store, ServerError> {
        assert_eq!(binding.name, "svc_evidence");
        Ok(self.store.clone())
    }
}

#[derive(Debug, Clone, Default)]
struct FakeKvClient {
    state: Arc<Mutex<FakeKvState>>,
}

#[derive(Debug, Default)]
struct FakeKvState {
    revision: u64,
    values: BTreeMap<String, KvResourceEntry>,
    watchers: BTreeMap<String, Vec<mpsc::UnboundedSender<KvResourceEntry>>>,
}

#[derive(Debug)]
struct FakeKvWatch {
    rx: mpsc::UnboundedReceiver<KvResourceEntry>,
}

impl Stream for FakeKvWatch {
    type Item = Result<KvResourceEntry, ServerError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx).map(|entry| entry.map(Ok))
    }
}

impl FakeKvState {
    fn next_entry(
        &mut self,
        key: &str,
        value: Bytes,
        operation: KvResourceOperation,
    ) -> KvResourceEntry {
        self.revision += 1;
        KvResourceEntry {
            key: key.to_string(),
            value,
            revision: self.revision,
            timestamp: OffsetDateTime::now_utc(),
            operation,
        }
    }

    fn notify(&mut self, entry: &KvResourceEntry) {
        if let Some(watchers) = self.watchers.get_mut(&entry.key) {
            watchers.retain(|watcher| watcher.send(entry.clone()).is_ok());
        }
    }
}

impl KvResourceClient for FakeKvClient {
    type Watch = FakeKvWatch;

    async fn get(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        Ok(self
            .state
            .lock()
            .await
            .values
            .get(key)
            .filter(|entry| entry.operation == KvResourceOperation::Update)
            .map(|entry| entry.value.clone()))
    }

    async fn get_entry(&self, key: &str) -> Result<Option<KvResourceEntry>, ServerError> {
        Ok(self.state.lock().await.values.get(key).cloned())
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        let mut state = self.state.lock().await;
        let entry = state.next_entry(key, value, KvResourceOperation::Update);
        state.values.insert(key.to_string(), entry.clone());
        state.notify(&entry);
        Ok(())
    }

    async fn update_revision(
        &self,
        key: &str,
        value: Bytes,
        revision: u64,
    ) -> Result<u64, ServerError> {
        let mut state = self.state.lock().await;
        let actual = state.values.get(key).map(|entry| entry.revision);
        if actual != Some(revision) {
            return Err(ServerError::KvRevisionMismatch {
                key: key.to_string(),
                expected: revision,
                actual,
            });
        }
        let entry = state.next_entry(key, value, KvResourceOperation::Update);
        let revision = entry.revision;
        state.values.insert(key.to_string(), entry.clone());
        state.notify(&entry);
        Ok(revision)
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        Ok(self
            .state
            .lock()
            .await
            .values
            .iter()
            .filter(|(_, entry)| entry.operation == KvResourceOperation::Update)
            .map(|(key, _)| key.clone())
            .collect())
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        let mut state = self.state.lock().await;
        let entry = state.next_entry(key, Bytes::new(), KvResourceOperation::Delete);
        state.values.insert(key.to_string(), entry.clone());
        state.notify(&entry);
        Ok(())
    }

    async fn delete_revision(&self, key: &str, revision: u64) -> Result<(), ServerError> {
        let mut state = self.state.lock().await;
        let actual = state.values.get(key).map(|entry| entry.revision);
        if actual != Some(revision) {
            return Err(ServerError::KvRevisionMismatch {
                key: key.to_string(),
                expected: revision,
                actual,
            });
        }
        let entry = state.next_entry(key, Bytes::new(), KvResourceOperation::Delete);
        state.values.insert(key.to_string(), entry.clone());
        state.notify(&entry);
        Ok(())
    }

    async fn watch(&self, key: &str) -> Result<Self::Watch, ServerError> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.state
            .lock()
            .await
            .watchers
            .entry(key.to_string())
            .or_default()
            .push(tx);
        Ok(FakeKvWatch { rx })
    }
}

#[derive(Debug, Clone, Default)]
struct FakeStoreClient {
    values: Arc<Mutex<BTreeMap<String, Bytes>>>,
}

impl StoreResourceClient for FakeStoreClient {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        Ok(self.values.lock().await.get(key).cloned())
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        self.values.lock().await.insert(key.to_string(), value);
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        Ok(self.values.lock().await.keys().cloned().collect())
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.values.lock().await.remove(key);
        Ok(())
    }
}

#[test]
fn connected_service_exposes_typed_resource_bindings_from_bootstrap_binding() {
    let connected = connected_service();

    assert_eq!(connected.resources().kv.len(), 1);
    assert_eq!(
        connected.kv_binding("drafts").expect("kv").bucket,
        "svc_drafts"
    );
    assert_eq!(
        connected.store_binding("evidence").expect("store").name,
        "svc_evidence"
    );
    assert_eq!(
        connected.bootstrap_binding(),
        &connected.binding().bootstrap_binding()
    );
    let jobs = connected.jobs_binding().expect("jobs");
    assert_eq!(jobs.namespace, "field-ops");
    let queue = jobs.queues.get("report-finalize").expect("queue");
    assert_eq!(queue.work_subject, "trellis.work.field-ops.report-finalize");
    assert_eq!(queue.payload.schema, "ReportFinalizePayload");
    assert_eq!(
        queue.result.as_ref().expect("result schema").schema,
        "ReportFinalizeResult"
    );
    assert!(queue.dlq);
}

#[test]
fn connected_service_resource_lookup_reports_missing_resources() {
    let connected = connected_service();

    let error = connected.kv_binding("missing").expect_err("missing kv");
    assert!(matches!(
        error,
        ServerError::MissingResourceBinding { service_name, resource_kind, resource_name }
            if service_name == "field-ops-service"
                && resource_kind == "kv"
                && resource_name == "missing"
    ));
}

#[tokio::test]
async fn connected_service_resource_open_reports_missing_alias() {
    let connected = connected_service_with_runtime(FakeRuntime::default());

    let error = connected.store("missing").await.expect_err("missing store");
    assert!(matches!(
        error,
        ServerError::MissingResourceBinding { service_name, resource_kind, resource_name }
            if service_name == "field-ops-service"
                && resource_kind == "store"
                && resource_name == "missing"
    ));
}

#[tokio::test]
async fn connected_service_resource_open_reports_invalid_kv_binding() {
    let mut bindings = resources();
    bindings.kv.insert(
        "broken".to_string(),
        KvResourceBinding {
            bucket: "".to_string(),
            history: 1,
            max_value_bytes: None,
            ttl_ms: 0,
        },
    );
    let connected = ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding: BootstrapBinding {
                contract_id: "field-ops@v1".to_string(),
                digest: "sha256:fieldops".to_string(),
            },
            resources: bindings,
        },
        FakeRuntime::default(),
        (),
    );

    let error = connected.kv("broken").await.expect_err("invalid kv");
    assert!(matches!(
        error,
        ServerError::InvalidResourceBinding { service_name, resource_kind, resource_name, reason }
            if service_name == "field-ops-service"
                && resource_kind == "kv"
                && resource_name == "broken"
                && reason == "bucket name is empty"
    ));
}

#[tokio::test]
async fn connected_service_resource_open_rejects_invalid_kv_bucket_name() {
    let mut bindings = resources();
    bindings.kv.insert(
        "broken".to_string(),
        KvResourceBinding {
            bucket: "svc drafts".to_string(),
            history: 1,
            max_value_bytes: None,
            ttl_ms: 0,
        },
    );
    let connected = ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding: BootstrapBinding {
                contract_id: "field-ops@v1".to_string(),
                digest: "sha256:fieldops".to_string(),
            },
            resources: bindings,
        },
        FakeRuntime::default(),
        (),
    );

    let error = connected.kv("broken").await.expect_err("invalid kv");
    assert!(matches!(
        error,
        ServerError::InvalidResourceBinding { service_name, resource_kind, resource_name, reason }
            if service_name == "field-ops-service"
                && resource_kind == "kv"
                && resource_name == "broken"
                && reason.contains("ASCII letters")
    ));
}

#[tokio::test]
async fn connected_service_resource_open_reports_invalid_store_binding() {
    let mut bindings = resources();
    bindings.store.insert(
        "broken".to_string(),
        StoreResourceBinding {
            name: "svc_broken".to_string(),
            max_object_bytes: Some(-1),
            max_total_bytes: None,
            ttl_ms: 0,
        },
    );
    let connected = ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding: BootstrapBinding {
                contract_id: "field-ops@v1".to_string(),
                digest: "sha256:fieldops".to_string(),
            },
            resources: bindings,
        },
        FakeRuntime::default(),
        (),
    );

    let error = connected.store("broken").await.expect_err("invalid store");
    assert!(matches!(
        error,
        ServerError::InvalidResourceBinding { service_name, resource_kind, resource_name, reason }
            if service_name == "field-ops-service"
                && resource_kind == "store"
                && resource_name == "broken"
                && reason == "max_object_bytes must not be negative"
    ));
}

#[tokio::test]
async fn connected_service_resource_open_rejects_invalid_store_name() {
    let mut bindings = resources();
    bindings.store.insert(
        "broken".to_string(),
        StoreResourceBinding {
            name: "svc.evidence".to_string(),
            max_object_bytes: None,
            max_total_bytes: None,
            ttl_ms: 0,
        },
    );
    let connected = ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding: BootstrapBinding {
                contract_id: "field-ops@v1".to_string(),
                digest: "sha256:fieldops".to_string(),
            },
            resources: bindings,
        },
        FakeRuntime::default(),
        (),
    );

    let error = connected.store("broken").await.expect_err("invalid store");
    assert!(matches!(
        error,
        ServerError::InvalidResourceBinding { service_name, resource_kind, resource_name, reason }
            if service_name == "field-ops-service"
                && resource_kind == "store"
                && resource_name == "broken"
                && reason.contains("ASCII letters")
    ));
}

#[tokio::test]
async fn kv_resource_handle_reads_writes_lists_and_deletes_bytes() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let drafts = connected.kv("drafts").await.expect("kv handle");

    drafts
        .put("report", Bytes::from_static(b"draft"))
        .await
        .expect("put");
    assert_eq!(
        drafts.get("report").await.expect("get"),
        Some(Bytes::from_static(b"draft"))
    );
    assert_eq!(
        drafts.list().await.expect("list"),
        vec!["report".to_string()]
    );
    drafts.delete("report").await.expect("delete");
    assert_eq!(drafts.get("report").await.expect("missing"), None);
}

#[tokio::test]
async fn kv_resource_handle_reads_entry_metadata() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let drafts = connected.kv("drafts").await.expect("kv handle");

    drafts
        .put("report", Bytes::from_static(b"draft"))
        .await
        .expect("put");

    let entry = drafts
        .get_entry("report")
        .await
        .expect("get entry")
        .expect("entry");
    assert_eq!(entry.key, "report");
    assert_eq!(entry.value, Bytes::from_static(b"draft"));
    assert_eq!(entry.revision, 1);
    assert_eq!(entry.operation, KvResourceOperation::Update);
}

#[tokio::test]
async fn kv_resource_handle_watches_updates_and_deletes() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let drafts = connected.kv("drafts").await.expect("kv handle");
    let mut watch = drafts.watch("report").await.expect("watch");

    drafts
        .put("report", Bytes::from_static(b"draft"))
        .await
        .expect("put");
    drafts.delete("report").await.expect("delete");

    let update = watch
        .next()
        .await
        .expect("update event")
        .expect("update event ok");
    assert_eq!(update.operation, KvResourceOperation::Update);
    assert_eq!(update.value, Bytes::from_static(b"draft"));

    let delete = watch
        .next()
        .await
        .expect("delete event")
        .expect("delete event ok");
    assert_eq!(delete.operation, KvResourceOperation::Delete);
    assert_eq!(delete.revision, 2);
}

#[tokio::test]
async fn kv_resource_handle_supports_revision_checked_update_and_delete() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let drafts = connected.kv("drafts").await.expect("kv handle");

    drafts
        .put("report", Bytes::from_static(b"draft"))
        .await
        .expect("put");
    let revision = drafts
        .get_entry("report")
        .await
        .expect("get entry")
        .expect("entry")
        .revision;

    let updated_revision = drafts
        .update_revision("report", Bytes::from_static(b"final"), revision)
        .await
        .expect("update revision");
    assert_eq!(updated_revision, 2);
    assert_eq!(
        drafts.get("report").await.expect("get"),
        Some(Bytes::from_static(b"final"))
    );

    drafts
        .delete_revision("report", updated_revision)
        .await
        .expect("delete revision");
    assert_eq!(drafts.get("report").await.expect("missing"), None);
    assert_eq!(
        drafts
            .get_entry("report")
            .await
            .expect("get delete entry")
            .expect("delete entry")
            .operation,
        KvResourceOperation::Delete
    );
}

#[tokio::test]
async fn kv_resource_handle_reports_revision_checked_delete_failure() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let drafts = connected.kv("drafts").await.expect("kv handle");

    drafts
        .put("report", Bytes::from_static(b"draft"))
        .await
        .expect("put");

    let error = drafts
        .delete_revision("report", 42)
        .await
        .expect_err("revision mismatch");
    assert!(matches!(
        error,
        ServerError::KvRevisionMismatch { key, expected, actual }
            if key == "report" && expected == 42 && actual == Some(1)
    ));
}

#[tokio::test]
async fn kv_resource_watch_drop_unsubscribes_fake_watcher() {
    let runtime = FakeRuntime::default();
    let connected = connected_service_with_runtime(runtime.clone());
    let drafts = connected.kv("drafts").await.expect("kv handle");
    let watch = drafts.watch("report").await.expect("watch");
    drop(watch);

    drafts
        .put("report", Bytes::from_static(b"draft"))
        .await
        .expect("put");

    assert!(runtime
        .kv
        .state
        .lock()
        .await
        .watchers
        .get("report")
        .expect("watcher list")
        .is_empty());
}

#[tokio::test]
async fn store_resource_handle_reads_writes_lists_and_deletes_bytes() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let evidence = connected.store("evidence").await.expect("store handle");

    evidence
        .write("photo.jpg", Bytes::from_static(b"jpeg"))
        .await
        .expect("write");
    assert_eq!(
        evidence.read("photo.jpg").await.expect("read"),
        Some(Bytes::from_static(b"jpeg"))
    );
    assert_eq!(
        evidence.list().await.expect("list"),
        vec!["photo.jpg".to_string()]
    );
    evidence.delete("photo.jpg").await.expect("delete");
    assert_eq!(evidence.read("photo.jpg").await.expect("missing"), None);
}

#[tokio::test]
async fn store_resource_handle_waits_for_object_bytes() {
    let runtime = FakeRuntime::default();
    let connected = connected_service_with_runtime(runtime.clone());
    let evidence = connected.store("evidence").await.expect("store handle");

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(20)).await;
        runtime
            .store
            .write("delayed.txt", Bytes::from_static(b"ready"))
            .await
            .expect("write delayed object");
    });

    let bytes = evidence
        .wait_for(
            "delayed.txt",
            StoreWaitOptions {
                timeout: Some(Duration::from_secs(1)),
                poll_interval: Duration::from_millis(5),
            },
        )
        .await
        .expect("wait for object");
    assert_eq!(bytes, Bytes::from_static(b"ready"));
}

#[tokio::test]
async fn store_resource_handle_wait_times_out_for_missing_object() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let evidence = connected.store("evidence").await.expect("store handle");

    let error = evidence
        .wait_for(
            "missing.txt",
            StoreWaitOptions {
                timeout: Some(Duration::from_millis(15)),
                poll_interval: Duration::from_millis(5),
            },
        )
        .await
        .expect_err("wait timeout");
    assert!(matches!(
        error,
        ServerError::StoreWaitTimeout { service_name, store, key, timeout_ms }
            if service_name == "field-ops-service"
                && store == "evidence"
                && key == "missing.txt"
                && timeout_ms == 15
    ));
}

#[tokio::test]
async fn store_resource_handle_zero_timeout_still_reads_existing_object() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let evidence = connected.store("evidence").await.expect("store handle");
    evidence
        .write("present.txt", Bytes::from_static(b"ready"))
        .await
        .expect("write present object");

    let bytes = evidence
        .wait_for(
            "present.txt",
            StoreWaitOptions {
                timeout: Some(Duration::ZERO),
                poll_interval: Duration::from_millis(5),
            },
        )
        .await
        .expect("immediate wait for present object");

    assert_eq!(bytes, Bytes::from_static(b"ready"));
}

#[tokio::test]
async fn store_resource_handle_wait_can_be_canceled() {
    let connected = connected_service_with_runtime(FakeRuntime::default());
    let evidence = connected.store("evidence").await.expect("store handle");
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(15)).await;
        cancel_tx.send(()).expect("send cancellation");
    });

    let error = evidence
        .wait_for_with_cancel(
            "canceled.txt",
            StoreWaitOptions {
                timeout: Some(Duration::from_secs(1)),
                poll_interval: Duration::from_millis(5),
            },
            async move {
                let _ = cancel_rx.await;
            },
        )
        .await
        .expect_err("wait canceled");
    assert!(matches!(
        error,
        ServerError::StoreWaitCanceled { service_name, store, key }
            if service_name == "field-ops-service"
                && store == "evidence"
                && key == "canceled.txt"
    ));
}

#[test]
fn connected_service_resource_lookup_reports_missing_jobs_binding() {
    let connected = ConnectedService::new(
        "field-ops-service",
        BoundService {
            binding: BootstrapBinding {
                contract_id: "field-ops@v1".to_string(),
                digest: "sha256:fieldops".to_string(),
            },
            resources: ServiceResourceBindings::default(),
        },
        (),
        (),
    );

    let error = connected.jobs_binding().expect_err("missing jobs");
    assert!(matches!(
        error,
        ServerError::MissingResourceBinding { service_name, resource_kind, resource_name }
            if service_name == "field-ops-service"
                && resource_kind == "jobs"
                && resource_name == "jobs"
    ));
}

#[test]
fn default_bootstrap_binding_has_empty_resource_bindings() {
    let binding = BootstrapBinding {
        contract_id: "empty@v1".to_string(),
        digest: "sha256:empty".to_string(),
    };

    assert_eq!(
        binding.resource_bindings(),
        ServiceResourceBindings::default()
    );
}
