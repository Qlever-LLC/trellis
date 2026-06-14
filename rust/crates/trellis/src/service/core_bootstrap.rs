use futures_util::future::BoxFuture;

use crate::client::TrellisClientError;
use crate::jobs::bindings::{
    JobKeyConcurrencyBinding, JobKeyStalePolicy, JobQueueDepthBinding, JobQueueWhenFull,
};
use crate::sdk::core::types::{
    TrellisBindingsGetRequest, TrellisBindingsGetResponse, TrellisBindingsGetResponseBinding,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValueKeyConcurrency,
    TrellisBindingsGetResponseBindingResourcesJobsQueuesValueQueue, TrellisCatalogResponse,
};
use crate::sdk::core::{rpc::TrellisBindingsGetRpc, CoreClient};

use super::{
    BootstrapBinding, BootstrapBindingInfo, BootstrapContractRef, CoreBootstrapPort,
    EventConsumerOrdering, EventConsumerReplay, EventConsumerResourceBinding,
    JobsQueueResourceBinding, JobsResourceBinding, JobsSchemaRef, KvResourceBinding, ServerError,
    ServiceResourceBindings, StoreResourceBinding,
};

pub trait CoreBootstrapClientPort: Send + Sync {
    fn trellis_catalog<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<TrellisCatalogResponse, TrellisClientError>>;

    fn trellis_bindings_get<'a>(
        &'a self,
        input: &'a TrellisBindingsGetRequest,
    ) -> BoxFuture<'a, Result<TrellisBindingsGetResponse, TrellisClientError>>;
}

impl<'a> CoreBootstrapClientPort for CoreClient<'a> {
    fn trellis_catalog<'b>(
        &'b self,
    ) -> BoxFuture<'b, Result<TrellisCatalogResponse, TrellisClientError>> {
        Box::pin(async move { CoreClient::trellis_catalog(self).await })
    }

    fn trellis_bindings_get<'b>(
        &'b self,
        input: &'b TrellisBindingsGetRequest,
    ) -> BoxFuture<'b, Result<TrellisBindingsGetResponse, TrellisClientError>> {
        Box::pin(async move { self.inner().call::<TrellisBindingsGetRpc>(input).await })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CoreBootstrapBinding(TrellisBindingsGetResponseBinding);

impl CoreBootstrapBinding {
    pub fn new(binding: TrellisBindingsGetResponseBinding) -> Self {
        Self(binding)
    }

    pub fn into_inner(self) -> TrellisBindingsGetResponseBinding {
        self.0
    }
}

impl AsRef<TrellisBindingsGetResponseBinding> for CoreBootstrapBinding {
    fn as_ref(&self) -> &TrellisBindingsGetResponseBinding {
        &self.0
    }
}

impl std::ops::Deref for CoreBootstrapBinding {
    type Target = TrellisBindingsGetResponseBinding;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl BootstrapBindingInfo for CoreBootstrapBinding {
    fn bootstrap_binding(&self) -> BootstrapBinding {
        BootstrapBinding {
            contract_id: self.0.contract_id.clone(),
            digest: self.0.digest.clone(),
        }
    }

    fn resource_bindings(&self) -> ServiceResourceBindings {
        resource_bindings_from_core_binding(&self.0)
    }
}

/// Map generated Trellis core bootstrap resources into service-owned binding types.
fn resource_bindings_from_core_binding(
    binding: &TrellisBindingsGetResponseBinding,
) -> ServiceResourceBindings {
    ServiceResourceBindings {
        kv: binding
            .resources
            .kv
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|(name, kv)| {
                (
                    name,
                    KvResourceBinding {
                        bucket: kv.bucket,
                        history: kv.history,
                        max_value_bytes: kv.max_value_bytes,
                        ttl_ms: kv.ttl_ms,
                    },
                )
            })
            .collect(),
        store: binding
            .resources
            .store
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|(name, store)| {
                (
                    name,
                    StoreResourceBinding {
                        name: store.name,
                        max_object_bytes: store.max_object_bytes,
                        max_total_bytes: store.max_total_bytes,
                        ttl_ms: store.ttl_ms,
                    },
                )
            })
            .collect(),
        jobs: binding
            .resources
            .jobs
            .clone()
            .map(|jobs| JobsResourceBinding {
                namespace: jobs.namespace,
                work_stream: jobs.work_stream,
                queues: jobs
                    .queues
                    .into_iter()
                    .map(|(name, queue)| {
                        (
                            name,
                            JobsQueueResourceBinding {
                                queue_type: queue.queue_type,
                                publish_prefix: queue.publish_prefix,
                                work_subject: queue.work_subject,
                                consumer_name: queue.consumer_name,
                                payload: JobsSchemaRef {
                                    schema: queue.payload.schema,
                                },
                                result: queue.result.map(|result| JobsSchemaRef {
                                    schema: result.schema,
                                }),
                                max_deliver: queue.max_deliver,
                                backoff_ms: queue.backoff_ms,
                                ack_wait_ms: queue.ack_wait_ms,
                                default_deadline_ms: queue.default_deadline_ms,
                                progress: queue.progress,
                                logs: queue.logs,
                                dlq: queue.dlq,
                                concurrency: queue.concurrency,
                                key_concurrency: queue
                                    .key_concurrency
                                    .map(job_key_concurrency_binding_from_core),
                                queue: queue.queue.map(job_queue_depth_binding_from_core),
                            },
                        )
                    })
                    .collect(),
            }),
        event_consumers: binding
            .resources
            .event_consumers
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|(name, consumer)| {
                (
                    name,
                    EventConsumerResourceBinding {
                        stream: consumer.stream,
                        consumer_name: consumer.consumer_name,
                        filter_subjects: consumer.filter_subjects,
                        replay: match consumer.replay.as_str() {
                            "new" => EventConsumerReplay::New,
                            "all" => EventConsumerReplay::All,
                            _ => EventConsumerReplay::Unknown,
                        },
                        ordering: match consumer.ordering.as_str() {
                            "strict" => EventConsumerOrdering::Strict,
                            _ => EventConsumerOrdering::Unknown,
                        },
                        concurrency: consumer.concurrency,
                        ack_wait_ms: consumer.ack_wait_ms,
                        max_deliver: consumer.max_deliver,
                        backoff_ms: consumer.backoff_ms,
                    },
                )
            })
            .collect(),
    }
}

fn job_key_concurrency_binding_from_core(
    value: TrellisBindingsGetResponseBindingResourcesJobsQueuesValueKeyConcurrency,
) -> JobKeyConcurrencyBinding {
    JobKeyConcurrencyBinding {
        key: value.key,
        max_active: u32::try_from(value.max_active).unwrap_or(u32::MAX),
        heartbeat_interval_ms: u64::try_from(value.heartbeat_interval_ms).unwrap_or(0),
        heartbeat_ttl_ms: u64::try_from(value.heartbeat_ttl_ms).unwrap_or(0),
        stale_policy: match value.stale_policy.as_str() {
            "block" => JobKeyStalePolicy::Block,
            _ => JobKeyStalePolicy::FailStale,
        },
    }
}

fn job_queue_depth_binding_from_core(
    value: TrellisBindingsGetResponseBindingResourcesJobsQueuesValueQueue,
) -> JobQueueDepthBinding {
    JobQueueDepthBinding {
        max_queued_per_key: u64::try_from(value.max_queued_per_key).unwrap_or(0),
        when_full: match value.when_full.as_str() {
            "coalesce" => JobQueueWhenFull::Coalesce,
            "replace-oldest" => JobQueueWhenFull::ReplaceOldest,
            _ => JobQueueWhenFull::Reject,
        },
    }
}

pub struct CoreBootstrapAdapter<C> {
    client: C,
}

impl<C> CoreBootstrapAdapter<C> {
    pub fn new(client: C) -> Self {
        Self { client }
    }
}

impl<C> CoreBootstrapPort for CoreBootstrapAdapter<C>
where
    C: CoreBootstrapClientPort,
{
    type Binding = CoreBootstrapBinding;

    fn fetch_catalog_contracts<'a>(
        &'a self,
    ) -> BoxFuture<'a, Result<Vec<BootstrapContractRef>, ServerError>> {
        Box::pin(async move {
            let response = self
                .client
                .trellis_catalog()
                .await
                .map_err(|error| map_client_error("Trellis.Catalog", error))?;
            Ok(map_catalog_to_contract_refs(&response))
        })
    }

    fn fetch_binding<'a>(
        &'a self,
        expected: &'a BootstrapContractRef,
    ) -> BoxFuture<'a, Result<Option<Self::Binding>, ServerError>> {
        Box::pin(async move {
            let request = make_bindings_get_request(expected);
            let response = self
                .client
                .trellis_bindings_get(&request)
                .await
                .map_err(|error| map_client_error("Trellis.Bindings.Get", error))?;
            Ok(map_binding_response(&response))
        })
    }
}

fn make_bindings_get_request(expected: &BootstrapContractRef) -> TrellisBindingsGetRequest {
    TrellisBindingsGetRequest {
        contract_id: Some(expected.id.clone()),
        digest: Some(expected.digest.clone()),
    }
}

fn map_catalog_to_contract_refs(response: &TrellisCatalogResponse) -> Vec<BootstrapContractRef> {
    response
        .catalog
        .contracts
        .iter()
        .map(|contract| BootstrapContractRef {
            id: contract.id.clone(),
            digest: contract.digest.clone(),
        })
        .collect()
}

fn map_binding_response(response: &TrellisBindingsGetResponse) -> Option<CoreBootstrapBinding> {
    response.binding.clone().map(CoreBootstrapBinding::new)
}

fn map_client_error(subject: &'static str, error: TrellisClientError) -> ServerError {
    ServerError::Nats(format!("bootstrap {subject} request failed: {error}"))
}
