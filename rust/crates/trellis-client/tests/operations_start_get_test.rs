use std::future::Future;
use std::sync::{Arc, Mutex};

use futures_util::stream::{self, BoxStream};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_client::{
    control_subject, OperationDescriptor, OperationEvent, OperationState, OperationTransport,
    TrellisClientError,
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

    const KEY: &'static str = "Billing.Refund";
    const SUBJECT: &'static str = "operations.v1.Billing.Refund";
    const CALLER_CAPABILITIES: &'static [&'static str] = &["billing.refund"];
    const READ_CAPABILITIES: &'static [&'static str] = &["billing.read"];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &["billing.cancel"];
    const CANCELABLE: bool = true;
}

#[derive(Clone)]
struct FakeTransport {
    seen: Arc<Mutex<Vec<(String, Value)>>>,
    responses: Arc<Mutex<Vec<Value>>>,
}

impl FakeTransport {
    fn new(responses: Vec<Value>) -> Self {
        Self {
            seen: Arc::new(Mutex::new(Vec::new())),
            responses: Arc::new(Mutex::new(responses.into_iter().rev().collect())),
        }
    }

    fn seen(&self) -> Vec<(String, Value)> {
        self.seen.lock().expect("lock seen").clone()
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
                .ok_or_else(|| TrellisClientError::OperationProtocol("missing fake response".into()))
        }
    }

    fn watch_json_value<'a>(
        &'a self,
        subject: String,
        body: Value,
    ) -> impl Future<Output = Result<BoxStream<'a, Result<Value, TrellisClientError>>, TrellisClientError>> + Send + 'a {
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
    let error = reference.wait().await.expect_err("wait should reject non-terminal snapshots");

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
