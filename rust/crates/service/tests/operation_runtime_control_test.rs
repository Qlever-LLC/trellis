use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_service::{
    control_subject, dispatch_one, InMemoryOperationRuntime, InboundRequest, OperationDescriptor,
    OperationFailure, OperationRefData, OperationState, RequestContext, Router, ServerError,
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

struct CaptureOperation;

impl OperationDescriptor for CaptureOperation {
    type Input = RefundInput;
    type Progress = RefundProgress;
    type Output = RefundOutput;

    const KEY: &'static str = "Billing.Capture";
    const SUBJECT: &'static str = "operations.v1.Billing.Capture";
    const CANCELABLE: bool = true;
}

struct NonCancelableRefundOperation;

impl OperationDescriptor for NonCancelableRefundOperation {
    type Input = RefundInput;
    type Progress = RefundProgress;
    type Output = RefundOutput;

    const KEY: &'static str = "Billing.NonCancelableRefund";
    const SUBJECT: &'static str = "operations.v1.Billing.NonCancelableRefund";
    const CANCELABLE: bool = false;
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
            reply_to: Some("_INBOX.1".to_string()),
        },
    }
}

#[tokio::test]
async fn accepted_operation_can_be_controlled_by_operation_id_and_observed_by_router() {
    let runtime = InMemoryOperationRuntime::new("billing");
    let refunds = runtime.operation::<RefundOperation>();

    let mut router = Router::new();
    router.register_operation::<RefundOperation, _, _, _, _, _, _, _, _>(
        {
            let refunds = refunds.clone();
            move |_ctx, _input| {
                let refunds = refunds.clone();
                async move { refunds.accept("op_refund").await }
            }
        },
        {
            let refunds = refunds.clone();
            move |_ctx, operation_id| {
                let refunds = refunds.clone();
                async move { refunds.get(operation_id).await }
            }
        },
        {
            let refunds = refunds.clone();
            move |_ctx, operation_id| {
                let refunds = refunds.clone();
                async move { refunds.wait(operation_id).await }
            }
        },
        {
            let refunds = refunds.clone();
            move |_ctx, operation_id| {
                let refunds = refunds.clone();
                async move { refunds.cancel(operation_id).await }
            }
        },
    );

    let accepted = dispatch_one(
        &router,
        request(RefundOperation::SUBJECT, json!({ "charge_id": "ch_123" })),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");
    let body: Value = serde_json::from_slice(&accepted.payload).expect("accepted JSON");
    assert_eq!(body["kind"], "accepted");
    assert_eq!(body["ref"]["id"], "op_refund");
    assert_eq!(body["snapshot"]["state"], "pending");
    assert_eq!(body["snapshot"]["id"], "op_refund");
    assert_eq!(body["snapshot"]["service"], "billing");
    assert_eq!(body["snapshot"]["operation"], "Billing.Refund");
    assert!(body["snapshot"]["createdAt"].is_string());
    assert!(body["snapshot"]["updatedAt"].is_string());

    refunds
        .control("op_refund")
        .await
        .expect("control succeeds")
        .started()
        .await
        .expect("started update succeeds");
    refunds
        .control("op_refund")
        .await
        .expect("control succeeds")
        .progress(RefundProgress {
            message: "provider working".to_string(),
        })
        .await
        .expect("progress update succeeds");

    let get = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "get", "operationId": "op_refund" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");
    let body: Value = serde_json::from_slice(&get.payload).expect("snapshot JSON");
    assert_eq!(body["kind"], "snapshot");
    assert_eq!(body["snapshot"]["revision"], 3);
    assert_eq!(body["snapshot"]["state"], "running");
    assert_eq!(body["snapshot"]["progress"]["message"], "provider working");

    refunds
        .control("op_refund")
        .await
        .expect("control succeeds")
        .complete(RefundOutput {
            refund_id: "rf_123".to_string(),
        })
        .await
        .expect("complete update succeeds");

    let wait = dispatch_one(
        &router,
        request(
            &control_subject(RefundOperation::SUBJECT),
            json!({ "action": "wait", "operationId": "op_refund" }),
        ),
    )
    .await
    .expect("dispatch success")
    .expect("reply should be present");
    let body: Value = serde_json::from_slice(&wait.payload).expect("terminal JSON");
    assert_eq!(body["snapshot"]["revision"], 4);
    assert_eq!(body["snapshot"]["state"], "completed");
    assert_eq!(body["snapshot"]["progress"]["message"], "provider working");
    assert_eq!(body["snapshot"]["output"]["refund_id"], "rf_123");
    assert!(body["snapshot"]["completedAt"].is_string());
}

#[tokio::test]
async fn service_control_handle_supports_typed_started_progress_complete_fail_and_cancel() {
    let runtime = InMemoryOperationRuntime::new("billing");
    let refunds = runtime.operation::<RefundOperation>();

    refunds
        .accept("op_complete")
        .await
        .expect("accept succeeds");
    let snapshot = refunds
        .control("op_complete")
        .await
        .expect("control succeeds")
        .started()
        .await
        .expect("started succeeds");
    assert_eq!(snapshot.state, OperationState::Running);

    let snapshot = refunds
        .control("op_complete")
        .await
        .expect("control succeeds")
        .progress(RefundProgress {
            message: "halfway".to_string(),
        })
        .await
        .expect("progress succeeds");
    assert_eq!(snapshot.progress.expect("progress").message, "halfway");

    let snapshot = refunds
        .control("op_complete")
        .await
        .expect("control succeeds")
        .complete(RefundOutput {
            refund_id: "rf_456".to_string(),
        })
        .await
        .expect("complete succeeds");
    assert_eq!(snapshot.output.expect("output").refund_id, "rf_456");

    refunds.accept("op_fail").await.expect("accept succeeds");
    let snapshot = refunds
        .control("op_fail")
        .await
        .expect("control succeeds")
        .fail(OperationFailure {
            message: "processor declined".to_string(),
        })
        .await
        .expect("fail succeeds");
    assert_eq!(snapshot.state, OperationState::Failed);
    assert_eq!(
        snapshot.error.expect("failure error").message,
        "processor declined"
    );

    refunds.accept("op_cancel").await.expect("accept succeeds");
    let snapshot = refunds
        .control("op_cancel")
        .await
        .expect("control succeeds")
        .cancel()
        .await
        .expect("cancel succeeds");
    assert_eq!(snapshot.state, OperationState::Cancelled);
}

#[tokio::test]
async fn duplicate_ids_preserve_existing_snapshot_and_non_cancelable_operations_reject_cancel() {
    let runtime = InMemoryOperationRuntime::new("billing");
    let refunds = runtime.operation::<RefundOperation>();
    let non_cancelable = runtime.operation::<NonCancelableRefundOperation>();

    refunds
        .accept("op_duplicate")
        .await
        .expect("accept succeeds");
    refunds
        .control("op_duplicate")
        .await
        .expect("control succeeds")
        .progress(RefundProgress {
            message: "already started".to_string(),
        })
        .await
        .expect("progress succeeds");
    let duplicate = refunds.accept("op_duplicate").await;
    assert!(matches!(
        duplicate,
        Err(ServerError::OperationAlreadyExists { .. })
    ));
    let blank = refunds.accept("   ").await;
    assert!(matches!(blank, Err(ServerError::OperationInvalidId { .. })));
    let snapshot = refunds.get("op_duplicate").await.expect("snapshot exists");
    assert_eq!(snapshot.revision, 2);
    assert_eq!(
        snapshot.progress.expect("progress").message,
        "already started"
    );

    non_cancelable
        .accept("op_no_cancel")
        .await
        .expect("accept succeeds");
    let cancel = non_cancelable
        .control("op_no_cancel")
        .await
        .expect("control succeeds")
        .cancel()
        .await;
    assert!(matches!(
        cancel,
        Err(ServerError::OperationUnsupportedControl { .. })
    ));
    assert_eq!(
        non_cancelable
            .get("op_no_cancel")
            .await
            .expect("snapshot exists")
            .state,
        OperationState::Pending
    );
}

#[tokio::test]
async fn wrong_id_name_service_and_terminal_updates_return_result_errors() {
    let runtime = InMemoryOperationRuntime::new("billing");
    let refunds = runtime.operation::<RefundOperation>();
    let captures = runtime.operation::<CaptureOperation>();

    refunds.accept("op_refund").await.expect("accept succeeds");

    let wrong_id = refunds.control("missing").await;
    assert!(matches!(
        wrong_id,
        Err(ServerError::OperationNotFound { .. })
    ));

    let wrong_name = captures.control("op_refund").await;
    assert!(matches!(
        wrong_name,
        Err(ServerError::OperationMismatch { .. })
    ));

    let wrong_service = refunds
        .control_ref(OperationRefData {
            id: "op_refund".to_string(),
            service: "ledger".to_string(),
            operation: RefundOperation::KEY.to_string(),
        })
        .await;
    assert!(matches!(
        wrong_service,
        Err(ServerError::OperationMismatch { .. })
    ));

    refunds
        .control("op_refund")
        .await
        .expect("control succeeds")
        .complete(RefundOutput {
            refund_id: "rf_done".to_string(),
        })
        .await
        .expect("complete succeeds");
    let terminal_update = refunds
        .control("op_refund")
        .await
        .expect("control succeeds")
        .progress(RefundProgress {
            message: "too late".to_string(),
        })
        .await;
    assert!(matches!(
        terminal_update,
        Err(ServerError::OperationTerminal { .. })
    ));
}
