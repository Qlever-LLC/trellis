use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use trellis_rs::client::{
    PreparedTrellisEvent, RpcDescriptor, ServiceConnectWithContractOptions, TrellisClient,
    TrellisClientError,
};
use trellis_rs::service::ConnectedServiceRuntime;

use crate::support::assertions::assert_case_registered;

const SERVICE_CONTRACT_ID: &str = "trellis.integration.outbox-service@v1";
const CLIENT_CONTRACT_ID: &str = "trellis.integration.outbox-client@v1";
const OUTBOX_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.outbox-service@v1",
  "displayName": "Trellis Integration Outbox Service",
  "description": "Exercises SQL outbox delivery with live NATS.",
  "kind": "service",
  "capabilities": {
    "readEvents": { "displayName": "Read events", "description": "Subscribe to outbox fixture events." }
  },
  "schemas": {
    "DocInput": { "type": "object", "required": ["documentId"], "properties": { "documentId": { "type": "string" } } },
    "DocOutput": { "type": "object", "required": ["documentId", "processedBy"], "properties": { "documentId": { "type": "string" }, "processedBy": { "type": "string" } } },
    "DocProcessed": { "type": "object", "required": ["documentId"], "properties": { "documentId": { "type": "string" } } },
    "DocAudited": { "type": "object", "required": ["documentId", "action"], "properties": { "documentId": { "type": "string" }, "action": { "type": "string" } } }
  },
  "rpc": {
    "Documents.Process": { "version": "v1", "subject": "rpc.v1.Integration.Outbox.Documents.Process", "input": { "schema": "DocInput" }, "output": { "schema": "DocOutput" }, "capabilities": { "call": [] }, "errors": [] },
    "Documents.ProcessWithRollback": { "version": "v1", "subject": "rpc.v1.Integration.Outbox.Documents.ProcessWithRollback", "input": { "schema": "DocInput" }, "output": { "schema": "DocOutput" }, "capabilities": { "call": [] }, "errors": [] },
    "Documents.ProcessMultiEvent": { "version": "v1", "subject": "rpc.v1.Integration.Outbox.Documents.ProcessMultiEvent", "input": { "schema": "DocInput" }, "output": { "schema": "DocOutput" }, "capabilities": { "call": [] }, "errors": [] }
  },
  "events": {
    "Document.Processed": { "version": "v1", "subject": "events.v1.Integration.Outbox.Document.Processed", "event": { "schema": "DocProcessed" }, "capabilities": { "publish": [], "subscribe": ["readEvents"] } },
    "Document.Audited": { "version": "v1", "subject": "events.v1.Integration.Outbox.Document.Audited", "event": { "schema": "DocAudited" }, "capabilities": { "publish": [], "subscribe": ["readEvents"] } }
  }
}"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocInput {
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocOutput {
    document_id: String,
    processed_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocProcessed {
    document_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DocAudited {
    document_id: String,
    action: String,
}

struct ProcessRpc;

impl trellis_rs::client::RpcDescriptor for ProcessRpc {
    type Input = DocInput;
    type Output = DocOutput;

    const KEY: &'static str = "Documents.Process";
    const SUBJECT: &'static str = "rpc.v1.Integration.Outbox.Documents.Process";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId"],"properties":{"documentId":{"type":"string"}}}"#;
    const OUTPUT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["documentId","processedBy"],"properties":{"documentId":{"type":"string"},"processedBy":{"type":"string"}}}"#;
}

struct ProcessWithRollbackRpc;

impl trellis_rs::client::RpcDescriptor for ProcessWithRollbackRpc {
    type Input = DocInput;
    type Output = DocOutput;

    const KEY: &'static str = "Documents.ProcessWithRollback";
    const SUBJECT: &'static str = "rpc.v1.Integration.Outbox.Documents.ProcessWithRollback";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = ProcessRpc::INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = ProcessRpc::OUTPUT_SCHEMA_JSON;
}

struct ProcessMultiEventRpc;

impl trellis_rs::client::RpcDescriptor for ProcessMultiEventRpc {
    type Input = DocInput;
    type Output = DocOutput;

    const KEY: &'static str = "Documents.ProcessMultiEvent";
    const SUBJECT: &'static str = "rpc.v1.Integration.Outbox.Documents.ProcessMultiEvent";
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &[];
    const INPUT_SCHEMA_JSON: &'static str = ProcessRpc::INPUT_SCHEMA_JSON;
    const OUTPUT_SCHEMA_JSON: &'static str = ProcessRpc::OUTPUT_SCHEMA_JSON;
}

struct ProcessedEvent;

impl trellis_rs::client::EventDescriptor for ProcessedEvent {
    type Event = DocProcessed;

    const KEY: &'static str = "Document.Processed";
    const SUBJECT: &'static str = "events.v1.Integration.Outbox.Document.Processed";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
}

struct AuditedEvent;

impl trellis_rs::client::EventDescriptor for AuditedEvent {
    type Event = DocAudited;

    const KEY: &'static str = "Document.Audited";
    const SUBJECT: &'static str = "events.v1.Integration.Outbox.Document.Audited";
    const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readEvents"];
}

struct OutboxContract;

struct AbortOnDrop<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T> AbortOnDrop<T> {
    fn new(handle: JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    async fn abort_and_wait(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

#[tokio::test]
async fn outbox_commits_event_through_sql_outbox() {
    assert_case_registered(
        "outbox.commits-event-through-sql-outbox",
        "outbox",
        "outbox",
    );

    let fixture = start_outbox_fixture().await;
    let db = Arc::new(tokio::sync::Mutex::new(create_db()));
    let mut service = fixture.service;
    let service_client = Arc::clone(service.client());
    let handler_db = Arc::clone(&db);
    service.register_rpc::<ProcessRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&handler_db);
        let service_client = Arc::clone(&service_client);
        async move {
            let processed = DocProcessed {
                document_id: input.document_id.clone(),
            };
            let prepared = trellis_rs::client::prepare_event::<ProcessedEvent>(&processed)
                .map_err(trellis_rs::service::ServerError::Json)?;
            {
                let conn = db.lock().await;
                conn.execute_batch("BEGIN").map_err(sqlite_server_error)?;
                enqueue_sql_event(
                    &conn,
                    &format!("{}:processed", input.document_id),
                    &prepared,
                )?;
                conn.execute_batch("COMMIT").map_err(sqlite_server_error)?;
            }
            publish_and_mark_dispatched(
                &db,
                &service_client,
                vec![(format!("{}:processed", input.document_id), prepared)],
            )
            .await?;
            Ok(DocOutput {
                document_id: input.document_id,
                processed_by: "outbox-commit".to_string(),
            })
        }
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let mut capture = capture_processed(&fixture.client).await;

    let output = call_rpc_with_retry::<ProcessRpc>(
        &fixture.client,
        &DocInput {
            document_id: "doc-commit".to_string(),
        },
        "Documents.Process",
    )
    .await;
    assert_eq!(output.document_id, "doc-commit");
    let event = wait_for_processed(&mut capture, "doc-commit").await;
    assert_eq!(event.document_id, "doc-commit");

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn outbox_rollback_does_not_publish() {
    assert_case_registered("outbox.rollback-does-not-publish", "outbox", "outbox");

    let fixture = start_outbox_fixture().await;
    let db = Arc::new(tokio::sync::Mutex::new(create_db()));
    let mut service = fixture.service;
    let handler_db = Arc::clone(&db);
    service.register_rpc::<ProcessWithRollbackRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&handler_db);
        async move {
            let processed = DocProcessed {
                document_id: input.document_id,
            };
            let prepared = trellis_rs::client::prepare_event::<ProcessedEvent>(&processed)
                .map_err(trellis_rs::service::ServerError::Json)?;
            let conn = db.lock().await;
            conn.execute_batch("BEGIN").map_err(sqlite_server_error)?;
            enqueue_sql_event(&conn, "rollback-event", &prepared)?;
            conn.execute_batch("ROLLBACK")
                .map_err(sqlite_server_error)?;
            Err(trellis_rs::service::ServerError::Nats(
                "intentional rollback".to_string(),
            ))
        }
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let mut capture = capture_processed(&fixture.client).await;
    let result = fixture
        .client
        .call::<ProcessWithRollbackRpc>(&DocInput {
            document_id: "doc-rollback".to_string(),
        })
        .await;
    assert!(result.is_err(), "rollback RPC should fail");
    assert_no_processed(&mut capture, "doc-rollback").await;

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn outbox_multiple_events_in_one_transaction() {
    assert_case_registered(
        "outbox.multiple-events-in-one-transaction",
        "outbox",
        "outbox",
    );

    let fixture = start_outbox_fixture().await;
    let db = Arc::new(tokio::sync::Mutex::new(create_db()));
    let mut service = fixture.service;
    let service_client = Arc::clone(service.client());
    let handler_db = Arc::clone(&db);
    service.register_rpc::<ProcessMultiEventRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&handler_db);
        let service_client = Arc::clone(&service_client);
        async move {
            let processed = trellis_rs::client::prepare_event::<ProcessedEvent>(&DocProcessed {
                document_id: input.document_id.clone(),
            })
            .map_err(trellis_rs::service::ServerError::Json)?;
            let audited = trellis_rs::client::prepare_event::<AuditedEvent>(&DocAudited {
                document_id: input.document_id.clone(),
                action: "multi".to_string(),
            })
            .map_err(trellis_rs::service::ServerError::Json)?;
            {
                let conn = db.lock().await;
                conn.execute_batch("BEGIN").map_err(sqlite_server_error)?;
                enqueue_sql_event(&conn, "multi-processed", &processed)?;
                enqueue_sql_event(&conn, "multi-audited", &audited)?;
                conn.execute_batch("COMMIT").map_err(sqlite_server_error)?;
            }
            publish_and_mark_dispatched(
                &db,
                &service_client,
                vec![
                    ("multi-processed".to_string(), processed),
                    ("multi-audited".to_string(), audited),
                ],
            )
            .await?;
            Ok(DocOutput {
                document_id: input.document_id,
                processed_by: "outbox-multi".to_string(),
            })
        }
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let mut processed_capture = capture_processed(&fixture.client).await;
    let mut audited_capture = capture_audited(&fixture.client).await;
    call_rpc_with_retry::<ProcessMultiEventRpc>(
        &fixture.client,
        &DocInput {
            document_id: "doc-multi".to_string(),
        },
        "Documents.ProcessMultiEvent",
    )
    .await;
    assert_eq!(
        wait_for_processed(&mut processed_capture, "doc-multi")
            .await
            .document_id,
        "doc-multi"
    );
    assert_eq!(
        wait_for_audited(&mut audited_capture, "doc-multi", "multi")
            .await
            .action,
        "multi"
    );

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn outbox_listener_derives_event() {
    assert_case_registered("outbox.listener-derives-event", "outbox", "outbox");

    let fixture = start_outbox_fixture().await;
    let db = Arc::new(tokio::sync::Mutex::new(create_db()));
    let mut service = fixture.service;
    let service_client = Arc::clone(service.client());
    let listener_client = Arc::clone(&service_client);
    let listener_db = Arc::clone(&db);
    let listener_task = AbortOnDrop::new(tokio::spawn(async move {
        let mut stream = listener_client
            .subscribe::<ProcessedEvent>()
            .await
            .expect("subscribe service listener to processed events");
        while let Some(result) = stream.next().await {
            let event = result.expect("listener receives processed event");
            let audited = trellis_rs::client::prepare_event::<AuditedEvent>(&DocAudited {
                document_id: event.document_id.clone(),
                action: "listener-derived".to_string(),
            })
            .expect("prepare audited event");
            {
                let conn = listener_db.lock().await;
                conn.execute_batch("BEGIN")
                    .expect("begin listener transaction");
                enqueue_sql_event(&conn, "listener-audited", &audited)
                    .expect("enqueue audited event");
                conn.execute_batch("COMMIT")
                    .expect("commit listener transaction");
            }
            publish_and_mark_dispatched(
                &listener_db,
                &listener_client,
                vec![("listener-audited".to_string(), audited)],
            )
            .await
            .expect("publish listener-derived audited event");
        }
    }));
    tokio::time::sleep(Duration::from_millis(250)).await;

    let handler_db = Arc::clone(&db);
    service.register_rpc::<ProcessRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&handler_db);
        let service_client = Arc::clone(&service_client);
        async move {
            let processed = trellis_rs::client::prepare_event::<ProcessedEvent>(&DocProcessed {
                document_id: input.document_id.clone(),
            })
            .map_err(trellis_rs::service::ServerError::Json)?;
            {
                let conn = db.lock().await;
                conn.execute_batch("BEGIN").map_err(sqlite_server_error)?;
                enqueue_sql_event(&conn, "listener-processed", &processed)?;
                conn.execute_batch("COMMIT").map_err(sqlite_server_error)?;
            }
            publish_and_mark_dispatched(
                &db,
                &service_client,
                vec![("listener-processed".to_string(), processed)],
            )
            .await?;
            Ok(DocOutput {
                document_id: input.document_id,
                processed_by: "outbox-listener".to_string(),
            })
        }
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    let mut processed_capture = capture_processed(&fixture.client).await;
    let mut audited_capture = capture_audited(&fixture.client).await;
    call_rpc_with_retry::<ProcessRpc>(
        &fixture.client,
        &DocInput {
            document_id: "doc-listener".to_string(),
        },
        "Documents.Process",
    )
    .await;
    assert_eq!(
        wait_for_processed(&mut processed_capture, "doc-listener")
            .await
            .document_id,
        "doc-listener"
    );
    assert_eq!(
        wait_for_audited(&mut audited_capture, "doc-listener", "listener-derived")
            .await
            .action,
        "listener-derived"
    );

    listener_task.abort_and_wait().await;
    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn outbox_sql_row_state_is_dispatched() {
    assert_case_registered("outbox.sql-row-state-is-dispatched", "outbox", "outbox");

    let fixture = start_outbox_fixture().await;
    let db = Arc::new(tokio::sync::Mutex::new(create_db()));
    let mut service = fixture.service;
    let service_client = Arc::clone(service.client());
    let handler_db = Arc::clone(&db);
    service.register_rpc::<ProcessRpc, _, _>(move |_context, input| {
        let db = Arc::clone(&handler_db);
        let service_client = Arc::clone(&service_client);
        async move {
            let prepared = trellis_rs::client::prepare_event::<ProcessedEvent>(&DocProcessed {
                document_id: input.document_id.clone(),
            })
            .map_err(trellis_rs::service::ServerError::Json)?;
            {
                let conn = db.lock().await;
                conn.execute_batch("BEGIN").map_err(sqlite_server_error)?;
                enqueue_sql_event(&conn, "row-state-event", &prepared)?;
                conn.execute_batch("COMMIT").map_err(sqlite_server_error)?;
            }
            publish_and_mark_dispatched(
                &db,
                &service_client,
                vec![("row-state-event".to_string(), prepared)],
            )
            .await?;
            Ok(DocOutput {
                document_id: input.document_id,
                processed_by: "outbox-row-state".to_string(),
            })
        }
    });
    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));
    call_rpc_with_retry::<ProcessRpc>(
        &fixture.client,
        &DocInput {
            document_id: "doc-row-state".to_string(),
        },
        "Documents.Process",
    )
    .await;
    let conn = db.lock().await;
    let (state, kind): (String, String) = conn
        .query_row(
            "SELECT state, kind FROM trellis_outbox WHERE id = ?1",
            params!["row-state-event"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read outbox row state");
    assert_eq!(state, "dispatched");
    assert_eq!(kind, "event.publish");
    drop(conn);
    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn outbox_sqlite_010_schema_upgrades() {
    assert_case_registered("outbox.sqlite-010-schema-upgrades", "outbox", "outbox");

    let db_path = temp_sqlite_path("outbox-sqlite-010-schema-upgrades");
    let conn = Connection::open(&db_path).expect("open SQLite test database");
    create_legacy_sql_outbox_schema(&conn);
    insert_legacy_sql_outbox_row(&conn);

    let processed = trellis_rs::client::prepare_event::<ProcessedEvent>(&DocProcessed {
        document_id: "doc-after-migration".to_string(),
    })
    .expect("prepare processed event");
    let before_migration =
        insert_service_sql_outbox_event(&conn, "new-before-migration", &processed);
    assert!(
        before_migration.is_err(),
        "legacy 0.10 outbox schema should reject 0.11 inserts"
    );

    apply_sqlite_sql_outbox_migrations(&conn);
    apply_sqlite_sql_outbox_migrations(&conn);
    drop(conn);

    let conn = Connection::open(&db_path).expect("reopen migrated SQLite test database");
    insert_service_sql_outbox_event(&conn, "new-after-migration", &processed)
        .expect("insert 0.11 outbox row after migration");

    let legacy: (String, String, String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT kind, name, state, next_attempt_at, outcome FROM trellis_outbox WHERE id = ?1",
            params!["legacy-1"],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .expect("read migrated legacy row");
    assert_eq!(legacy.0, "event.publish");
    assert_eq!(legacy.1, "Document.Processed");
    assert_eq!(legacy.2, "pending");
    assert_eq!(legacy.3.as_deref(), Some("2999-01-01T00:00:00.000Z"));
    assert_eq!(legacy.4, None);

    let inserted: (String, String) = conn
        .query_row(
            "SELECT kind, name FROM trellis_outbox WHERE id = ?1",
            params!["new-after-migration"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read inserted migrated row");
    assert_eq!(inserted.0, "event.publish");
    assert_eq!(inserted.1, "Document.Processed");
    drop(conn);
    std::fs::remove_file(db_path).expect("remove SQLite test database");
}

struct OutboxFixture {
    _runtime: trellis_test::TrellisTestRuntime,
    service: ConnectedServiceRuntime<OutboxContract>,
    client: TrellisClient,
}

async fn start_outbox_fixture() -> OutboxFixture {
    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();
    admin
        .connect_admin(&bootstrap_url)
        .await
        .expect("connect admin client");
    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(OUTBOX_SERVICE_CONTRACT_JSON)
            .expect("build outbox service contract");
    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision outbox service instance");
    let contract_json =
        serde_json::to_string(service_contract.manifest()).expect("serialize service contract");
    let service_client =
        TrellisClient::connect_service_with_contract(ServiceConnectWithContractOptions {
            trellis_url: runtime.trellis_url(),
            contract_id: SERVICE_CONTRACT_ID,
            contract_digest: service_contract.digest(),
            contract_json: &contract_json,
            session_key_seed_base64url: &service_key.seed,
            timeout_ms: trellis_rs::service::DEFAULT_TIMEOUT_MS,
            retry_delay_ms: trellis_rs::service::DEFAULT_RETRY_DELAY_MS,
            authority_pending_timeout_ms: trellis_rs::service::DEFAULT_AUTHORITY_PENDING_TIMEOUT_MS,
        })
        .await
        .expect("connect outbox service client");
    let service = ConnectedServiceRuntime::<OutboxContract>::from_connected_client(
        "outbox-fixture-service",
        Arc::new(service_client),
    )
    .expect("build outbox service runtime");
    let client = admin
        .connect_client(&bootstrap_url, &outbox_client_contract())
        .await
        .expect("connect outbox client");
    OutboxFixture {
        _runtime: runtime,
        service,
        client,
    }
}

fn outbox_client_contract() -> trellis_test::TrellisTestContract {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        CLIENT_CONTRACT_ID,
        "Trellis Integration Outbox Client",
        "App/client participant for the outbox integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "outboxService",
        trellis_rs::contracts::use_contract(SERVICE_CONTRACT_ID)
            .with_rpc_call([
                "Documents.Process",
                "Documents.ProcessWithRollback",
                "Documents.ProcessMultiEvent",
            ])
            .with_event_subscribe(["Document.Processed", "Document.Audited"]),
    )
    .build()
    .expect("build outbox client contract manifest");
    trellis_test::TrellisTestContract::from_manifest_value(
        serde_json::to_value(manifest).expect("serialize outbox client contract manifest"),
    )
    .expect("build outbox client contract")
}

fn create_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory SQLite");
    conn.execute_batch(
        "CREATE TABLE trellis_outbox (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            subject TEXT NOT NULL,
            payload BLOB NOT NULL,
            headers TEXT NOT NULL,
            event_id TEXT NOT NULL,
            event_time TEXT NOT NULL,
            state TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );",
    )
    .expect("create outbox schema");
    conn
}

fn enqueue_sql_event(
    conn: &Connection,
    id: &str,
    event: &PreparedTrellisEvent,
) -> Result<(), trellis_rs::service::ServerError> {
    conn.execute(
        "INSERT INTO trellis_outbox (id, kind, subject, payload, headers, event_id, event_time, state, attempts)
         VALUES (?1, 'event.publish', ?2, ?3, ?4, ?5, ?6, 'pending', 0)",
        params![
            id,
            event.subject(),
            event.payload(),
            serde_json::to_string(event.headers()).map_err(trellis_rs::service::ServerError::Json)?,
            event.event_id(),
            event.event_time(),
        ],
    )
    .map_err(sqlite_server_error)?;
    Ok(())
}

async fn publish_and_mark_dispatched(
    db: &Arc<tokio::sync::Mutex<Connection>>,
    client: &TrellisClient,
    events: Vec<(String, PreparedTrellisEvent)>,
) -> Result<(), trellis_rs::service::ServerError> {
    for (id, event) in events {
        client
            .publish_prepared(&event)
            .await
            .map_err(|error| trellis_rs::service::ServerError::Nats(error.to_string()))?;
        let conn = db.lock().await;
        conn.execute(
            "UPDATE trellis_outbox SET state = 'dispatched', attempts = attempts + 1 WHERE id = ?1",
            params![id],
        )
        .map_err(sqlite_server_error)?;
    }
    Ok(())
}

fn sqlite_server_error(error: rusqlite::Error) -> trellis_rs::service::ServerError {
    trellis_rs::service::ServerError::Nats(format!("sqlite outbox error: {error}"))
}

fn create_legacy_sql_outbox_schema(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE trellis_outbox (
            id TEXT PRIMARY KEY,
            event TEXT NOT NULL,
            subject TEXT NOT NULL,
            payload TEXT NOT NULL,
            headers TEXT NOT NULL,
            state TEXT NOT NULL,
            attempts INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            next_attempt_at TEXT,
            last_error TEXT
        );",
    )
    .expect("create legacy SQL outbox schema");
}

fn insert_legacy_sql_outbox_row(conn: &Connection) {
    conn.execute(
        "INSERT INTO trellis_outbox (id, event, subject, payload, headers, state, attempts, created_at, updated_at, next_attempt_at, last_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            "legacy-1",
            "Document.Processed",
            "events.v1.Integration.Outbox.Document.Processed.legacy",
            r#"{"documentId":"legacy-doc"}"#,
            "{}",
            "pending",
            0,
            "2026-01-01T00:00:00.000Z",
            "2026-01-01T00:00:00.000Z",
            "2999-01-01T00:00:00.000Z",
            Option::<String>::None,
        ],
    )
    .expect("insert legacy SQL outbox row");
}

fn apply_sqlite_sql_outbox_migrations(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS trellis_outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL, headers TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, next_attempt_at TEXT, last_error TEXT, outcome TEXT);",
    )
    .expect("create SQL outbox table when missing");
    if column_exists(conn, "trellis_outbox", "event")
        && !column_exists(conn, "trellis_outbox", "name")
    {
        conn.execute_batch("ALTER TABLE trellis_outbox RENAME COLUMN event TO name")
            .expect("rename legacy event column");
    }
    if !column_exists(conn, "trellis_outbox", "kind") {
        conn.execute_batch(
            "ALTER TABLE trellis_outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'event.publish'",
        )
        .expect("add outbox kind column");
    }
    if !column_exists(conn, "trellis_outbox", "outcome") {
        conn.execute_batch("ALTER TABLE trellis_outbox ADD COLUMN outcome TEXT")
            .expect("add outbox outcome column");
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS trellis_outbox_due_idx ON trellis_outbox (state, next_attempt_at);
         CREATE TABLE IF NOT EXISTS trellis_inbox (message_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);",
    )
    .expect("create SQL outbox indexes and inbox table");
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("prepare table info query");
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query table info");
    let exists = columns
        .map(|name| name.expect("read table column name"))
        .any(|name| name == column);
    exists
}

fn insert_service_sql_outbox_event(
    conn: &Connection,
    id: &str,
    event: &PreparedTrellisEvent,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO trellis_outbox (id, kind, name, subject, payload, headers, state, attempts, created_at, updated_at, next_attempt_at, last_error, outcome)
         VALUES (?1, 'event.publish', ?2, ?3, ?4, ?5, 'pending', 0, ?6, ?6, NULL, NULL, NULL)",
        params![
            id,
            "Document.Processed",
            event.subject(),
            String::from_utf8_lossy(event.payload()).as_ref(),
            serde_json::to_string(event.headers()).expect("serialize event headers"),
            event.event_time(),
        ],
    )
}

fn temp_sqlite_path(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "trellis-{name}-{}-{nonce}.sqlite",
        std::process::id()
    ))
}

async fn call_rpc_with_retry<D>(client: &TrellisClient, input: &D::Input, label: &str) -> D::Output
where
    D: RpcDescriptor,
{
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match client.call::<D>(input).await {
            Ok(output) => return output,
            Err(error)
                if is_retryable_service_startup_error(&error) && Instant::now() < deadline =>
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live {label} RPC: {error}"),
        }
    }
}

fn is_retryable_service_startup_error(error: &TrellisClientError) -> bool {
    match error {
        TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        TrellisClientError::Timeout => true,
        _ => false,
    }
}

async fn capture_processed(
    client: &TrellisClient,
) -> futures_util::stream::BoxStream<
    'static,
    Result<DocProcessed, trellis_rs::client::TrellisClientError>,
> {
    client
        .subscribe::<ProcessedEvent>()
        .await
        .expect("subscribe to Document.Processed")
        .boxed()
}

async fn capture_audited(
    client: &TrellisClient,
) -> futures_util::stream::BoxStream<
    'static,
    Result<DocAudited, trellis_rs::client::TrellisClientError>,
> {
    client
        .subscribe::<AuditedEvent>()
        .await
        .expect("subscribe to Document.Audited")
        .boxed()
}

async fn wait_for_processed(
    stream: &mut futures_util::stream::BoxStream<
        'static,
        Result<DocProcessed, trellis_rs::client::TrellisClientError>,
    >,
    document_id: &str,
) -> DocProcessed {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, stream.next()).await {
            Ok(Some(Ok(event))) if event.document_id == document_id => return event,
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => panic!("processed event stream failed: {error}"),
            Ok(None) => panic!("processed event stream ended"),
            Err(_) => panic!("timed out waiting for processed event {document_id}"),
        }
    }
}

async fn wait_for_audited(
    stream: &mut futures_util::stream::BoxStream<
        'static,
        Result<DocAudited, trellis_rs::client::TrellisClientError>,
    >,
    document_id: &str,
    action: &str,
) -> DocAudited {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(remaining, stream.next()).await {
            Ok(Some(Ok(event))) if event.document_id == document_id && event.action == action => {
                return event;
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => panic!("audited event stream failed: {error}"),
            Ok(None) => panic!("audited event stream ended"),
            Err(_) => panic!("timed out waiting for audited event {document_id}:{action}"),
        }
    }
}

async fn assert_no_processed(
    stream: &mut futures_util::stream::BoxStream<
        'static,
        Result<DocProcessed, trellis_rs::client::TrellisClientError>,
    >,
    document_id: &str,
) {
    match tokio::time::timeout(Duration::from_millis(750), stream.next()).await {
        Ok(Some(Ok(event))) if event.document_id == document_id => {
            panic!("rollback published unexpected event: {event:?}")
        }
        Ok(Some(Ok(_))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => {}
    }
}
