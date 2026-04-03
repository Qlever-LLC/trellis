use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_server::{
    control_subject, dispatch_one, AcceptedOperation, InboundRequest, OperationDescriptor,
    OperationRefData, OperationSnapshot, OperationState, RequestContext, Router,
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
    const CANCELABLE: bool = true;
}

fn request(subject: &str, payload: Value) -> InboundRequest {
    InboundRequest {
        subject: subject.to_string(),
        payload: Bytes::from(serde_json::to_vec(&payload).expect("serialize payload")),
        reply_to: Some("_INBOX.1".to_string()),
        context: RequestContext {
            subject: subject.to_string(),
            session_key: Some("svc_session".to_string()),
            proof: Some("proof".to_string()),
        },
    }
}

#[tokio::test]
async fn registered_operation_start_replies_with_accepted_envelope_and_revision_1() {
    let mut router = Router::new();
    router.register_operation::<RefundOperation, _, _, _, _, _, _, _, _>(
        |_ctx, _input| async move {
            Ok(AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: OperationRefData {
                    id: "op_123".to_string(),
                    service: "billing".to_string(),
                    operation: "Billing.Refund".to_string(),
                },
                snapshot: OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Pending,
                    progress: None,
                    output: None,
                },
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "working".to_string(),
                }),
                output: None,
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                output: None,
            })
        },
    );

    let reply = dispatch_one(
        &router,
        request(RefundOperation::SUBJECT, json!({ "charge_id": "ch_123" })),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "accepted");
    assert_eq!(body["ref"]["id"], "op_123");
    assert_eq!(body["snapshot"]["state"], "pending");
    assert_eq!(body["snapshot"]["revision"], 1);
}

#[tokio::test]
async fn operation_control_get_returns_single_snapshot_frame() {
    let mut router = Router::new();
    router.register_operation::<RefundOperation, _, _, _, _, _, _, _, _>(
        |_ctx, _input| async move {
            Ok(AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: OperationRefData {
                    id: "op_123".to_string(),
                    service: "billing".to_string(),
                    operation: "Billing.Refund".to_string(),
                },
                snapshot: OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Pending,
                    progress: None,
                    output: None,
                },
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "working".to_string(),
                }),
                output: None,
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                output: None,
            })
        },
    );

    let reply = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "get", "operationId": "op_123" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "snapshot");
    assert_eq!(body["snapshot"]["state"], "running");
    assert_eq!(body["snapshot"]["revision"], 2);
    assert_eq!(body["snapshot"]["progress"]["message"], "working");
}

#[tokio::test]
async fn operation_control_cancel_returns_single_snapshot_frame() {
    let mut router = Router::new();
    router.register_operation::<RefundOperation, _, _, _, _, _, _, _, _>(
        |_ctx, _input| async move {
            Ok(AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: OperationRefData {
                    id: "op_123".to_string(),
                    service: "billing".to_string(),
                    operation: "Billing.Refund".to_string(),
                },
                snapshot: OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Pending,
                    progress: None,
                    output: None,
                },
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "working".to_string(),
                }),
                output: None,
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                output: None,
            })
        },
    );

    let reply = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "cancel", "operationId": "op_123" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "snapshot");
    assert_eq!(body["snapshot"]["state"], "cancelled");
    assert_eq!(body["snapshot"]["revision"], 4);
}

#[tokio::test]
async fn operation_control_wait_returns_terminal_snapshot_frame() {
    let mut router = Router::new();
    router.register_operation::<RefundOperation, _, _, _, _, _, _, _, _>(
        |_ctx, _input| async move {
            Ok(AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: OperationRefData {
                    id: "op_123".to_string(),
                    service: "billing".to_string(),
                    operation: "Billing.Refund".to_string(),
                },
                snapshot: OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Pending,
                    progress: None,
                    output: None,
                },
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "working".to_string(),
                }),
                output: None,
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                output: None,
            })
        },
    );

    let reply = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "wait", "operationId": "op_123" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "snapshot");
    assert_eq!(body["snapshot"]["state"], "completed");
    assert_eq!(body["snapshot"]["revision"], 3);
    assert_eq!(body["snapshot"]["output"]["refund_id"], "rf_123");
}

#[tokio::test]
async fn operation_control_watch_returns_single_snapshot_frame() {
    let mut router = Router::new();
    router.register_operation::<RefundOperation, _, _, _, _, _, _, _, _>(
        |_ctx, _input| async move {
            Ok(AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: OperationRefData {
                    id: "op_123".to_string(),
                    service: "billing".to_string(),
                    operation: "Billing.Refund".to_string(),
                },
                snapshot: OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Pending,
                    progress: None,
                    output: None,
                },
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "working".to_string(),
                }),
                output: None,
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                output: None,
            })
        },
    );

    let reply = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "watch", "operationId": "op_123" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "snapshot");
    assert_eq!(body["snapshot"]["state"], "running");
    assert_eq!(body["snapshot"]["revision"], 2);
}
