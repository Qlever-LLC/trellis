//! Runtime leases backed by NATS KV.

use std::{error::Error as StdError, fmt, time::Duration};

use async_nats::jetstream::{self, context, kv};
use bytes::Bytes;
use thiserror::Error;

use crate::ResolvedLeasesConfig;

/// Coordinates runtime leases in a NATS KV bucket.
///
/// A lease manager owns the runtime instance identity used as lease values and
/// exposes explicit acquire, renew, and release operations for callers that
/// need single-owner access to a runtime resource. Managers created with
/// [`LeaseManager::new`] hold only resolved settings; use [`LeaseManager::open`]
/// before performing lease operations against NATS.
#[derive(Clone)]
pub struct LeaseManager {
    /// NATS KV bucket that stores runtime lease keys.
    pub bucket: String,
    /// Runtime instance identifier written as the owner value for acquired leases.
    pub owner_id: String,
    /// Maximum lease age configured on the backing KV bucket.
    pub ttl: Duration,
    /// Recommended interval for renewing held leases.
    pub renew: Duration,
    store: Option<kv::Store>,
    replicas: usize,
}

impl fmt::Debug for LeaseManager {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LeaseManager")
            .field("bucket", &self.bucket)
            .field("owner_id", &self.owner_id)
            .field("ttl", &self.ttl)
            .field("renew", &self.renew)
            .field("replicas", &self.replicas)
            .field("store_open", &self.store.is_some())
            .finish()
    }
}

impl LeaseManager {
    /// Builds lease manager settings from resolved runtime config fields.
    #[must_use]
    pub fn new(config: &ResolvedLeasesConfig, owner_id: impl Into<String>) -> Self {
        Self {
            bucket: config.bucket.clone(),
            owner_id: owner_id.into(),
            ttl: Duration::from_millis(config.ttl_ms),
            renew: Duration::from_millis(config.renew_ms),
            store: None,
            replicas: config.replicas.into(),
        }
    }

    /// Opens the NATS KV lease bucket and returns a manager backed by it.
    pub async fn open(
        jetstream: jetstream::Context,
        config: &ResolvedLeasesConfig,
        owner_id: impl Into<String>,
    ) -> Result<Self, LeaseError> {
        let mut manager = Self::new(config, owner_id);
        let store = open_or_create_store(
            &jetstream,
            manager.bucket.clone(),
            lease_bucket_config(&manager.bucket, manager.ttl, manager.replicas),
        )
        .await?;
        manager.store = Some(store);
        Ok(manager)
    }

    /// Attempts to acquire a runtime lease.
    pub async fn acquire(&self, key: LeaseKey) -> Result<LeaseGuard, LeaseError> {
        let store = self.store()?;
        match store
            .create(
                key.value.clone(),
                Bytes::copy_from_slice(self.owner_id.as_bytes()),
            )
            .await
        {
            Ok(revision) => Ok(LeaseGuard { key, revision }),
            Err(error) if error.kind() == kv::CreateErrorKind::AlreadyExists => {
                Err(LeaseError::Held { key })
            }
            Err(error) => Err(LeaseError::Backend {
                key: Some(key),
                operation: "acquire",
                message: error.to_string(),
            }),
        }
    }

    /// Renews a held lease using the guard's current revision.
    ///
    /// This performs one compare-and-update operation against the backing KV
    /// entry. Callers that need continuous ownership should schedule renewals
    /// before [`LeaseManager::ttl`] expires and keep the guard returned by each
    /// successful renewal.
    pub async fn renew(&self, guard: &mut LeaseGuard) -> Result<(), LeaseError> {
        let store = self.store()?;
        let key = guard.key.clone();
        match store
            .update(
                guard.key.value.clone(),
                Bytes::copy_from_slice(self.owner_id.as_bytes()),
                guard.revision,
            )
            .await
        {
            Ok(revision) => {
                guard.revision = revision;
                Ok(())
            }
            Err(error) => Err(classify_revision_error(store, key, "renew", error).await),
        }
    }

    /// Releases a held lease using the guard's current revision.
    pub async fn release(&self, guard: LeaseGuard) -> Result<(), LeaseError> {
        let store = self.store()?;
        let key = guard.key.clone();
        match store
            .delete_expect_revision(guard.key.value.clone(), Some(guard.revision))
            .await
        {
            Ok(()) => Ok(()),
            Err(error) => Err(classify_revision_error(store, key, "release", error).await),
        }
    }

    fn store(&self) -> Result<&kv::Store, LeaseError> {
        self.store.as_ref().ok_or_else(|| LeaseError::Backend {
            key: None,
            operation: "open",
            message: "lease KV bucket is not open".to_owned(),
        })
    }
}

/// Proof that this runtime currently owns a lease key.
///
/// The guard carries the last observed KV revision and must be passed back to
/// [`LeaseManager::renew`] or [`LeaseManager::release`]. Revision checks make a
/// stale guard fail instead of renewing or deleting another owner's lease.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaseGuard {
    /// Acquired lease key.
    pub key: LeaseKey,
    /// Last observed NATS KV revision for the lease key.
    pub revision: u64,
}

/// Canonical key for a runtime lease entry.
///
/// Lease keys are stored directly in the configured NATS KV bucket. Callers are
/// responsible for choosing stable, subsystem-scoped key strings that do not
/// collide with unrelated runtime resources.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaseKey {
    /// Canonical lease key string.
    pub value: String,
}

impl LeaseKey {
    /// Creates a lease key.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
        }
    }
}

/// Lease operation error.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum LeaseError {
    /// Lease is already held by another owner.
    #[error("lease {key:?} is already held")]
    Held {
        /// Lease key.
        key: LeaseKey,
    },
    /// Lease is not currently held.
    #[error("lease {key:?} is not held")]
    NotHeld {
        /// Lease key.
        key: LeaseKey,
    },
    /// Lease guard revision is stale.
    #[error("lease {key:?} has a stale revision")]
    Stale {
        /// Lease key.
        key: LeaseKey,
    },
    /// NATS KV backend operation failed.
    #[error("lease backend {operation} failed for {key:?}: {message}")]
    Backend {
        /// Lease key, when the failed operation targets a key.
        key: Option<LeaseKey>,
        /// Backend operation name.
        operation: &'static str,
        /// Backend error message.
        message: String,
    },
}

fn lease_bucket_config(bucket: &str, ttl: Duration, replicas: usize) -> kv::Config {
    kv::Config {
        bucket: bucket.to_owned(),
        history: 1,
        max_age: ttl,
        num_replicas: replicas,
        ..Default::default()
    }
}

async fn open_or_create_store(
    jetstream: &jetstream::Context,
    bucket: String,
    config: kv::Config,
) -> Result<kv::Store, LeaseError> {
    match jetstream.get_key_value(bucket.clone()).await {
        Ok(store) => Ok(store),
        Err(open_error) => match jetstream.create_key_value(config).await {
            Ok(store) => Ok(store),
            Err(create_error) if is_bucket_create_race(&create_error) => jetstream
                .get_key_value(bucket)
                .await
                .map_err(|retry_error| LeaseError::Backend {
                    key: None,
                    operation: "open",
                    message: format!(
                        "failed to open lease KV bucket after concurrent create: {retry_error}"
                    ),
                }),
            Err(create_error) => Err(LeaseError::Backend {
                key: None,
                operation: "open",
                message: format!(
                    "failed to open lease KV bucket ({open_error}) or create it ({create_error})"
                ),
            }),
        },
    }
}

async fn classify_revision_error(
    store: &kv::Store,
    key: LeaseKey,
    operation: &'static str,
    error: kv::UpdateError,
) -> LeaseError {
    if error.kind() != kv::UpdateErrorKind::WrongLastRevision {
        return LeaseError::Backend {
            key: Some(key),
            operation,
            message: error.to_string(),
        };
    }

    match store.entry(key.value.clone()).await {
        Ok(Some(entry)) => match entry.operation {
            kv::Operation::Delete | kv::Operation::Purge => LeaseError::NotHeld { key },
            _ => LeaseError::Stale { key },
        },
        Ok(None) => LeaseError::NotHeld { key },
        Err(inspect_error) => LeaseError::Backend {
            key: Some(key),
            operation,
            message: format!(
                "revision mismatch ({error}); failed to inspect current lease entry: {inspect_error}"
            ),
        },
    }
}

fn is_bucket_create_race(error: &context::CreateKeyValueError) -> bool {
    if error.kind() != context::CreateKeyValueErrorKind::BucketCreate {
        return false;
    }

    has_stream_exists_error(error)
}

fn has_stream_exists_error(error: &dyn StdError) -> bool {
    let mut source = error.source();
    while let Some(error) = source {
        if let Some(stream_error) = error.downcast_ref::<context::CreateStreamError>() {
            if matches!(
                stream_error.kind(),
                context::CreateStreamErrorKind::JetStream(error)
                    if error.kind() == jetstream::ErrorCode::STREAM_NAME_EXIST
            ) {
                return true;
            }
        }
        if let Some(jetstream_error) = error.downcast_ref::<jetstream::Error>() {
            if jetstream_error.kind() == jetstream::ErrorCode::STREAM_NAME_EXIST {
                return true;
            }
        }
        source = error.source();
    }

    false
}

#[cfg(test)]
mod tests;
