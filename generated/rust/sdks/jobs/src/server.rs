//! Thin server-side helpers for `trellis.jobs@v1`.

use trellis_server::{HandlerResult, RequestContext, Router};

/// Register a handler for `Jobs.Cancel`.
pub fn register_jobs_cancel<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::JobsCancelRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::JobsCancelResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::JobsCancelRpc, _, _>(handler);
}

/// Register a handler for `Jobs.Get`.
pub fn register_jobs_get<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::JobsGetRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::JobsGetResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::JobsGetRpc, _, _>(handler);
}

/// Register a handler for `Jobs.Health`.
pub fn register_jobs_health<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::JobsHealthResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::JobsHealthRpc, _, _>(handler);
}

/// Register a handler for `Jobs.List`.
pub fn register_jobs_list<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::JobsListRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::JobsListResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::JobsListRpc, _, _>(handler);
}

/// Register a handler for `Jobs.ListServices`.
pub fn register_jobs_list_services<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::JobsListServicesResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::JobsListServicesRpc, _, _>(handler);
}

/// Register a handler for `Jobs.Retry`.
pub fn register_jobs_retry<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::JobsRetryRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::JobsRetryResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::JobsRetryRpc, _, _>(handler);
}

