//! Thin server-side helpers for `trellis.activity@v1`.

use trellis_server::{HandlerResult, RequestContext, Router, EventPublisher, ServerError};

/// Register a handler for `Activity.Get`.
pub fn register_activity_get<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::ActivityGetRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::ActivityGetResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::ActivityGetRpc, _, _>(handler);
}

/// Register a handler for `Activity.Health`.
pub fn register_activity_health<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::ActivityHealthResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::ActivityHealthRpc, _, _>(handler);
}

/// Register a handler for `Activity.List`.
pub fn register_activity_list<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::ActivityListRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::ActivityListResponse>> + Send + 'static,
{
    router.register_rpc::<crate::rpc::ActivityListRpc, _, _>(handler);
}

/// Publish `Activity.Recorded` from a service handler.
pub async fn publish_activity_recorded(publisher: &EventPublisher, event: &crate::types::ActivityRecordedEvent) -> Result<(), ServerError> {
    publisher.publish::<crate::events::ActivityRecordedEventDescriptor>(event).await
}

