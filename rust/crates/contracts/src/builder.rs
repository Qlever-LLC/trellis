use serde_json::Value;

use crate::{
    parse_manifest, ContractErrorRef, ContractExports, ContractJobQueueResource, ContractKind,
    ContractKvResource, ContractManifest, ContractOperation, ContractOperationTransfer,
    ContractResources, ContractRpcMethod, ContractSchemaRef, ContractStoreResource,
    ContractStreamResource, ContractStreamSource, ContractSubject, ContractUseOperation,
    ContractUsePubSub, ContractUseRef, ContractUseRpc, ContractsError, OperationCapabilities,
    PubSubCapabilities, RpcCapabilities, CONTRACT_FORMAT_V1,
};

/// Thin builder over `ContractManifest` for Rust-authored contracts.
pub struct ContractManifestBuilder {
    manifest: ContractManifest,
}

impl ContractManifestBuilder {
    pub fn new(
        id: impl Into<String>,
        display_name: impl Into<String>,
        description: impl Into<String>,
        kind: ContractKind,
    ) -> Self {
        Self {
            manifest: ContractManifest {
                format: CONTRACT_FORMAT_V1.to_string(),
                id: id.into(),
                display_name: display_name.into(),
                description: description.into(),
                kind,
                schemas: Default::default(),
                exports: ContractExports::default(),
                uses: Default::default(),
                rpc: Default::default(),
                operations: Default::default(),
                events: Default::default(),
                subjects: Default::default(),
                errors: Default::default(),
                jobs: Default::default(),
                resources: ContractResources::default(),
            },
        }
    }

    pub fn schema(mut self, name: impl Into<String>, schema: Value) -> Self {
        self.manifest.schemas.insert(name.into(), schema);
        self
    }

    pub fn use_ref(mut self, alias: impl Into<String>, use_ref: ContractUseRef) -> Self {
        self.manifest.uses.insert(alias.into(), use_ref);
        self
    }

    pub fn rpc(mut self, name: impl Into<String>, rpc: ContractRpcMethod) -> Self {
        self.manifest.rpc.insert(name.into(), rpc);
        self
    }

    pub fn operation(mut self, name: impl Into<String>, operation: ContractOperation) -> Self {
        self.manifest.operations.insert(name.into(), operation);
        self
    }

    pub fn subject(mut self, name: impl Into<String>, subject: ContractSubject) -> Self {
        self.manifest.subjects.insert(name.into(), subject);
        self
    }

    pub fn kv_resource(mut self, name: impl Into<String>, kv: ContractKvResource) -> Self {
        self.manifest.resources.kv.insert(name.into(), kv);
        self
    }

    pub fn stream_resource(
        mut self,
        name: impl Into<String>,
        stream: ContractStreamResource,
    ) -> Self {
        self.manifest.resources.streams.insert(name.into(), stream);
        self
    }

    pub fn store_resource(mut self, name: impl Into<String>, store: ContractStoreResource) -> Self {
        self.manifest.resources.store.insert(name.into(), store);
        self
    }

    pub fn job_queue(
        mut self,
        queue_type: impl Into<String>,
        queue: ContractJobQueueResource,
    ) -> Self {
        self.manifest.jobs.insert(queue_type.into(), queue);
        self
    }

    pub fn build(self) -> Result<ContractManifest, ContractsError> {
        let value = serde_json::to_value(self.manifest)?;
        parse_manifest(value)
    }

    pub fn build_unvalidated(self) -> ContractManifest {
        self.manifest
    }
}

pub fn schema_ref(name: impl Into<String>) -> ContractSchemaRef {
    ContractSchemaRef {
        schema: name.into(),
    }
}

pub fn rpc(
    version: impl Into<String>,
    subject: impl Into<String>,
    input_schema: impl Into<String>,
    output_schema: impl Into<String>,
) -> ContractRpcMethod {
    ContractRpcMethod {
        version: version.into(),
        subject: subject.into(),
        input: schema_ref(input_schema),
        output: schema_ref(output_schema),
        capabilities: None,
        errors: None,
    }
}

pub fn operation(
    version: impl Into<String>,
    subject: impl Into<String>,
    input_schema: impl Into<String>,
    progress_schema: Option<impl Into<String>>,
    output_schema: Option<impl Into<String>>,
) -> ContractOperation {
    ContractOperation {
        version: version.into(),
        subject: subject.into(),
        input: schema_ref(input_schema),
        progress: progress_schema.map(schema_ref),
        output: output_schema.map(schema_ref),
        transfer: None,
        capabilities: None,
        cancel: None,
    }
}

pub fn use_contract(contract: impl Into<String>) -> ContractUseRef {
    ContractUseRef {
        contract: contract.into(),
        rpc: None,
        operations: None,
        events: None,
        subjects: None,
    }
}

pub fn kv(purpose: impl Into<String>, schema: impl Into<String>) -> ContractKvResource {
    ContractKvResource {
        purpose: purpose.into(),
        schema: schema_ref(schema),
        required: None,
        history: None,
        ttl_ms: None,
        max_value_bytes: None,
    }
}

pub fn store(purpose: impl Into<String>) -> ContractStoreResource {
    ContractStoreResource {
        purpose: purpose.into(),
        required: None,
        ttl_ms: None,
        max_object_bytes: None,
        max_total_bytes: None,
    }
}

pub fn stream(
    purpose: impl Into<String>,
    subjects: impl IntoIterator<Item = impl Into<String>>,
) -> ContractStreamResource {
    ContractStreamResource {
        purpose: purpose.into(),
        required: None,
        subjects: subjects.into_iter().map(Into::into).collect(),
        retention: None,
        storage: None,
        num_replicas: None,
        discard: None,
        max_msgs: None,
        max_bytes: None,
        max_age_ms: None,
        sources: None,
    }
}

pub fn stream_source(from_alias: impl Into<String>) -> ContractStreamSource {
    ContractStreamSource {
        from_alias: from_alias.into(),
        filter_subject: None,
        subject_transform_dest: None,
    }
}

pub fn subject(value: impl Into<String>) -> ContractSubject {
    ContractSubject {
        subject: value.into(),
        message: None,
        capabilities: None,
    }
}

pub fn job_queue(
    payload: ContractSchemaRef,
    result: Option<ContractSchemaRef>,
) -> ContractJobQueueResource {
    ContractJobQueueResource {
        payload,
        result,
        max_deliver: None,
        backoff_ms: None,
        ack_wait_ms: None,
        default_deadline_ms: None,
        progress: None,
        logs: None,
        dlq: None,
        concurrency: None,
    }
}

impl ContractRpcMethod {
    pub fn with_call_capabilities(
        mut self,
        call: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.capabilities = Some(RpcCapabilities {
            call: Some(call.into_iter().map(Into::into).collect()),
        });
        self
    }

    pub fn with_error_types(
        mut self,
        error_types: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.errors = Some(
            error_types
                .into_iter()
                .map(|error_type| ContractErrorRef {
                    error_type: error_type.into(),
                })
                .collect(),
        );
        self
    }
}

impl ContractOperation {
    pub fn with_transfer(
        mut self,
        store: impl Into<String>,
        key: impl Into<String>,
        content_type: Option<impl Into<String>>,
        metadata: Option<impl Into<String>>,
        expires_in_ms: Option<i64>,
        max_bytes: Option<i64>,
    ) -> Self {
        self.transfer = Some(ContractOperationTransfer {
            store: store.into(),
            key: key.into(),
            content_type: content_type.map(Into::into),
            metadata: metadata.map(Into::into),
            expires_in_ms,
            max_bytes,
        });
        self
    }

    pub fn with_call_capabilities(
        mut self,
        call: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(OperationCapabilities::default);
        capabilities.call = Some(call.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_read_capabilities(
        mut self,
        read: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(OperationCapabilities::default);
        capabilities.read = Some(read.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_cancel_capabilities(
        mut self,
        cancel_capabilities: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(OperationCapabilities::default);
        capabilities.cancel = Some(cancel_capabilities.into_iter().map(Into::into).collect());
        self
    }

    pub fn cancel(mut self, cancel: bool) -> Self {
        self.cancel = Some(cancel);
        self
    }
}

impl ContractUseRef {
    pub fn with_rpc_call(mut self, call: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.rpc = Some(ContractUseRpc {
            call: Some(call.into_iter().map(Into::into).collect()),
        });
        self
    }

    pub fn with_event_publish(
        mut self,
        publish: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.events = Some(ContractUsePubSub {
            publish: Some(publish.into_iter().map(Into::into).collect()),
            subscribe: None,
        });
        self
    }

    pub fn with_operation_call(
        mut self,
        call: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.operations = Some(ContractUseOperation {
            call: Some(call.into_iter().map(Into::into).collect()),
        });
        self
    }

    pub fn with_event_subscribe(
        mut self,
        subscribe: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.events = Some(ContractUsePubSub {
            publish: None,
            subscribe: Some(subscribe.into_iter().map(Into::into).collect()),
        });
        self
    }
}

impl ContractKvResource {
    pub fn required(mut self, required: bool) -> Self {
        self.required = Some(required);
        self
    }

    pub fn history(mut self, history: i64) -> Self {
        self.history = Some(history);
        self
    }

    pub fn ttl_ms(mut self, ttl_ms: i64) -> Self {
        self.ttl_ms = Some(ttl_ms);
        self
    }
}

impl ContractStoreResource {
    pub fn required(mut self, required: bool) -> Self {
        self.required = Some(required);
        self
    }

    pub fn ttl_ms(mut self, ttl_ms: i64) -> Self {
        self.ttl_ms = Some(ttl_ms);
        self
    }

    pub fn max_object_bytes(mut self, max_object_bytes: i64) -> Self {
        self.max_object_bytes = Some(max_object_bytes);
        self
    }

    pub fn max_total_bytes(mut self, max_total_bytes: i64) -> Self {
        self.max_total_bytes = Some(max_total_bytes);
        self
    }
}

impl ContractStreamResource {
    pub fn required(mut self, required: bool) -> Self {
        self.required = Some(required);
        self
    }

    pub fn retention(mut self, retention: impl Into<String>) -> Self {
        self.retention = Some(retention.into());
        self
    }

    pub fn storage(mut self, storage: impl Into<String>) -> Self {
        self.storage = Some(storage.into());
        self
    }

    pub fn num_replicas(mut self, num_replicas: i64) -> Self {
        self.num_replicas = Some(num_replicas);
        self
    }

    pub fn discard(mut self, discard: impl Into<String>) -> Self {
        self.discard = Some(discard.into());
        self
    }

    pub fn max_msgs(mut self, max_msgs: i64) -> Self {
        self.max_msgs = Some(max_msgs);
        self
    }

    pub fn max_bytes(mut self, max_bytes: i64) -> Self {
        self.max_bytes = Some(max_bytes);
        self
    }

    pub fn max_age_ms(mut self, max_age_ms: i64) -> Self {
        self.max_age_ms = Some(max_age_ms);
        self
    }

    pub fn source(mut self, source: ContractStreamSource) -> Self {
        self.sources.get_or_insert_with(Vec::new).push(source);
        self
    }
}

impl ContractStreamSource {
    pub fn filter_subject(mut self, filter_subject: impl Into<String>) -> Self {
        self.filter_subject = Some(filter_subject.into());
        self
    }

    pub fn subject_transform_dest(mut self, subject_transform_dest: impl Into<String>) -> Self {
        self.subject_transform_dest = Some(subject_transform_dest.into());
        self
    }
}

impl ContractSubject {
    pub fn with_publish_capabilities(
        mut self,
        publish: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let publish = Some(publish.into_iter().map(Into::into).collect());
        let subscribe = self
            .capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.subscribe.clone());
        self.capabilities = Some(PubSubCapabilities { publish, subscribe });
        self
    }

    pub fn with_subscribe_capabilities(
        mut self,
        subscribe: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let subscribe = Some(subscribe.into_iter().map(Into::into).collect());
        let publish = self
            .capabilities
            .as_ref()
            .and_then(|capabilities| capabilities.publish.clone());
        self.capabilities = Some(PubSubCapabilities { publish, subscribe });
        self
    }
}
