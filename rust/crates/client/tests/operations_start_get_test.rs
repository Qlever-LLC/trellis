use std::future::Future;
use std::sync::{Arc, Mutex};

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_client::{
    control_subject, FileInfo, OperationDescriptor, OperationEvent, OperationState,
    OperationTransferStartError, OperationTransport, TransferOperationDescriptor,
    TrellisClientError, UploadTransferGrant,
};

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

struct RefundOperation;

impl OperationDescriptor for RefundOperation {
    type Input = RefundInput;
    type Progress = RefundProgress;
    type Output = RefundOutput;
    type Error = String;

    const KEY: &'static str = "Billing.Refund";
    const SUBJECT: &'static str = "operations.v1.Billing.Refund";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["billing.refund"];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &["billing.read"];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &["billing.cancel"];
    const CANCELABLE: bool = true;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = None;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = "{}";
}

struct ReceiptUploadOperation;

impl OperationDescriptor for ReceiptUploadOperation {
    type Input = RefundInput;
    type Progress = RefundProgress;
    type Output = RefundOutput;
    type Error = String;

    const KEY: &'static str = "Billing.ReceiptUpload";
    const SUBJECT: &'static str = "operations.v1.Billing.ReceiptUpload";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["billing.receipt.upload"];
    const OBSERVE_CAPABILITIES: &'static [&'static str] = &["billing.read"];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = false;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = None;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = "{}";
}

impl TransferOperationDescriptor for ReceiptUploadOperation {}

#[derive(Clone)]
struct FakeTransport {
    seen: Arc<Mutex<Vec<(String, Value)>>>,
    responses: Arc<Mutex<Vec<Value>>>,
    uploads: Arc<Mutex<Vec<(UploadTransferGrant, Vec<u8>)>>>,
    fail_upload: bool,
}

impl FakeTransport {
    fn new(responses: Vec<Value>) -> Self {
        Self {
            seen: Arc::new(Mutex::new(Vec::new())),
            responses: Arc::new(Mutex::new(responses.into_iter().rev().collect())),
            uploads: Arc::new(Mutex::new(Vec::new())),
            fail_upload: false,
        }
    }

    fn failing_upload(responses: Vec<Value>) -> Self {
        Self {
            fail_upload: true,
            ..Self::new(responses)
        }
    }

    fn seen(&self) -> Vec<(String, Value)> {
        self.seen.lock().expect("lock seen").clone()
    }

    fn uploads(&self) -> Vec<(UploadTransferGrant, Vec<u8>)> {
        self.uploads.lock().expect("lock uploads").clone()
    }
}

impl OperationTransport for FakeTransport {
    fn request_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<Output = Result<Value, TrellisClientError>> + Send + 'a {
        async move {
            self.seen
                .lock()
                .expect("lock seen")
                .push((subject, body.clone()));
            self.responses
                .lock()
                .expect("lock responses")
                .pop()
                .ok_or_else(|| {
                    TrellisClientError::OperationProtocol("missing fake response".into())
                })
        }
    }

    fn watch_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<
        Output = Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError>,
    > + Send
           + 'a {
        async move {
            self.seen
                .lock()
                .expect("lock seen")
                .push((subject, body.clone()));
            let frames: Vec<_> = self
                .responses
                .lock()
                .expect("lock responses")
                .drain(..)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .map(Ok)
                .collect();
            Ok(Box::pin(stream::iter(frames)) as BoxStream<'a, Result<Value, TrellisClientError>>)
        }
    }

    fn put_upload_transfer<'a>(
        &'a self,
        grant: UploadTransferGrant,
        body: Vec<u8>,
    ) -> impl Future<Output = Result<FileInfo, TrellisClientError>> + Send + 'a {
        async move {
            self.uploads
                .lock()
                .expect("lock uploads")
                .push((grant, body.clone()));
            if self.fail_upload {
                return Err(TrellisClientError::TransferProtocol(
                    "upload failed".to_string(),
                ));
            }
            Ok(FileInfo {
                key: "incoming/test.txt".to_string(),
                size: body.len() as u64,
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
                digest: None,
                content_type: None,
                metadata: Default::default(),
            })
        }
    }
}

#[tokio::test]
async fn operation_invoker_control_by_id_uses_typed_control_subject_without_starting() {
    let transport = FakeTransport::new(vec![json!({
        "kind": "snapshot",
        "snapshot": {
            "revision": 7,
            "state": "running",
            "progress": {
                "message": "job resumed"
            }
        }
    })]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .control("op_resumed")
        .expect("operation id should be valid");
    let snapshot = reference.get().await.expect("get should succeed");

    assert_eq!(reference.id(), "op_resumed");
    assert_eq!(reference.operation(), "Billing.Refund");
    assert_eq!(reference.service(), "");
    assert_eq!(snapshot.revision, 7);
    assert_eq!(snapshot.state, OperationState::Running);
    assert_eq!(
        snapshot.progress,
        Some(RefundProgress {
            message: "job resumed".to_string(),
        })
    );
    assert_eq!(snapshot.output, None);
    assert_eq!(
        transport.seen(),
        vec![(
            control_subject(RefundOperation::SUBJECT),
            json!({ "action": "get", "operationId": "op_resumed" }),
        )]
    );
}

#[test]
fn operation_invoker_control_by_id_rejects_blank_id_as_result_error() {
    let transport = FakeTransport::new(Vec::new());
    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);

    let error = operation
        .control("   ")
        .expect_err("blank operation id should fail");

    assert!(matches!(error, TrellisClientError::OperationProtocol(_)));
    assert!(transport.seen().is_empty());
}

#[tokio::test]
async fn operation_invoker_control_by_id_preserves_typed_terminal_output() {
    let transport = FakeTransport::new(vec![json!({
        "kind": "snapshot",
        "snapshot": {
            "revision": 8,
            "state": "completed",
            "output": {
                "refund_id": "rf_resumed"
            }
        }
    })]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let snapshot = operation
        .control("op_done")
        .expect("operation id should be valid")
        .wait()
        .await
        .expect("wait should succeed");

    assert_eq!(snapshot.revision, 8);
    assert_eq!(snapshot.state, OperationState::Completed);
    assert_eq!(snapshot.progress, None);
    assert_eq!(
        snapshot.output,
        Some(RefundOutput {
            refund_id: "rf_resumed".to_string(),
        })
    );
    assert_eq!(
        transport.seen(),
        vec![(
            control_subject(RefundOperation::SUBJECT),
            json!({ "action": "wait", "operationId": "op_done" }),
        )]
    );
}

#[tokio::test]
async fn operation_invoker_control_by_id_decodes_control_error_frames_as_result_errors() {
    let transport = FakeTransport::new(vec![json!({
        "kind": "error",
        "error": {
            "type": "TerminalOperation",
            "message": "operation is already terminal"
        }
    })]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let error = operation
        .control("op_done")
        .expect("operation id should be valid")
        .cancel()
        .await
        .expect_err("terminal operation control should fail");

    match error {
        TrellisClientError::OperationProtocol(message) => {
            assert!(message.contains("TerminalOperation"));
            assert!(message.contains("already terminal"));
        }
        other => panic!("unexpected error: {other}"),
    }
    assert_eq!(
        transport.seen(),
        vec![(
            control_subject(RefundOperation::SUBJECT),
            json!({ "action": "cancel", "operationId": "op_done" }),
        )]
    );
}

#[tokio::test]
async fn operation_input_builder_start_posts_input() {
    let transport = FakeTransport::new(vec![json!({
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
    })]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let input = RefundInput {
        charge_id: "ch_123".to_string(),
    };
    let reference = operation
        .input(&input)
        .start()
        .await
        .expect("builder start should succeed");

    assert_eq!(reference.id(), "op_123");
    assert_eq!(
        transport.seen(),
        vec![(
            RefundOperation::SUBJECT.to_string(),
            json!({ "charge_id": "ch_123" }),
        ),]
    );
}

#[tokio::test]
async fn operation_input_transfer_builder_uploads_after_accept() {
    let transport = FakeTransport::new(vec![json!({
        "kind": "accepted",
        "ref": {
            "id": "op_123",
            "service": "billing",
            "operation": "Billing.ReceiptUpload"
        },
        "snapshot": {
            "revision": 1,
            "state": "pending"
        },
        "transfer": {
            "type": "TransferGrant",
            "kind": "upload",
            "service": "billing",
            "sessionKey": "session-key",
            "transferId": "tx1",
            "subject": "transfer.v1.upload.test.tx1",
            "expiresAt": "2099-01-01T00:00:00.000Z",
            "chunkBytes": 6
        }
    })]);

    let operation = trellis_client::OperationInvoker::<_, ReceiptUploadOperation>::new(&transport);
    let input = RefundInput {
        charge_id: "ch_123".to_string(),
    };
    let started = operation
        .input(&input)
        .transfer("hello world")
        .start()
        .await
        .expect("builder transfer start should succeed");
    let reference = started.operation_ref();

    assert_eq!(reference.id(), "op_123");
    assert_eq!(
        transport.seen(),
        vec![(
            ReceiptUploadOperation::SUBJECT.to_string(),
            json!({ "charge_id": "ch_123" }),
        ),]
    );
    assert_eq!(started.file_info().key, "incoming/test.txt");
    assert_eq!(transport.uploads().len(), 1);
    let (grant, body) = transport.uploads().pop().expect("one upload");
    assert_eq!(grant.subject, "transfer.v1.upload.test.tx1");
    assert_eq!(body, b"hello world".to_vec());
}

#[tokio::test]
async fn operation_input_transfer_builder_error_keeps_accepted_operation_ref() {
    let transport = FakeTransport::failing_upload(vec![json!({
        "kind": "accepted",
        "ref": {
            "id": "op_accepted",
            "service": "billing",
            "operation": "Billing.ReceiptUpload"
        },
        "snapshot": {
            "revision": 1,
            "state": "pending"
        },
        "transfer": {
            "type": "TransferGrant",
            "kind": "upload",
            "service": "billing",
            "sessionKey": "session-key",
            "transferId": "tx1",
            "subject": "transfer.v1.upload.test.tx1",
            "expiresAt": "2099-01-01T00:00:00.000Z",
            "chunkBytes": 6
        }
    })]);

    let operation = trellis_client::OperationInvoker::<_, ReceiptUploadOperation>::new(&transport);
    let input = RefundInput {
        charge_id: "ch_123".to_string(),
    };
    let error = operation
        .input(&input)
        .transfer("hello world")
        .start()
        .await
        .expect_err("builder transfer upload should fail");

    match error {
        OperationTransferStartError::Upload {
            operation_ref,
            source,
        } => {
            assert_eq!(operation_ref.id(), "op_accepted");
            assert!(matches!(source, TrellisClientError::TransferProtocol(_)));
        }
        OperationTransferStartError::Start(_) => panic!("expected upload failure"),
    }
}

#[tokio::test]
async fn start_returns_operation_ref_from_accepted_envelope() {
    let transport = FakeTransport::new(vec![json!({
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
    })]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .start(&RefundInput {
            charge_id: "ch_123".to_string(),
        })
        .await
        .expect("start should succeed");

    assert_eq!(reference.id(), "op_123");
    assert_eq!(reference.service(), "billing");
    assert_eq!(reference.operation(), "Billing.Refund");

    assert_eq!(
        transport.seen(),
        vec![(
            RefundOperation::SUBJECT.to_string(),
            json!({ "charge_id": "ch_123" }),
        )]
    );
}

#[tokio::test]
async fn operation_ref_transfer_uses_the_accepted_transfer_session() {
    let transport = FakeTransport::new(vec![json!({
        "kind": "accepted",
        "ref": {
            "id": "op_123",
            "service": "billing",
            "operation": "Billing.Refund"
        },
        "snapshot": {
            "revision": 1,
            "state": "pending"
        },
        "transfer": {
            "type": "TransferGrant",
            "kind": "upload",
            "service": "billing",
            "sessionKey": "session-key",
            "transferId": "tx1",
            "subject": "transfer.v1.upload.test.tx1",
            "expiresAt": "2099-01-01T00:00:00.000Z",
            "chunkBytes": 6
        }
    })]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .start(&RefundInput {
            charge_id: "ch_123".to_string(),
        })
        .await
        .expect("start should succeed");

    let uploaded = reference
        .transfer("hello world".as_bytes())
        .await
        .expect("transfer succeeds");
    assert_eq!(uploaded.key, "incoming/test.txt");
    assert_eq!(uploaded.size, 11);
}

#[tokio::test]
async fn operation_ref_get_sends_control_get_and_decodes_snapshot_frame() {
    let transport = FakeTransport::new(vec![
        json!({
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
        }),
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
    ]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .start(&RefundInput {
            charge_id: "ch_123".to_string(),
        })
        .await
        .expect("start should succeed");
    let snapshot = reference.get().await.expect("get should succeed");

    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.state, OperationState::Running);
    assert_eq!(
        snapshot.progress,
        Some(RefundProgress {
            message: "working".to_string(),
        })
    );
    assert_eq!(snapshot.output, None);

    assert_eq!(
        transport.seen(),
        vec![
            (
                RefundOperation::SUBJECT.to_string(),
                json!({ "charge_id": "ch_123" }),
            ),
            (
                control_subject(RefundOperation::SUBJECT),
                json!({ "action": "get", "operationId": "op_123" }),
            ),
        ]
    );
}

#[tokio::test]
async fn operation_ref_cancel_sends_control_cancel_and_decodes_snapshot_frame() {
    let transport = FakeTransport::new(vec![
        json!({
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
        }),
        json!({
            "kind": "snapshot",
            "snapshot": {
                "revision": 3,
                "state": "cancelled"
            }
        }),
    ]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .start(&RefundInput {
            charge_id: "ch_123".to_string(),
        })
        .await
        .expect("start should succeed");
    let snapshot = reference.cancel().await.expect("cancel should succeed");

    assert_eq!(snapshot.revision, 3);
    assert_eq!(snapshot.state, OperationState::Cancelled);
    assert_eq!(snapshot.progress, None);
    assert_eq!(snapshot.output, None);

    assert_eq!(
        transport.seen(),
        vec![
            (
                RefundOperation::SUBJECT.to_string(),
                json!({ "charge_id": "ch_123" }),
            ),
            (
                control_subject(RefundOperation::SUBJECT),
                json!({ "action": "cancel", "operationId": "op_123" }),
            ),
        ]
    );
}

#[tokio::test]
async fn operation_ref_watch_sends_control_watch_and_decodes_snapshot_frame() {
    let transport = FakeTransport::new(vec![
        json!({
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
        }),
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
        json!({
            "kind": "keepalive"
        }),
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
    ]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .start(&RefundInput {
            charge_id: "ch_123".to_string(),
        })
        .await
        .expect("start should succeed");
    let stream = reference.watch().await.expect("watch should succeed");
    let events: Vec<_> = stream.collect::<Vec<_>>().await;

    assert_eq!(events.len(), 3);
    assert!(matches!(events[0], Ok(OperationEvent::Started { .. })));
    assert!(matches!(events[1], Ok(OperationEvent::Progress { .. })));
    assert!(matches!(events[2], Ok(OperationEvent::Completed { .. })));

    assert_eq!(
        transport.seen(),
        vec![
            (
                RefundOperation::SUBJECT.to_string(),
                json!({ "charge_id": "ch_123" }),
            ),
            (
                control_subject(RefundOperation::SUBJECT),
                json!({ "action": "watch", "operationId": "op_123" }),
            ),
        ]
    );
}

#[tokio::test]
async fn operation_ref_wait_sends_control_wait_and_rejects_non_terminal_snapshot() {
    let transport = FakeTransport::new(vec![
        json!({
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
        }),
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
    ]);

    let operation = trellis_client::OperationInvoker::<_, RefundOperation>::new(&transport);
    let reference = operation
        .start(&RefundInput {
            charge_id: "ch_123".to_string(),
        })
        .await
        .expect("start should succeed");
    let error = reference
        .wait()
        .await
        .expect_err("wait should reject non-terminal snapshots");

    assert!(matches!(error, TrellisClientError::OperationProtocol(_)));
    assert_eq!(
        transport.seen(),
        vec![
            (
                RefundOperation::SUBJECT.to_string(),
                json!({ "charge_id": "ch_123" }),
            ),
            (
                control_subject(RefundOperation::SUBJECT),
                json!({ "action": "wait", "operationId": "op_123" }),
            ),
        ]
    );
}
