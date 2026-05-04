use std::{collections::BTreeMap, sync::Arc};

use bytes::Bytes;
use tokio::sync::Mutex;
use trellis_service::{
    BootstrapBinding, BootstrapBindingInfo, ConnectedService, JobsQueueResourceBinding,
    JobsResourceBinding, JobsSchemaRef, KvResourceBinding, KvResourceClient, ResourceRuntimeClient,
    ServerError, ServiceResourceBindings, StoreResourceBinding, StoreResourceClient,
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
    values: Arc<Mutex<BTreeMap<String, Bytes>>>,
}

impl KvResourceClient for FakeKvClient {
    async fn get(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        Ok(self.values.lock().await.get(key).cloned())
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
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
