use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use trellis_jobs::types::{Job, JobState};

use crate::worker_presence::WorkerPresenceRecord;

/// SQLite-backed Jobs projection store.
#[derive(Debug, Clone)]
pub struct SqliteJobsStore {
    connection: Arc<Mutex<Connection>>,
}

/// Filter used when listing projected jobs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListJobsFilter {
    pub service: Option<String>,
    pub job_type: Option<String>,
    pub states: Option<Vec<JobState>>,
    pub since: Option<OffsetDateTime>,
    pub offset: Option<u64>,
    pub limit: u64,
}

impl Default for ListJobsFilter {
    fn default() -> Self {
        Self {
            service: None,
            job_type: None,
            states: None,
            since: None,
            offset: None,
            limit: u64::MAX,
        }
    }
}

/// Page of projected jobs using the public Jobs list ordering.
#[derive(Debug, Clone, PartialEq)]
pub struct JobsPage {
    pub jobs: Vec<Job>,
    pub count: u64,
    pub offset: u64,
    pub limit: u64,
    pub next_offset: Option<u64>,
}

/// Errors returned by the SQLite Jobs projection store.
#[derive(Debug, thiserror::Error)]
pub enum SqliteJobsStoreError {
    #[error("sqlite operation failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("sqlite connection lock is poisoned")]
    Poisoned,
    #[error("failed to encode {model}: {details}")]
    EncodeJson {
        model: &'static str,
        details: String,
    },
    #[error("failed to decode {model}: {details}")]
    DecodeJson {
        model: &'static str,
        details: String,
    },
}

impl SqliteJobsStore {
    /// Open a store at `path` and initialize the schema if needed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SqliteJobsStoreError> {
        let store = Self {
            connection: Arc::new(Mutex::new(Connection::open(path)?)),
        };
        store.initialize_schema()?;
        Ok(store)
    }

    /// Open an in-memory store and initialize the schema. Intended for tests.
    pub fn open_in_memory() -> Result<Self, SqliteJobsStoreError> {
        let store = Self {
            connection: Arc::new(Mutex::new(Connection::open_in_memory()?)),
        };
        store.initialize_schema()?;
        Ok(store)
    }

    /// Initialize the projection schema. Safe to call more than once.
    pub fn initialize_schema(&self) -> Result<(), SqliteJobsStoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS jobs_projection (
                service TEXT NOT NULL,
                job_type TEXT NOT NULL,
                id TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                updated_at_nanos INTEGER NOT NULL,
                deadline TEXT,
                deadline_nanos INTEGER,
                payload_json TEXT NOT NULL,
                job_json TEXT NOT NULL,
                PRIMARY KEY (service, job_type, id)
            );
            DROP INDEX IF EXISTS idx_jobs_projection_global_id;
            CREATE UNIQUE INDEX idx_jobs_projection_global_id
                ON jobs_projection (id);
            CREATE TABLE IF NOT EXISTS worker_presence_projection (
                service TEXT NOT NULL,
                job_type TEXT NOT NULL,
                instance_id TEXT NOT NULL,
                concurrency INTEGER,
                version TEXT,
                heartbeat_at TEXT NOT NULL,
                record_json TEXT NOT NULL,
                PRIMARY KEY (service, job_type, instance_id)
            );
            CREATE INDEX IF NOT EXISTS idx_worker_presence_fresh
                ON worker_presence_projection (heartbeat_at DESC, service ASC, job_type ASC, instance_id ASC);

            CREATE TABLE IF NOT EXISTS projection_metadata (
                name TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;
        ensure_projection_timestamp_columns(&connection)?;
        backfill_projection_timestamp_columns(&connection)?;
        Ok(())
    }

    /// Upsert one projected job row.
    pub fn upsert_job(&self, job: &Job) -> Result<(), SqliteJobsStoreError> {
        let state = job_state_token(job.state);
        let updated_at_nanos = timestamp_str_nanos(&job.updated_at);
        let deadline_nanos = job.deadline.as_deref().map(timestamp_str_nanos);
        let payload_json = serde_json::to_string(&job.payload).map_err(|error| {
            SqliteJobsStoreError::EncodeJson {
                model: "job payload",
                details: error.to_string(),
            }
        })?;
        let job_json =
            serde_json::to_string(job).map_err(|error| SqliteJobsStoreError::EncodeJson {
                model: "job",
                details: error.to_string(),
            })?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection.execute(
            r#"
            INSERT INTO jobs_projection
                (service, job_type, id, state, created_at, updated_at, updated_at_nanos, deadline, deadline_nanos, payload_json, job_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(service, job_type, id) DO UPDATE SET
                state = excluded.state,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                updated_at_nanos = excluded.updated_at_nanos,
                deadline = excluded.deadline,
                deadline_nanos = excluded.deadline_nanos,
                payload_json = excluded.payload_json,
                job_json = excluded.job_json
            "#,
            params![
                job.service,
                job.job_type,
                job.id,
                state,
                job.created_at,
                job.updated_at,
                updated_at_nanos,
                job.deadline,
                deadline_nanos,
                payload_json,
                job_json
            ],
        )?;
        Ok(())
    }

    /// Fetch a job by its fully-qualified projection key.
    pub fn get_job(
        &self,
        service: &str,
        job_type: &str,
        id: &str,
    ) -> Result<Option<Job>, SqliteJobsStoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection
            .query_row(
                "SELECT job_json FROM jobs_projection WHERE service = ?1 AND job_type = ?2 AND id = ?3",
                params![service, job_type, id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|json| decode_job_json(&json))
            .transpose()
    }

    /// Fetch a job by the globally addressable admin id.
    pub fn get_job_by_global_id(&self, id: &str) -> Result<Option<Job>, SqliteJobsStoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection
            .query_row(
                "SELECT job_json FROM jobs_projection WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|json| decode_job_json(&json))
            .transpose()
    }

    /// List projected jobs with stable offset pagination.
    pub fn list_jobs(&self, filter: &ListJobsFilter) -> Result<JobsPage, SqliteJobsStoreError> {
        let (where_sql, mut query_params) = list_jobs_where_clause(filter);
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;

        let count_sql = format!("SELECT COUNT(*) FROM jobs_projection{where_sql}");
        let count =
            connection.query_row(&count_sql, params_from_iter(query_params.iter()), |row| {
                row.get::<_, i64>(0)
            })?;
        let count = u64::try_from(count).unwrap_or(0);

        let offset = filter.offset.unwrap_or(0);
        query_params.push(sql_u64(filter.limit));
        query_params.push(sql_u64(offset));
        let list_sql = format!(
            "SELECT job_json FROM jobs_projection{where_sql} \
             ORDER BY updated_at_nanos DESC, service ASC, job_type ASC, id ASC \
             LIMIT ? OFFSET ?"
        );
        let mut statement = connection.prepare(&list_sql)?;
        let rows = statement.query_map(params_from_iter(query_params.iter()), |row| {
            row.get::<_, String>(0)
        })?;
        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(decode_job_json(&row?)?);
        }

        let next_offset = offset
            .checked_add(filter.limit)
            .filter(|next_offset| *next_offset < count);

        Ok(JobsPage {
            jobs,
            count,
            offset,
            limit: filter.limit,
            next_offset,
        })
    }

    /// List non-terminal jobs whose business deadline is at or before `now`.
    pub fn scan_expired_jobs(&self, now: &str) -> Result<Vec<Job>, SqliteJobsStoreError> {
        let now_nanos = timestamp_str_nanos(now);
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        let mut statement = connection.prepare(
            r#"
            SELECT job_json FROM jobs_projection
            WHERE state IN ('pending', 'retry', 'active')
              AND deadline_nanos IS NOT NULL
              AND deadline_nanos <= ?1
            ORDER BY deadline_nanos ASC, service ASC, job_type ASC, id ASC
            "#,
        )?;
        let rows = statement.query_map(params![now_nanos], |row| row.get::<_, String>(0))?;
        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(decode_job_json(&row?)?);
        }
        Ok(jobs)
    }

    /// Upsert one worker-presence projection row.
    pub fn upsert_worker_presence(
        &self,
        worker: &WorkerPresenceRecord,
    ) -> Result<(), SqliteJobsStoreError> {
        let record_json =
            serde_json::to_string(worker).map_err(|error| SqliteJobsStoreError::EncodeJson {
                model: "worker presence",
                details: error.to_string(),
            })?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection.execute(
            r#"
            INSERT INTO worker_presence_projection
                (service, job_type, instance_id, concurrency, version, heartbeat_at, record_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(service, job_type, instance_id) DO UPDATE SET
                concurrency = excluded.concurrency,
                version = excluded.version,
                heartbeat_at = excluded.heartbeat_at,
                record_json = excluded.record_json
            "#,
            params![
                worker.service,
                worker.job_type,
                worker.instance_id,
                worker.concurrency,
                worker.version,
                worker.heartbeat_at,
                record_json
            ],
        )?;
        Ok(())
    }

    /// Fetch one worker-presence projection row by its fully-qualified key.
    pub fn get_worker_presence(
        &self,
        service: &str,
        job_type: &str,
        instance_id: &str,
    ) -> Result<Option<WorkerPresenceRecord>, SqliteJobsStoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection
            .query_row(
                "SELECT record_json FROM worker_presence_projection WHERE service = ?1 AND job_type = ?2 AND instance_id = ?3",
                params![service, job_type, instance_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|json| {
                serde_json::from_str::<WorkerPresenceRecord>(&json).map_err(|error| {
                    SqliteJobsStoreError::DecodeJson {
                        model: "worker presence",
                        details: error.to_string(),
                    }
                })
            })
            .transpose()
    }

    /// List worker-presence rows whose heartbeat is still fresh at `now`.
    pub fn list_fresh_workers(
        &self,
        now: OffsetDateTime,
        fresh_for: Duration,
    ) -> Result<Vec<WorkerPresenceRecord>, SqliteJobsStoreError> {
        let threshold = now - fresh_for;
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        let mut statement = connection.prepare(
            "SELECT record_json FROM worker_presence_projection ORDER BY service ASC, job_type ASC, instance_id ASC",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut workers = Vec::new();
        for row in rows {
            let worker = serde_json::from_str::<WorkerPresenceRecord>(&row?).map_err(|error| {
                SqliteJobsStoreError::DecodeJson {
                    model: "worker presence",
                    details: error.to_string(),
                }
            })?;
            if parse_timestamp(&worker.heartbeat_at) >= threshold {
                workers.push(worker);
            }
        }
        Ok(workers)
    }
}

fn ensure_projection_timestamp_columns(
    connection: &Connection,
) -> Result<(), SqliteJobsStoreError> {
    let mut statement = connection.prepare("PRAGMA table_info(jobs_projection)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    if !columns.iter().any(|column| column == "updated_at_nanos") {
        connection.execute(
            "ALTER TABLE jobs_projection ADD COLUMN updated_at_nanos INTEGER",
            [],
        )?;
    }
    if !columns.iter().any(|column| column == "deadline_nanos") {
        connection.execute(
            "ALTER TABLE jobs_projection ADD COLUMN deadline_nanos INTEGER",
            [],
        )?;
    }
    connection.execute_batch(
        r#"
        DROP INDEX IF EXISTS idx_jobs_projection_list;
        DROP INDEX IF EXISTS idx_jobs_projection_deadline;
        CREATE INDEX IF NOT EXISTS idx_jobs_projection_list
            ON jobs_projection (updated_at_nanos DESC, service ASC, job_type ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_jobs_projection_deadline
            ON jobs_projection (deadline_nanos, state);
        "#,
    )?;
    Ok(())
}

fn backfill_projection_timestamp_columns(
    connection: &Connection,
) -> Result<(), SqliteJobsStoreError> {
    let mut statement = connection.prepare(
        r#"
        SELECT service, job_type, id, updated_at, deadline
        FROM jobs_projection
        WHERE updated_at_nanos IS NULL
           OR (deadline IS NOT NULL AND deadline_nanos IS NULL)
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut backfills = Vec::new();
    for row in rows {
        let (service, job_type, id, updated_at, deadline) = row?;
        backfills.push((
            service,
            job_type,
            id,
            timestamp_str_nanos(&updated_at),
            deadline.as_deref().map(timestamp_str_nanos),
        ));
    }
    drop(statement);

    for (service, job_type, id, updated_at_nanos, deadline_nanos) in backfills {
        connection.execute(
            r#"
            UPDATE jobs_projection
            SET updated_at_nanos = ?1, deadline_nanos = ?2
            WHERE service = ?3 AND job_type = ?4 AND id = ?5
            "#,
            params![updated_at_nanos, deadline_nanos, service, job_type, id],
        )?;
    }
    Ok(())
}

fn decode_job_json(json: &str) -> Result<Job, SqliteJobsStoreError> {
    serde_json::from_str(json).map_err(|error| SqliteJobsStoreError::DecodeJson {
        model: "job",
        details: error.to_string(),
    })
}

fn list_jobs_where_clause(filter: &ListJobsFilter) -> (String, Vec<SqlValue>) {
    let mut clauses = Vec::new();
    let mut params = Vec::new();

    if let Some(service) = &filter.service {
        clauses.push("service = ?".to_string());
        params.push(SqlValue::Text(service.clone()));
    }
    if let Some(job_type) = &filter.job_type {
        clauses.push("job_type = ?".to_string());
        params.push(SqlValue::Text(job_type.clone()));
    }
    if let Some(states) = &filter.states {
        if states.is_empty() {
            clauses.push("1 = 0".to_string());
        } else {
            let placeholders = vec!["?"; states.len()].join(", ");
            clauses.push(format!("state IN ({placeholders})"));
            params.extend(
                states
                    .iter()
                    .map(|state| SqlValue::Text(job_state_token(*state).to_string())),
            );
        }
    }
    if let Some(since) = filter.since {
        clauses.push("updated_at_nanos >= ?".to_string());
        params.push(SqlValue::Integer(timestamp_nanos(since)));
    }

    if clauses.is_empty() {
        (String::new(), params)
    } else {
        (format!(" WHERE {}", clauses.join(" AND ")), params)
    }
}

fn sql_u64(value: u64) -> SqlValue {
    SqlValue::Integer(i64::try_from(value).unwrap_or(i64::MAX))
}

fn job_state_token(state: JobState) -> &'static str {
    match state {
        JobState::Pending => "pending",
        JobState::Active => "active",
        JobState::Retry => "retry",
        JobState::Completed => "completed",
        JobState::Failed => "failed",
        JobState::Cancelled => "cancelled",
        JobState::Expired => "expired",
        JobState::Dead => "dead",
        JobState::Dismissed => "dismissed",
    }
}

fn parse_timestamp(timestamp: &str) -> OffsetDateTime {
    OffsetDateTime::parse(timestamp, &Rfc3339).unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

fn timestamp_str_nanos(timestamp: &str) -> i64 {
    timestamp_nanos(parse_timestamp(timestamp))
}

fn timestamp_nanos(timestamp: OffsetDateTime) -> i64 {
    i64::try_from(timestamp.unix_timestamp_nanos()).unwrap_or_else(|_| {
        if timestamp < OffsetDateTime::UNIX_EPOCH {
            i64::MIN
        } else {
            i64::MAX
        }
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use trellis_jobs::types::JobContext;

    use super::*;

    fn job(id: &str, service: &str, job_type: &str, updated_at: &str, state: JobState) -> Job {
        Job {
            id: id.to_string(),
            context: context(id),
            service: service.to_string(),
            job_type: job_type.to_string(),
            state,
            payload: json!({ "id": id }),
            result: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            started_at: None,
            completed_at: None,
            tries: 0,
            max_tries: 3,
            last_error: None,
            deadline: None,
            progress: None,
            logs: None,
        }
    }

    fn context(id: &str) -> JobContext {
        JobContext {
            request_id: format!("request-{id}"),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01".to_string(),
            tracestate: None,
        }
    }

    fn worker(
        service: &str,
        job_type: &str,
        instance_id: &str,
        heartbeat_at: &str,
    ) -> WorkerPresenceRecord {
        WorkerPresenceRecord {
            service: service.to_string(),
            job_type: job_type.to_string(),
            instance_id: instance_id.to_string(),
            concurrency: Some(2),
            version: Some("1.0.0".to_string()),
            heartbeat_at: heartbeat_at.to_string(),
        }
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "trellis-service-jobs-{name}-{}-{}.sqlite3",
            std::process::id(),
            OffsetDateTime::now_utc().unix_timestamp_nanos()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    fn create_old_jobs_projection_schema(
        path: &Path,
        jobs: &[Job],
    ) -> Result<(), SqliteJobsStoreError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            r#"
            CREATE TABLE jobs_projection (
                service TEXT NOT NULL,
                job_type TEXT NOT NULL,
                id TEXT NOT NULL,
                state TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deadline TEXT,
                payload_json TEXT NOT NULL,
                job_json TEXT NOT NULL,
                PRIMARY KEY (service, job_type, id)
            );
            CREATE INDEX idx_jobs_projection_global_id
                ON jobs_projection (id);
            "#,
        )?;

        for projected in jobs {
            let payload_json = serde_json::to_string(&projected.payload).map_err(|error| {
                SqliteJobsStoreError::EncodeJson {
                    model: "job payload",
                    details: error.to_string(),
                }
            })?;
            let job_json = serde_json::to_string(projected).map_err(|error| {
                SqliteJobsStoreError::EncodeJson {
                    model: "job",
                    details: error.to_string(),
                }
            })?;
            connection.execute(
                r#"
                INSERT INTO jobs_projection
                    (service, job_type, id, state, created_at, updated_at, deadline, payload_json, job_json)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    projected.service,
                    projected.job_type,
                    projected.id,
                    job_state_token(projected.state),
                    projected.created_at,
                    projected.updated_at,
                    projected.deadline,
                    payload_json,
                    job_json
                ],
            )?;
        }

        Ok(())
    }

    fn insert_raw_projected_job_json(
        store: &SqliteJobsStore,
        service: &str,
        job_type: &str,
        id: &str,
        state: JobState,
        updated_at: &str,
        job_json: &str,
    ) -> Result<(), SqliteJobsStoreError> {
        let connection = store
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        connection.execute(
            r#"
            INSERT INTO jobs_projection
                (service, job_type, id, state, created_at, updated_at, updated_at_nanos, deadline, deadline_nanos, payload_json, job_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, ?8, ?9)
            "#,
            params![
                service,
                job_type,
                id,
                job_state_token(state),
                "2026-01-01T00:00:00Z",
                updated_at,
                timestamp_str_nanos(updated_at),
                "{}",
                job_json,
            ],
        )?;
        Ok(())
    }

    #[test]
    fn schema_init_is_idempotent() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        store
            .initialize_schema()
            .expect("schema init should be idempotent");
    }

    #[test]
    fn schema_init_upgrades_old_global_id_index_to_unique() {
        let path = temp_db_path("upgrade-global-id-index");
        create_old_jobs_projection_schema(
            &path,
            &[job(
                "job-1",
                "svc",
                "import",
                "2026-01-01T00:00:00Z",
                JobState::Pending,
            )],
        )
        .expect("old schema should be created");

        let store = SqliteJobsStore::open(&path).expect("store should open and upgrade index");
        let duplicate = job(
            "job-1",
            "other-svc",
            "export",
            "2026-01-01T00:01:00Z",
            JobState::Pending,
        );
        let error = store
            .upsert_job(&duplicate)
            .expect_err("duplicate global job id should be rejected");

        assert!(matches!(error, SqliteJobsStoreError::Sqlite(_)));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn schema_init_rejects_existing_duplicate_global_ids() {
        let path = temp_db_path("duplicate-global-ids");
        create_old_jobs_projection_schema(
            &path,
            &[
                job(
                    "job-1",
                    "svc-a",
                    "import",
                    "2026-01-01T00:00:00Z",
                    JobState::Pending,
                ),
                job(
                    "job-1",
                    "svc-b",
                    "export",
                    "2026-01-01T00:01:00Z",
                    JobState::Pending,
                ),
            ],
        )
        .expect("old schema with duplicates should be created");

        let error = SqliteJobsStore::open(&path)
            .expect_err("existing duplicate global ids should prevent opening the projection");

        assert!(matches!(error, SqliteJobsStoreError::Sqlite(_)));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn schema_init_backfills_timestamp_columns_for_existing_rows() {
        let path = temp_db_path("backfill-timestamp-columns");
        let before = job(
            "before",
            "svc",
            "import",
            "2026-01-01T00:00:29Z",
            JobState::Pending,
        );
        let mut at = job(
            "at",
            "svc",
            "import",
            "2025-12-31T19:00:30-05:00",
            JobState::Pending,
        );
        at.deadline = Some("2025-12-31T19:01:00-05:00".to_string());
        create_old_jobs_projection_schema(&path, &[before, at])
            .expect("old schema should be created");

        let store = SqliteJobsStore::open(&path).expect("store should open and backfill");
        let page = store
            .list_jobs(&ListJobsFilter {
                since: Some(parse_timestamp("2026-01-01T00:00:30.000Z")),
                ..Default::default()
            })
            .expect("list should succeed");
        let expired = store
            .scan_expired_jobs("2026-01-01T00:01:00Z")
            .expect("scan should succeed");

        assert_eq!(
            page.jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["at"]
        );
        assert_eq!(
            expired
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["at"]
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn upsert_and_get_job() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let mut projected = job(
            "job-1",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Pending,
        );
        store.upsert_job(&projected).expect("insert should succeed");
        projected.state = JobState::Active;
        projected.updated_at = "2026-01-01T00:01:00Z".to_string();
        store.upsert_job(&projected).expect("update should succeed");

        let fetched = store
            .get_job("svc", "import", "job-1")
            .expect("get should succeed")
            .expect("job should exist");
        assert_eq!(fetched.state, JobState::Active);
        assert_eq!(fetched.updated_at, "2026-01-01T00:01:00Z");
    }

    #[test]
    fn list_jobs_applies_filters() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        for projected in [
            job(
                "a",
                "svc",
                "import",
                "2026-01-01T00:01:00Z",
                JobState::Pending,
            ),
            job("b", "svc", "export", "2026-01-01T00:02:00Z", JobState::Dead),
            job(
                "c",
                "other",
                "import",
                "2026-01-01T00:03:00Z",
                JobState::Pending,
            ),
        ] {
            store.upsert_job(&projected).expect("insert should succeed");
        }

        let page = store
            .list_jobs(&ListJobsFilter {
                service: Some("svc".to_string()),
                states: Some(vec![JobState::Pending]),
                since: Some(parse_timestamp("2026-01-01T00:00:30Z")),
                ..Default::default()
            })
            .expect("list should succeed");
        assert_eq!(
            page.jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a"]
        );
    }

    #[test]
    fn list_jobs_filters_in_sql_before_decoding_job_json() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        store
            .upsert_job(&job(
                "valid",
                "svc",
                "import",
                "2026-01-01T00:01:00Z",
                JobState::Pending,
            ))
            .expect("valid job should insert");
        insert_raw_projected_job_json(
            &store,
            "other",
            "import",
            "invalid-json",
            JobState::Pending,
            "2026-01-01T00:02:00Z",
            "not valid json",
        )
        .expect("raw invalid row should insert");

        let filtered = store
            .list_jobs(&ListJobsFilter {
                service: Some("svc".to_string()),
                ..Default::default()
            })
            .expect("filtered list should not decode unrelated rows");

        assert_eq!(
            filtered
                .jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["valid"]
        );
        assert_eq!(filtered.count, 1);
        assert!(matches!(
            store.list_jobs(&ListJobsFilter::default()),
            Err(SqliteJobsStoreError::DecodeJson { .. })
        ));
    }

    #[test]
    fn list_jobs_since_compares_equivalent_offset_timestamps() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        for projected in [
            job(
                "before",
                "svc",
                "import",
                "2026-01-01T00:00:29Z",
                JobState::Pending,
            ),
            job(
                "at-z",
                "svc",
                "import",
                "2026-01-01T00:00:30Z",
                JobState::Pending,
            ),
            job(
                "at-millis",
                "svc",
                "import",
                "2026-01-01T00:00:30.000Z",
                JobState::Pending,
            ),
            job(
                "at-offset",
                "svc",
                "import",
                "2025-12-31T19:00:30-05:00",
                JobState::Pending,
            ),
        ] {
            store.upsert_job(&projected).expect("insert should succeed");
        }

        let page = store
            .list_jobs(&ListJobsFilter {
                since: Some(parse_timestamp("2025-12-31T19:00:30-05:00")),
                ..Default::default()
            })
            .expect("list should succeed");

        assert_eq!(
            page.jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["at-millis", "at-offset", "at-z"]
        );
    }

    #[test]
    fn list_jobs_order_by_compares_equivalent_timestamp_variants() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        for projected in [
            job(
                "same-z",
                "svc",
                "import",
                "2026-01-01T00:00:30Z",
                JobState::Pending,
            ),
            job(
                "same-millis",
                "svc",
                "import",
                "2026-01-01T00:00:30.000Z",
                JobState::Pending,
            ),
            job(
                "same-offset",
                "svc",
                "import",
                "2025-12-31T19:00:30-05:00",
                JobState::Pending,
            ),
            job(
                "latest",
                "svc",
                "import",
                "2026-01-01T00:00:31Z",
                JobState::Pending,
            ),
        ] {
            store.upsert_job(&projected).expect("insert should succeed");
        }

        let page = store
            .list_jobs(&ListJobsFilter::default())
            .expect("list should succeed");

        assert_eq!(
            page.jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["latest", "same-millis", "same-offset", "same-z"]
        );
    }

    #[test]
    fn list_jobs_uses_offset_pagination() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        for projected in [
            job(
                "a",
                "svc",
                "import",
                "2026-01-03T00:00:00Z",
                JobState::Pending,
            ),
            job(
                "b",
                "svc",
                "import",
                "2026-01-02T00:00:00Z",
                JobState::Pending,
            ),
            job(
                "c",
                "svc",
                "import",
                "2026-01-01T00:00:00Z",
                JobState::Pending,
            ),
        ] {
            store.upsert_job(&projected).expect("insert should succeed");
        }

        let first = store
            .list_jobs(&ListJobsFilter {
                limit: 2,
                ..Default::default()
            })
            .expect("first page should succeed");
        assert_eq!(
            first
                .jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(first.count, 3);
        assert_eq!(first.offset, 0);
        assert_eq!(first.limit, 2);
        assert_eq!(first.next_offset, Some(2));
        let second = store
            .list_jobs(&ListJobsFilter {
                offset: first.next_offset,
                limit: 2,
                ..Default::default()
            })
            .expect("second page should succeed");
        assert_eq!(
            second
                .jobs
                .iter()
                .map(|job| job.id.as_str())
                .collect::<Vec<_>>(),
            vec!["c"]
        );
        assert_eq!(second.count, 3);
        assert_eq!(second.offset, 2);
        assert_eq!(second.limit, 2);
        assert_eq!(second.next_offset, None);
    }

    #[test]
    fn duplicate_global_id_is_rejected() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        store
            .upsert_job(&job(
                "job-1",
                "svc-a",
                "import",
                "2026-01-01T00:00:00Z",
                JobState::Pending,
            ))
            .expect("insert should succeed");
        let error = store
            .upsert_job(&job(
                "job-1",
                "svc-b",
                "import",
                "2026-01-01T00:00:00Z",
                JobState::Pending,
            ))
            .expect_err("duplicate global id should fail");
        assert!(matches!(error, SqliteJobsStoreError::Sqlite(_)));
    }

    #[test]
    fn deadline_scan_returns_expirable_jobs_only() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let mut expired = job(
            "expired",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Pending,
        );
        expired.deadline = Some("2026-01-01T00:01:00Z".to_string());
        let mut future = job(
            "future",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Pending,
        );
        future.deadline = Some("2026-01-01T00:03:00Z".to_string());
        let mut terminal = job(
            "done",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Completed,
        );
        terminal.deadline = Some("2026-01-01T00:01:00Z".to_string());
        for projected in [expired, future, terminal] {
            store.upsert_job(&projected).expect("insert should succeed");
        }

        let jobs = store
            .scan_expired_jobs("2026-01-01T00:02:00Z")
            .expect("scan should succeed");
        assert_eq!(
            jobs.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(),
            vec!["expired"]
        );
    }

    #[test]
    fn deadline_scan_compares_equivalent_timestamp_variants() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        let mut at_millis = job(
            "at-millis",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Pending,
        );
        at_millis.deadline = Some("2026-01-01T00:01:00.000Z".to_string());
        let mut at_offset = job(
            "at-offset",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Pending,
        );
        at_offset.deadline = Some("2025-12-31T19:01:00-05:00".to_string());
        let mut future_offset = job(
            "future-offset",
            "svc",
            "import",
            "2026-01-01T00:00:00Z",
            JobState::Pending,
        );
        future_offset.deadline = Some("2025-12-31T19:01:01-05:00".to_string());
        for projected in [at_millis, at_offset, future_offset] {
            store.upsert_job(&projected).expect("insert should succeed");
        }

        let jobs = store
            .scan_expired_jobs("2026-01-01T00:01:00Z")
            .expect("scan should succeed");
        assert_eq!(
            jobs.iter().map(|job| job.id.as_str()).collect::<Vec<_>>(),
            vec!["at-millis", "at-offset"]
        );
    }

    #[test]
    fn fresh_worker_listing_excludes_stale_records() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        store
            .upsert_worker_presence(&worker("svc", "import", "fresh", "2026-01-01T00:00:30Z"))
            .expect("insert should succeed");
        store
            .upsert_worker_presence(&worker("svc", "import", "stale", "2025-12-31T23:58:00Z"))
            .expect("insert should succeed");

        let now = OffsetDateTime::parse("2026-01-01T00:01:00Z", &Rfc3339).expect("valid timestamp");
        let workers = store
            .list_fresh_workers(now, Duration::from_secs(90))
            .expect("fresh listing should succeed");
        assert_eq!(
            workers
                .iter()
                .map(|worker| worker.instance_id.as_str())
                .collect::<Vec<_>>(),
            vec!["fresh"]
        );
    }
}
