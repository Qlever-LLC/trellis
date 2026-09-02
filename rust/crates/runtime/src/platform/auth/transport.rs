use std::collections::{BTreeMap, BTreeSet};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use trellis_protocol::{
    parse_api, parse_participant, resolve_participant, ApiArtifact, ApiSurfaceKind,
    AuthorizationPrincipalKind, ParticipantResourceKind, PermissionAction,
    UnsignedAuthorizationContext,
};

use super::{
    AuthorizationRegistryBinding, AuthorizationStateError, ParticipantBindingRecord,
    ResourceBindingEvidence, ResourceProviderIdentity,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TransportPermissions {
    pub publish: Vec<String>,
    pub subscribe: Vec<String>,
}

pub(crate) fn compile_transport_permissions(
    context: &UnsignedAuthorizationContext,
    binding: &ParticipantBindingRecord,
    resource_bindings: &[ResourceBindingEvidence],
    registry: &AuthorizationRegistryBinding,
) -> Result<TransportPermissions, AuthorizationStateError> {
    if binding.participant_id != context.participant.id
        || binding.artifact_digest != context.participant.artifact_digest
        || binding.needs_digest != context.participant.needs_digest
    {
        return invalid("issuable state does not match participant binding");
    }
    let participant_value: Value = serde_json::from_str(&binding.participant_json)
        .map_err(|error| invalid_error(format!("participant JSON is invalid: {error}")))?;
    let participant =
        parse_participant(&participant_value).map_err(|error| invalid_error(error.to_string()))?;
    let api_values: BTreeMap<String, Value> = serde_json::from_str(&binding.api_artifacts_json)
        .map_err(|error| invalid_error(format!("API artifact map is invalid: {error}")))?;
    let mut apis = BTreeMap::new();
    for (api_id, value) in api_values {
        let api = parse_api(&value).map_err(|error| invalid_error(error.to_string()))?;
        if api.id() != api_id {
            return invalid("API artifact map key does not match artifact ID");
        }
        apis.insert(api_id, api);
    }
    let resolved = resolve_participant(&participant, &apis)
        .map_err(|error| invalid_error(error.to_string()))?;
    if resolved.participant_digest() != context.participant.artifact_digest
        || resolved
            .needs()
            .digest()
            .map_err(|error| invalid_error(error.to_string()))?
            != context.participant.needs_digest
    {
        return invalid("resolved participant identity does not match issuable state");
    }

    let mut publish = BTreeSet::new();
    let mut subscribe = BTreeSet::from([format!("{}.>", context.inbox_prefix)]);

    // Narrow authorization-registry read/watch binding for every connected
    // runtime. Direct reads are limited by key token shape, while watch consumer
    // creation is bound to the two exact filters used by the registry clients.
    publish.insert("$JS.API.INFO".to_owned());
    let trust_stream = format!("KV_{}", registry.trust_bucket);
    let context_stream = format!("KV_{}", registry.context_bucket);
    publish.insert(format!("$JS.API.STREAM.INFO.{trust_stream}"));
    publish.insert(format!("$JS.API.STREAM.INFO.{context_stream}"));
    publish.insert(format!("$JS.FC.{trust_stream}.>"));
    publish.insert(format!("$JS.FC.{context_stream}.>"));
    publish.insert(format!(
        "$JS.API.DIRECT.GET.{trust_stream}.$KV.{}.manifest.*",
        registry.trust_bucket
    ));
    publish.insert(format!(
        "$JS.API.DIRECT.GET.{context_stream}.$KV.{}.>",
        registry.context_bucket
    ));
    publish.insert(format!(
        "$JS.API.CONSUMER.CREATE.{trust_stream}.*.$KV.{}.manifest.current",
        registry.trust_bucket
    ));
    publish.insert(format!("$JS.API.CONSUMER.INFO.{trust_stream}.*"));
    publish.insert(format!("$JS.API.CONSUMER.INFO.{context_stream}.*"));
    if matches!(
        context.principal.kind,
        AuthorizationPrincipalKind::Service | AuthorizationPrincipalKind::Device
    ) {
        publish.insert("$JS.API.INFO".to_owned());
        if context.principal.kind == AuthorizationPrincipalKind::Service {
            let instance_id = context
                .instance_id
                .as_deref()
                .ok_or_else(|| invalid_error("service instance is missing"))?;
            let bucket = format!("trellis_operations_{instance_id}");
            let stream = format!("KV_{bucket}");
            publish.insert(format!("$KV.{bucket}.>"));
            publish.insert(format!("$JS.API.STREAM.CREATE.{stream}"));
            publish.insert(format!("$JS.API.CONSUMER.DELETE.{stream}.>"));
            publish.insert(format!("$JS.API.$KV.{bucket}.>"));
            kv_read(&bucket, &mut publish);
        }
        let deployment_id = context.deployment_id.as_deref().ok_or_else(|| {
            invalid_error("deployed principal is missing deployment identity".to_owned())
        })?;
        let instance_id = context.instance_id.as_deref().ok_or_else(|| {
            invalid_error("deployed principal is missing instance identity".to_owned())
        })?;
        let kind = match context.principal.kind {
            AuthorizationPrincipalKind::Service => "service",
            AuthorizationPrincipalKind::Device => "device",
            AuthorizationPrincipalKind::User => unreachable!(),
        };
        publish.insert(format!(
            "health.v1.heartbeat.{kind}.{}.{}.{}.{}.{}",
            URL_SAFE_NO_PAD.encode(context.participant.id.as_bytes()),
            URL_SAFE_NO_PAD.encode(context.participant.artifact_digest.as_bytes()),
            URL_SAFE_NO_PAD.encode(deployment_id.as_bytes()),
            URL_SAFE_NO_PAD.encode(instance_id.as_bytes()),
            context.session_key,
        ));
    }

    for implementation in resolved.implemented_apis() {
        let provided = implementation.provided();
        let api = apis
            .get(provided.api())
            .ok_or_else(|| invalid_error("implemented API artifact is missing".to_owned()))?;
        let api_value = api
            .normalized_value()
            .map_err(|error| invalid_error(error.to_string()))?;
        let session_prefix = &context.session_key[..16.min(context.session_key.len())];
        subscribe.extend(provided.rpc().values().cloned());
        for name in provided.rpc().keys() {
            if api_value["rpc"][name]["transfer"]["direction"].as_str() == Some("receive") {
                subscribe.insert(format!("transfer.v1.download.{session_prefix}.*"));
            }
        }
        for operation in provided.operations().values() {
            subscribe.insert(operation.subject().to_owned());
            subscribe.insert(format!("{}.control", operation.subject()));
        }
        for name in provided.operations().keys() {
            if api_value["operations"][name]["transfer"]["direction"].as_str() == Some("send") {
                subscribe.insert(format!("transfer.v1.upload.{session_prefix}.*"));
            }
        }
        subscribe.extend(provided.feeds().values().cloned());
    }

    for atom in context.grant_set.permissions() {
        if let Some((api_id, surface, name)) = atom.target().as_api_surface() {
            let api = apis
                .get(api_id)
                .ok_or_else(|| invalid_error(format!("grant references unknown API {api_id}")))?;
            compile_api_surface(
                api,
                surface,
                name,
                atom.action(),
                &mut publish,
                &mut subscribe,
            )?;
        } else if let Some((api_id, operation, _signal)) = atom.target().as_operation_signal() {
            let subject = api_subject(apis.get(api_id), ApiSurfaceKind::Operation, operation)?;
            if atom.action() != PermissionAction::Control {
                return invalid("operation signal grant must use control action");
            }
            publish.insert(format!("{subject}.control"));
        } else if let Some((participant_id, kind, name)) = atom.target().as_participant_resource() {
            if participant_id != context.participant.id {
                return invalid("resource grant belongs to another participant");
            }
            let resource = resource_binding(resource_bindings, kind, name)?;
            compile_resource(resource, atom.action(), &mut publish, &mut subscribe)?;
        }
    }

    Ok(TransportPermissions {
        publish: publish.into_iter().collect(),
        subscribe: subscribe.into_iter().collect(),
    })
}

#[cfg(test)]
pub(crate) fn compile_test_transport_permissions(
    state: &super::IssuableAuthorizationState,
    binding: &ParticipantBindingRecord,
    registry: &AuthorizationRegistryBinding,
) -> Result<TransportPermissions, AuthorizationStateError> {
    let context = UnsignedAuthorizationContext {
        format: trellis_protocol::AUTHORIZATION_CONTEXT_FORMAT_V1.to_owned(),
        authority: "test".to_owned(),
        issuer_key_id: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
        issuer_manifest_generation: 1,
        session_id: state.session_id.clone(),
        session_key: state.session_public_key.clone(),
        principal: state.principal.clone(),
        participant: state.participant.clone(),
        authority_ref: state.authority_ref.clone(),
        deployment_id: state.deployment_id.clone(),
        instance_id: state.instance_id.clone(),
        inbox_prefix: state.inbox_prefix.clone(),
        issued_at: 1,
        not_before: 1,
        expires_at: 2,
        grant_set: state.grant_set.clone(),
        capabilities: state.capabilities.clone(),
        extensions: serde_json::Map::new(),
        critical: Vec::new(),
    };
    compile_transport_permissions(&context, binding, &state.resource_bindings, registry)
}

fn compile_api_surface(
    api: &ApiArtifact,
    surface: ApiSurfaceKind,
    name: &str,
    action: PermissionAction,
    publish: &mut BTreeSet<String>,
    subscribe: &mut BTreeSet<String>,
) -> Result<(), AuthorizationStateError> {
    let subjects = api
        .derived_subjects()
        .map_err(|error| invalid_error(error.to_string()))?;
    let api_value = api
        .normalized_value()
        .map_err(|error| invalid_error(error.to_string()))?;
    match (surface, action) {
        (ApiSurfaceKind::Rpc, PermissionAction::Call) => {
            publish.insert(required_subject(subjects.rpc.get(name), "RPC", name)?);
            if api_value["rpc"][name]["transfer"]["direction"].as_str() == Some("receive") {
                publish.insert("transfer.v1.download.*.*".to_owned());
            }
        }
        (ApiSurfaceKind::Operation, PermissionAction::Invoke) => {
            let subject = required_subject(subjects.operations.get(name), "operation", name)?;
            publish.insert(subject.clone());
            publish.insert(format!("{subject}.control"));
            if api_value["operations"][name]["transfer"]["direction"].as_str() == Some("send") {
                publish.insert("transfer.v1.upload.*.*".to_owned());
            }
        }
        (ApiSurfaceKind::Operation, PermissionAction::Observe) => {
            let subject = required_subject(subjects.operations.get(name), "operation", name)?;
            publish.insert(format!("{subject}.control"));
        }
        (ApiSurfaceKind::Operation, PermissionAction::Cancel | PermissionAction::Control) => {
            let subject = required_subject(subjects.operations.get(name), "operation", name)?;
            publish.insert(format!("{subject}.control"));
        }
        (ApiSurfaceKind::Event, PermissionAction::Publish) => {
            publish.insert(
                subjects
                    .events
                    .get(name)
                    .ok_or_else(|| invalid_error(format!("unknown event {name}")))?
                    .wildcard
                    .clone(),
            );
        }
        (ApiSurfaceKind::Event, PermissionAction::Subscribe) => {
            subscribe.insert(
                subjects
                    .events
                    .get(name)
                    .ok_or_else(|| invalid_error(format!("unknown event {name}")))?
                    .wildcard
                    .clone(),
            );
        }
        (ApiSurfaceKind::Feed, PermissionAction::Subscribe) => {
            publish.insert(required_subject(subjects.feeds.get(name), "feed", name)?);
        }
        (ApiSurfaceKind::State, PermissionAction::Read) => {
            publish.insert("rpc.v1.State.Get".to_owned());
            publish.insert("rpc.v1.State.List".to_owned());
        }
        (ApiSurfaceKind::State, PermissionAction::Write) => {
            publish.insert("rpc.v1.State.Put".to_owned());
        }
        (ApiSurfaceKind::State, PermissionAction::Delete) => {
            publish.insert("rpc.v1.State.Delete".to_owned());
        }
        _ => return invalid("grant action does not match API surface"),
    }
    Ok(())
}

fn api_subject(
    api: Option<&ApiArtifact>,
    surface: ApiSurfaceKind,
    name: &str,
) -> Result<String, AuthorizationStateError> {
    let api = api.ok_or_else(|| invalid_error("grant references unknown API"))?;
    let subjects = api
        .derived_subjects()
        .map_err(|error| invalid_error(error.to_string()))?;
    match surface {
        ApiSurfaceKind::Operation => {
            required_subject(subjects.operations.get(name), "operation", name)
        }
        _ => invalid("unsupported subject lookup"),
    }
}

fn required_subject(
    subject: Option<&String>,
    kind: &str,
    name: &str,
) -> Result<String, AuthorizationStateError> {
    subject
        .cloned()
        .ok_or_else(|| invalid_error(format!("unknown {kind} {name}")))
}

fn resource_binding<'a>(
    resources: &'a [ResourceBindingEvidence],
    kind: ParticipantResourceKind,
    name: &str,
) -> Result<&'a ResourceBindingEvidence, AuthorizationStateError> {
    let kind = match kind {
        ParticipantResourceKind::Kv => "kv",
        ParticipantResourceKind::Store => "store",
        ParticipantResourceKind::JobQueue => "jobQueue",
        ParticipantResourceKind::EventConsumer => "eventConsumer",
        ParticipantResourceKind::State => "state",
    };
    resources
        .iter()
        .find(|resource| resource.resource_kind == kind && resource.local_name == name)
        .ok_or_else(|| invalid_error(format!("missing physical binding for {kind} {name}")))
}

fn compile_resource(
    resource: &ResourceBindingEvidence,
    action: PermissionAction,
    publish: &mut BTreeSet<String>,
    subscribe: &mut BTreeSet<String>,
) -> Result<(), AuthorizationStateError> {
    match (&resource.provider_identity, action) {
        (ResourceProviderIdentity::Kv { bucket }, PermissionAction::Read) => {
            kv_read(bucket, publish);
        }
        (ResourceProviderIdentity::Kv { bucket }, PermissionAction::Write)
        | (ResourceProviderIdentity::Kv { bucket }, PermissionAction::Delete) => {
            publish.insert(format!("$KV.{bucket}.>"));
            publish.insert(format!("$JS.API.STREAM.INFO.KV_{bucket}"));
        }
        (
            ResourceProviderIdentity::State { .. },
            PermissionAction::Read | PermissionAction::Write | PermissionAction::Delete,
        ) => {}
        (ResourceProviderIdentity::Store { bucket }, PermissionAction::Read) => {
            let stream = format!("OBJ_{bucket}");
            publish.insert("$JS.API.INFO".to_owned());
            publish.insert(format!("$JS.API.STREAM.INFO.{stream}"));
            publish.insert(format!("$JS.API.STREAM.MSG.GET.{stream}"));
            publish.insert(format!("$JS.API.CONSUMER.CREATE.{stream}"));
            publish.insert(format!("$JS.API.CONSUMER.CREATE.{stream}.>"));
            publish.insert(format!("$JS.API.CONSUMER.MSG.NEXT.{stream}.>"));
            publish.insert(format!("$JS.API.CONSUMER.DELETE.{stream}.>"));
            publish.insert(format!("$JS.FC.{stream}.>"));
            publish.insert(format!("$JS.ACK.{stream}.>"));
        }
        (
            ResourceProviderIdentity::Store { bucket },
            PermissionAction::Write | PermissionAction::Delete,
        ) => {
            publish.insert(format!("$O.{bucket}.C.>"));
            publish.insert(format!("$O.{bucket}.M.>"));
            publish.insert(format!("$JS.API.STREAM.PURGE.OBJ_{bucket}"));
        }
        (
            ResourceProviderIdentity::JobQueue {
                namespace: _,
                work_stream,
                publish_prefix,
                updates_prefix,
                ..
            },
            PermissionAction::Submit,
        ) => {
            publish.insert(format!("{publish_prefix}.>"));
            publish.insert(format!("$JS.API.CONSUMER.INFO.{work_stream}.>"));
            if let Some(prefix) = updates_prefix {
                subscribe.insert(format!("{prefix}.>"));
            }
        }
        (
            ResourceProviderIdentity::JobQueue {
                namespace,
                work_stream,
                publish_prefix,
                work_subject,
                consumer,
                updates_prefix,
                ..
            },
            PermissionAction::Process,
        ) => {
            let keys_bucket = format!("JOBS_KEYS_{namespace}");
            subscribe.insert(work_subject.clone());
            subscribe.insert(format!("{publish_prefix}.>"));
            publish.insert(format!("{publish_prefix}.>"));
            publish.insert(format!("trellis.jobs.workers.{namespace}.>"));
            publish.insert("$JS.API.DIRECT.GET.JOBS".to_owned());
            publish.insert("$JS.API.DIRECT.GET.JOBS.>".to_owned());
            publish.insert("$JS.API.STREAM.MSG.GET.JOBS".to_owned());
            publish.insert(format!("$KV.{keys_bucket}.>"));
            kv_read(&keys_bucket, publish);
            publish.insert(format!("$JS.API.STREAM.INFO.{work_stream}"));
            publish.insert(format!("$JS.API.CONSUMER.INFO.{work_stream}.{consumer}"));
            publish.insert(format!("$JS.API.CONSUMER.MSG.NEXT.{work_stream}.>"));
            publish.insert(format!("$JS.ACK.{work_stream}.>"));
            if let Some(prefix) = updates_prefix {
                publish.insert(format!("{prefix}.>"));
                subscribe.insert(format!("{prefix}.>"));
            }
        }
        (
            ResourceProviderIdentity::EventConsumer {
                stream, consumer, ..
            },
            PermissionAction::Consume,
        ) => {
            publish.insert(format!("$JS.API.CONSUMER.INFO.{stream}.{consumer}"));
            publish.insert(format!("$JS.API.CONSUMER.MSG.NEXT.{stream}.{consumer}"));
            publish.insert(format!("$JS.ACK.{stream}.{consumer}.>"));
        }
        _ => return invalid("resource action does not match physical binding"),
    }
    Ok(())
}

fn kv_read(bucket: &str, publish: &mut BTreeSet<String>) {
    let stream = format!("KV_{bucket}");
    publish.insert(format!("$JS.API.STREAM.INFO.{stream}"));
    publish.insert(format!("$JS.API.STREAM.MSG.GET.{stream}"));
    publish.insert(format!("$JS.API.DIRECT.GET.{stream}"));
    publish.insert(format!("$JS.API.DIRECT.GET.{stream}.>"));
    publish.insert(format!("$JS.API.CONSUMER.CREATE.{stream}.>"));
    publish.insert(format!("$JS.API.CONSUMER.MSG.NEXT.{stream}.>"));
    publish.insert(format!("$JS.ACK.{stream}.>"));
}

fn invalid<T>(message: impl Into<String>) -> Result<T, AuthorizationStateError> {
    Err(invalid_error(message))
}

fn invalid_error(message: impl Into<String>) -> AuthorizationStateError {
    AuthorizationStateError::InvalidRecord(message.into())
}

#[cfg(test)]
mod tests {
    use super::{compile_resource, compile_test_transport_permissions};
    use crate::platform::auth::{
        AuthorityKind, IssuableAuthorizationState, ParticipantBindingRecord,
        ParticipantBindingState, ResourceBindingEvidence, ResourceBindingState,
        ResourceProviderIdentity,
    };
    use serde_json::Value;
    use std::collections::BTreeSet;
    use trellis_protocol::{
        parse_api, parse_participant, resolve_participant, ApiSurfaceKind,
        AuthorizationAuthorityKind, AuthorizationAuthorityRef, AuthorizationParticipant,
        AuthorizationPrincipal, AuthorizationPrincipalKind, GrantSet, ParticipantResourceKind,
        PermissionAction, PermissionAtom, PermissionTarget,
    };

    fn test_registry_binding() -> super::super::context::AuthorizationRegistryBinding {
        super::super::context::AuthorizationRegistryBinding::test_binding()
    }

    #[test]
    fn canonical_administrator_compiles_all_console_transport_subjects() {
        let binding = super::super::cli_participant_binding(1).expect("CLI participant binding");
        let resolved = binding.resolve().expect("resolved CLI participant");
        let state = IssuableAuthorizationState {
            principal: AuthorizationPrincipal {
                kind: AuthorizationPrincipalKind::User,
                id: "usr_admin".to_owned(),
            },
            session_id: "ses_admin".to_owned(),
            session_public_key: "session-key".to_owned(),
            session_key_id: "session-key-id".to_owned(),
            inbox_prefix: "_INBOX.admin".to_owned(),
            participant: AuthorizationParticipant {
                kind: binding.participant_kind,
                id: binding.participant_id.clone(),
                artifact_digest: binding.artifact_digest.clone(),
                needs_digest: binding.needs_digest.clone(),
            },
            authority_ref: AuthorizationAuthorityRef {
                kind: AuthorizationAuthorityKind::Identity,
                id: "auth_admin".to_owned(),
                version: 1,
            },
            deployment_id: None,
            instance_id: None,
            grant_set: GrantSet::new(
                resolved
                    .proposal()
                    .required()
                    .grant_set()
                    .permissions()
                    .iter()
                    .chain(resolved.proposal().optional().grant_set().permissions())
                    .cloned()
                    .collect(),
            ),
            resource_bindings: Vec::new(),
            capabilities: vec!["trellis.jobs::read".to_owned()],
            session_expires_at: None,
            effective_authority_expires_at: None,
            delegation_expires_at: None,
            materialization_version: 1,
        };

        let permissions =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding())
                .expect("administrator transport permissions");

        for subject in [
            "rpc.v1.Jobs.ListServices",
            "rpc.v1.Jobs.Metrics",
            "rpc.v1.EventLog.Query",
            "feed.v1.Health.Watch",
        ] {
            assert!(permissions.publish.iter().any(|allowed| allowed == subject));
        }
    }

    #[test]
    fn registry_read_watch_is_granted_and_writes_are_denied() {
        let (binding, state) = fixture();
        let permissions =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        for bucket in [
            "KV_trellis_authorization_trust",
            "KV_trellis_authorization_contexts",
        ] {
            assert!(permissions
                .publish
                .contains(&format!("$JS.API.STREAM.INFO.{bucket}")));
            assert!(permissions
                .publish
                .contains(&format!("$JS.API.CONSUMER.INFO.{bucket}.*")));
        }
        for allowed in [
            "$JS.API.DIRECT.GET.KV_trellis_authorization_trust.$KV.trellis_authorization_trust.manifest.*",
            "$JS.API.DIRECT.GET.KV_trellis_authorization_contexts.$KV.trellis_authorization_contexts.>",
            "$JS.API.CONSUMER.CREATE.KV_trellis_authorization_trust.*.$KV.trellis_authorization_trust.manifest.current",
            "$JS.FC.KV_trellis_authorization_trust.>",
            "$JS.FC.KV_trellis_authorization_contexts.>",
        ] {
            assert!(permissions.publish.contains(&allowed.to_owned()));
        }
        assert!(!permissions
            .publish
            .iter()
            .any(|subject| subject.ends_with(".revocation.>")));
        assert!(permissions.publish.contains(&"$JS.API.INFO".to_owned()));
        // KV value writes, registry administration, and stream mutation are denied.
        for denied in [
            "$KV.trellis_authorization_trust.>",
            "$KV.trellis_authorization_contexts.>",
            "$JS.API.CONSUMER.DELETE.KV_trellis_authorization_trust.*",
            "$JS.API.CONSUMER.DELETE.KV_trellis_authorization_contexts.*",
            "$JS.API.STREAM.CREATE.KV_trellis_authorization_trust",
            "$JS.API.STREAM.UPDATE.KV_trellis_authorization_trust",
            "$JS.API.STREAM.DELETE.KV_trellis_authorization_trust",
            "$JS.API.KV.PURGE.trellis_authorization_trust",
            "$JS.API.CONSUMER.LIST.KV_trellis_authorization_trust",
            "$JS.API.CONSUMER.DELETE.KV_trellis_authorization_trust.consumer",
            "$JS.API.CONSUMER.MSG.NEXT.KV_trellis_authorization_trust.consumer",
            "$JS.ACK.KV_trellis_authorization_trust.consumer.>",
            "$JS.API.STREAM.MSG.GET.KV_trellis_authorization_trust",
            "$JS.API.STREAM.MSG.GET.KV_trellis_authorization_contexts",
            "$JS.API.CONSUMER.CREATE.KV_trellis_authorization_trust",
            "$JS.API.CONSUMER.CREATE.KV_trellis_authorization_contexts",
            "$JS.API.CONSUMER.CREATE.KV_trellis_authorization_trust.*.$KV.trellis_authorization_trust.>",
            "$JS.API.CONSUMER.CREATE.KV_trellis_authorization_contexts.*.$KV.trellis_authorization_contexts.>",
        ] {
            assert!(
                !permissions.publish.contains(&denied.to_owned()),
                "granted denied registry permission {denied}"
            );
        }
    }

    #[test]
    fn jobs_participant_has_no_transitional_transport_shortcut() {
        let (binding, state) = fixture_for("acme.jobs@v1");
        assert_eq!(state.participant.id, "acme.jobs@v1");
        // Compile the fixture service identity and assert the transport carries
        // no Jobs/JetStream shortcut subjects beyond the registry binding.
        let permissions =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        assert!(!permissions
            .publish
            .iter()
            .any(|subject| subject == "trellis.jobs.>"));
        assert!(!permissions.publish.iter().any(|subject| {
            (subject.starts_with("$JS.API.STREAM.INFO.JOBS")
                || subject.starts_with("$JS.API.CONSUMER.")
                || subject.starts_with("$JS.API.STREAM.MSG.GET.JOBS"))
                && !subject.contains("KV_")
        }));
        assert!(!permissions
            .subscribe
            .contains(&"feed.v1.Jobs.Watch".to_owned()));
    }

    #[test]
    fn job_process_update_subscription_is_resource_exact() {
        let resource = ResourceBindingEvidence {
            resource_kind: "jobQueue".to_owned(),
            local_name: "documents".to_owned(),
            binding_id: "binding-documents".to_owned(),
            owner_participant_id: "acme.jobs@v1".to_owned(),
            provider_identity: ResourceProviderIdentity::JobQueue {
                namespace: "tr_jobs_documents".to_owned(),
                work_stream: "JOBS_WORK_DOCUMENTS".to_owned(),
                publish_prefix: "trellis.jobs.tr_jobs_documents.process".to_owned(),
                updates_prefix: Some("trellis.job_updates.tr_jobs_documents.process".to_owned()),
                work_subject: "trellis.work.tr_jobs_documents.process".to_owned(),
                consumer: "worker-documents".to_owned(),
            },
            state: ResourceBindingState::Available,
            materialized_at: 1,
            error: None,
        };
        let mut publish = BTreeSet::new();
        let mut subscribe = BTreeSet::new();

        compile_resource(
            &resource,
            PermissionAction::Process,
            &mut publish,
            &mut subscribe,
        )
        .unwrap();

        assert_eq!(
            subscribe,
            BTreeSet::from([
                "trellis.job_updates.tr_jobs_documents.process.>".to_owned(),
                "trellis.jobs.tr_jobs_documents.process.>".to_owned(),
                "trellis.work.tr_jobs_documents.process".to_owned(),
            ])
        );
    }

    #[test]
    fn compiler_is_exact_sorted_and_action_scoped() {
        let (binding, mut state) = fixture();
        state.grant_set = GrantSet::new(vec![
            PermissionAtom::new(
                PermissionTarget::api_surface(
                    "trellis.auth@v1",
                    ApiSurfaceKind::Rpc,
                    "Auth.Sessions.Me",
                )
                .unwrap(),
                PermissionAction::Call,
            )
            .unwrap(),
            PermissionAtom::new(
                PermissionTarget::participant_resource(
                    "trellis.auth-runtime",
                    ParticipantResourceKind::Kv,
                    "browserFlows",
                )
                .unwrap(),
                PermissionAction::Read,
            )
            .unwrap(),
        ]);
        state.resource_bindings = vec![ResourceBindingEvidence {
            resource_kind: "kv".to_owned(),
            local_name: "browserFlows".to_owned(),
            binding_id: "binding-browser-flows".to_owned(),
            owner_participant_id: "trellis.auth-runtime".to_owned(),
            provider_identity: ResourceProviderIdentity::Kv {
                bucket: "AUTH_BROWSER_FLOWS".to_owned(),
            },
            state: ResourceBindingState::Available,
            materialized_at: 1,
            error: None,
        }];

        let permissions =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        assert!(permissions.publish.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(permissions
            .subscribe
            .windows(2)
            .all(|pair| pair[0] < pair[1]));
        assert!(permissions
            .publish
            .contains(&"rpc.v1.Auth.Sessions.Me".to_owned()));
        assert!(!permissions
            .publish
            .contains(&"rpc.v1.Auth.Users.Create".to_owned()));
        assert!(permissions
            .publish
            .contains(&"$JS.API.DIRECT.GET.KV_AUTH_BROWSER_FLOWS".to_owned()));
        assert!(!permissions
            .publish
            .contains(&"$KV.AUTH_BROWSER_FLOWS.>".to_owned()));
        assert!(permissions
            .subscribe
            .contains(&"_INBOX.session.>".to_owned()));
        assert_eq!(
            permissions,
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap()
        );
    }

    #[test]
    fn resource_binding_never_creates_authority() {
        let (binding, mut state) = fixture();
        state.resource_bindings = vec![kv_binding("trellis.auth-runtime")];

        state.grant_set = GrantSet::new(Vec::new());
        let none =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        assert!(!none
            .publish
            .iter()
            .any(|subject| subject.contains("AUTH_BROWSER_FLOWS")));

        state.grant_set = GrantSet::new(vec![kv_atom(PermissionAction::Read)]);
        let read =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        assert!(read
            .publish
            .contains(&"$JS.API.DIRECT.GET.KV_AUTH_BROWSER_FLOWS".to_owned()));
        assert!(!read
            .publish
            .contains(&"$KV.AUTH_BROWSER_FLOWS.>".to_owned()));

        state.grant_set = GrantSet::new(vec![kv_atom(PermissionAction::Write)]);
        let write =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        assert!(write
            .publish
            .contains(&"$KV.AUTH_BROWSER_FLOWS.>".to_owned()));
        assert!(!write
            .publish
            .iter()
            .any(|subject| subject.starts_with("$JS.API.DIRECT.GET.KV_AUTH_BROWSER_FLOWS")));

        state.grant_set = GrantSet::new(Vec::new());
        let reduced =
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).unwrap();
        assert!(!reduced
            .publish
            .iter()
            .any(|subject| subject.contains("AUTH_BROWSER_FLOWS")));
    }

    #[test]
    fn resource_atom_for_another_participant_fails_closed() {
        let (binding, mut state) = fixture();
        state.resource_bindings = vec![kv_binding("trellis.auth-runtime")];
        state.grant_set = GrantSet::new(vec![PermissionAtom::new(
            PermissionTarget::participant_resource(
                "other-participant",
                ParticipantResourceKind::Kv,
                "browserFlows",
            )
            .unwrap(),
            PermissionAction::Read,
        )
        .unwrap()]);
        assert!(
            compile_test_transport_permissions(&state, &binding, &test_registry_binding()).is_err()
        );
    }

    fn kv_atom(action: PermissionAction) -> PermissionAtom {
        PermissionAtom::new(
            PermissionTarget::participant_resource(
                "trellis.auth-runtime",
                ParticipantResourceKind::Kv,
                "browserFlows",
            )
            .unwrap(),
            action,
        )
        .unwrap()
    }

    fn kv_binding(owner: &str) -> ResourceBindingEvidence {
        ResourceBindingEvidence {
            resource_kind: "kv".to_owned(),
            local_name: "browserFlows".to_owned(),
            binding_id: "binding-browser-flows".to_owned(),
            owner_participant_id: owner.to_owned(),
            provider_identity: ResourceProviderIdentity::Kv {
                bucket: "AUTH_BROWSER_FLOWS".to_owned(),
            },
            state: ResourceBindingState::Available,
            materialized_at: 1,
            error: None,
        }
    }

    fn fixture() -> (ParticipantBindingRecord, IssuableAuthorizationState) {
        fixture_for("trellis.auth-runtime")
    }

    fn fixture_for(participant_id: &str) -> (ParticipantBindingRecord, IssuableAuthorizationState) {
        let api_value: Value =
            serde_json::from_str(include_str!("../../../trellis.api.json")).expect("auth API JSON");
        let mut participant_value: Value =
            serde_json::from_str(include_str!("../../../trellis.participant.json"))
                .expect("auth participant JSON");
        participant_value["id"] = Value::String(participant_id.to_owned());
        let api = parse_api(&api_value).expect("auth API");
        let participant = parse_participant(&participant_value).expect("auth participant");
        let apis = std::collections::BTreeMap::from([(api.id().to_owned(), api.clone())]);
        let resolved = resolve_participant(&participant, &apis).expect("resolved participant");
        let binding = ParticipantBindingRecord {
            participant_id: participant.id().to_owned(),
            participant_kind: participant.kind(),
            artifact_digest: participant.digest().unwrap(),
            needs_digest: resolved.needs().digest().unwrap(),
            participant_json: participant.canonical_json().unwrap(),
            api_artifacts_json: serde_json::to_string(&std::collections::BTreeMap::from([(
                api.id().to_owned(),
                api_value,
            )]))
            .unwrap(),
            resolved_at: 1,
            state: ParticipantBindingState::Resolved,
            error: None,
        };
        let state = IssuableAuthorizationState {
            principal: AuthorizationPrincipal {
                kind: AuthorizationPrincipalKind::Service,
                id: "svc_auth".to_owned(),
            },
            session_id: "ses_01".to_owned(),
            session_public_key: "session-key".to_owned(),
            session_key_id: "session-key-id".to_owned(),
            inbox_prefix: "_INBOX.session".to_owned(),
            participant: AuthorizationParticipant {
                kind: binding.participant_kind,
                id: binding.participant_id.clone(),
                artifact_digest: binding.artifact_digest.clone(),
                needs_digest: binding.needs_digest.clone(),
            },
            authority_ref: AuthorizationAuthorityRef {
                kind: AuthorizationAuthorityKind::Deployment,
                id: "dpa_auth".to_owned(),
                version: 1,
            },
            deployment_id: Some("dep_auth".to_owned()),
            instance_id: Some("ins_auth".to_owned()),
            grant_set: GrantSet::new(Vec::new()),
            resource_bindings: Vec::new(),
            capabilities: vec!["service".to_owned()],
            session_expires_at: None,
            effective_authority_expires_at: None,
            delegation_expires_at: None,
            materialization_version: 1,
        };
        let _ = AuthorityKind::Deployment;
        (binding, state)
    }
}
