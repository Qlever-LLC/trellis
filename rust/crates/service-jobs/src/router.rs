//! Router construction for the Jobs admin service.

use serde_json::Value;
use trellis_sdk_jobs::rpc::{
    JobsCancelRpc, JobsDismissDLQRpc, JobsGetRpc, JobsHealthRpc, JobsListDLQRpc, JobsListRpc,
    JobsListServicesRpc, JobsReplayDLQRpc, JobsRetryRpc,
};
use trellis_sdk_jobs::types::{
    JobsCancelRequest, JobsDismissDLQRequest, JobsGetRequest, JobsHealthRequest,
    JobsHealthResponse, JobsListDLQRequest, JobsListRequest, JobsListServicesRequest,
    JobsReplayDLQRequest, JobsRetryRequest,
};
use trellis_server::Router;

use crate::contract::SERVICE_NAME;
use crate::kv_query::JobsKvQuery;

/// Build the Jobs admin RPC router backed by a KV query adapter.
pub fn build_router_with_query(query: JobsKvQuery) -> Router {
    let mut router = Router::new();
    router.register_rpc::<JobsHealthRpc, _, _>(|_ctx, _input: JobsHealthRequest| async move {
        Ok(JobsHealthResponse {
            checks: Vec::new(),
            service: SERVICE_NAME.to_string(),
            status: Value::String("ok".to_string()),
            timestamp: now_timestamp_string(),
        })
    });
    router.register_rpc::<JobsListServicesRpc, _, _>({
        let query = query.clone();
        move |_ctx, _input: JobsListServicesRequest| {
            let query = query.clone();
            async move { query.list_services().await.map_err(map_query_error) }
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

fn map_query_error(error: crate::kv_query::JobsQueryError) -> trellis_server::ServerError {
    trellis_server::ServerError::Nats(error.to_string())
}

fn now_timestamp_string() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
