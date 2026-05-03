use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
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
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListJobsFilter {
    pub service: Option<String>,
    pub job_type: Option<String>,
    pub states: Option<Vec<JobState>>,
    pub since: Option<String>,
    pub limit: Option<u64>,
    pub cursor: Option<String>,
}

/// Page of projected jobs using the public Jobs cursor ordering.
#[derive(Debug, Clone, PartialEq)]
pub struct JobsPage {
    pub jobs: Vec<Job>,
    pub has_more: bool,
    pub next_cursor: Option<String>,
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
    #[error("duplicate projected jobs found for globally addressable id '{id}'")]
    DuplicateJobId { id: String },
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
                deadline TEXT,
                payload_json TEXT NOT NULL,
                job_json TEXT NOT NULL,
                PRIMARY KEY (service, job_type, id)
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_projection_global_id
                ON jobs_projection (id);
            CREATE INDEX IF NOT EXISTS idx_jobs_projection_list
                ON jobs_projection (updated_at DESC, service ASC, job_type ASC, id ASC);
            CREATE INDEX IF NOT EXISTS idx_jobs_projection_deadline
                ON jobs_projection (deadline, state);

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
        Ok(())
    }

    /// Upsert one projected job row.
    pub fn upsert_job(&self, job: &Job) -> Result<(), SqliteJobsStoreError> {
        let state = job_state_token(job.state);
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
                (service, job_type, id, state, created_at, updated_at, deadline, payload_json, job_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(service, job_type, id) DO UPDATE SET
                state = excluded.state,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                deadline = excluded.deadline,
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
                job.deadline,
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

    /// Fetch a job by the globally addressable admin id, detecting duplicates.
    pub fn get_job_by_global_id(&self, id: &str) -> Result<Option<Job>, SqliteJobsStoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        let mut statement = connection.prepare(
            "SELECT job_json FROM jobs_projection WHERE id = ?1 ORDER BY service ASC, job_type ASC",
        )?;
        let rows = statement.query_map(params![id], |row| row.get::<_, String>(0))?;
        let mut found = None;
        for row in rows {
            if found.is_some() {
                return Err(SqliteJobsStoreError::DuplicateJobId { id: id.to_string() });
            }
            found = Some(decode_job_json(&row?)?);
        }
        Ok(found)
    }

    /// List projected jobs with stable cursor pagination.
    pub fn list_jobs(&self, filter: &ListJobsFilter) -> Result<JobsPage, SqliteJobsStoreError> {
        let mut jobs = self.read_all_jobs()?;
        if let Some(service) = &filter.service {
            jobs.retain(|job| job.service == *service);
        }
        if let Some(job_type) = &filter.job_type {
            jobs.retain(|job| job.job_type == *job_type);
        }
        if let Some(states) = &filter.states {
            jobs.retain(|job| states.contains(&job.state));
        }
        if let Some(since) = &filter.since {
            jobs.retain(|job| job.updated_at >= *since);
        }

        jobs.sort_by(compare_jobs);
        if let Some(cursor) = &filter.cursor {
            let cursor = decode_cursor(cursor)?;
            jobs.retain(|job| compare_job_to_cursor(job, &cursor).is_gt());
        }

        let mut has_more = false;
        let mut next_cursor = None;
        if let Some(limit) = filter.limit {
            let limit = usize::try_from(limit).unwrap_or(usize::MAX);
            if jobs.len() > limit {
                has_more = true;
                jobs.truncate(limit);
                next_cursor = jobs.last().map(encode_cursor).transpose()?;
            }
        }

        Ok(JobsPage {
            jobs,
            has_more,
            next_cursor,
        })
    }

    /// List non-terminal jobs whose business deadline is at or before `now`.
    pub fn scan_expired_jobs(&self, now: &str) -> Result<Vec<Job>, SqliteJobsStoreError> {
        let mut jobs = self.read_all_jobs()?;
        jobs.retain(|job| {
            matches!(
                job.state,
                JobState::Pending | JobState::Retry | JobState::Active
            ) && job
                .deadline
                .as_deref()
                .is_some_and(|deadline| deadline <= now)
        });
        jobs.sort_by(|left, right| {
            left.deadline
                .cmp(&right.deadline)
                .then_with(|| left.service.cmp(&right.service))
                .then_with(|| left.job_type.cmp(&right.job_type))
                .then_with(|| left.id.cmp(&right.id))
        });
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

    fn read_all_jobs(&self) -> Result<Vec<Job>, SqliteJobsStoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| SqliteJobsStoreError::Poisoned)?;
        let mut statement = connection.prepare("SELECT job_json FROM jobs_projection")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut jobs = Vec::new();
        for row in rows {
            jobs.push(decode_job_json(&row?)?);
        }
        Ok(jobs)
    }
}

fn decode_job_json(json: &str) -> Result<Job, SqliteJobsStoreError> {
    serde_json::from_str(json).map_err(|error| SqliteJobsStoreError::DecodeJson {
        model: "job",
        details: error.to_string(),
    })
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

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct JobsCursor {
    updated_at: String,
    service: String,
    job_type: String,
    id: String,
}

fn compare_jobs(left: &Job, right: &Job) -> std::cmp::Ordering {
    right
        .updated_at
        .cmp(&left.updated_at)
        .then_with(|| left.service.cmp(&right.service))
        .then_with(|| left.job_type.cmp(&right.job_type))
        .then_with(|| left.id.cmp(&right.id))
}

fn compare_job_to_cursor(job: &Job, cursor: &JobsCursor) -> std::cmp::Ordering {
    cursor
        .updated_at
        .cmp(&job.updated_at)
        .then_with(|| job.service.cmp(&cursor.service))
        .then_with(|| job.job_type.cmp(&cursor.job_type))
        .then_with(|| job.id.cmp(&cursor.id))
}

fn encode_cursor(job: &Job) -> Result<String, SqliteJobsStoreError> {
    serde_json::to_string(&JobsCursor {
        updated_at: job.updated_at.clone(),
        service: job.service.clone(),
        job_type: job.job_type.clone(),
        id: job.id.clone(),
    })
    .map_err(|error| SqliteJobsStoreError::EncodeJson {
        model: "jobs cursor",
        details: error.to_string(),
    })
}

fn decode_cursor(cursor: &str) -> Result<JobsCursor, SqliteJobsStoreError> {
    serde_json::from_str(cursor).map_err(|error| SqliteJobsStoreError::DecodeJson {
        model: "jobs cursor",
        details: error.to_string(),
    })
}

fn parse_timestamp(timestamp: &str) -> OffsetDateTime {
    OffsetDateTime::parse(timestamp, &Rfc3339).unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn job(id: &str, service: &str, job_type: &str, updated_at: &str, state: JobState) -> Job {
        Job {
            id: id.to_string(),
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

    #[test]
    fn schema_init_is_idempotent() {
        let store = SqliteJobsStore::open_in_memory().expect("store should open");
        store
            .initialize_schema()
            .expect("schema init should be idempotent");
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
                since: Some("2026-01-01T00:00:30Z".to_string()),
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
    fn list_jobs_uses_cursor_pagination() {
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
                limit: Some(2),
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
        assert!(first.has_more);
        let second = store
            .list_jobs(&ListJobsFilter {
                cursor: first.next_cursor,
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
    }

    #[test]
    fn duplicate_global_id_is_reported() {
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
        store
            .upsert_job(&job(
                "job-1",
                "svc-b",
                "import",
                "2026-01-01T00:00:00Z",
                JobState::Pending,
            ))
            .expect("insert should succeed");

        let error = store
            .get_job_by_global_id("job-1")
            .expect_err("duplicate should fail");
        assert!(matches!(error, SqliteJobsStoreError::DuplicateJobId { id } if id == "job-1"));
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
