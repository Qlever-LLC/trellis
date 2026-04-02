//! Thin server-side helpers for `trellis.core@v1`.

use trellis_server::{HandlerResult, RequestContext, Router};

/// Register a handler for `Trellis.Bindings.Get`.
pub fn register_trellis_bindings_get<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::TrellisBindingsGetRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::TrellisBindingsGetResponse>>
        + Send
        + 'static,
{
    router.register_rpc::<crate::rpc::TrellisBindingsGetRpc, _, _>(handler);
}

/// Register a handler for `Trellis.Catalog`.
pub fn register_trellis_catalog<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::rpc::Empty) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::TrellisCatalogResponse>>
        + Send
        + 'static,
{
    router.register_rpc::<crate::rpc::TrellisCatalogRpc, _, _>(handler);
}

/// Register a handler for `Trellis.Contract.Get`.
pub fn register_trellis_contract_get<F, Fut>(router: &mut Router, handler: F)
where
    F: Fn(RequestContext, crate::types::TrellisContractGetRequest) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HandlerResult<crate::types::TrellisContractGetResponse>>
        + Send
        + 'static,
{
    router.register_rpc::<crate::rpc::TrellisContractGetRpc, _, _>(handler);
}
