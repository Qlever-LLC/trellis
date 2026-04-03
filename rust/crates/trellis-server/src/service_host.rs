use bytes::Bytes;
use futures_util::future::BoxFuture;

use crate::{
    AuthenticatedRouter, BootstrapBinding, RequestContext, RequestHandler, RequestValidator,
    Router, ServerError,
};

/// A bootstrap-validated host wrapper for one service router.
pub struct ServiceHost<H> {
    service_name: String,
    binding: BootstrapBinding,
    handler: H,
}

impl<H> ServiceHost<H> {
    pub fn new(service_name: impl Into<String>, binding: BootstrapBinding, handler: H) -> Self {
        Self {
            service_name: service_name.into(),
            binding,
            handler,
        }
    }

    pub fn service_name(&self) -> &str {
        &self.service_name
    }

    pub fn binding(&self) -> &BootstrapBinding {
        &self.binding
    }

    pub fn handler(&self) -> &H {
        &self.handler
    }

    pub fn into_parts(self) -> (String, BootstrapBinding, H) {
        (self.service_name, self.binding, self.handler)
    }
}

impl<H> RequestHandler for ServiceHost<H>
where
    H: RequestHandler,
{
    fn handle<'a>(
        &'a self,
        subject: &'a str,
        payload: Bytes,
        context: RequestContext,
    ) -> BoxFuture<'a, Result<Bytes, ServerError>> {
        self.handler.handle(subject, payload, context)
    }
}

/// Bootstrap a service host from a previously resolved binding.
pub fn bootstrap_service_host<V>(
    service_name: &str,
    binding: BootstrapBinding,
    router: Router,
    validator: V,
) -> ServiceHost<AuthenticatedRouter<V>>
where
    V: RequestValidator,
{
    let authenticated_router = AuthenticatedRouter::new(router, validator);
    ServiceHost::new(service_name.to_string(), binding, authenticated_router)
}
