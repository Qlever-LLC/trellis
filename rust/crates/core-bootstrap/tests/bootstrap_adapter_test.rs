use std::sync::{Arc, Mutex};

use futures_util::future::{ready, BoxFuture, FutureExt};
use serde_json::json;
use trellis_client::TrellisClientError;
use trellis_core_bootstrap::bootstrap::{
    make_bindings_get_request, map_binding_response, map_catalog_to_contract_refs,
    CoreBootstrapAdapter, CoreBootstrapBinding, CoreBootstrapClientPort,
};
use trellis_sdk_core::types::{
    TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisBindingsGetResponseBinding,
    TrellisBindingsGetResponseBindingResources, TrellisCatalogResponse,
    TrellisCatalogResponseCatalog, TrellisCatalogResponseCatalogContractsItem,
    TrellisContractGetResponse, TrellisContractGetResponseContractResources,
};
use trellis_service::{BootstrapBindingInfo, BootstrapContractRef, CoreBootstrapPort, ServerError};

struct FakeCoreClient {
    catalog_result: Mutex<Option<Result<TrellisCatalogResponse, TrellisClientError>>>,
    binding_result: Mutex<Option<Result<TrellisBindingsGetResponse, TrellisClientError>>>,
    seen_binding_requests: Arc<Mutex<Vec<TrellisBindingsGetRequest>>>,
}

impl CoreBootstrapClientPort for FakeCoreClient {
    fn trellis_catalog<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<TrellisCatalogResponse, TrellisClientError>> {
        let result = self
            .catalog_result
            .lock()
            .expect("lock catalog result")
            .take()
            .expect("catalog result should be set");
        ready(result).boxed()
    }

    fn trellis_bindings_get<'a>(
        &'a self,
        input: &'a TrellisBindingsGetRequest,
    ) -> BoxFuture<'a, Result<TrellisBindingsGetResponse, TrellisClientError>> {
        self.seen_binding_requests
            .lock()
            .expect("lock seen binding requests")
            .push(input.clone());
        let result = self
            .binding_result
            .lock()
            .expect("lock binding result")
            .take()
            .expect("binding result should be set");
        ready(result).boxed()
    }
}

fn expected_ref() -> BootstrapContractRef {
    BootstrapContractRef {
        id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
    }
}

fn sample_catalog() -> TrellisCatalogResponse {
    TrellisCatalogResponse {
        catalog: TrellisCatalogResponseCatalog {
            contracts: vec![TrellisCatalogResponseCatalogContractsItem {
                description: "jobs".to_string(),
                digest: "sha256:expected".to_string(),
                display_name: "Jobs".to_string(),
                id: "trellis.jobs@v1".to_string(),
            }],
            format: "trellis.catalog.v1".to_string(),
            issues: None,
        },
    }
}

#[test]
fn make_bindings_get_request_uses_expected_contract_ref() {
    let expected = expected_ref();

    let request = make_bindings_get_request(&expected);

    assert_eq!(request.contract_id.as_deref(), Some("trellis.jobs@v1"));
    assert_eq!(request.digest.as_deref(), Some("sha256:expected"));
}

#[test]
fn map_catalog_to_contract_refs_maps_id_and_digest() {
    let contracts = map_catalog_to_contract_refs(&sample_catalog());

    assert_eq!(
        contracts,
        vec![BootstrapContractRef {
            id: "trellis.jobs@v1".to_string(),
            digest: "sha256:expected".to_string(),
        }]
    );
}

#[test]
fn map_binding_response_handles_some_and_none() {
    let with_binding = TrellisBindingsGetResponse {
        binding: Some(TrellisBindingsGetResponseBinding {
            contract_id: "trellis.jobs@v1".to_string(),
            digest: "sha256:expected".to_string(),
            resources: TrellisBindingsGetResponseBindingResources {
                jobs: None,
                kv: None,
                store: None,
            },
        }),
    };
    let without_binding = TrellisBindingsGetResponse { binding: None };

    let some_binding = map_binding_response(&with_binding);
    let none_binding = map_binding_response(&without_binding);

    assert_eq!(
        some_binding,
        Some(CoreBootstrapBinding::new(
            TrellisBindingsGetResponseBinding {
                contract_id: "trellis.jobs@v1".to_string(),
                digest: "sha256:expected".to_string(),
                resources: TrellisBindingsGetResponseBindingResources {
                    jobs: None,
                    kv: None,
                    store: None,
                },
            }
        ))
    );
    assert_eq!(none_binding, None);
}

#[tokio::test]
async fn adapter_fetch_binding_passes_expected_filter_to_client() {
    let expected = expected_ref();
    let seen_requests = Arc::new(Mutex::new(Vec::new()));
    let client = FakeCoreClient {
        catalog_result: Mutex::new(Some(Ok(sample_catalog()))),
        binding_result: Mutex::new(Some(Ok(TrellisBindingsGetResponse {
            binding: Some(TrellisBindingsGetResponseBinding {
                contract_id: expected.id.clone(),
                digest: expected.digest.clone(),
                resources: TrellisBindingsGetResponseBindingResources {
                    jobs: None,
                    kv: None,
                    store: None,
                },
            }),
        }))),
        seen_binding_requests: Arc::clone(&seen_requests),
    };
    let adapter = CoreBootstrapAdapter::new(client);

    let binding = adapter
        .fetch_binding(&expected)
        .await
        .expect("binding lookup should succeed");

    assert_eq!(
        binding.expect("binding should exist").digest,
        expected.digest
    );

    let requests = seen_requests.lock().expect("lock seen binding requests");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].contract_id.as_deref(), Some("trellis.jobs@v1"));
    assert_eq!(requests[0].digest.as_deref(), Some("sha256:expected"));
}

#[tokio::test]
async fn adapter_maps_client_error_to_server_error() {
    let client = FakeCoreClient {
        catalog_result: Mutex::new(Some(Err(TrellisClientError::Timeout))),
        binding_result: Mutex::new(Some(Ok(TrellisBindingsGetResponse { binding: None }))),
        seen_binding_requests: Arc::new(Mutex::new(Vec::new())),
    };
    let adapter = CoreBootstrapAdapter::new(client);

    let result = adapter.fetch_catalog_contracts().await;

    assert!(matches!(
        result,
        Err(ServerError::Nats(message)) if message.contains("Trellis.Catalog")
    ));
}

#[test]
fn jobs_binding_types_deserialize_with_work_stream() {
    let response: TrellisBindingsGetResponse = serde_json::from_value(json!({
        "binding": {
            "contractId": "trellis.jobs@v1",
            "digest": "sha256:expected",
            "resources": {
                "jobs": {
                    "namespace": "jobs",
                    "workStream": "JOBS_WORK",
                    "queues": {
                        "document-process": {
                            "queueType": "document-process",
                            "publishPrefix": "trellis.jobs.documents",
                            "workSubject": "trellis.work.documents.document-process",
                            "consumerName": "documents-document-process",
                            "payload": { "schema": "DocumentPayload" },
                            "maxDeliver": 5,
                            "backoffMs": [5000, 30000],
                            "ackWaitMs": 60000,
                            "progress": true,
                            "logs": true,
                            "dlq": true,
                            "concurrency": 2
                        }
                    }
                },
                "kv": {}
            }
        }
    }))
    .expect("deserialize bindings response with jobs work stream");

    let binding = response.binding.expect("binding");
    let jobs = binding.resources.jobs.as_ref().expect("jobs binding");
    let queue = jobs
        .queues
        .get("document-process")
        .expect("document-process queue");
    assert_eq!(jobs.work_stream.as_deref(), Some("JOBS_WORK"));
    assert_eq!(queue.consumer_name, "documents-document-process");
    assert_eq!(queue.payload.schema, "DocumentPayload");
    assert!(queue.result.is_none());
    assert!(queue.dlq);
    assert!(binding.resources.kv.as_ref().is_none_or(|kv| kv.is_empty()));
    let contract: TrellisContractGetResponse = serde_json::from_value(json!({
        "contract": {
            "id": "trellis.jobs@v1",
            "displayName": "Jobs",
            "description": "jobs",
            "format": "trellis.contract.v1",
            "kind": "service",
            "jobs": {
                "document-process": {
                    "payload": { "schema": "DocumentPayload" },
                    "maxDeliver": 5,
                    "backoffMs": [5000, 30000],
                    "ackWaitMs": 60000,
                    "progress": true,
                    "logs": true,
                    "dlq": true,
                    "concurrency": 2
                }
            },
            "resources": { "kv": {} }
        }
    }))
    .expect("deserialize contract response without stream resources");

    let jobs = contract.contract.jobs.as_ref().expect("jobs resources");
    assert_eq!(
        jobs.get("document-process")
            .expect("document-process queue")
            .payload
            .schema,
        "DocumentPayload"
    );
    let resources: TrellisContractGetResponseContractResources =
        contract.contract.resources.expect("resources");
    assert!(resources.kv.as_ref().is_none_or(|kv| kv.is_empty()));
}

#[test]
fn core_bootstrap_binding_maps_generated_resources_to_service_resource_bindings() {
    let response: TrellisBindingsGetResponse = serde_json::from_value(json!({
        "binding": {
            "contractId": "field-ops@v1",
            "digest": "sha256:fieldops",
            "resources": {
                "kv": {
                    "drafts": {
                        "bucket": "svc_drafts",
                        "history": 10,
                        "maxValueBytes": 16384,
                        "ttlMs": 86400000
                    }
                },
                "store": {
                    "evidence": {
                        "name": "svc_evidence",
                        "maxObjectBytes": 10485760,
                        "ttlMs": 0
                    }
                },
                "jobs": {
                    "namespace": "field-ops",
                    "workStream": "JOBS_WORK",
                    "queues": {
                        "report-finalize": {
                            "queueType": "report-finalize",
                            "publishPrefix": "trellis.jobs.field-ops.report-finalize",
                            "workSubject": "trellis.work.field-ops.report-finalize",
                            "consumerName": "field-ops-report-finalize",
                            "payload": { "schema": "ReportFinalizePayload" },
                            "result": { "schema": "ReportFinalizeResult" },
                            "maxDeliver": 5,
                            "backoffMs": [5000, 30000],
                            "ackWaitMs": 60000,
                            "defaultDeadlineMs": 120000,
                            "progress": true,
                            "logs": true,
                            "dlq": true,
                            "concurrency": 2
                        }
                    }
                }
            }
        }
    }))
    .expect("deserialize binding resources");
    let binding = CoreBootstrapBinding::new(response.binding.expect("binding"));

    let resources = binding.resource_bindings();

    assert_eq!(resources.kv.get("drafts").expect("kv").bucket, "svc_drafts");
    assert_eq!(
        resources.store.get("evidence").expect("store").name,
        "svc_evidence"
    );
    let jobs = resources.jobs.expect("jobs");
    assert_eq!(jobs.namespace, "field-ops");
    assert_eq!(jobs.work_stream.as_deref(), Some("JOBS_WORK"));
    let queue = jobs.queues.get("report-finalize").expect("queue");
    assert_eq!(queue.consumer_name, "field-ops-report-finalize");
    assert_eq!(queue.payload.schema, "ReportFinalizePayload");
    assert_eq!(
        queue.result.as_ref().expect("result schema").schema,
        "ReportFinalizeResult"
    );
    assert!(queue.dlq);
}
