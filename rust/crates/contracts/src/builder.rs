use serde_json::Value;

use crate::{
    parse_manifest, ContractCapabilities, ContractCapabilityMetadata, ContractDocs,
    ContractErrorDecl, ContractErrorRef, ContractEvent, ContractExports, ContractFeed,
    ContractJobQueueResource, ContractKind, ContractKvResource, ContractManifest,
    ContractOperation, ContractOperationSignal, ContractOperationTransfer,
    ContractOperationTransferDirection, ContractResources, ContractRpcMethod, ContractRpcTransfer,
    ContractRpcTransferDirection, ContractSchemaRef, ContractStateKind, ContractStateStore,
    ContractStoreResource, ContractUseFeed, ContractUseOperation, ContractUsePubSub,
    ContractUseRef, ContractUseRpc, ContractsError, FeedCapabilities, OperationCapabilities,
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
                docs: None,
                kind,
                capabilities: Default::default(),
                schemas: Default::default(),
                exports: ContractExports::default(),
                uses: Default::default(),
                state: Default::default(),
                rpc: Default::default(),
                operations: Default::default(),
                events: Default::default(),
                feeds: Default::default(),
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

    /// Attach summarized programmer-facing Markdown documentation to the contract.
    pub fn docs_with_summary(
        mut self,
        summary: impl Into<String>,
        markdown: impl Into<String>,
    ) -> Self {
        self.manifest.docs = Some(ContractDocs {
            summary: Some(summary.into()),
            markdown: markdown.into(),
        });
        self
    }

    /// Declare a contract-local structured error backed by a named schema.
    pub fn error(
        mut self,
        name: impl Into<String>,
        error_type: impl Into<String>,
        schema: impl Into<String>,
    ) -> Self {
        self.manifest.errors.insert(
            name.into(),
            ContractErrorDecl {
                error_type: error_type.into(),
                schema: Some(schema_ref(schema)),
            },
        );
        self
    }

    /// Declare human-facing metadata for a contract-local capability.
    pub fn capability(
        mut self,
        name: impl Into<String>,
        metadata: ContractCapabilityMetadata,
    ) -> Self {
        self.manifest.capabilities.insert(name.into(), metadata);
        self
    }

    pub fn use_ref(mut self, alias: impl Into<String>, use_ref: ContractUseRef) -> Self {
        self.manifest
            .uses
            .required_mut()
            .insert(alias.into(), use_ref);
        self
    }

    pub fn optional_use_ref(mut self, alias: impl Into<String>, use_ref: ContractUseRef) -> Self {
        self.manifest
            .uses
            .optional_mut()
            .insert(alias.into(), use_ref);
        self
    }

    pub fn export_schema(mut self, name: impl Into<String>) -> Self {
        self.manifest.exports.schemas.push(name.into());
        self
    }

    pub fn state(mut self, name: impl Into<String>, state: ContractStateStore) -> Self {
        self.manifest.state.insert(name.into(), state);
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

    pub fn event(mut self, name: impl Into<String>, event: ContractEvent) -> Self {
        self.manifest.events.insert(name.into(), event);
        self
    }

    pub fn feed(mut self, name: impl Into<String>, feed: ContractFeed) -> Self {
        self.manifest.feeds.insert(name.into(), feed);
        self
    }

    pub fn kv_resource(mut self, name: impl Into<String>, kv: ContractKvResource) -> Self {
        self.manifest.resources.kv.insert(name.into(), kv);
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

    pub fn build(mut self) -> Result<ContractManifest, ContractsError> {
        self.apply_baseline_uses()?;
        self.project_declared_capabilities()?;
        let value = serde_json::to_value(self.manifest)?;
        parse_manifest(value)
    }

    pub fn build_unvalidated(mut self) -> ContractManifest {
        let _ = self.apply_baseline_uses();
        let _ = self.project_declared_capabilities();
        self.manifest
    }

    fn apply_baseline_uses(&mut self) -> Result<(), ContractsError> {
        if matches!(
            self.manifest.kind,
            ContractKind::Service | ContractKind::Device
        ) && self.manifest.id != "trellis.health@v1"
        {
            merge_use_ref(
                &mut self.manifest.uses,
                "health",
                use_contract("trellis.health@v1").with_event_publish(["Health.Heartbeat"]),
            )?;
        }
        Ok(())
    }

    fn project_declared_capabilities(&mut self) -> Result<(), ContractsError> {
        if self.manifest.capabilities.is_empty() {
            assert_no_undeclared_local_capabilities(&self.manifest)?;
            return Ok(());
        }

        let declared = self.manifest.capabilities.clone();
        project_contract_capabilities(&mut self.manifest, &declared)?;
        Ok(())
    }
}

fn project_contract_capabilities(
    manifest: &mut ContractManifest,
    declared: &ContractCapabilities,
) -> Result<(), ContractsError> {
    let contract_id = manifest.id.clone();
    manifest.capabilities = declared
        .iter()
        .map(|(name, metadata)| (global_capability_name(&contract_id, name), metadata.clone()))
        .collect();

    for method in manifest.rpc.values_mut() {
        if let Some(capabilities) = method.capabilities.as_mut() {
            project_capability_list(
                &mut capabilities.call,
                &contract_id,
                declared,
                "rpc call capabilities",
            )?;
        }
    }
    for operation in manifest.operations.values_mut() {
        if let Some(capabilities) = operation.capabilities.as_mut() {
            project_capability_list(
                &mut capabilities.call,
                &contract_id,
                declared,
                "operation call capabilities",
            )?;
            project_capability_list(
                &mut capabilities.observe,
                &contract_id,
                declared,
                "operation observe capabilities",
            )?;
            project_capability_list(
                &mut capabilities.cancel,
                &contract_id,
                declared,
                "operation cancel capabilities",
            )?;
            project_capability_list(
                &mut capabilities.control,
                &contract_id,
                declared,
                "operation control capabilities",
            )?;
        }
    }
    for event in manifest.events.values_mut() {
        if let Some(capabilities) = event.capabilities.as_mut() {
            project_capability_list(
                &mut capabilities.publish,
                &contract_id,
                declared,
                "event publish capabilities",
            )?;
            project_capability_list(
                &mut capabilities.subscribe,
                &contract_id,
                declared,
                "event subscribe capabilities",
            )?;
        }
    }
    for feed in manifest.feeds.values_mut() {
        if let Some(capabilities) = feed.capabilities.as_mut() {
            project_capability_list(
                &mut capabilities.subscribe,
                &contract_id,
                declared,
                "feed subscribe capabilities",
            )?;
        }
    }
    Ok(())
}

fn project_capability_list(
    capabilities: &mut Option<Vec<String>>,
    contract_id: &str,
    declared: &ContractCapabilities,
    context: &str,
) -> Result<(), ContractsError> {
    let Some(capabilities) = capabilities else {
        return Ok(());
    };
    for capability in &mut *capabilities {
        if declared.contains_key(capability) {
            *capability = global_capability_name(contract_id, capability);
        } else if !is_external_capability_ref(capability) {
            return Err(ContractsError::UndeclaredCapability {
                context: context.to_string(),
                capability: capability.clone(),
            });
        }
    }
    capabilities.sort();
    capabilities.dedup();
    Ok(())
}

fn is_external_capability_ref(capability: &str) -> bool {
    matches!(capability, "admin" | "service") || capability.contains("::")
}

fn assert_no_undeclared_local_capabilities(
    manifest: &ContractManifest,
) -> Result<(), ContractsError> {
    for method in manifest.rpc.values() {
        if let Some(capabilities) = method.capabilities.as_ref() {
            assert_capability_list_external(&capabilities.call, "rpc call capabilities")?;
        }
    }
    for operation in manifest.operations.values() {
        if let Some(capabilities) = operation.capabilities.as_ref() {
            assert_capability_list_external(&capabilities.call, "operation call capabilities")?;
            assert_capability_list_external(
                &capabilities.observe,
                "operation observe capabilities",
            )?;
            assert_capability_list_external(&capabilities.cancel, "operation cancel capabilities")?;
            assert_capability_list_external(
                &capabilities.control,
                "operation control capabilities",
            )?;
        }
    }
    for event in manifest.events.values() {
        if let Some(capabilities) = event.capabilities.as_ref() {
            assert_capability_list_external(&capabilities.publish, "event publish capabilities")?;
            assert_capability_list_external(
                &capabilities.subscribe,
                "event subscribe capabilities",
            )?;
        }
    }
    for feed in manifest.feeds.values() {
        if let Some(capabilities) = feed.capabilities.as_ref() {
            assert_capability_list_external(
                &capabilities.subscribe,
                "feed subscribe capabilities",
            )?;
        }
    }
    Ok(())
}

fn assert_capability_list_external(
    capabilities: &Option<Vec<String>>,
    context: &str,
) -> Result<(), ContractsError> {
    let Some(capabilities) = capabilities else {
        return Ok(());
    };
    for capability in capabilities {
        if !is_external_capability_ref(capability) {
            return Err(ContractsError::UndeclaredCapability {
                context: context.to_string(),
                capability: capability.clone(),
            });
        }
    }
    Ok(())
}

fn add_unique_strings(target: &mut Vec<String>, values: impl IntoIterator<Item = String>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}

fn merge_use_ref(
    uses: &mut crate::ContractUses,
    alias: impl Into<String>,
    use_ref: ContractUseRef,
) -> Result<(), ContractsError> {
    merge_use_ref_map(uses.required_mut(), alias, use_ref)
}

fn merge_use_ref_map(
    uses: &mut std::collections::BTreeMap<String, ContractUseRef>,
    alias: impl Into<String>,
    use_ref: ContractUseRef,
) -> Result<(), ContractsError> {
    let alias = alias.into();
    let Some(existing) = uses.get_mut(&alias) else {
        uses.insert(alias, use_ref);
        return Ok(());
    };

    if existing.contract != use_ref.contract {
        return Err(ContractsError::ContractUseConflict {
            alias,
            existing_contract: existing.contract.clone(),
            new_contract: use_ref.contract,
        });
    }

    if let Some(rpc) = use_ref.rpc {
        let existing_rpc = existing.rpc.get_or_insert_with(ContractUseRpc::default);
        if let Some(next_call) = rpc.call {
            let call = existing_rpc.call.get_or_insert_with(Vec::new);
            add_unique_strings(call, next_call);
        }
    }

    if let Some(operations) = use_ref.operations {
        let existing_operations = existing
            .operations
            .get_or_insert_with(ContractUseOperation::default);
        if let Some(next_call) = operations.call {
            let call = existing_operations.call.get_or_insert_with(Vec::new);
            add_unique_strings(call, next_call);
        }
    }

    if let Some(events) = use_ref.events {
        let existing_events = existing
            .events
            .get_or_insert_with(ContractUsePubSub::default);
        if let Some(next_publish) = events.publish {
            let publish = existing_events.publish.get_or_insert_with(Vec::new);
            add_unique_strings(publish, next_publish);
        }
        if let Some(next_subscribe) = events.subscribe {
            let subscribe = existing_events.subscribe.get_or_insert_with(Vec::new);
            add_unique_strings(subscribe, next_subscribe);
        }
    }
    if let Some(feeds) = use_ref.feeds {
        let existing_feeds = existing.feeds.get_or_insert_with(ContractUseFeed::default);
        if let Some(next_subscribe) = feeds.subscribe {
            let subscribe = existing_feeds.subscribe.get_or_insert_with(Vec::new);
            add_unique_strings(subscribe, next_subscribe);
        }
    }
    Ok(())
}

pub fn schema_ref(name: impl Into<String>) -> ContractSchemaRef {
    ContractSchemaRef {
        schema: name.into(),
    }
}

/// Return the global capability namespace for a contract id.
pub fn contract_capability_namespace(contract_id: &str) -> String {
    let Some((namespace, version)) = contract_id.rsplit_once("@v") else {
        return contract_id.to_string();
    };
    if version.chars().all(|char| char.is_ascii_digit()) && !version.is_empty() {
        namespace.to_string()
    } else {
        contract_id.to_string()
    }
}

/// Return the globally qualified name for a contract-local capability.
pub fn global_capability_name(contract_id: &str, local_capability: &str) -> String {
    format!(
        "{}::{local_capability}",
        contract_capability_namespace(contract_id)
    )
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
        transfer: None,
        docs: None,
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
        signals: Default::default(),
        docs: None,
    }
}

pub fn event(
    version: impl Into<String>,
    subject: impl Into<String>,
    event_schema: impl Into<String>,
) -> ContractEvent {
    ContractEvent {
        version: version.into(),
        subject: subject.into(),
        params: None,
        event: schema_ref(event_schema),
        capabilities: None,
        docs: None,
    }
}

pub fn feed(
    version: impl Into<String>,
    subject: impl Into<String>,
    input_schema: impl Into<String>,
    event_schema: impl Into<String>,
) -> ContractFeed {
    ContractFeed {
        version: version.into(),
        subject: subject.into(),
        input: schema_ref(input_schema),
        event: schema_ref(event_schema),
        capabilities: None,
        docs: None,
    }
}

pub fn state(kind: ContractStateKind, schema: impl Into<String>) -> ContractStateStore {
    ContractStateStore {
        kind,
        schema: schema_ref(schema),
        state_version: None,
        accepted_versions: Default::default(),
    }
}

pub fn use_contract(contract: impl Into<String>) -> ContractUseRef {
    ContractUseRef {
        contract: contract.into(),
        rpc: None,
        operations: None,
        events: None,
        feeds: None,
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
    pub fn docs_with_summary(
        mut self,
        summary: impl Into<String>,
        markdown: impl Into<String>,
    ) -> Self {
        self.docs = Some(ContractDocs {
            summary: Some(summary.into()),
            markdown: markdown.into(),
        });
        self
    }

    pub fn with_receive_transfer(mut self) -> Self {
        self.transfer = Some(ContractRpcTransfer {
            direction: ContractRpcTransferDirection::Receive,
        });
        self
    }

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
            direction: ContractOperationTransferDirection::Send,
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

    pub fn with_observe_capabilities(
        mut self,
        observe: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(OperationCapabilities::default);
        capabilities.observe = Some(observe.into_iter().map(Into::into).collect());
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

    /// Sets the capabilities required for named operation-control signals.
    pub fn with_control_capabilities(
        mut self,
        control_capabilities: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(OperationCapabilities::default);
        capabilities.control = Some(control_capabilities.into_iter().map(Into::into).collect());
        self
    }

    pub fn cancel(mut self, cancel: bool) -> Self {
        self.cancel = Some(cancel);
        self
    }

    pub fn signal(mut self, name: impl Into<String>, input: impl Into<String>) -> Self {
        self.signals.insert(
            name.into(),
            ContractOperationSignal {
                input: schema_ref(input),
                docs: None,
            },
        );
        self
    }
}

impl ContractEvent {
    pub fn with_publish_capabilities(
        mut self,
        publish: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(PubSubCapabilities::default);
        capabilities.publish = Some(publish.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_subscribe_capabilities(
        mut self,
        subscribe: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(PubSubCapabilities::default);
        capabilities.subscribe = Some(subscribe.into_iter().map(Into::into).collect());
        self
    }
}

impl ContractFeed {
    pub fn with_subscribe_capabilities(
        mut self,
        subscribe: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        let capabilities = self
            .capabilities
            .get_or_insert_with(FeedCapabilities::default);
        capabilities.subscribe = Some(subscribe.into_iter().map(Into::into).collect());
        self
    }
}

impl ContractStateStore {
    pub fn state_version(mut self, state_version: impl Into<String>) -> Self {
        self.state_version = Some(state_version.into());
        self
    }

    pub fn accepted_version(
        mut self,
        version: impl Into<String>,
        schema: impl Into<String>,
    ) -> Self {
        self.accepted_versions
            .insert(version.into(), schema_ref(schema));
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
        let events = self.events.get_or_insert_with(ContractUsePubSub::default);
        events.publish = Some(publish.into_iter().map(Into::into).collect());
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
        let events = self.events.get_or_insert_with(ContractUsePubSub::default);
        events.subscribe = Some(subscribe.into_iter().map(Into::into).collect());
        self
    }

    pub fn with_feed_subscribe(
        mut self,
        subscribe: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        self.feeds = Some(ContractUseFeed {
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
