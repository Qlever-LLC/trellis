use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::TryStreamExt;
use postgres::Client as PostgresClient;
use rusqlite::{params, types::Type as SqliteType, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use ulid::Ulid;

use crate::client::EventDescriptor;

const OUTBOX_STATUS_PENDING: &str = "pending";
const OUTBOX_STATUS_IN_FLIGHT: &str = "in_flight";
const OUTBOX_STATUS_PUBLISHED: &str = "published";
pub(crate) const EVENT_ID_HEADER: &str = "Nats-Msg-Id";
pub(crate) const EVENT_TIME_HEADER: &str = "Trellis-Event-Time";

/// A Trellis event prepared for durable storage or later publishing.
///
/// The prepared form stores the event subject, encoded body payload, transport
/// headers, and event metadata separately. Contract identity and digest are not
/// duplicated into this transport record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedTrellisEvent {
    subject: String,
    payload: Bytes,
    headers: HeaderMap,
    event_id: String,
    event_time: String,
}

impl PreparedTrellisEvent {
    /// Build a prepared event from an already encoded JSON body payload.
    ///
    /// The event id and event time are generated as metadata and are not written
    /// into the payload bytes.
    pub fn new(subject: impl Into<String>, payload: Bytes) -> Self {
        Self {
            subject: subject.into(),
            payload,
            headers: HeaderMap::new(),
            event_id: Ulid::new().to_string(),
            event_time: now_rfc3339(),
        }
    }

    fn from_parts(
        subject: String,
        payload: Bytes,
        headers: HeaderMap,
        event_id: String,
        event_time: String,
    ) -> Self {
        Self {
            subject,
            payload,
            headers,
            event_id,
            event_time,
        }
    }

    /// Return the concrete NATS subject for this event.
    pub fn subject(&self) -> &str {
        &self.subject
    }

    /// Return the encoded JSON event payload.
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Return a cloned payload suitable for NATS publish calls.
    pub fn payload_bytes(&self) -> Bytes {
        self.payload.clone()
    }

    /// Return transport headers preserved with this prepared event.
    pub fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    /// Replace the transport headers preserved with this prepared event.
    ///
    /// `publish_headers` overlays Trellis event metadata headers on top of these
    /// values so stale `Nats-Msg-Id` or `Trellis-Event-Time` values cannot
    /// override the prepared event metadata.
    pub fn with_headers(mut self, headers: HeaderMap) -> Self {
        self.headers = headers;
        self
    }

    /// Return the Trellis event id used as the `Nats-Msg-Id` publish header.
    pub fn event_id(&self) -> &str {
        &self.event_id
    }

    /// Return the Trellis event timestamp propagated as `Trellis-Event-Time`.
    pub fn event_time(&self) -> &str {
        &self.event_time
    }

    /// Return the NATS headers required to publish this prepared event.
    pub fn publish_headers(&self) -> HeaderMap {
        let mut headers = self.headers.clone();
        headers.insert(EVENT_ID_HEADER, self.event_id.as_str());
        headers.insert(EVENT_TIME_HEADER, self.event_time.as_str());
        headers
    }
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

/// Prepare one descriptor-backed typed event without publishing it.
pub fn prepare_event<D>(event: &D::Event) -> Result<PreparedTrellisEvent, serde_json::Error>
where
    D: EventDescriptor,
{
    prepare_event_value(D::SUBJECT, event)
}

/// Prepare one generic JSON-serializable event for a concrete subject.
pub fn prepare_event_value<T>(
    subject: &str,
    event: &T,
) -> Result<PreparedTrellisEvent, serde_json::Error>
where
    T: Serialize + ?Sized,
{
    Ok(PreparedTrellisEvent::new(
        subject,
        Bytes::from(serde_json::to_vec(event)?),
    ))
}

fn sqlite_header_decode_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(3, SqliteType::Text, Box::new(error))
}

/// Errors returned by Trellis event outbox and inbox stores.
#[derive(Debug, thiserror::Error)]
pub enum EventStoreError {
    /// JSON encoding or decoding failed.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    /// SQLite storage failed.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Postgres storage failed.
    #[error("postgres error: {0}")]
    Postgres(#[from] postgres::Error),
    /// NATS KV storage failed.
    #[error("nats kv error: {0}")]
    NatsKv(String),
    /// A publisher failed while dispatching an outbox event.
    #[error("publish error: {0}")]
    Publish(String),
}

/// One durable outbox event record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutboxEventRecord {
    pub id: String,
    pub event: PreparedTrellisEvent,
    pub attempts: u32,
    pub last_error: Option<String>,
}

/// Storage abstraction for pending prepared events.
pub trait OutboxStore {
    /// Store a prepared event under a stable application-chosen outbox id.
    fn enqueue(
        &mut self,
        id: &str,
        event: &PreparedTrellisEvent,
    ) -> impl std::future::Future<Output = Result<(), EventStoreError>>;

    /// Claim one pending event for publication.
    fn claim_next(
        &mut self,
    ) -> impl std::future::Future<Output = Result<Option<OutboxEventRecord>, EventStoreError>>;

    /// Mark a claimed event as successfully published.
    fn mark_published(
        &mut self,
        id: &str,
    ) -> impl std::future::Future<Output = Result<(), EventStoreError>>;

    /// Return a claimed event to pending state after a publish failure.
    fn mark_failed(
        &mut self,
        id: &str,
        error: &str,
    ) -> impl std::future::Future<Output = Result<(), EventStoreError>>;
}

/// Storage abstraction for consumer-side duplicate suppression.
pub trait InboxStore {
    /// Record an incoming event id and report whether it was newly accepted.
    fn record_received(
        &mut self,
        event_id: &str,
    ) -> impl std::future::Future<Output = Result<InboxReceipt, EventStoreError>>;
}

/// Result of recording an inbox event id.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InboxReceipt {
    /// This message id was not seen before and should be processed.
    Accepted,
    /// This message id was already recorded and should be suppressed.
    Duplicate,
}

/// Result of one outbox dispatch attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutboxDispatchResult {
    /// No pending event was available.
    Empty,
    /// One event was published and marked complete.
    Published { id: String },
    /// One event failed and was returned to pending state.
    Failed { id: String, error: String },
}

/// Claim and publish at most one outbox event.
pub async fn dispatch_outbox_once<S, F, Fut, E>(
    store: &mut S,
    mut publish: F,
) -> Result<OutboxDispatchResult, EventStoreError>
where
    S: OutboxStore,
    F: FnMut(PreparedTrellisEvent) -> Fut,
    Fut: std::future::Future<Output = Result<(), E>>,
    E: std::fmt::Display,
{
    let Some(record) = store.claim_next().await? else {
        return Ok(OutboxDispatchResult::Empty);
    };
    match publish(record.event.clone()).await {
        Ok(()) => {
            store.mark_published(&record.id).await?;
            Ok(OutboxDispatchResult::Published { id: record.id })
        }
        Err(error) => {
            let error = error.to_string();
            store.mark_failed(&record.id, &error).await?;
            Ok(OutboxDispatchResult::Failed {
                id: record.id,
                error,
            })
        }
    }
}

#[derive(Clone, Debug)]
struct MemoryOutboxEntry {
    record: OutboxEventRecord,
    status: String,
}

/// In-memory outbox useful for tests and single-process prototypes.
#[derive(Debug, Default)]
pub struct MemoryOutboxStore {
    records: HashMap<String, MemoryOutboxEntry>,
}

impl MemoryOutboxStore {
    /// Create an empty in-memory outbox store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return a stored record by id, including its current attempt count.
    pub fn record(&self, id: &str) -> Option<&OutboxEventRecord> {
        self.records.get(id).map(|entry| &entry.record)
    }
}

impl OutboxStore for MemoryOutboxStore {
    async fn enqueue(
        &mut self,
        id: &str,
        event: &PreparedTrellisEvent,
    ) -> Result<(), EventStoreError> {
        self.records.insert(
            id.to_string(),
            MemoryOutboxEntry {
                record: OutboxEventRecord {
                    id: id.to_string(),
                    event: event.clone(),
                    attempts: 0,
                    last_error: None,
                },
                status: OUTBOX_STATUS_PENDING.to_string(),
            },
        );
        Ok(())
    }

    async fn claim_next(&mut self) -> Result<Option<OutboxEventRecord>, EventStoreError> {
        let Some((_, entry)) = self
            .records
            .iter_mut()
            .find(|(_, entry)| entry.status == OUTBOX_STATUS_PENDING)
        else {
            return Ok(None);
        };
        entry.status = OUTBOX_STATUS_IN_FLIGHT.to_string();
        entry.record.attempts = entry.record.attempts.saturating_add(1);
        Ok(Some(entry.record.clone()))
    }

    async fn mark_published(&mut self, id: &str) -> Result<(), EventStoreError> {
        if let Some(entry) = self.records.get_mut(id) {
            entry.status = OUTBOX_STATUS_PUBLISHED.to_string();
        }
        Ok(())
    }

    async fn mark_failed(&mut self, id: &str, error: &str) -> Result<(), EventStoreError> {
        if let Some(entry) = self.records.get_mut(id) {
            entry.status = OUTBOX_STATUS_PENDING.to_string();
            entry.record.last_error = Some(error.to_string());
        }
        Ok(())
    }
}

/// In-memory inbox useful for tests and single-process prototypes.
#[derive(Debug, Default)]
pub struct MemoryInboxStore {
    seen: HashSet<String>,
}

impl MemoryInboxStore {
    /// Create an empty in-memory inbox store.
    pub fn new() -> Self {
        Self::default()
    }
}

impl InboxStore for MemoryInboxStore {
    async fn record_received(&mut self, event_id: &str) -> Result<InboxReceipt, EventStoreError> {
        if self.seen.insert(event_id.to_string()) {
            Ok(InboxReceipt::Accepted)
        } else {
            Ok(InboxReceipt::Duplicate)
        }
    }
}

/// SQLite-backed outbox adapter. Callers own schema migrations.
#[derive(Debug)]
pub struct SqliteOutboxStore<'a> {
    connection: &'a Connection,
}

impl<'a> SqliteOutboxStore<'a> {
    /// Wrap an existing SQLite connection.
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    /// Create a minimal test schema for this adapter.
    pub fn create_schema(connection: &Connection) -> Result<(), EventStoreError> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS trellis_outbox_events (\
                id TEXT PRIMARY KEY,\
                subject TEXT NOT NULL,\
                payload BLOB NOT NULL,\
                headers TEXT NOT NULL,\
                event_id TEXT NOT NULL,\
                event_time TEXT NOT NULL,\
                status TEXT NOT NULL,\
                attempts INTEGER NOT NULL DEFAULT 0,\
                last_error TEXT\
            );",
        )?;
        Ok(())
    }
}

impl OutboxStore for SqliteOutboxStore<'_> {
    async fn enqueue(
        &mut self,
        id: &str,
        event: &PreparedTrellisEvent,
    ) -> Result<(), EventStoreError> {
        self.connection.execute(
            "INSERT INTO trellis_outbox_events \
                (id, subject, payload, headers, event_id, event_time, status, attempts) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0) \
             ON CONFLICT(id) DO NOTHING",
            params![
                id,
                event.subject(),
                event.payload(),
                serde_json::to_string(event.headers())?,
                event.event_id(),
                event.event_time(),
                OUTBOX_STATUS_PENDING,
            ],
        )?;
        Ok(())
    }

    async fn claim_next(&mut self) -> Result<Option<OutboxEventRecord>, EventStoreError> {
        let row = self
            .connection
            .query_row(
                "SELECT id, subject, payload, headers, event_id, event_time, attempts, last_error \
                 FROM trellis_outbox_events WHERE status = ?1 ORDER BY rowid LIMIT 1",
                params![OUTBOX_STATUS_PENDING],
                |row| {
                    let id: String = row.get(0)?;
                    let attempts: u32 = row.get::<_, i64>(6)?.try_into().unwrap_or(u32::MAX);
                    let header_json: String = row.get(3)?;
                    let headers =
                        serde_json::from_str(&header_json).map_err(sqlite_header_decode_error)?;
                    Ok(OutboxEventRecord {
                        id,
                        event: PreparedTrellisEvent::from_parts(
                            row.get(1)?,
                            Bytes::from(row.get::<_, Vec<u8>>(2)?),
                            headers,
                            row.get(4)?,
                            row.get(5)?,
                        ),
                        attempts,
                        last_error: row.get(7)?,
                    })
                },
            )
            .optional()?;
        let Some(mut record) = row else {
            return Ok(None);
        };
        record.attempts = record.attempts.saturating_add(1);
        self.connection.execute(
            "UPDATE trellis_outbox_events SET status = ?1, attempts = ?2 WHERE id = ?3",
            params![OUTBOX_STATUS_IN_FLIGHT, record.attempts, record.id],
        )?;
        Ok(Some(record))
    }

    async fn mark_published(&mut self, id: &str) -> Result<(), EventStoreError> {
        self.connection.execute(
            "UPDATE trellis_outbox_events SET status = ?1 WHERE id = ?2",
            params![OUTBOX_STATUS_PUBLISHED, id],
        )?;
        Ok(())
    }

    async fn mark_failed(&mut self, id: &str, error: &str) -> Result<(), EventStoreError> {
        self.connection.execute(
            "UPDATE trellis_outbox_events SET status = ?1, last_error = ?2 WHERE id = ?3",
            params![OUTBOX_STATUS_PENDING, error, id],
        )?;
        Ok(())
    }
}

/// SQLite-backed inbox adapter. Callers own schema migrations.
#[derive(Debug)]
pub struct SqliteInboxStore<'a> {
    connection: &'a Connection,
}

impl<'a> SqliteInboxStore<'a> {
    /// Wrap an existing SQLite connection.
    pub fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    /// Create a minimal test schema for this adapter.
    pub fn create_schema(connection: &Connection) -> Result<(), EventStoreError> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS trellis_inbox_events (\
                event_id TEXT PRIMARY KEY\
            );",
        )?;
        Ok(())
    }
}

impl InboxStore for SqliteInboxStore<'_> {
    async fn record_received(&mut self, event_id: &str) -> Result<InboxReceipt, EventStoreError> {
        let inserted = self.connection.execute(
            "INSERT INTO trellis_inbox_events (event_id) VALUES (?1) ON CONFLICT(event_id) DO NOTHING",
            params![event_id],
        )?;
        if inserted == 0 {
            Ok(InboxReceipt::Duplicate)
        } else {
            Ok(InboxReceipt::Accepted)
        }
    }
}

/// Postgres-backed outbox adapter. Callers own schema migrations.
pub struct PostgresOutboxStore<'a> {
    client: &'a mut PostgresClient,
}

impl std::fmt::Debug for PostgresOutboxStore<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PostgresOutboxStore")
            .finish_non_exhaustive()
    }
}

impl<'a> PostgresOutboxStore<'a> {
    /// Wrap an existing Postgres client.
    pub fn new(client: &'a mut PostgresClient) -> Self {
        Self { client }
    }

    /// Create a minimal test schema for this adapter.
    pub fn create_schema(client: &mut PostgresClient) -> Result<(), EventStoreError> {
        client.batch_execute(
            "CREATE TABLE IF NOT EXISTS trellis_outbox_events (\
                id TEXT PRIMARY KEY,\
                subject TEXT NOT NULL,\
                payload BYTEA NOT NULL,\
                headers TEXT NOT NULL,\
                event_id TEXT NOT NULL,\
                event_time TEXT NOT NULL,\
                status TEXT NOT NULL,\
                attempts INTEGER NOT NULL DEFAULT 0,\
                last_error TEXT\
            );",
        )?;
        Ok(())
    }
}

impl OutboxStore for PostgresOutboxStore<'_> {
    async fn enqueue(
        &mut self,
        id: &str,
        event: &PreparedTrellisEvent,
    ) -> Result<(), EventStoreError> {
        self.client.execute(
            "INSERT INTO trellis_outbox_events \
                (id, subject, payload, headers, event_id, event_time, status, attempts) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0) \
             ON CONFLICT(id) DO NOTHING",
            &[
                &id,
                &event.subject(),
                &event.payload(),
                &serde_json::to_string(event.headers())?,
                &event.event_id(),
                &event.event_time(),
                &OUTBOX_STATUS_PENDING,
            ],
        )?;
        Ok(())
    }

    async fn claim_next(&mut self) -> Result<Option<OutboxEventRecord>, EventStoreError> {
        let row = self.client.query_opt(
            "SELECT id, subject, payload, headers, event_id, event_time, attempts, last_error \
             FROM trellis_outbox_events WHERE status = $1 ORDER BY id LIMIT 1",
            &[&OUTBOX_STATUS_PENDING],
        )?;
        let Some(row) = row else {
            return Ok(None);
        };
        let id: String = row.get(0);
        let attempts = u32::try_from(row.get::<_, i32>(6))
            .unwrap_or(u32::MAX)
            .saturating_add(1);
        self.client.execute(
            "UPDATE trellis_outbox_events SET status = $1, attempts = $2 WHERE id = $3",
            &[&OUTBOX_STATUS_IN_FLIGHT, &(attempts as i32), &id],
        )?;
        let header_json: String = row.get(3);
        let headers = serde_json::from_str(&header_json)?;
        Ok(Some(OutboxEventRecord {
            id,
            event: PreparedTrellisEvent::from_parts(
                row.get(1),
                Bytes::from(row.get::<_, Vec<u8>>(2)),
                headers,
                row.get(4),
                row.get(5),
            ),
            attempts,
            last_error: row.get(7),
        }))
    }

    async fn mark_published(&mut self, id: &str) -> Result<(), EventStoreError> {
        self.client.execute(
            "UPDATE trellis_outbox_events SET status = $1 WHERE id = $2",
            &[&OUTBOX_STATUS_PUBLISHED, &id],
        )?;
        Ok(())
    }

    async fn mark_failed(&mut self, id: &str, error: &str) -> Result<(), EventStoreError> {
        self.client.execute(
            "UPDATE trellis_outbox_events SET status = $1, last_error = $2 WHERE id = $3",
            &[&OUTBOX_STATUS_PENDING, &error, &id],
        )?;
        Ok(())
    }
}

/// Postgres-backed inbox adapter. Callers own schema migrations.
pub struct PostgresInboxStore<'a> {
    client: &'a mut PostgresClient,
}

impl std::fmt::Debug for PostgresInboxStore<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PostgresInboxStore")
            .finish_non_exhaustive()
    }
}

impl<'a> PostgresInboxStore<'a> {
    /// Wrap an existing Postgres client.
    pub fn new(client: &'a mut PostgresClient) -> Self {
        Self { client }
    }

    /// Create a minimal test schema for this adapter.
    pub fn create_schema(client: &mut PostgresClient) -> Result<(), EventStoreError> {
        client.batch_execute(
            "CREATE TABLE IF NOT EXISTS trellis_inbox_events (\
                event_id TEXT PRIMARY KEY\
            );",
        )?;
        Ok(())
    }
}

impl InboxStore for PostgresInboxStore<'_> {
    async fn record_received(&mut self, event_id: &str) -> Result<InboxReceipt, EventStoreError> {
        let inserted = self.client.execute(
            "INSERT INTO trellis_inbox_events (event_id) VALUES ($1) ON CONFLICT(event_id) DO NOTHING",
            &[&event_id],
        )?;
        if inserted == 0 {
            Ok(InboxReceipt::Duplicate)
        } else {
            Ok(InboxReceipt::Accepted)
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct StoredPreparedEvent {
    subject: String,
    payload: Vec<u8>,
    headers: HeaderMap,
    event_id: String,
    event_time: String,
    attempts: u32,
    last_error: Option<String>,
    status: String,
}

impl StoredPreparedEvent {
    fn from_prepared(event: &PreparedTrellisEvent) -> Self {
        Self {
            subject: event.subject().to_string(),
            payload: event.payload().to_vec(),
            headers: event.headers().clone(),
            event_id: event.event_id().to_string(),
            event_time: event.event_time().to_string(),
            attempts: 0,
            last_error: None,
            status: OUTBOX_STATUS_PENDING.to_string(),
        }
    }

    fn into_record(self, id: String) -> OutboxEventRecord {
        OutboxEventRecord {
            id,
            event: PreparedTrellisEvent::from_parts(
                self.subject,
                Bytes::from(self.payload),
                self.headers,
                self.event_id,
                self.event_time,
            ),
            attempts: self.attempts,
            last_error: self.last_error,
        }
    }
}

/// NATS KV-backed outbox adapter using KV create/update revision checks.
#[derive(Clone, Debug)]
pub struct NatsKvOutboxStore {
    store: async_nats::jetstream::kv::Store,
    prefix: String,
}

impl NatsKvOutboxStore {
    /// Wrap an existing NATS KV bucket with a key prefix.
    pub fn new(store: async_nats::jetstream::kv::Store, prefix: impl Into<String>) -> Self {
        Self {
            store,
            prefix: prefix.into(),
        }
    }

    fn key(&self, id: &str) -> String {
        format!("{}outbox/{id}", self.prefix)
    }
}

impl OutboxStore for NatsKvOutboxStore {
    async fn enqueue(
        &mut self,
        id: &str,
        event: &PreparedTrellisEvent,
    ) -> Result<(), EventStoreError> {
        let value = serde_json::to_vec(&StoredPreparedEvent::from_prepared(event))?;
        match self.store.create(self.key(id), Bytes::from(value)).await {
            Ok(_) => Ok(()),
            Err(error) => {
                let message = error.to_string();
                if message.contains("already exists") {
                    Ok(())
                } else {
                    Err(EventStoreError::NatsKv(message))
                }
            }
        }
    }

    async fn claim_next(&mut self) -> Result<Option<OutboxEventRecord>, EventStoreError> {
        let mut keys = self
            .store
            .keys()
            .await
            .map_err(|error| EventStoreError::NatsKv(error.to_string()))?;
        while let Some(key) = keys
            .try_next()
            .await
            .map_err(|error| EventStoreError::NatsKv(error.to_string()))?
        {
            if !key.starts_with(&format!("{}outbox/", self.prefix)) {
                continue;
            }
            let Some(entry) = self
                .store
                .entry(key.clone())
                .await
                .map_err(|error| EventStoreError::NatsKv(error.to_string()))?
            else {
                continue;
            };
            let mut stored: StoredPreparedEvent = serde_json::from_slice(&entry.value)?;
            if stored.status != OUTBOX_STATUS_PENDING {
                continue;
            }
            stored.status = OUTBOX_STATUS_IN_FLIGHT.to_string();
            stored.attempts = stored.attempts.saturating_add(1);
            let value = serde_json::to_vec(&stored)?;
            if self
                .store
                .update(key.clone(), Bytes::from(value), entry.revision)
                .await
                .is_err()
            {
                continue;
            }
            let id = key
                .strip_prefix(&format!("{}outbox/", self.prefix))
                .unwrap_or(&key)
                .to_string();
            return Ok(Some(stored.into_record(id)));
        }
        Ok(None)
    }

    async fn mark_published(&mut self, id: &str) -> Result<(), EventStoreError> {
        let key = self.key(id);
        if let Some(entry) = self
            .store
            .entry(key.clone())
            .await
            .map_err(|error| EventStoreError::NatsKv(error.to_string()))?
        {
            let mut stored: StoredPreparedEvent = serde_json::from_slice(&entry.value)?;
            stored.status = OUTBOX_STATUS_PUBLISHED.to_string();
            self.store
                .update(
                    key,
                    Bytes::from(serde_json::to_vec(&stored)?),
                    entry.revision,
                )
                .await
                .map_err(|error| EventStoreError::NatsKv(error.to_string()))?;
        }
        Ok(())
    }

    async fn mark_failed(&mut self, id: &str, error: &str) -> Result<(), EventStoreError> {
        let key = self.key(id);
        if let Some(entry) = self
            .store
            .entry(key.clone())
            .await
            .map_err(|error| EventStoreError::NatsKv(error.to_string()))?
        {
            let mut stored: StoredPreparedEvent = serde_json::from_slice(&entry.value)?;
            stored.status = OUTBOX_STATUS_PENDING.to_string();
            stored.last_error = Some(error.to_string());
            self.store
                .update(
                    key,
                    Bytes::from(serde_json::to_vec(&stored)?),
                    entry.revision,
                )
                .await
                .map_err(|error| EventStoreError::NatsKv(error.to_string()))?;
        }
        Ok(())
    }
}

/// NATS KV-backed inbox adapter using KV create as duplicate suppression.
#[derive(Clone, Debug)]
pub struct NatsKvInboxStore {
    store: async_nats::jetstream::kv::Store,
    prefix: String,
}

impl NatsKvInboxStore {
    /// Wrap an existing NATS KV bucket with a key prefix.
    pub fn new(store: async_nats::jetstream::kv::Store, prefix: impl Into<String>) -> Self {
        Self {
            store,
            prefix: prefix.into(),
        }
    }

    fn key(&self, event_id: &str) -> String {
        format!("{}inbox/{event_id}", self.prefix)
    }
}

impl InboxStore for NatsKvInboxStore {
    async fn record_received(&mut self, event_id: &str) -> Result<InboxReceipt, EventStoreError> {
        match self.store.create(self.key(event_id), Bytes::new()).await {
            Ok(_) => Ok(InboxReceipt::Accepted),
            Err(error) => {
                let message = error.to_string();
                if message.contains("already exists") {
                    Ok(InboxReceipt::Duplicate)
                } else {
                    Err(EventStoreError::NatsKv(message))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[derive(Debug, Deserialize, Serialize)]
    struct TestEvent {
        header: String,
        value: String,
    }

    #[derive(Debug, Deserialize, Serialize)]
    struct TestEventWithoutDomainHeader {
        value: String,
    }

    struct TestDescriptorWithoutDomainHeader;

    impl EventDescriptor for TestDescriptorWithoutDomainHeader {
        type Event = TestEventWithoutDomainHeader;

        const KEY: &'static str = "Test.EventWithoutDomainHeader";
        const SUBJECT: &'static str = "events.v1.Test.EventWithoutDomainHeader";
        const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
        const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
    }

    struct TestDescriptor;

    impl EventDescriptor for TestDescriptor {
        type Event = TestEvent;

        const KEY: &'static str = "Test.Event";
        const SUBJECT: &'static str = "events.v1.Test.Event";
        const PUBLISH_CAPABILITIES: &'static [&'static str] = &[];
        const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &[];
    }

    fn test_event() -> TestEvent {
        TestEvent {
            header: "domain-header".to_string(),
            value: "payload".to_string(),
        }
    }

    #[test]
    fn prepare_event_preserves_subject_and_body_payload() {
        let prepared = prepare_event::<TestDescriptor>(&test_event()).expect("event prepares");
        assert_eq!(prepared.subject(), "events.v1.Test.Event");
        assert!(!prepared.event_id().is_empty());
        assert!(prepared.event_time().ends_with('Z'));
        assert_eq!(
            serde_json::from_slice::<Value>(prepared.payload()).expect("payload is json"),
            serde_json::json!({
                "header": "domain-header",
                "value": "payload"
            })
        );
        let headers = prepared.publish_headers();
        assert_eq!(
            headers.get(EVENT_ID_HEADER).map(|value| value.as_str()),
            Some(prepared.event_id())
        );
        assert_eq!(
            headers.get(EVENT_TIME_HEADER).map(|value| value.as_str()),
            Some(prepared.event_time())
        );
    }

    #[test]
    fn prepare_event_does_not_add_header_when_missing() {
        let prepared =
            prepare_event::<TestDescriptorWithoutDomainHeader>(&TestEventWithoutDomainHeader {
                value: "payload".to_string(),
            })
            .expect("event prepares");
        let payload = serde_json::from_slice::<Value>(prepared.payload()).expect("payload is json");
        assert!(payload.get("header").is_none());
        assert!(!prepared.event_id().is_empty());
        assert!(prepared.event_time().ends_with('Z'));
    }

    #[test]
    fn publish_headers_preserve_existing_headers_and_overlay_metadata() {
        let mut existing = HeaderMap::new();
        existing.insert(
            "traceparent",
            "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
        );
        existing.insert(EVENT_ID_HEADER, "stale");
        let prepared = prepare_event::<TestDescriptor>(&test_event())
            .expect("event prepares")
            .with_headers(existing);

        let headers = prepared.publish_headers();
        assert_eq!(
            headers.get("traceparent").map(|value| value.as_str()),
            Some("00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01")
        );
        assert_eq!(
            headers.get(EVENT_ID_HEADER).map(|value| value.as_str()),
            Some(prepared.event_id())
        );
        assert_eq!(
            headers.get(EVENT_TIME_HEADER).map(|value| value.as_str()),
            Some(prepared.event_time())
        );
    }

    #[tokio::test]
    async fn outbox_dispatch_retries_failed_publish() {
        let prepared = prepare_event::<TestDescriptor>(&test_event()).expect("event prepares");
        let mut store = MemoryOutboxStore::new();
        store
            .enqueue("outbox_1", &prepared)
            .await
            .expect("enqueue succeeds");

        let failed = dispatch_outbox_once(&mut store, |_event| async { Err("temporary") })
            .await
            .expect("dispatch returns failure result");
        assert_eq!(
            failed,
            OutboxDispatchResult::Failed {
                id: "outbox_1".to_string(),
                error: "temporary".to_string()
            }
        );
        assert_eq!(
            store.record("outbox_1").map(|record| record.attempts),
            Some(1)
        );

        let published = dispatch_outbox_once(&mut store, |_event| async { Ok::<(), &str>(()) })
            .await
            .expect("dispatch publishes retry");
        assert_eq!(
            published,
            OutboxDispatchResult::Published {
                id: "outbox_1".to_string()
            }
        );
        assert_eq!(
            store.record("outbox_1").map(|record| record.attempts),
            Some(2)
        );
    }

    #[tokio::test]
    async fn inbox_suppresses_duplicates() {
        let mut inbox = MemoryInboxStore::new();
        assert_eq!(
            inbox.record_received("evt_1").await.expect("first record"),
            InboxReceipt::Accepted
        );
        assert_eq!(
            inbox.record_received("evt_1").await.expect("second record"),
            InboxReceipt::Duplicate
        );
    }

    #[tokio::test]
    async fn sqlite_outbox_persists_dispatch_and_retry_state() {
        let connection = Connection::open_in_memory().expect("sqlite opens");
        SqliteOutboxStore::create_schema(&connection).expect("schema creates");
        let prepared = prepare_event::<TestDescriptor>(&test_event()).expect("event prepares");

        let mut store = SqliteOutboxStore::new(&connection);
        store
            .enqueue("sqlite-outbox", &prepared)
            .await
            .expect("enqueue succeeds");

        let failed = dispatch_outbox_once(&mut store, |_event| async { Err("temporary") })
            .await
            .expect("dispatch returns failure result");
        assert_eq!(
            failed,
            OutboxDispatchResult::Failed {
                id: "sqlite-outbox".to_string(),
                error: "temporary".to_string()
            }
        );

        let retried = store
            .claim_next()
            .await
            .expect("retry can claim")
            .expect("failed message is pending again");
        assert_eq!(retried.id, "sqlite-outbox");
        assert_eq!(retried.attempts, 2);
        assert_eq!(retried.last_error.as_deref(), Some("temporary"));
        assert_eq!(retried.event, prepared);
        store
            .mark_published("sqlite-outbox")
            .await
            .expect("mark published succeeds");
        assert!(store
            .claim_next()
            .await
            .expect("claim after publish succeeds")
            .is_none());
    }

    #[tokio::test]
    async fn sqlite_inbox_suppresses_duplicates() {
        let connection = Connection::open_in_memory().expect("sqlite opens");
        SqliteInboxStore::create_schema(&connection).expect("schema creates");
        let mut inbox = SqliteInboxStore::new(&connection);

        assert_eq!(
            inbox
                .record_received("evt_sqlite")
                .await
                .expect("first record succeeds"),
            InboxReceipt::Accepted
        );
        assert_eq!(
            inbox
                .record_received("evt_sqlite")
                .await
                .expect("duplicate record succeeds"),
            InboxReceipt::Duplicate
        );
    }
}
