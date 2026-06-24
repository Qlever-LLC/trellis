use bytes::Bytes;
use futures_util::future::BoxFuture;
use futures_util::stream;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_service::internal::{dispatch_one, InboundRequest};
use trellis_service::{
    control_subject, AcceptedOperation, OperationDescriptor, OperationFailure, OperationProvider,
    OperationRefData, OperationSnapshot, OperationState, OperationTransferProgress, RequestContext,
    Router, ServerError,
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
    type Error = OperationFailure;

    const KEY: &'static str = "Billing.Refund";
    const SUBJECT: &'static str = "operations.v1.Billing.Refund";
    const CANCELABLE: bool = true;
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const PROGRESS_SCHEMA_JSON: Option<&'static str> = None;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","properties":{},"required":[]}"#;
    const SIGNAL_INPUT_SCHEMAS_JSON: &'static str = "{}";
}

struct RefundProvider;

impl OperationProvider<RefundOperation> for RefundProvider {
    fn start(
        &self,
        _context: RequestContext,
        input: RefundInput,
    ) -> BoxFuture<'static, Result<AcceptedOperation<RefundProgress, RefundOutput>, ServerError>>
    {
        Box::pin(async move {
            assert_eq!(input.charge_id, "ch_123");
            Ok(AcceptedOperation {
                kind: "accepted".to_string(),
                operation_ref: OperationRefData {
                    id: "op_provider".to_string(),
                    service: "billing".to_string(),
                    operation: "Billing.Refund".to_string(),
                },
                snapshot: OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Pending,
                    progress: None,
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
            })
        })
    }

    fn get(
        &self,
        _context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<RefundProgress, RefundOutput>, ServerError>>
    {
        Box::pin(async move {
            assert_eq!(operation_id, "op_provider");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "provider working".to_string(),
                }),
                transfer: None,
                output: None,
                ..Default::default()
            })
        })
    }

    fn wait(
        &self,
        _context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<RefundProgress, RefundOutput>, ServerError>>
    {
        Box::pin(async move {
            assert_eq!(operation_id, "op_provider");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                transfer: None,
                output: Some(RefundOutput {
                    refund_id: "rf_provider".to_string(),
                }),
                ..Default::default()
            })
        })
    }

    fn cancel(
        &self,
        _context: RequestContext,
        operation_id: String,
    ) -> BoxFuture<'static, Result<OperationSnapshot<RefundProgress, RefundOutput>, ServerError>>
    {
        Box::pin(async move {
            assert_eq!(operation_id, "op_provider");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
            })
        })
    }
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
            iat: None,
            request_id: None,
            required_capabilities: None,
            reply_to: Some("_INBOX.1".to_string()),
            caller: None,
            traceparent: None,
            tracestate: None,
        },
    }
}

#[tokio::test]
async fn registered_operation_provider_handles_start_and_control_action() {
    let mut router = Router::new();
    router.register_operation_provider::<RefundOperation, _>(RefundProvider);

    let reply = dispatch_one(
        &router,
        request(RefundOperation::SUBJECT, json!({ "charge_id": "ch_123" })),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "accepted");
    assert_eq!(body["ref"]["id"], "op_provider");
    assert_eq!(body["snapshot"]["state"], "pending");

    let reply = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "get", "operationId": "op_provider" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");

    let body: Value = serde_json::from_slice(&reply.payload).expect("reply should be JSON");
    assert_eq!(body["kind"], "snapshot");
    assert_eq!(body["snapshot"]["state"], "running");
    assert_eq!(body["snapshot"]["progress"]["message"], "provider working");
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
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 2,
                state: OperationState::Running,
                progress: Some(RefundProgress {
                    message: "working".to_string(),
                }),
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                transfer: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
                ..Default::default()
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
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
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
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
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                transfer: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
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
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
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
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                transfer: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
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
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
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
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                transfer: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
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
async fn operation_control_watch_returns_terminal_snapshot_frame() {
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
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
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
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Completed,
                progress: None,
                transfer: None,
                output: Some(RefundOutput {
                    refund_id: "rf_123".to_string(),
                }),
                ..Default::default()
            })
        },
        |_ctx, operation_id| async move {
            assert_eq!(operation_id, "op_123");
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 4,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
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
    assert_eq!(body["snapshot"]["state"], "completed");
    assert_eq!(body["snapshot"]["revision"], 3);
    assert_eq!(body["snapshot"]["output"]["refund_id"], "rf_123");
}

#[tokio::test]
async fn operation_control_watch_encodes_transfer_event_frames() {
    let mut router = Router::new();
    router.register_operation_with_watch::<RefundOperation, _, _, _, _, _, _, _>(
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
                    transfer: None,
                    output: None,
                    ..Default::default()
                },
                transfer: None,
            })
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 1,
                state: OperationState::Pending,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
        |_ctx, operation_id| {
            assert_eq!(operation_id, "op_123");
            Box::pin(stream::iter(vec![
                Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 1,
                    state: OperationState::Running,
                    progress: None,
                    transfer: None,
                    output: None,
                    ..Default::default()
                }),
                Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                    revision: 2,
                    state: OperationState::Running,
                    progress: None,
                    transfer: Some(OperationTransferProgress {
                        chunk_index: 0,
                        chunk_bytes: 11,
                        transferred_bytes: 11,
                    }),
                    output: None,
                    ..Default::default()
                }),
            ]))
        },
        |_ctx, _operation_id| async move {
            Ok(OperationSnapshot::<RefundProgress, RefundOutput> {
                revision: 3,
                state: OperationState::Cancelled,
                progress: None,
                transfer: None,
                output: None,
                ..Default::default()
            })
        },
    );

    let subject = control_subject(RefundOperation::SUBJECT);
    let replies = router
        .handle_request_frames(
            &subject,
            Bytes::from(
                serde_json::to_vec(&json!({ "action": "watch", "operationId": "op_123" }))
                    .expect("serialize control request"),
            ),
            RequestContext {
                subject: subject.clone(),
                session_key: Some("svc_session".to_string()),
                proof: Some("proof".to_string()),
                iat: None,
                request_id: None,
                required_capabilities: None,
                reply_to: None,
                caller: None,
                traceparent: None,
                tracestate: None,
            },
        )
        .await
        .expect("dispatch success");

    assert_eq!(replies.len(), 2);
    let first: Value = serde_json::from_slice(&replies[0]).expect("first reply JSON");
    let second: Value = serde_json::from_slice(&replies[1]).expect("second reply JSON");
    assert_eq!(first["kind"], "snapshot");
    assert_eq!(second["kind"], "event");
    assert_eq!(second["event"]["type"], "transfer");
    assert_eq!(second["event"]["transfer"]["transferredBytes"], 11);
    assert_eq!(
        second["event"]["snapshot"]["transfer"]["transferredBytes"],
        11
    );
}
