use serde_json::{json, Value};
use trellis_contracts::{
    event, feed, job_queue, kv, operation, rpc, schema_ref, store, ContractKind, ContractManifest,
    ContractManifestBuilder, ContractsError,
};

fn empty_object_schema() -> Value {
    json!({
        "type": "object",
        "properties": {}
    })
}

fn bounded_list_request_schema() -> Value {
    json!({
        "type": "object",
        "required": ["limit", "offset"],
        "properties": {
            "limit": {"type": "integer", "minimum": 0, "maximum": 500},
            "offset": {"type": "integer", "minimum": 0}
        }
    })
}

fn non_empty_string_schema() -> Value {
    json!({"type": "string", "minLength": 1})
}

fn string_record_schema() -> Value {
    json!({
        "type": "object",
        "patternProperties": {
            "^.*$": {"type": "string"}
        }
    })
}

fn site_summary_schema() -> Value {
    json!({
        "type": "object",
        "required": [
            "siteId",
            "siteName",
            "openInspections",
            "overdueInspections",
            "latestStatus",
            "lastReportAt"
        ],
        "properties": {
            "siteId": non_empty_string_schema(),
            "siteName": non_empty_string_schema(),
            "openInspections": {"type": "integer", "minimum": 0},
            "overdueInspections": {"type": "integer", "minimum": 0},
            "latestStatus": non_empty_string_schema(),
            "lastReportAt": non_empty_string_schema()
        }
    })
}

fn inspection_assignment_schema() -> Value {
    json!({
        "type": "object",
        "required": [
            "inspectionId",
            "siteId",
            "siteName",
            "assetName",
            "checklistName",
            "priority",
            "scheduledFor"
        ],
        "properties": {
            "inspectionId": non_empty_string_schema(),
            "siteId": non_empty_string_schema(),
            "siteName": non_empty_string_schema(),
            "assetName": non_empty_string_schema(),
            "checklistName": non_empty_string_schema(),
            "priority": {
                "anyOf": [
                    {"type": "string", "const": "high"},
                    {"type": "string", "const": "medium"},
                    {"type": "string", "const": "low"}
                ]
            },
            "scheduledFor": non_empty_string_schema()
        }
    })
}

fn evidence_record_schema() -> Value {
    json!({
        "type": "object",
        "required": ["evidenceId", "key", "size", "evidenceType", "uploadedAt"],
        "properties": {
            "evidenceId": non_empty_string_schema(),
            "key": non_empty_string_schema(),
            "size": {"type": "integer", "minimum": 0},
            "contentType": non_empty_string_schema(),
            "evidenceType": non_empty_string_schema(),
            "fileName": non_empty_string_schema(),
            "uploadedAt": non_empty_string_schema()
        }
    })
}

fn evidence_file_info_schema() -> Value {
    json!({
        "type": "object",
        "required": ["key", "size", "updatedAt", "metadata"],
        "properties": {
            "key": non_empty_string_schema(),
            "size": {"type": "integer", "minimum": 0},
            "updatedAt": non_empty_string_schema(),
            "digest": non_empty_string_schema(),
            "contentType": non_empty_string_schema(),
            "metadata": string_record_schema()
        }
    })
}

fn evidence_download_grant_schema() -> Value {
    json!({
        "type": "object",
        "required": [
            "type",
            "direction",
            "service",
            "sessionKey",
            "transferId",
            "subject",
            "expiresAt",
            "chunkBytes",
            "info"
        ],
        "properties": {
            "type": {"type": "string", "const": "TransferGrant"},
            "direction": {"type": "string", "const": "receive"},
            "service": non_empty_string_schema(),
            "sessionKey": non_empty_string_schema(),
            "transferId": non_empty_string_schema(),
            "subject": non_empty_string_schema(),
            "expiresAt": non_empty_string_schema(),
            "chunkBytes": {"type": "integer", "minimum": 1},
            "info": evidence_file_info_schema()
        }
    })
}

fn report_record_schema() -> Value {
    json!({
        "type": "object",
        "required": [
            "reportId",
            "inspectionId",
            "siteName",
            "assetName",
            "status",
            "publishedAt",
            "reportComment",
            "summary",
            "readiness",
            "evidenceStatus"
        ],
        "properties": {
            "reportId": non_empty_string_schema(),
            "inspectionId": non_empty_string_schema(),
            "siteId": non_empty_string_schema(),
            "siteName": non_empty_string_schema(),
            "assetName": non_empty_string_schema(),
            "status": non_empty_string_schema(),
            "publishedAt": non_empty_string_schema(),
            "reportComment": {"type": "string", "minLength": 1, "pattern": "\\S"},
            "summary": non_empty_string_schema(),
            "readiness": non_empty_string_schema(),
            "evidenceStatus": non_empty_string_schema()
        }
    })
}

fn progress_schema() -> Value {
    json!({
        "type": "object",
        "required": ["stage", "message"],
        "properties": {
            "stage": non_empty_string_schema(),
            "message": non_empty_string_schema()
        }
    })
}

fn named_live_feed_event(name: &str, event_schema: Value) -> Value {
    json!({
        "type": "object",
        "required": ["name", "event"],
        "properties": {
            "name": {"type": "string", "const": name},
            "event": event_schema
        }
    })
}

fn activity_live_feed_event_schema() -> Value {
    json!({
        "anyOf": [
            named_live_feed_event("Audit.Recorded", json!({
                "type": "object",
                "required": ["activityId", "kind", "message", "occurredAt"],
                "properties": {
                    "activityId": non_empty_string_schema(),
                    "kind": non_empty_string_schema(),
                    "message": non_empty_string_schema(),
                    "occurredAt": non_empty_string_schema(),
                    "relatedSiteId": non_empty_string_schema(),
                    "relatedInspectionId": non_empty_string_schema()
                }
            })),
            named_live_feed_event("Reports.Published", json!({
                "type": "object",
                "required": ["reportId", "inspectionId", "publishedAt"],
                "properties": {
                    "reportId": non_empty_string_schema(),
                    "inspectionId": non_empty_string_schema(),
                    "siteId": non_empty_string_schema(),
                    "publishedAt": non_empty_string_schema()
                }
            })),
            named_live_feed_event("Evidence.Uploaded", evidence_record_schema()),
            named_live_feed_event("Sites.Refreshed", json!({
                "type": "object",
                "required": ["refreshId", "site", "refreshedAt"],
                "properties": {
                    "refreshId": non_empty_string_schema(),
                    "site": site_summary_schema(),
                    "refreshedAt": non_empty_string_schema()
                }
            }))
        ]
    })
}

fn with_schemas(builder: ContractManifestBuilder) -> ContractManifestBuilder {
    builder
        .schema(
            "AuditRecordedEvent",
            json!({
                "type": "object",
                "required": ["activityId", "kind", "message", "occurredAt"],
                "properties": {
                    "activityId": non_empty_string_schema(),
                    "kind": non_empty_string_schema(),
                    "message": non_empty_string_schema(),
                    "occurredAt": non_empty_string_schema(),
                    "relatedSiteId": non_empty_string_schema(),
                    "relatedInspectionId": non_empty_string_schema()
                }
            }),
        )
        .schema("InspectionAssignment", inspection_assignment_schema())
        .schema("AssignmentsListRequest", bounded_list_request_schema())
        .schema(
            "AssignmentsListResponse",
            json!({
                "type": "object",
                "required": ["assignments"],
                "properties": {
                    "assignments": {
                        "type": "array",
                        "items": inspection_assignment_schema()
                    }
                }
            }),
        )
        .schema("SiteSummary", site_summary_schema())
        .schema("SitesListRequest", bounded_list_request_schema())
        .schema(
            "SitesListResponse",
            json!({
                "type": "object",
                "required": ["sites"],
                "properties": {
                    "sites": {"type": "array", "items": site_summary_schema()}
                }
            }),
        )
        .schema(
            "SitesGetRequest",
            json!({
                "type": "object",
                "required": ["siteId"],
                "properties": {"siteId": non_empty_string_schema()}
            }),
        )
        .schema(
            "SitesGetResponse",
            json!({
                "type": "object",
                "properties": {"site": site_summary_schema()}
            }),
        )
        .schema(
            "SitesRefreshRequest",
            json!({
                "type": "object",
                "required": ["siteId"],
                "properties": {"siteId": non_empty_string_schema()}
            }),
        )
        .schema("SitesRefreshProgress", progress_schema())
        .schema(
            "SitesRefreshResponse",
            json!({
                "type": "object",
                "required": ["refreshId", "site", "status"],
                "properties": {
                    "refreshId": non_empty_string_schema(),
                    "site": site_summary_schema(),
                    "status": non_empty_string_schema()
                }
            }),
        )
        .schema(
            "SiteRefreshJobPayload",
            json!({
                "type": "object",
                "required": ["siteId"],
                "properties": {"siteId": non_empty_string_schema()}
            }),
        )
        .schema(
            "SiteRefreshJobResult",
            json!({
                "type": "object",
                "required": ["refreshId", "site", "status"],
                "properties": {
                    "refreshId": non_empty_string_schema(),
                    "site": site_summary_schema(),
                    "status": non_empty_string_schema()
                }
            }),
        )
        .schema(
            "SitesRefreshedEvent",
            json!({
                "type": "object",
                "required": ["refreshId", "site", "refreshedAt"],
                "properties": {
                    "refreshId": non_empty_string_schema(),
                    "site": site_summary_schema(),
                    "refreshedAt": non_empty_string_schema()
                }
            }),
        )
        .schema(
            "EvidenceUploadRequest",
            json!({
                "type": "object",
                "required": ["key", "evidenceType"],
                "properties": {
                    "key": non_empty_string_schema(),
                    "contentType": non_empty_string_schema(),
                    "evidenceType": non_empty_string_schema(),
                    "metadata": string_record_schema()
                }
            }),
        )
        .schema("EvidenceUploadProgress", progress_schema())
        .schema(
            "EvidenceUploadResponse",
            json!({
                "type": "object",
                "required": ["evidenceId", "key", "size", "disposition"],
                "properties": {
                    "evidenceId": non_empty_string_schema(),
                    "key": non_empty_string_schema(),
                    "size": {"type": "integer", "minimum": 0},
                    "contentType": non_empty_string_schema(),
                    "fileName": non_empty_string_schema(),
                    "disposition": non_empty_string_schema()
                }
            }),
        )
        .schema("EvidenceRecord", evidence_record_schema())
        .schema(
            "EvidenceListRequest",
            json!({
                "type": "object",
                "required": ["limit", "offset"],
                "properties": {
                    "limit": {"type": "integer", "minimum": 0, "maximum": 500},
                    "offset": {"type": "integer", "minimum": 0},
                    "prefix": non_empty_string_schema()
                }
            }),
        )
        .schema(
            "EvidenceListResponse",
            json!({
                "type": "object",
                "required": ["evidence"],
                "properties": {
                    "evidence": {"type": "array", "items": evidence_record_schema()}
                }
            }),
        )
        .schema(
            "EvidenceDownloadRequest",
            json!({
                "type": "object",
                "required": ["key"],
                "properties": {"key": non_empty_string_schema()}
            }),
        )
        .schema("EvidenceFileInfo", evidence_file_info_schema())
        .schema("EvidenceDownloadGrant", evidence_download_grant_schema())
        .schema(
            "EvidenceDownloadResponse",
            json!({
                "type": "object",
                "required": ["transfer"],
                "properties": {"transfer": evidence_download_grant_schema()}
            }),
        )
        .schema(
            "EvidenceDeleteRequest",
            json!({
                "type": "object",
                "required": ["key"],
                "properties": {"key": non_empty_string_schema()}
            }),
        )
        .schema(
            "EvidenceDeleteResponse",
            json!({
                "type": "object",
                "required": ["key", "deleted"],
                "properties": {
                    "key": non_empty_string_schema(),
                    "deleted": {"type": "boolean"}
                }
            }),
        )
        .schema("EvidenceUploadedEvent", evidence_record_schema())
        .schema(
            "ReportsGenerateRequest",
            json!({
                "type": "object",
                "required": ["inspectionId", "reportComment"],
                "properties": {
                    "inspectionId": non_empty_string_schema(),
                    "reportComment": {"type": "string", "minLength": 1, "pattern": "\\S"}
                }
            }),
        )
        .schema("ReportsGenerateProgress", progress_schema())
        .schema(
            "ReportsGenerateResponse",
            json!({
                "type": "object",
                "required": ["reportId", "inspectionId", "status"],
                "properties": {
                    "reportId": non_empty_string_schema(),
                    "inspectionId": non_empty_string_schema(),
                    "status": non_empty_string_schema()
                }
            }),
        )
        .schema("ReportRecord", report_record_schema())
        .schema("ReportsListRequest", bounded_list_request_schema())
        .schema(
            "ReportsListResponse",
            json!({
                "type": "object",
                "required": ["reports"],
                "properties": {
                    "reports": {"type": "array", "items": report_record_schema()}
                }
            }),
        )
        .schema(
            "ReportsPublishedEvent",
            json!({
                "type": "object",
                "required": ["reportId", "inspectionId", "publishedAt"],
                "properties": {
                    "reportId": non_empty_string_schema(),
                    "inspectionId": non_empty_string_schema(),
                    "siteId": non_empty_string_schema(),
                    "publishedAt": non_empty_string_schema()
                }
            }),
        )
        .schema("ActivityLiveFeedRequest", empty_object_schema())
        .schema("ActivityLiveFeedEvent", activity_live_feed_event_schema())
}

fn service_rpc(
    subject: &'static str,
    input_schema: &'static str,
    output_schema: &'static str,
    errors: impl IntoIterator<Item = &'static str>,
) -> trellis_contracts::ContractRpcMethod {
    rpc("v1", subject, input_schema, output_schema)
        .with_call_capabilities(Vec::<&str>::new())
        .with_error_types(errors)
}

fn service_operation(
    subject: &'static str,
    input_schema: &'static str,
    progress_schema: &'static str,
    output_schema: &'static str,
) -> trellis_contracts::ContractOperation {
    operation(
        "v1",
        subject,
        input_schema,
        Some(progress_schema),
        Some(output_schema),
    )
    .with_call_capabilities(Vec::<&str>::new())
    .with_read_capabilities(Vec::<&str>::new())
}

/// Build the Rust-authored Field Ops demo service contract manifest.
pub fn contract_manifest() -> Result<ContractManifest, ContractsError> {
    let builder = ContractManifestBuilder::new(
        "trellis.demo-service@v1",
        "Field Ops Demo Service",
        "Consolidated Field Ops demo service for Trellis concepts.",
        ContractKind::Service,
    );

    with_schemas(builder)
        .export_schema("EvidenceRecord")
        .export_schema("InspectionAssignment")
        .export_schema("ReportRecord")
        .export_schema("SiteSummary")
        .job_queue(
            "refreshSiteSummary",
            job_queue(
                schema_ref("SiteRefreshJobPayload"),
                Some(schema_ref("SiteRefreshJobResult")),
            ),
        )
        .kv_resource(
            "siteSummaries",
            kv(
                "Latest site summaries for the Field Ops demo.",
                "SiteSummary",
            )
            .required(true)
            .history(1)
            .ttl_ms(0),
        )
        .store_resource(
            "uploads",
            store("Persistent evidence locker files for the Field Ops demo.")
                .required(true)
                .ttl_ms(0)
                .max_object_bytes(64 * 1024 * 1024)
                .max_total_bytes(256 * 1024 * 1024),
        )
        .rpc(
            "Assignments.List",
            service_rpc(
                "rpc.v1.Assignments.List",
                "AssignmentsListRequest",
                "AssignmentsListResponse",
                ["UnexpectedError"],
            ),
        )
        .rpc(
            "Sites.List",
            service_rpc(
                "rpc.v1.Sites.List",
                "SitesListRequest",
                "SitesListResponse",
                ["UnexpectedError"],
            ),
        )
        .rpc(
            "Sites.Get",
            service_rpc(
                "rpc.v1.Sites.Get",
                "SitesGetRequest",
                "SitesGetResponse",
                ["UnexpectedError"],
            ),
        )
        .rpc(
            "Evidence.List",
            service_rpc(
                "rpc.v1.Evidence.List",
                "EvidenceListRequest",
                "EvidenceListResponse",
                ["UnexpectedError"],
            ),
        )
        .rpc(
            "Evidence.Download",
            service_rpc(
                "rpc.v1.Evidence.Download",
                "EvidenceDownloadRequest",
                "EvidenceDownloadResponse",
                ["TransferError", "UnexpectedError"],
            )
            .with_receive_transfer(),
        )
        .rpc(
            "Evidence.Delete",
            service_rpc(
                "rpc.v1.Evidence.Delete",
                "EvidenceDeleteRequest",
                "EvidenceDeleteResponse",
                ["UnexpectedError"],
            ),
        )
        .rpc(
            "Reports.List",
            service_rpc(
                "rpc.v1.Reports.List",
                "ReportsListRequest",
                "ReportsListResponse",
                ["UnexpectedError"],
            ),
        )
        .operation(
            "Sites.Refresh",
            service_operation(
                "operations.v1.Sites.Refresh",
                "SitesRefreshRequest",
                "SitesRefreshProgress",
                "SitesRefreshResponse",
            ),
        )
        .operation(
            "Reports.Generate",
            service_operation(
                "operations.v1.Reports.Generate",
                "ReportsGenerateRequest",
                "ReportsGenerateProgress",
                "ReportsGenerateResponse",
            )
            .with_cancel_capabilities(Vec::<&str>::new())
            .cancel(true),
        )
        .operation(
            "Evidence.Upload",
            service_operation(
                "operations.v1.Evidence.Upload",
                "EvidenceUploadRequest",
                "EvidenceUploadProgress",
                "EvidenceUploadResponse",
            )
            .with_transfer(
                "uploads",
                "/key",
                Some("/contentType"),
                Some("/metadata"),
                Some(60_000),
                None,
            ),
        )
        .event(
            "Audit.Recorded",
            event("v1", "events.v1.Audit.Recorded", "AuditRecordedEvent"),
        )
        .event(
            "Reports.Published",
            event("v1", "events.v1.Reports.Published", "ReportsPublishedEvent"),
        )
        .event(
            "Evidence.Uploaded",
            event("v1", "events.v1.Evidence.Uploaded", "EvidenceUploadedEvent"),
        )
        .event(
            "Sites.Refreshed",
            event("v1", "events.v1.Sites.Refreshed", "SitesRefreshedEvent"),
        )
        .feed(
            "Audit.Feed",
            feed(
                "v1",
                "feeds.v1.Audit.Feed",
                "ActivityLiveFeedRequest",
                "ActivityLiveFeedEvent",
            )
            .with_subscribe_capabilities(Vec::<&str>::new()),
        )
        .build()
}
