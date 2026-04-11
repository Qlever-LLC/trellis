use crate::{
    bootstrap_service_host, run_nats_request_loop, BootstrapBinding, RequestHandler,
    RequestValidator, Router, ServerError,
};

/// Subscribe to one RPC subject for service request handling.
pub async fn subscribe_subject(
    client: &async_nats::Client,
    subject: &str,
) -> Result<async_nats::Subscriber, ServerError> {
    client
        .subscribe(subject.to_string())
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))
}

/// Run one service request loop bound to a single subject.
pub async fn run_single_subject_service<H>(
    client: async_nats::Client,
    subject: &str,
    handler: H,
) -> Result<(), ServerError>
where
    H: RequestHandler,
{
    let subscriber = subscribe_subject(&client, subject).await?;
    run_nats_request_loop(client, subscriber, handler).await
}

/// Bootstrap a service host and run one subject-bound service loop.
pub async fn bootstrap_and_run_single_subject_service<V>(
    client: async_nats::Client,
    service_name: &str,
    binding: BootstrapBinding,
    subject: &str,
    router: Router,
    validator: V,
) -> Result<(), ServerError>
where
    V: RequestValidator,
{
    let host = bootstrap_service_host(service_name, binding, router, validator);

    run_single_subject_service(client, subject, host).await
}
