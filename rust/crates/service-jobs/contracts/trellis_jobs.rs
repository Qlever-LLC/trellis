//! Rust source for the `trellis.jobs@v1` contract manifest.

use serde_json::{json, Value};
use trellis_contracts::{
    ContractCapabilityMetadata, ContractKind, ContractManifest, ContractManifestBuilder,
    ContractsError,
};

const READ_CAPABILITY: &str = "jobs.admin.read";
const MUTATE_CAPABILITY: &str = "jobs.admin.mutate";
const UNEXPECTED_ERROR: &str = "UnexpectedError";
const VALIDATION_ERROR: &str = "ValidationError";

/// Build the canonical Jobs admin contract manifest.
pub fn contract_manifest() -> Result<ContractManifest, ContractsError> {
    ContractManifestBuilder::new(
        "trellis.jobs@v1",
        "Trellis Jobs",
        "Trellis-managed background job administration API.",
        ContractKind::Service,
    )
    .use_ref(
        "core",
        trellis_contracts::use_contract("trellis.core@v1")
            .with_rpc_call(["Trellis.Bindings.Get", "Trellis.Catalog"]),
    )
    .use_ref(
        "auth",
        trellis_contracts::use_contract("trellis.auth@v1")
            .with_rpc_call(["Auth.Requests.Validate"]),
    )
    .capability(
        READ_CAPABILITY,
        ContractCapabilityMetadata {
            display_name: "Read jobs admin data".to_string(),
            description: "View Jobs service health, services, jobs, and dead-letter queues."
                .to_string(),
            consequence: None,
        },
    )
    .capability(
        MUTATE_CAPABILITY,
        ContractCapabilityMetadata {
            display_name: "Mutate jobs admin data".to_string(),
            description: "Cancel, retry, replay, or dismiss Jobs service work items.".to_string(),
            consequence: Some("Can change background job execution state.".to_string()),
        },
    )
    .schema("Empty", empty_schema())
    .schema("JobState", job_state_schema())
    .schema("JobLogEntry", job_log_entry_schema())
    .schema("JobProgress", job_progress_schema())
    .schema("Job", job_schema())
    .schema("JobsHealthResponse", jobs_health_response_schema())
    .schema(
        "JobsListServicesResponse",
        jobs_list_services_response_schema(),
    )
    .schema("JobsListRequest", job_list_request_schema())
    .schema("JobsListResponse", jobs_list_response_schema())
    .schema("JobsGetRequest", job_identity_schema())
    .schema("JobsGetResponse", jobs_get_response_schema())
    .schema("JobsCancelRequest", job_identity_schema())
    .schema("JobsCancelResponse", job_response_schema())
    .schema("JobsRetryRequest", job_identity_schema())
    .schema("JobsRetryResponse", job_response_schema())
    .schema("JobsListDLQRequest", job_list_request_schema())
    .schema("JobsListDLQResponse", jobs_list_response_schema())
    .schema("JobsReplayDLQRequest", job_identity_schema())
    .schema("JobsReplayDLQResponse", job_response_schema())
    .schema("JobsDismissDLQRequest", job_identity_schema())
    .schema("JobsDismissDLQResponse", job_response_schema())
    .rpc(
        "Jobs.Health",
        admin_rpc(
            "Jobs.Health",
            "Empty",
            "JobsHealthResponse",
            READ_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR]),
    )
    .rpc(
        "Jobs.ListServices",
        admin_rpc(
            "Jobs.ListServices",
            "Empty",
            "JobsListServicesResponse",
            READ_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR]),
    )
    .rpc(
        "Jobs.List",
        admin_rpc(
            "Jobs.List",
            "JobsListRequest",
            "JobsListResponse",
            READ_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .rpc(
        "Jobs.Get",
        admin_rpc(
            "Jobs.Get",
            "JobsGetRequest",
            "JobsGetResponse",
            READ_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .rpc(
        "Jobs.Cancel",
        admin_rpc(
            "Jobs.Cancel",
            "JobsCancelRequest",
            "JobsCancelResponse",
            MUTATE_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .rpc(
        "Jobs.Retry",
        admin_rpc(
            "Jobs.Retry",
            "JobsRetryRequest",
            "JobsRetryResponse",
            MUTATE_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .rpc(
        "Jobs.ListDLQ",
        admin_rpc(
            "Jobs.ListDLQ",
            "JobsListDLQRequest",
            "JobsListDLQResponse",
            READ_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .rpc(
        "Jobs.ReplayDLQ",
        admin_rpc(
            "Jobs.ReplayDLQ",
            "JobsReplayDLQRequest",
            "JobsReplayDLQResponse",
            MUTATE_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .rpc(
        "Jobs.DismissDLQ",
        admin_rpc(
            "Jobs.DismissDLQ",
            "JobsDismissDLQRequest",
            "JobsDismissDLQResponse",
            MUTATE_CAPABILITY,
        )
        .with_error_types([UNEXPECTED_ERROR, VALIDATION_ERROR]),
    )
    .build()
}

fn admin_rpc(
    name: &str,
    input_schema: &str,
    output_schema: &str,
    capability: &str,
) -> trellis_contracts::ContractRpcMethod {
    trellis_contracts::rpc("v1", format!("rpc.v1.{name}"), input_schema, output_schema)
        .with_call_capabilities([capability])
}

fn empty_schema() -> Value {
    json!({
        "type": "object",
        "properties": {}
    })
}

fn job_state_schema() -> Value {
    json!({
        "anyOf": [
            { "const": "pending", "type": "string" },
            { "const": "active", "type": "string" },
            { "const": "retry", "type": "string" },
            { "const": "completed", "type": "string" },
            { "const": "failed", "type": "string" },
            { "const": "cancelled", "type": "string" },
            { "const": "expired", "type": "string" },
            { "const": "dead", "type": "string" },
            { "const": "dismissed", "type": "string" }
        ]
    })
}

fn job_log_entry_schema() -> Value {
    json!({
        "type": "object",
        "required": ["timestamp", "level", "message"],
        "properties": {
            "timestamp": { "type": "string", "format": "date-time" },
            "level": {
                "anyOf": [
                    { "const": "info", "type": "string" },
                    { "const": "warn", "type": "string" },
                    { "const": "error", "type": "string" }
                ]
            },
            "message": { "type": "string" }
        }
    })
}

fn job_progress_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "step": { "type": "string" },
            "current": { "type": "integer", "minimum": 0 },
            "total": { "type": "integer", "minimum": 0 },
            "message": { "type": "string" }
        }
    })
}

fn job_schema() -> Value {
    json!({
        "type": "object",
        "required": [
            "id",
            "service",
            "type",
            "state",
            "payload",
            "createdAt",
            "updatedAt",
            "tries",
            "maxTries"
        ],
        "properties": {
            "id": { "type": "string", "minLength": 1 },
            "service": { "type": "string", "minLength": 1 },
            "type": { "type": "string", "minLength": 1 },
            "state": job_state_schema(),
            "payload": {},
            "result": {},
            "createdAt": { "type": "string", "format": "date-time" },
            "updatedAt": { "type": "string", "format": "date-time" },
            "startedAt": { "type": "string", "format": "date-time" },
            "completedAt": { "type": "string", "format": "date-time" },
            "tries": { "type": "integer", "minimum": 0 },
            "maxTries": { "type": "integer", "minimum": 1 },
            "lastError": { "type": "string" },
            "deadline": { "type": "string", "format": "date-time" },
            "progress": job_progress_schema(),
            "logs": { "type": "array", "items": job_log_entry_schema() }
        }
    })
}

fn job_identity_schema() -> Value {
    json!({
        "type": "object",
        "description": "Jobs admin ids are globally addressable; callers identify jobs by id only.",
        "required": ["id"],
        "properties": {
            "id": { "type": "string", "minLength": 1 }
        }
    })
}

fn job_list_request_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "service": { "type": "string", "minLength": 1 },
            "type": { "type": "string", "minLength": 1 },
            "state": job_state_schema(),
            "since": { "type": "string", "format": "date-time" },
            "cursor": { "type": "string", "minLength": 1 },
            "limit": { "type": "integer", "minimum": 1 }
        }
    })
}

fn worker_schema() -> Value {
    json!({
        "type": "object",
        "required": ["service", "jobType", "instanceId", "timestamp"],
        "properties": {
            "service": { "type": "string", "minLength": 1 },
            "jobType": { "type": "string", "minLength": 1 },
            "instanceId": { "type": "string", "minLength": 1 },
            "timestamp": { "type": "string", "format": "date-time" },
            "concurrency": { "type": "integer", "minimum": 1 },
            "version": { "type": "string", "minLength": 1 }
        }
    })
}

fn jobs_health_response_schema() -> Value {
    json!({
        "type": "object",
        "required": ["service", "status", "timestamp", "checks"],
        "properties": {
            "service": { "type": "string", "minLength": 1 },
            "status": {},
            "timestamp": { "type": "string", "format": "date-time" },
            "checks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "patternProperties": { "^.*$": {} }
                }
            }
        }
    })
}

fn jobs_list_services_response_schema() -> Value {
    json!({
        "type": "object",
        "required": ["services"],
        "properties": {
            "services": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["name", "healthy", "workers"],
                    "properties": {
                        "name": { "type": "string", "minLength": 1 },
                        "healthy": { "type": "boolean" },
                        "workers": { "type": "array", "items": worker_schema() }
                    }
                }
            }
        }
    })
}

fn jobs_list_response_schema() -> Value {
    json!({
        "type": "object",
        "required": ["jobs", "hasMore"],
        "properties": {
            "jobs": { "type": "array", "items": job_schema() },
            "hasMore": { "type": "boolean" },
            "nextCursor": { "type": "string", "minLength": 1 }
        }
    })
}

fn jobs_get_response_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "job": job_schema()
        }
    })
}

fn job_response_schema() -> Value {
    json!({
        "type": "object",
        "required": ["job"],
        "properties": {
            "job": job_schema()
        }
    })
}
