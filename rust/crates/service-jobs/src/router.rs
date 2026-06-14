//! Router construction for the Jobs admin service.

use serde_json::Value;
use trellis_rs::sdk::jobs::rpc::{
    Empty, JobsCancelRpc, JobsDismissDLQRpc, JobsGetKeyRpc, JobsGetRpc, JobsHealthRpc,
    JobsListDLQRpc, JobsListRpc, JobsListServicesRpc, JobsReplayDLQRpc, JobsRetryRpc,
};
use trellis_rs::sdk::jobs::types::{
    JobsCancelRequest, JobsDismissDLQRequest, JobsGetKeyRequest, JobsGetRequest,
    JobsHealthResponse, JobsListDLQRequest, JobsListRequest, JobsListServicesRequest,
    JobsReplayDLQRequest, JobsRetryRequest,
};
use trellis_rs::service::{DeclaredRpcError, Router, ServerError};

use crate::contract::SERVICE_NAME;
use crate::query::{JobsQuery, JobsQueryError};

/// Build the Jobs admin RPC router backed by a SQL projection query adapter.
pub fn build_router_with_query(query: JobsQuery) -> Router {
    let mut router = Router::new();
    router.register_rpc::<JobsHealthRpc, _, _>(|_ctx, _input: Empty| async move {
        Ok(JobsHealthResponse {
            checks: Vec::new(),
            service: SERVICE_NAME.to_string(),
            status: Value::String("ok".to_string()),
            timestamp: now_timestamp_string(),
        })
    });
    router.register_rpc::<JobsListServicesRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsListServicesRequest| {
            let query = query.clone();
            async move { query.list_services(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsListRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsListRequest| {
            let query = query.clone();
            async move { query.list_jobs(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsGetRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsGetRequest| {
            let query = query.clone();
            async move { query.get_job(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsGetKeyRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsGetKeyRequest| {
            let query = query.clone();
            async move { query.get_key(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsCancelRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsCancelRequest| {
            let query = query.clone();
            async move { query.cancel_job(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsRetryRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsRetryRequest| {
            let query = query.clone();
            async move { query.retry_job(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsListDLQRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsListDLQRequest| {
            let query = query.clone();
            async move { query.list_dlq(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsReplayDLQRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsReplayDLQRequest| {
            let query = query.clone();
            async move { query.replay_dlq(&input).await.map_err(map_query_error) }
        }
    });
    router.register_rpc::<JobsDismissDLQRpc, _, _>({
        let query = query.clone();
        move |_ctx, input: JobsDismissDLQRequest| {
            let query = query.clone();
            async move { query.dismiss_dlq(&input).await.map_err(map_query_error) }
        }
    });
    router
}

fn map_query_error(error: JobsQueryError) -> ServerError {
    match error {
        JobsQueryError::JobNotFound { key } => ServerError::DeclaredRpc(DeclaredRpcError::new(
            "NotFoundError",
            format!("Job '{key}' not found"),
            [
                ("resource", serde_json::json!("Job")),
                ("jobId", serde_json::json!(key)),
            ],
        )),
        JobsQueryError::JobStateConflict {
            key,
            expected,
            actual,
        } => ServerError::DeclaredRpc(DeclaredRpcError::new(
            "ValidationError",
            format!("Job '{key}' is in state '{actual}', expected {expected}"),
            [
                ("field", serde_json::json!("state")),
                ("jobKey", serde_json::json!(key)),
                ("expected", serde_json::json!(expected)),
                ("actual", serde_json::json!(actual)),
            ],
        )),
        JobsQueryError::Validation { field, details } => {
            ServerError::DeclaredRpc(DeclaredRpcError::new(
                "ValidationError",
                format!("Invalid {field}: {details}"),
                [
                    ("field", serde_json::json!(field)),
                    ("details", serde_json::json!(details)),
                ],
            ))
        }
        JobsQueryError::ConvertWireModel { model, details } => {
            ServerError::DeclaredRpc(DeclaredRpcError::new(
                "ValidationError",
                format!("Invalid {model}: {details}"),
                [
                    ("field", serde_json::json!(model)),
                    ("details", serde_json::json!(details)),
                ],
            ))
        }
        other => ServerError::Nats(format!("jobs RPC query failed: {other}")),
    }
}

fn now_timestamp_string() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
