use std::sync::{Arc, Mutex};

use futures_util::future::{ready, BoxFuture, FutureExt};
use serde_json::json;
use trellis_auth::{
    AuthGetInstalledContractRequest, AuthGetInstalledContractResponse,
    AuthGetInstalledContractResponseContract,
};
use trellis_auth_adapters::bootstrap::{
    is_contract_not_found_validation_error, make_get_installed_contract_request,
    map_get_installed_contract_result, map_installed_contract_response, AuthBootstrapAdapter,
    AuthBootstrapClientPort,
};
use trellis_client::TrellisClientError;
use trellis_server::{BootstrapContractRef, ServerError};

struct FakeAuthClient {
    result: Mutex<Option<Result<AuthGetInstalledContractResponse, TrellisClientError>>>,
    seen_requests: Arc<Mutex<Vec<AuthGetInstalledContractRequest>>>,
}

impl AuthBootstrapClientPort for FakeAuthClient {
    fn auth_get_installed_contract<'a>(
        &'a self,
        input: &'a AuthGetInstalledContractRequest,
    ) -> BoxFuture<'a, Result<AuthGetInstalledContractResponse, TrellisClientError>> {
        self.seen_requests
            .lock()
            .expect("lock seen requests")
            .push(input.clone());
        let result = self
            .result
            .lock()
            .expect("lock result")
            .take()
            .expect("result should be set");
        ready(result).boxed()
    }
}

fn expected_ref() -> BootstrapContractRef {
    BootstrapContractRef {
        id: "trellis.jobs@v1".to_string(),
        digest: "sha256:expected".to_string(),
    }
}

fn installed_contract_response(id: &str, digest: &str) -> AuthGetInstalledContractResponse {
    AuthGetInstalledContractResponse {
        contract: AuthGetInstalledContractResponseContract {
            digest: digest.to_string(),
            id: id.to_string(),
            display_name: None,
            description: None,
            session_key: None,
            installed_at: None,
            contract: None,
        },
    }
}

#[test]
fn make_get_installed_contract_request_uses_expected_digest() {
    let expected = expected_ref();

    let request = make_get_installed_contract_request(&expected);

    assert_eq!(request.digest, "sha256:expected");
}

#[test]
fn map_installed_contract_response_maps_id_and_digest() {
    let response = installed_contract_response("trellis.jobs@v1", "sha256:expected");

    let mapped = map_installed_contract_response(&response);

    assert_eq!(mapped.id, "trellis.jobs@v1");
    assert_eq!(mapped.digest, "sha256:expected");
}

#[test]
fn not_found_validation_error_detection_matches_expected_shape() {
    let not_found = r#"{"type":"ValidationError","message":"contract not found","path":"/digest"}"#;
    let different = r#"{"type":"ValidationError","message":"invalid digest"}"#;

    assert!(is_contract_not_found_validation_error(not_found));
    assert!(!is_contract_not_found_validation_error(different));
    assert!(!is_contract_not_found_validation_error("not-json"));
}

#[test]
fn map_get_installed_contract_result_maps_not_found_to_none() {
    let not_found_error = TrellisClientError::RpcError(
        r#"{"type":"ValidationError","message":"contract not found","path":"/digest"}"#.to_string(),
    );

    let mapped_none =
        map_get_installed_contract_result(Err(not_found_error), "Auth.GetInstalledContract")
            .expect("not found should map to none");

    assert_eq!(mapped_none, None);
}

#[tokio::test]
async fn adapter_fetch_installed_contract_passes_digest_and_maps_success() {
    let expected = expected_ref();
    let seen_requests = Arc::new(Mutex::new(Vec::new()));
    let client = FakeAuthClient {
        result: Mutex::new(Some(Ok(installed_contract_response(
            &expected.id,
            &expected.digest,
        )))),
        seen_requests: Arc::clone(&seen_requests),
    };
    let adapter = AuthBootstrapAdapter::new(client);

    let contract = adapter
        .fetch_installed_contract(&expected)
        .await
        .expect("fetch should succeed")
        .expect("installed contract should exist");

    assert_eq!(contract, expected);

    let requests = seen_requests.lock().expect("lock seen requests");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].digest, "sha256:expected");
}

#[tokio::test]
async fn adapter_fetch_installed_contract_maps_non_not_found_error() {
    let expected = expected_ref();
    let client = FakeAuthClient {
        result: Mutex::new(Some(Err(TrellisClientError::Timeout))),
        seen_requests: Arc::new(Mutex::new(Vec::new())),
    };
    let adapter = AuthBootstrapAdapter::new(client);

    let result = adapter.fetch_installed_contract(&expected).await;

    assert!(matches!(
        result,
        Err(ServerError::Nats(message)) if message.contains("Auth.GetInstalledContract")
    ));
}

#[test]
fn installed_contract_types_deserialize_stream_bindings_and_summary_counts() {
    let response: trellis_sdk_auth::types::AuthGetInstalledContractResponse =
        serde_json::from_value(json!({
            "contract": {
                "id": "trellis.jobs@v1",
                "digest": "sha256:expected",
                "displayName": "Jobs",
                "description": "jobs",
                "installedAt": "2026-01-01T00:00:00Z",
                "kind": "service",
                "contract": {},
                "analysisSummary": {
                    "events": 0,
                    "jobsQueues": 1,
                    "kvResources": 2,
                    "streamResources": 3,
                    "namespaces": ["jobs"],
                    "natsPublish": 4,
                    "natsSubscribe": 5,
                    "rpcMethods": 6
                },
                "resourceBindings": {
                    "jobs": {
                        "namespace": "jobs",
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
                    "kv": {
                        "jobsState": {
                            "bucket": "trellis_jobs",
                            "history": 1,
                            "ttlMs": 0
                        }
                    },
                    "streams": {
                        "jobsWork": {
                            "name": "JOBS_WORK",
                            "subjects": ["trellis.work.>"],
                            "retention": "workqueue",
                            "sources": [
                                {
                                    "fromAlias": "jobs",
                                    "streamName": "JOBS"
                                }
                            ]
                        }
                    }
                },
                "resources": {
                    "jobs": {
                        "queues": {
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
                        }
                    },
                    "kv": {
                        "jobsState": {
                            "purpose": "Projected job state",
                            "history": 1,
                            "ttlMs": 0
                        }
                    },
                    "streams": {
                        "jobsWork": {
                            "purpose": "Store sourced work queue messages",
                            "subjects": ["trellis.work.>"],
                            "retention": "workqueue",
                            "sources": [
                                {
                                    "fromAlias": "jobs",
                                    "filterSubject": "trellis.jobs.*.*.*.created",
                                    "subjectTransformDest": "trellis.work.$1.$2"
                                }
                            ]
                        }
                    }
                }
            }
        }))
        .expect("deserialize installed contract response with streams");

    let summary = response
        .contract
        .analysis_summary
        .expect("analysis summary");
    assert_eq!(summary.stream_resources, 3.0);

    let resources = response.contract.resources.expect("resources");
    assert_eq!(
        resources
            .jobs
            .as_ref()
            .expect("jobs resources")
            .queues
            .get("document-process")
            .expect("document-process queue")
            .payload
            .schema,
        "DocumentPayload"
    );
    assert_eq!(
        resources
            .kv
            .as_ref()
            .expect("kv resources")
            .get("jobsState")
            .expect("jobsState")
            .purpose,
        "Projected job state"
    );
    let jobs_work = resources
        .streams
        .expect("streams")
        .get("jobsWork")
        .expect("jobsWork resource")
        .clone();
    assert_eq!(jobs_work.retention.as_deref(), Some("workqueue"));
}

#[test]
fn install_service_response_deserializes_typed_resource_bindings() {
    let response: trellis_sdk_auth::types::AuthProvisionServiceInstanceResponse =
        serde_json::from_value(json!({
            "instance": {
                "instanceId": "svc-inst-1",
                "instanceKey": "svc-key",
                "profileId": "jobs.default",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "disabled": false,
                "capabilities": ["jobs.read"],
                "currentContractId": "trellis.jobs@v1",
                "currentContractDigest": "sha256:expected",
                "resourceBindings": {
                    "jobs": {
                        "namespace": "jobs",
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
                    "kv": {
                        "jobsState": {
                            "bucket": "trellis_jobs",
                            "history": 1,
                            "ttlMs": 0
                        }
                    },
                    "streams": {
                        "jobsWork": {
                            "name": "JOBS_WORK",
                            "subjects": ["trellis.work.>"],
                            "retention": "workqueue"
                        }
                    }
                }
            }
        }))
        .expect("deserialize install service response");

    let resource_bindings = response
        .instance
        .resource_bindings
        .expect("resource bindings");
    let jobs = resource_bindings.jobs.expect("jobs bindings");
    assert_eq!(
        jobs.queues
            .get("document-process")
            .expect("document-process queue")
            .publish_prefix,
        "trellis.jobs.documents"
    );
    assert_eq!(
        resource_bindings
            .kv
            .expect("kv bindings")
            .get("jobsState")
            .expect("jobsState")
            .bucket,
        "trellis_jobs"
    );
    assert_eq!(
        resource_bindings
            .streams
            .expect("stream bindings")
            .get("jobsWork")
            .expect("jobsWork binding")
            .name,
        "JOBS_WORK"
    );
}
