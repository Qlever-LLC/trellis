use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params, OptionalExtension, Row, ToSql};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};
use trellis_protocol::{
    canonicalize_json, parse_authorization_context, AuthorizationAuthorityKind,
    SignedAuthorizationContext,
};

use super::super::{
    application::repository::IdempotentOutcome,
    authority::{issuance_snapshot_token, IssuanceSnapshotToken},
    domain::require_protocol_timestamp,
    sqlite::{
        common::{
            decode_enum, encode_enum, from_sql_version, map_write_error, sql_error, to_sql_version,
        },
        contexts::sqlite_issuance_snapshot,
        outbox::{insert_sql_idempotency_and_actions, sqlite_idempotency_replay},
        validation::next_version,
        SqliteAuthorizationStore,
    },
    AuthorityKind, AuthorizationStateError, IdempotencyResultRecord, PostCommitActionKind,
    PostCommitActionRecord,
};

const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Durable rollback floor for one installation authorization root.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationTrustStateRecord {
    /// Signed authorization namespace.
    pub authority: String,
    /// Pinned root key ID.
    pub root_key_id: String,
    /// Pinned root object digest.
    pub root_digest: String,
    /// Highest accepted issuer-manifest generation.
    pub manifest_generation: u64,
    /// Digest accepted at `manifest_generation`.
    pub manifest_digest: String,
    /// Last accepted update in Unix milliseconds.
    pub updated_at: i64,
    /// Positive optimistic version.
    pub version: u64,
}

/// Durable authorization-context lifecycle state.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationContextState {
    /// Signed context is within its durable lease and has not been revoked.
    Active,
    /// Context was invalidated before its signed expiry.
    Revoked,
    /// Signed expiry elapsed without a semantic revocation.
    Expired,
}

/// Stable safe reason published for an authorization-context revocation.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationContextRevocationReason {
    SessionRevoked,
    SessionExpired,
    CredentialChanged,
    PrincipalChanged,
    PrincipalInactive,
    AuthorityChanged,
    AuthorityRevoked,
    MaterializationChanged,
    MaterializationUnavailable,
    DeploymentInactive,
    DeploymentChanged,
    InstanceInactive,
    InstanceChanged,
    DeviceInactive,
    DeviceChanged,
    DelegationChanged,
    ParticipantChanged,
    IssuerRevoked,
    ContextReplaced,
    AdministrativeRevoke,
}

/// Durable signed authorization context and its publication lifecycle.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationContextRecord {
    pub context_digest: String,
    pub session_id: String,
    pub principal_id: String,
    pub authority_kind: AuthorityKind,
    pub authority_id: String,
    pub deployment_id: Option<String>,
    pub instance_id: Option<String>,
    pub issuer_key_id: String,
    pub issuer_manifest_generation: u64,
    pub signed_context_json: String,
    pub issuance_snapshot_token: String,
    pub refresh_at: i64,
    pub expires_at: i64,
    pub state: AuthorizationContextState,
    pub published_at: Option<i64>,
    pub revoked_at: Option<i64>,
    pub revocation_reason: Option<AuthorizationContextRevocationReason>,
    pub version: u64,
}

impl AuthorizationContextRecord {
    pub(crate) fn signed_context(
        &self,
    ) -> Result<SignedAuthorizationContext, AuthorizationStateError> {
        let value = serde_json::from_str(&self.signed_context_json)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        parse_authorization_context(&value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))
    }
}

/// Aggregate optimistic context-issuance commit.
#[derive(Clone, Debug)]
pub struct AuthorizationContextCommit {
    pub expected_snapshot_token: IssuanceSnapshotToken,
    pub context: AuthorizationContextRecord,
    pub idempotency: IdempotencyResultRecord,
    pub now: i64,
    pub minimum_remaining_seconds: i64,
}

/// Exact durable selector for context invalidation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorizationContextSelector {
    Context(String),
    Session(String),
    Principal(String),
    Authority(AuthorityKind, String),
    Deployment(String),
    Instance(String),
    Issuer(String),
}

/// Durable trust-floor and authorization-context repository boundary.
#[async_trait]
pub(crate) trait AuthorizationContextRepository: Send + Sync {
    async fn get_trust_state(
        &self,
    ) -> Result<Option<AuthorizationTrustStateRecord>, AuthorizationStateError>;

    async fn accept_trust_state(
        &self,
        state: AuthorizationTrustStateRecord,
        removed_issuer_key_ids: Vec<String>,
        revoked_at: i64,
    ) -> Result<AuthorizationTrustStateRecord, AuthorizationStateError>;

    async fn get_context_by_digest(
        &self,
        context_digest: &str,
    ) -> Result<Option<AuthorizationContextRecord>, AuthorizationStateError>;

    #[cfg(test)]
    async fn list_active_contexts_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError>;

    async fn list_unpublished_contexts(
        &self,
        limit: usize,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError>;

    async fn list_active_issuer_key_ids(&self) -> Result<Vec<String>, AuthorizationStateError>;

    async fn list_revoked_contexts(
        &self,
        after_context_digest: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError>;

    async fn commit_context(
        &self,
        commit: AuthorizationContextCommit,
    ) -> Result<IdempotentOutcome<AuthorizationContextRecord>, AuthorizationStateError>;

    async fn mark_context_published(
        &self,
        context_digest: &str,
        expected_version: u64,
        published_at: i64,
    ) -> Result<AuthorizationContextRecord, AuthorizationStateError>;

    async fn expire_contexts(
        &self,
        now: i64,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError>;

    async fn delete_terminal_contexts(
        &self,
        before: i64,
        limit: usize,
    ) -> Result<usize, AuthorizationStateError>;
}

#[async_trait]
impl AuthorizationContextRepository for SqliteAuthorizationStore {
    async fn get_trust_state(
        &self,
    ) -> Result<Option<AuthorizationTrustStateRecord>, AuthorizationStateError> {
        self.run(|connection| load_sql_trust_state(connection))
            .await
    }

    async fn accept_trust_state(
        &self,
        state: AuthorizationTrustStateRecord,
        removed_issuer_key_ids: Vec<String>,
        revoked_at: i64,
    ) -> Result<AuthorizationTrustStateRecord, AuthorizationStateError> {
        validate_trust_state(&state)?;
        require_protocol_timestamp("revokedAt", revoked_at)?;
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            let accepted = accept_trust_state(load_sql_trust_state(&transaction)?.as_ref(), state)?;
            transaction
                .execute(
                    "INSERT INTO auth_authorization_trust_state (
                        singleton_id, authority, root_key_id, root_digest, manifest_generation,
                        manifest_digest, updated_at, version
                     ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(singleton_id) DO UPDATE SET
                        authority = excluded.authority,
                        root_key_id = excluded.root_key_id,
                        root_digest = excluded.root_digest,
                        manifest_generation = excluded.manifest_generation,
                        manifest_digest = excluded.manifest_digest,
                        updated_at = excluded.updated_at,
                        version = excluded.version",
                    params![
                        accepted.authority,
                        accepted.root_key_id,
                        accepted.root_digest,
                        to_sql_version(accepted.manifest_generation)?,
                        accepted.manifest_digest,
                        accepted.updated_at,
                        to_sql_version(accepted.version)?,
                    ],
                )
                .map_err(map_write_error)?;
            for issuer_key_id in removed_issuer_key_ids {
                revoke_sql_contexts(
                    &transaction,
                    &AuthorizationContextSelector::Issuer(issuer_key_id),
                    AuthorizationContextRevocationReason::IssuerRevoked,
                    revoked_at,
                )?;
            }
            transaction.commit().map_err(sql_error)?;
            Ok(accepted)
        })
        .await
    }

    async fn get_context_by_digest(
        &self,
        context_digest: &str,
    ) -> Result<Option<AuthorizationContextRecord>, AuthorizationStateError> {
        let digest = context_digest.to_owned();
        self.run(move |connection| {
            connection
                .query_row(
                    &format!("{} WHERE context_digest = ?1", CONTEXT_SELECT),
                    [&digest],
                    decode_sql_context,
                )
                .optional()
                .map_err(sql_error)
        })
        .await
    }

    #[cfg(test)]
    async fn list_active_contexts_for_session(
        &self,
        session_id: &str,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError> {
        let id = session_id.to_owned();
        self.run(move |connection| {
            query_sql_contexts(
                connection,
                "session_id = ?1 AND state = 'active' ORDER BY expires_at, context_digest",
                &[&id],
            )
        })
        .await
    }

    async fn list_unpublished_contexts(
        &self,
        limit: usize,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError> {
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        self.run(move |connection| {
            query_sql_contexts(
                connection,
                "state = 'active' AND published_at IS NULL ORDER BY expires_at, context_digest LIMIT ?1",
                &[&limit],
            )
        })
        .await
    }

    async fn list_active_issuer_key_ids(&self) -> Result<Vec<String>, AuthorizationStateError> {
        self.run(|connection| {
            let mut statement = connection
                .prepare(
                    "SELECT DISTINCT issuer_key_id FROM auth_authorization_contexts
                     WHERE state = 'active' ORDER BY issuer_key_id",
                )
                .map_err(sql_error)?;
            let values = statement
                .query_map([], |row| row.get(0))
                .map_err(sql_error)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(sql_error)?;
            Ok(values)
        })
        .await
    }

    async fn list_revoked_contexts(
        &self,
        after_context_digest: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError> {
        let after_context_digest = after_context_digest.map(str::to_owned);
        self.run(move |connection| {
            let limit = i64::try_from(limit).unwrap_or(i64::MAX);
            match after_context_digest.as_deref() {
                Some(after) => query_sql_contexts(
                    connection,
                    "state = 'revoked' AND context_digest > ?1 ORDER BY context_digest LIMIT ?2",
                    &[&after, &limit],
                ),
                None => query_sql_contexts(
                    connection,
                    "state = 'revoked' ORDER BY context_digest LIMIT ?1",
                    &[&limit],
                ),
            }
        })
        .await
    }

    async fn commit_context(
        &self,
        commit: AuthorizationContextCommit,
    ) -> Result<IdempotentOutcome<AuthorizationContextRecord>, AuthorizationStateError> {
        validate_context_record(&commit.context)?;
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            if let Some(replay) = sqlite_idempotency_replay(&transaction, &commit.idempotency)? {
                return Ok(IdempotentOutcome::Replayed(replay));
            }
            let snapshot = sqlite_issuance_snapshot(&transaction, &commit.context.session_id)?;
            if issuance_snapshot_token(&snapshot)? != commit.expected_snapshot_token {
                return Err(AuthorizationStateError::StorageConflict);
            }
            let active = query_sql_contexts(
                &transaction,
                "session_id = ?1 AND state = 'active' ORDER BY expires_at DESC, context_digest DESC",
                &[&commit.context.session_id],
            )?;
            for displaced in active.iter().skip(2) {
                revoke_sql_contexts(
                    &transaction,
                    &AuthorizationContextSelector::Context(displaced.context_digest.clone()),
                    AuthorizationContextRevocationReason::ContextReplaced,
                    commit.now,
                )?;
            }
            if let Some(existing) = active.iter().take(2).find(|context| {
                context.issuance_snapshot_token == commit.context.issuance_snapshot_token
                    && context.issuer_key_id == commit.context.issuer_key_id
                    && context.issuer_manifest_generation
                        == commit.context.issuer_manifest_generation
                    && context.refresh_at > commit.now
                    && context.expires_at - commit.now >= commit.minimum_remaining_seconds
            }) {
                let mut idempotency = commit.idempotency;
                idempotency.result = json!({ "contextDigest": existing.context_digest });
                insert_sql_idempotency_and_actions(&transaction, &idempotency, &[])?;
                let existing = existing.clone();
                transaction.commit().map_err(sql_error)?;
                return Ok(IdempotentOutcome::Applied(existing));
            }
            for displaced in active.iter().skip(1) {
                revoke_sql_contexts(
                    &transaction,
                    &AuthorizationContextSelector::Context(displaced.context_digest.clone()),
                    AuthorizationContextRevocationReason::ContextReplaced,
                    commit.now,
                )?;
            }
            let action =
                context_action(&commit.context, PostCommitActionKind::ContextPublish, None)?;
            insert_sql_context(&transaction, &commit.context)?;
            let mut idempotency = commit.idempotency;
            idempotency.result = json!({ "contextDigest": commit.context.context_digest });
            insert_sql_idempotency_and_actions(&transaction, &idempotency, &[action])?;
            transaction.commit().map_err(sql_error)?;
            Ok(IdempotentOutcome::Applied(commit.context))
        })
        .await
    }

    async fn mark_context_published(
        &self,
        context_digest: &str,
        expected_version: u64,
        published_at: i64,
    ) -> Result<AuthorizationContextRecord, AuthorizationStateError> {
        require_protocol_timestamp("publishedAt", published_at)?;
        let digest = context_digest.to_owned();
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            let current = load_sql_context_by_digest(&transaction, &digest)?.ok_or_else(|| {
                AuthorizationStateError::InvalidRecord("context is missing".to_owned())
            })?;
            if current.version != expected_version || published_at > current.expires_at {
                return Err(AuthorizationStateError::StorageConflict);
            }
            if let Some(existing) = current.published_at {
                return if existing == published_at {
                    Ok(current)
                } else {
                    Err(AuthorizationStateError::StorageConflict)
                };
            }
            let version = next_version(current.version)?;
            transaction
                .execute(
                    "UPDATE auth_authorization_contexts
                     SET published_at = ?1, version = ?2
                     WHERE context_digest = ?3 AND version = ?4 AND published_at IS NULL",
                    params![
                        published_at,
                        to_sql_version(version)?,
                        digest,
                        to_sql_version(expected_version)?,
                    ],
                )
                .map_err(map_write_error)
                .and_then(|changed| {
                    if changed == 1 {
                        Ok(())
                    } else {
                        Err(AuthorizationStateError::StorageConflict)
                    }
                })?;
            let updated = load_sql_context_by_digest(&transaction, &digest)?.ok_or_else(|| {
                AuthorizationStateError::Storage("published context disappeared".to_owned())
            })?;
            transaction.commit().map_err(sql_error)?;
            Ok(updated)
        })
        .await
    }

    async fn expire_contexts(
        &self,
        now: i64,
    ) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError> {
        require_protocol_timestamp("now", now)?;
        self.run(move |connection| {
            let transaction = connection.transaction().map_err(sql_error)?;
            let contexts = query_sql_contexts(
                &transaction,
                "state = 'active' AND expires_at <= ?1 ORDER BY expires_at, context_digest",
                &[&now],
            )?;
            for context in &contexts {
                transaction
                    .execute(
                        "UPDATE auth_authorization_contexts SET state = 'expired', version = ?1
                         WHERE context_digest = ?2 AND state = 'active' AND version = ?3",
                        params![
                            to_sql_version(next_version(context.version)?)?,
                            context.context_digest,
                            to_sql_version(context.version)?,
                        ],
                    )
                    .map_err(map_write_error)?;
            }
            let expired = contexts
                .into_iter()
                .map(|mut context| {
                    context.state = AuthorizationContextState::Expired;
                    context.version = next_version(context.version)?;
                    Ok(context)
                })
                .collect::<Result<Vec<_>, AuthorizationStateError>>()?;
            transaction.commit().map_err(sql_error)?;
            Ok(expired)
        })
        .await
    }

    async fn delete_terminal_contexts(
        &self,
        before: i64,
        limit: usize,
    ) -> Result<usize, AuthorizationStateError> {
        require_protocol_timestamp("before", before)?;
        let limit = i64::try_from(limit).map_err(|_| {
            AuthorizationStateError::InvalidRecord("context cleanup limit is too large".to_owned())
        })?;
        self.run(move |connection| {
            let before_millis = before.checked_mul(1_000).ok_or_else(|| {
                AuthorizationStateError::InvalidRecord(
                    "context cleanup timestamp overflow".to_owned(),
                )
            })?;
            connection
                .execute(
                    "DELETE FROM auth_idempotency_results
                     WHERE purpose = 'authorizationContextIssue' AND expires_at <= ?1",
                    [before_millis],
                )
                .map_err(map_write_error)?;
            connection
                .execute(
                    "DELETE FROM auth_authorization_contexts
                     WHERE context_digest IN (
                       SELECT context_digest FROM auth_authorization_contexts AS context
                       WHERE state IN ('expired', 'revoked')
                          AND expires_at <= ?1
                         AND NOT EXISTS (
                           SELECT 1 FROM auth_post_commit_actions AS action
                           WHERE json_extract(action.payload_json, '$.contextDigest') = context.context_digest
                         )
                         ORDER BY expires_at, context_digest
                       LIMIT ?2
                     )",
                    params![before, limit],
                )
                .map_err(map_write_error)
        })
        .await
    }
}

const CONTEXT_SELECT: &str = "SELECT
    context_digest, session_id, principal_id, authority_kind, authority_id,
    deployment_id, instance_id, issuer_key_id, issuer_manifest_generation,
    signed_context_json, issuance_snapshot_token, refresh_at, expires_at,
    state, published_at, revoked_at, revocation_reason, version
    FROM auth_authorization_contexts";

fn load_sql_trust_state(
    connection: &rusqlite::Connection,
) -> Result<Option<AuthorizationTrustStateRecord>, AuthorizationStateError> {
    let table_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_authorization_trust_state')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(sql_error)?;
    if !table_exists {
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT authority, root_key_id, root_digest, manifest_generation, manifest_digest,
                    updated_at, version
             FROM auth_authorization_trust_state WHERE singleton_id = 1",
            [],
            |row| {
                Ok(AuthorizationTrustStateRecord {
                    authority: row.get(0)?,
                    root_key_id: row.get(1)?,
                    root_digest: row.get(2)?,
                    manifest_generation: from_sql_version(row.get(3)?)?,
                    manifest_digest: row.get(4)?,
                    updated_at: row.get(5)?,
                    version: from_sql_version(row.get(6)?)?,
                })
            },
        )
        .optional()
        .map_err(sql_error)
}

fn insert_sql_context(
    connection: &rusqlite::Connection,
    context: &AuthorizationContextRecord,
) -> Result<(), AuthorizationStateError> {
    connection
        .execute(
            "INSERT INTO auth_authorization_contexts (
                context_digest, session_id, principal_id, authority_kind, authority_id,
                deployment_id, instance_id, issuer_key_id, issuer_manifest_generation,
                signed_context_json, issuance_snapshot_token, refresh_at, expires_at,
                state, published_at, revoked_at, revocation_reason, version
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                ?15, ?16, ?17, ?18
             )",
            params![
                context.context_digest,
                context.session_id,
                context.principal_id,
                encode_enum(context.authority_kind)?,
                context.authority_id,
                context.deployment_id,
                context.instance_id,
                context.issuer_key_id,
                to_sql_version(context.issuer_manifest_generation)?,
                context.signed_context_json,
                context.issuance_snapshot_token,
                context.refresh_at,
                context.expires_at,
                encode_enum(context.state)?,
                context.published_at,
                context.revoked_at,
                context.revocation_reason.map(encode_enum).transpose()?,
                to_sql_version(context.version)?,
            ],
        )
        .map_err(map_write_error)?;
    Ok(())
}

fn load_sql_context_by_digest(
    connection: &rusqlite::Connection,
    context_digest: &str,
) -> Result<Option<AuthorizationContextRecord>, AuthorizationStateError> {
    connection
        .query_row(
            &format!("{} WHERE context_digest = ?1", CONTEXT_SELECT),
            [context_digest],
            decode_sql_context,
        )
        .optional()
        .map_err(sql_error)
}

fn query_sql_contexts(
    connection: &rusqlite::Connection,
    predicate: &str,
    parameters: &[&dyn ToSql],
) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError> {
    let mut statement = connection
        .prepare(&format!("{} WHERE {}", CONTEXT_SELECT, predicate))
        .map_err(sql_error)?;
    let contexts = statement
        .query_map(parameters, decode_sql_context)
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(contexts)
}

fn decode_sql_context(row: &Row<'_>) -> rusqlite::Result<AuthorizationContextRecord> {
    Ok(AuthorizationContextRecord {
        context_digest: row.get(0)?,
        session_id: row.get(1)?,
        principal_id: row.get(2)?,
        authority_kind: decode_enum(row.get::<_, String>(3)?)?,
        authority_id: row.get(4)?,
        deployment_id: row.get(5)?,
        instance_id: row.get(6)?,
        issuer_key_id: row.get(7)?,
        issuer_manifest_generation: from_sql_version(row.get(8)?)?,
        signed_context_json: row.get(9)?,
        issuance_snapshot_token: row.get(10)?,
        refresh_at: row.get(11)?,
        expires_at: row.get(12)?,
        state: decode_enum(row.get::<_, String>(13)?)?,
        published_at: row.get(14)?,
        revoked_at: row.get(15)?,
        revocation_reason: row
            .get::<_, Option<String>>(16)?
            .map(decode_enum)
            .transpose()?,
        version: from_sql_version(row.get(17)?)?,
    })
}

pub(crate) fn revoke_sql_contexts(
    connection: &rusqlite::Connection,
    selector: &AuthorizationContextSelector,
    reason: AuthorizationContextRevocationReason,
    revoked_at: i64,
) -> Result<Vec<AuthorizationContextRecord>, AuthorizationStateError> {
    require_protocol_timestamp("revokedAt", revoked_at)?;
    let contexts = match selector {
        AuthorizationContextSelector::Context(id) => query_sql_contexts(
            connection,
            "state = 'active' AND context_digest = ?1",
            &[id],
        )?,
        AuthorizationContextSelector::Session(id) => query_sql_contexts(
            connection,
            "state = 'active' AND session_id = ?1 ORDER BY context_digest",
            &[id],
        )?,
        AuthorizationContextSelector::Principal(id) => query_sql_contexts(
            connection,
            "state = 'active' AND principal_id = ?1 ORDER BY context_digest",
            &[id],
        )?,
        AuthorizationContextSelector::Authority(kind, id) => {
            let kind = encode_enum(*kind)?;
            query_sql_contexts(
                connection,
                "state = 'active' AND authority_kind = ?1 AND authority_id = ?2 ORDER BY context_digest",
                &[&kind, id],
            )?
        }
        AuthorizationContextSelector::Deployment(id) => query_sql_contexts(
            connection,
            "state = 'active' AND deployment_id = ?1 ORDER BY context_digest",
            &[id],
        )?,
        AuthorizationContextSelector::Instance(id) => query_sql_contexts(
            connection,
            "state = 'active' AND instance_id = ?1 ORDER BY context_digest",
            &[id],
        )?,
        AuthorizationContextSelector::Issuer(id) => query_sql_contexts(
            connection,
            "state = 'active' AND issuer_key_id = ?1 ORDER BY context_digest",
            &[id],
        )?,
    };
    let mut revoked = Vec::with_capacity(contexts.len());
    for mut context in contexts {
        context.state = AuthorizationContextState::Revoked;
        context.revoked_at = Some(revoked_at);
        context.revocation_reason = Some(reason);
        context.version = next_version(context.version)?;
        connection
            .execute(
                "UPDATE auth_authorization_contexts
                 SET state = 'revoked', revoked_at = ?1, revocation_reason = ?2, version = ?3
                 WHERE context_digest = ?4 AND state = 'active' AND version = ?5",
                params![
                    revoked_at,
                    encode_enum(reason)?,
                    to_sql_version(context.version)?,
                    context.context_digest,
                    to_sql_version(context.version - 1)?,
                ],
            )
            .map_err(map_write_error)
            .and_then(|changed| {
                if changed == 1 {
                    Ok(())
                } else {
                    Err(AuthorizationStateError::StorageConflict)
                }
            })?;
        insert_context_action(
            connection,
            &context_action(&context, PostCommitActionKind::ContextRevoke, Some(reason))?,
        )?;
        revoked.push(context);
    }
    Ok(revoked)
}

fn insert_context_action(
    connection: &rusqlite::Connection,
    action: &PostCommitActionRecord,
) -> Result<(), AuthorizationStateError> {
    let payload = canonicalize_json(&action.payload)
        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?;
    if let Some((kind, existing_payload)) = connection
        .query_row(
            "SELECT kind, payload_json FROM auth_post_commit_actions WHERE action_id = ?1",
            [&action.action_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(sql_error)?
    {
        return if kind == encode_enum(action.kind)? && existing_payload == payload {
            Ok(())
        } else {
            Err(AuthorizationStateError::StorageConflict)
        };
    }
    connection
        .execute(
            "INSERT INTO auth_post_commit_actions (
                action_id, kind, payload_json, created_at, attempts, next_attempt_at,
                claimed_until, last_error
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                action.action_id,
                encode_enum(action.kind)?,
                payload,
                action.created_at,
                i64::from(action.attempts),
                action.next_attempt_at,
                action.claimed_until,
                action.last_error,
            ],
        )
        .map_err(map_write_error)?;
    Ok(())
}

fn validate_trust_state(
    state: &AuthorizationTrustStateRecord,
) -> Result<(), AuthorizationStateError> {
    nonempty("authority", &state.authority)?;
    digest("rootKeyId", &state.root_key_id)?;
    digest("rootDigest", &state.root_digest)?;
    digest("manifestDigest", &state.manifest_digest)?;
    positive("manifestGeneration", state.manifest_generation)?;
    positive("version", state.version)?;
    require_protocol_timestamp("updatedAt", state.updated_at)
}

fn accept_trust_state(
    current: Option<&AuthorizationTrustStateRecord>,
    next: AuthorizationTrustStateRecord,
) -> Result<AuthorizationTrustStateRecord, AuthorizationStateError> {
    let Some(current) = current else {
        if next.version != 1 {
            return Err(AuthorizationStateError::StorageConflict);
        }
        return Ok(next);
    };
    if current.authority != next.authority
        || current.root_key_id != next.root_key_id
        || current.root_digest != next.root_digest
        || next.manifest_generation < current.manifest_generation
        || (next.manifest_generation == current.manifest_generation
            && next.manifest_digest != current.manifest_digest)
    {
        return Err(AuthorizationStateError::StorageConflict);
    }
    if next.manifest_generation == current.manifest_generation {
        return Ok(current.clone());
    }
    if next.version != next_version(current.version)? {
        return Err(AuthorizationStateError::StorageConflict);
    }
    Ok(next)
}

fn validate_context_record(
    record: &AuthorizationContextRecord,
) -> Result<(), AuthorizationStateError> {
    digest("contextDigest", &record.context_digest)?;
    nonempty("sessionId", &record.session_id)?;
    nonempty("principalId", &record.principal_id)?;
    nonempty("authorityId", &record.authority_id)?;
    digest("issuerKeyId", &record.issuer_key_id)?;
    digest("issuanceSnapshotToken", &record.issuance_snapshot_token)?;
    positive(
        "issuerManifestGeneration",
        record.issuer_manifest_generation,
    )?;
    positive("version", record.version)?;
    for (name, value) in [
        ("expiresAt", record.expires_at),
        ("refreshAt", record.refresh_at),
    ] {
        require_protocol_timestamp(name, value)?;
    }
    if record.refresh_at > record.expires_at
        || record.deployment_id.is_none() != record.instance_id.is_none()
        || (record.state == AuthorizationContextState::Revoked)
            != (record.revoked_at.is_some() && record.revocation_reason.is_some())
        || (record.state != AuthorizationContextState::Revoked
            && (record.revoked_at.is_some() || record.revocation_reason.is_some()))
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "authorization context lifecycle is inconsistent".to_owned(),
        ));
    }
    let value: Value = serde_json::from_str(&record.signed_context_json).map_err(|error| {
        AuthorizationStateError::InvalidRecord(format!("invalid signed context: {error}"))
    })?;
    let signed = parse_authorization_context(&value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let canonical = canonicalize_json(&value)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    if canonical != record.signed_context_json
        || signed
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
            != record.context_digest
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "signed context canonical digest does not match".to_owned(),
        ));
    }
    let context = signed.unsigned;
    if context.session_id != record.session_id
        || context.principal.id != record.principal_id
        || authority_kind(context.authority_ref.kind) != record.authority_kind
        || context.authority_ref.id != record.authority_id
        || context.deployment_id != record.deployment_id
        || context.instance_id != record.instance_id
        || context.issuer_key_id != record.issuer_key_id
        || context.issuer_manifest_generation != record.issuer_manifest_generation
        || context.expires_at != record.expires_at
    {
        return Err(AuthorizationStateError::InvalidRecord(
            "context record metadata does not match signed context".to_owned(),
        ));
    }
    Ok(())
}

fn context_action(
    context: &AuthorizationContextRecord,
    kind: PostCommitActionKind,
    reason: Option<AuthorizationContextRevocationReason>,
) -> Result<PostCommitActionRecord, AuthorizationStateError> {
    let payload = match kind {
        PostCommitActionKind::ContextPublish => json!({
            "format": "trellis.authorization-context-publish-action.v1",
            "contextDigest": context.context_digest,
        }),
        PostCommitActionKind::ContextRevoke => json!({
            "format": "trellis.authorization-context-revoke-action.v1",
            "contextDigest": context.context_digest,
            "reason": reason,
            "version": context.version,
        }),
        PostCommitActionKind::Event | PostCommitActionKind::Kick => unreachable!(),
    };
    let canonical = canonicalize_json(&payload)
        .map_err(|error| AuthorizationStateError::Storage(error.to_string()))?;
    let signed_context = serde_json::from_str::<Value>(&context.signed_context_json)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
    let issued_at = parse_authorization_context(&signed_context)
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
        .unsigned
        .issued_at;
    let action_at = context
        .revoked_at
        .unwrap_or(issued_at)
        .checked_mul(1_000)
        .ok_or_else(|| {
            AuthorizationStateError::InvalidRecord("context time overflow".to_owned())
        })?;
    Ok(PostCommitActionRecord {
        predecessor_action_id: None,
        action_id: URL_SAFE_NO_PAD.encode(Sha256::digest(canonical.as_bytes())),
        kind,
        payload,
        created_at: action_at,
        attempts: 0,
        next_attempt_at: action_at,
        claimed_until: None,
        last_error: None,
    })
}

fn authority_kind(kind: AuthorizationAuthorityKind) -> AuthorityKind {
    match kind {
        AuthorizationAuthorityKind::Identity => AuthorityKind::Identity,
        AuthorizationAuthorityKind::Deployment => AuthorityKind::Deployment,
    }
}

fn nonempty(name: &str, value: &str) -> Result<(), AuthorizationStateError> {
    if value.is_empty() || value.trim() != value {
        Err(AuthorizationStateError::InvalidRecord(format!(
            "{name} must be nonempty protocol-safe text"
        )))
    } else {
        Ok(())
    }
}

fn digest(name: &str, value: &str) -> Result<(), AuthorizationStateError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AuthorizationStateError::InvalidRecord(format!("{name} must be a digest")))?;
    if bytes.len() == 32 && URL_SAFE_NO_PAD.encode(bytes) == value {
        Ok(())
    } else {
        Err(AuthorizationStateError::InvalidRecord(format!(
            "{name} must canonically encode 32 bytes"
        )))
    }
}

fn positive(name: &str, value: u64) -> Result<(), AuthorizationStateError> {
    if (1..=MAXIMUM_SAFE_INTEGER).contains(&value) {
        Ok(())
    } else {
        Err(AuthorizationStateError::InvalidRecord(format!(
            "{name} must be a positive safe integer"
        )))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{BTreeMap, BTreeSet},
        sync::Arc,
    };

    use ed25519_dalek::SigningKey;
    use trellis_protocol::{
        parse_authorization_context, parse_participant, resolve_participant,
        sign_authorization_context, AuthorizationAuthorityRef, AuthorizationParticipant,
        AuthorizationPrincipal, AuthorizationPrincipalKind, GrantSet, ParticipantKind,
        UnsignedAuthorizationContext, AUTHORIZATION_CONTEXT_FORMAT_V1,
    };

    use super::*;
    use crate::platform::auth::account::hash_password;
    use crate::platform::auth::{
        AccountCreation, AccountFlowCreation, AccountFlowKind, AccountFlowRecord, AccountFlowState,
        AccountRepository, AuthService, AuthServiceConfig, AuthorityDecision,
        AuthorityDecisionOutcome, AuthorityEvidenceRepository, AuthorityProposalKind,
        AuthorityRepository, AuthorityState, AuthorityTarget, CompletePasswordResetInput,
        ContextRepository, CreateAuthorityProposalInput, DecideAuthorityProposalInput,
        DesiredAuthorityRecord, DeviceDelegationMutation, DeviceDelegationRecord,
        DeviceDelegationState, DeviceRecord, DeviceState, IdempotencyResultRecord,
        IdentityAuthorityRecord, LocalCredentialRecord, ParticipantBindingRecord,
        ParticipantBindingState, PasswordChange, PasswordResetCompletion, PostCommitActionKind,
        PrincipalKind, PrincipalState, ProviderIdentityLink, ProvisionedInstanceMutation,
        ProvisioningRepository, SessionCreation, SessionRecord, SessionRepository,
        SessionRevocation, SessionState, SqliteAuthorizationStore, UpdateUserInput,
        UserProfileRecord,
    };

    const NOW_MS: i64 = 1_735_689_600_000;
    const NOW_SECONDS: i64 = 1_735_689_600;
    const DIGEST: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    async fn repository_conformance<R>(repository: &R) -> Result<(), AuthorizationStateError>
    where
        R: AuthorizationContextRepository
            + AccountRepository
            + AuthorityRepository
            + ContextRepository
            + SessionRepository
            + Send
            + Sync,
    {
        let (context, snapshot_token) = seed_context(repository).await?;
        let trust = AuthorizationTrustStateRecord {
            authority: "example.test".to_owned(),
            root_key_id: DIGEST.to_owned(),
            root_digest: DIGEST.to_owned(),
            manifest_generation: 1,
            manifest_digest: DIGEST.to_owned(),
            updated_at: NOW_MS,
            version: 1,
        };
        assert_eq!(
            repository
                .accept_trust_state(trust.clone(), Vec::new(), NOW_SECONDS)
                .await?,
            trust
        );
        assert_eq!(
            repository
                .accept_trust_state(trust.clone(), Vec::new(), NOW_SECONDS)
                .await?,
            trust
        );
        let mut equivocation = trust.clone();
        equivocation.manifest_digest = context.context_digest.clone();
        assert_eq!(
            repository
                .accept_trust_state(equivocation, Vec::new(), NOW_SECONDS)
                .await,
            Err(AuthorizationStateError::StorageConflict)
        );
        let mut advanced = trust;
        advanced.manifest_generation = 2;
        advanced.manifest_digest = context.context_digest.clone();
        advanced.version = 2;
        assert_eq!(
            repository
                .accept_trust_state(advanced.clone(), Vec::new(), NOW_SECONDS)
                .await?,
            advanced
        );

        let current_snapshot = repository.load_issuance_snapshot("ses_context").await?;
        assert_eq!(issuance_snapshot_token(&current_snapshot)?, snapshot_token);
        let idempotency = IdempotencyResultRecord {
            scope_key: DIGEST.to_owned(),
            purpose: "authorizationContextIssue".to_owned(),
            signer_id: "ses_context".to_owned(),
            request_id: "req_context".to_owned(),
            request_digest: DIGEST.to_owned(),
            result: Value::Null,
            created_at: NOW_MS,
            expires_at: NOW_MS + 60_000,
        };
        let commit = AuthorizationContextCommit {
            expected_snapshot_token: snapshot_token,
            context: context.clone(),
            idempotency: idempotency.clone(),
            now: NOW_SECONDS,
            minimum_remaining_seconds: 1,
        };
        assert!(matches!(
            repository.commit_context(commit.clone()).await?,
            IdempotentOutcome::Applied(record) if record == context
        ));
        assert!(matches!(
            repository.commit_context(commit).await?,
            IdempotentOutcome::Replayed(value)
                if value == json!({ "contextDigest": context.context_digest })
        ));
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?,
            Some(context.clone())
        );
        assert_eq!(repository.list_unpublished_contexts(10).await?.len(), 1);
        let published = repository
            .mark_context_published(&context.context_digest, 1, NOW_SECONDS + 2)
            .await?;
        assert_eq!(published.published_at, Some(NOW_SECONDS + 2));
        assert!(repository.list_unpublished_contexts(10).await?.is_empty());
        let mut rotated = advanced;
        rotated.manifest_generation = 3;
        rotated.manifest_digest = DIGEST.to_owned();
        rotated.version = 3;
        repository
            .accept_trust_state(
                rotated,
                vec![context.issuer_key_id.clone()],
                NOW_SECONDS + 3,
            )
            .await?;
        let revoked = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context remains as revocation evidence");
        assert_eq!(revoked.state, AuthorizationContextState::Revoked);
        assert_eq!(
            revoked.revocation_reason,
            Some(AuthorizationContextRevocationReason::IssuerRevoked)
        );
        assert!(repository
            .list_active_contexts_for_session("ses_context")
            .await?
            .is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn corrupted_context_row_fails_to_decode() -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        let context_digest = context.context_digest.clone();
        let corrupted_context_digest = context_digest.clone();
        commit_seed_context(&repository, context, snapshot_token, "req_corrupt", 19).await?;
        // Persisted corruption: raw SQLite text `session_\u0072evoked` must not
        // decode as the canonical `session_revoked` reason via JSON escape
        // interpretation; the read must fail instead of silently accepting it.
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "UPDATE auth_authorization_contexts
                         SET state = 'revoked', revoked_at = ?1, revocation_reason = ?2
                         WHERE context_digest = ?3",
                        rusqlite::params![
                            NOW_MS,
                            "session_\\u0072evoked",
                            corrupted_context_digest
                        ],
                    )
                    .map_err(sql_error)?;
                Ok(1)
            })
            .await?;
        assert!(matches!(
            repository.get_context_by_digest(&context_digest).await,
            Err(AuthorizationStateError::Storage(_))
        ));
        Ok(())
    }

    async fn seed_context<R>(
        repository: &R,
    ) -> Result<(AuthorizationContextRecord, IssuanceSnapshotToken), AuthorizationStateError>
    where
        R: AccountRepository
            + AuthorityRepository
            + ContextRepository
            + SessionRepository
            + Send
            + Sync,
    {
        let participant_value = json!({
            "format": "trellis.participant.v1",
            "id": "context-test-app",
            "displayName": "Context test app",
            "description": "Context repository conformance participant.",
            "kind": "app",
            "schemas": {},
            "implements": {},
            "uses": { "required": {}, "optional": {} },
            "state": {},
            "jobQueues": {},
            "eventConsumers": {},
            "resources": {},
        });
        let participant = parse_participant(&participant_value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let resolved = resolve_participant(&participant, &BTreeMap::new())
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let participant_digest = resolved.participant_digest().to_owned();
        let needs_digest = resolved
            .needs()
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        repository
            .put_participant_binding(ParticipantBindingRecord {
                participant_id: resolved.participant_id().to_owned(),
                participant_kind: ParticipantKind::App,
                artifact_digest: participant_digest.clone(),
                needs_digest: needs_digest.clone(),
                participant_json: canonicalize_json(&participant_value)
                    .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
                api_artifacts_json: "{}".to_owned(),
                resolved_at: NOW_MS,
                state: ParticipantBindingState::Resolved,
                error: None,
            })
            .await?;
        repository
            .create_user_account(AccountCreation {
                principal: crate::platform::auth::PrincipalRecord {
                    principal_id: "usr_context".to_owned(),
                    kind: PrincipalKind::User,
                    state: PrincipalState::Active,
                    created_at: NOW_MS,
                    updated_at: NOW_MS,
                    version: 1,
                    disabled_at: None,
                    revoked_at: None,
                },
                profile: UserProfileRecord {
                    principal_id: "usr_context".to_owned(),
                    display_name: Some("Context user".to_owned()),
                    email: None,
                    image_url: None,
                    created_at: NOW_MS,
                    updated_at: NOW_MS,
                    version: 1,
                },
                credential: Some(LocalCredentialRecord {
                    principal_id: "usr_context".to_owned(),
                    normalized_username: "context".to_owned(),
                    password_hash: "current-hash".to_owned(),
                    hash_profile: 1,
                    failed_attempts: 0,
                    locked_until: None,
                    password_changed_at: NOW_MS,
                    updated_at: NOW_MS,
                    version: 1,
                }),
                identity: Some(ProviderIdentityLink {
                    provider: "local".to_owned(),
                    provider_subject: "context".to_owned(),
                    principal_id: "usr_context".to_owned(),
                    linked_at: NOW_MS,
                    last_seen_at: NOW_MS,
                }),
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([3; 32]),
                    purpose: "testAccountCreate".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_account".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: json!({ "principalId": "usr_context" }),
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let session_key = SigningKey::from_bytes(&[17; 32]);
        let session_public_key = URL_SAFE_NO_PAD.encode(session_key.verifying_key().as_bytes());
        let session_key_id =
            URL_SAFE_NO_PAD.encode(Sha256::digest(session_key.verifying_key().as_bytes()));
        let authority = IdentityAuthorityRecord {
            authority_id: "iau_context".to_owned(),
            principal_id: "usr_context".to_owned(),
            participant_id: "context-test-app".to_owned(),
            participant_artifact_digest: participant_digest.clone(),
            accepted_needs_digest: needs_digest.clone(),
            desired_grant_set: GrantSet::new(Vec::new()),
            desired_capabilities: Vec::new(),
            state: AuthorityState::Accepted,
            version: 1,
            created_at: NOW_MS,
            updated_at: NOW_MS,
            expires_at: Some(NOW_MS + 600_000),
            decision: Some(AuthorityDecision {
                decided_at: NOW_MS,
                decided_by: "usr_context".to_owned(),
                reason: None,
            }),
        };
        repository
            .create_session(SessionCreation {
                session: SessionRecord {
                    session_id: "ses_context".to_owned(),
                    principal_id: "usr_context".to_owned(),
                    principal_kind: PrincipalKind::User,
                    participant_id: "context-test-app".to_owned(),
                    participant_kind: ParticipantKind::App,
                    participant_artifact_digest: participant_digest.clone(),
                    participant_needs_digest: needs_digest.clone(),
                    session_public_key: session_public_key.clone(),
                    session_key_id: session_key_id.clone(),
                    inbox_prefix: "_INBOX.ses_context".to_owned(),
                    state: SessionState::Active,
                    created_at: NOW_MS,
                    last_seen_at: NOW_MS,
                    expires_at: Some(NOW_MS + 600_000),
                    revoked_at: None,
                    version: 1,
                },
                previous_session: None,
                desired_authority: Some(DesiredAuthorityRecord::Identity(authority)),
                runtime_binding: None,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([2; 32]),
                    purpose: "testSessionCreate".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_session".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: json!({ "sessionId": "ses_context" }),
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        repository
            .reconcile_authority(
                &AuthorityTarget {
                    kind: AuthorityKind::Identity,
                    authority_id: "iau_context".to_owned(),
                },
                NOW_MS,
            )
            .await?;
        let snapshot = repository.load_issuance_snapshot("ses_context").await?;
        let token = issuance_snapshot_token(&snapshot)?;
        let issuer_key = SigningKey::from_bytes(&[23; 32]);
        let issuer_key_id =
            URL_SAFE_NO_PAD.encode(Sha256::digest(issuer_key.verifying_key().as_bytes()));
        let signed = sign_authorization_context(
            UnsignedAuthorizationContext {
                format: AUTHORIZATION_CONTEXT_FORMAT_V1.to_owned(),
                authority: "example.test".to_owned(),
                issuer_key_id: issuer_key_id.clone(),
                issuer_manifest_generation: 2,
                session_id: "ses_context".to_owned(),
                session_key: session_public_key,
                principal: AuthorizationPrincipal {
                    kind: AuthorizationPrincipalKind::User,
                    id: "usr_context".to_owned(),
                },
                participant: AuthorizationParticipant {
                    kind: ParticipantKind::App,
                    id: "context-test-app".to_owned(),
                    artifact_digest: participant_digest.clone(),
                    needs_digest: needs_digest.clone(),
                },
                authority_ref: AuthorizationAuthorityRef {
                    kind: AuthorizationAuthorityKind::Identity,
                    id: "iau_context".to_owned(),
                    version: 1,
                },
                deployment_id: None,
                instance_id: None,
                inbox_prefix: "_INBOX.ses_context".to_owned(),
                issued_at: NOW_SECONDS,
                not_before: NOW_SECONDS - 30,
                expires_at: NOW_SECONDS + 300,
                grant_set: GrantSet::new(Vec::new()),
                capabilities: Vec::new(),
                extensions: serde_json::Map::new(),
                critical: Vec::new(),
            },
            &issuer_key,
        )
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let signed_context_json = canonicalize_json(
            &serde_json::to_value(&signed)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        )
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let context_digest = signed
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        Ok((
            AuthorizationContextRecord {
                context_digest,
                session_id: "ses_context".to_owned(),
                principal_id: "usr_context".to_owned(),
                authority_kind: AuthorityKind::Identity,
                authority_id: "iau_context".to_owned(),
                deployment_id: None,
                instance_id: None,
                issuer_key_id,
                issuer_manifest_generation: 2,
                signed_context_json,
                issuance_snapshot_token: token.0.clone(),
                refresh_at: NOW_SECONDS + 240,
                expires_at: NOW_SECONDS + 300,
                state: AuthorizationContextState::Active,
                published_at: None,
                revoked_at: None,
                revocation_reason: None,
                version: 1,
            },
            token,
        ))
    }

    async fn commit_seed_context<R>(
        repository: &R,
        context: AuthorizationContextRecord,
        snapshot_token: IssuanceSnapshotToken,
        request_id: &str,
        scope_byte: u8,
    ) -> Result<(), AuthorizationStateError>
    where
        R: AuthorizationContextRepository + Send + Sync,
    {
        repository
            .commit_context(AuthorizationContextCommit {
                expected_snapshot_token: snapshot_token,
                context,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([scope_byte; 32]),
                    purpose: "authorizationContextIssue".to_owned(),
                    signer_id: "ses_context".to_owned(),
                    request_id: request_id.to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                now: NOW_SECONDS,
                minimum_remaining_seconds: 1,
            })
            .await?;
        Ok(())
    }

    async fn seed_device_delegation_records(
        repository: &SqliteAuthorizationStore,
    ) -> Result<(DeviceRecord, DeviceDelegationRecord), AuthorizationStateError> {
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "INSERT INTO auth_deployments (
                             deployment_id, participant_id, participant_kind, state, expires_at
                         ) VALUES (?1, ?2, 'device', 'active', NULL)",
                        rusqlite::params!["dep_context_device", "context-test-app"],
                    )
                    .map_err(sql_error)?;
                connection
                    .execute(
                        "INSERT INTO auth_devices (
                             principal_id, deployment_id, state, created_at, updated_at, version
                         ) VALUES (?1, ?2, 'active', ?3, ?3, 1)",
                        rusqlite::params!["usr_context", "dep_context_device", NOW_MS],
                    )
                    .map_err(sql_error)?;
                connection
                    .execute(
                        "INSERT INTO auth_device_delegations (
                             principal_id, deployment_id, required, state, expires_at
                         ) VALUES (?1, ?2, 1, 'active', ?3)",
                        rusqlite::params!["usr_context", "dep_context_device", NOW_MS + 600_000],
                    )
                    .map_err(sql_error)?;
                Ok(())
            })
            .await?;
        Ok((
            repository
                .get_device("usr_context", "dep_context_device")
                .await?
                .expect("device"),
            repository
                .get_device_delegation("usr_context", "dep_context_device")
                .await?
                .expect("device delegation"),
        ))
    }

    fn device_delegation_idempotency(byte: u8) -> IdempotencyResultRecord {
        IdempotencyResultRecord {
            scope_key: URL_SAFE_NO_PAD.encode([byte + 100; 32]),
            purpose: "device.delegation.mutate".to_owned(),
            signer_id: "usr_context".to_owned(),
            request_id: format!("req_device_delegation_{byte}"),
            request_digest: DIGEST.to_owned(),
            result: Value::Null,
            created_at: NOW_MS,
            expires_at: NOW_MS + 60_000,
        }
    }

    #[tokio::test]
    async fn sqlite_context_repository_conforms() -> Result<(), AuthorizationStateError> {
        repository_conformance(&SqliteAuthorizationStore::open_in_memory()?).await
    }

    fn replacement_context(
        base: &AuthorizationContextRecord,
        _index: usize,
        issuer_seed: u8,
    ) -> Result<AuthorizationContextRecord, AuthorizationStateError> {
        let value: Value = serde_json::from_str(&base.signed_context_json)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut unsigned = parse_authorization_context(&value)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?
            .unsigned;
        let issuer_key = SigningKey::from_bytes(&[issuer_seed; 32]);
        unsigned.issuer_key_id =
            URL_SAFE_NO_PAD.encode(Sha256::digest(issuer_key.verifying_key().as_bytes()));
        let signed = sign_authorization_context(unsigned, &issuer_key)
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        let mut context = base.clone();
        context.issuer_key_id = signed.unsigned.issuer_key_id.clone();
        context.signed_context_json = canonicalize_json(
            &serde_json::to_value(&signed)
                .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?,
        )
        .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        context.context_digest = signed
            .digest()
            .map_err(|error| AuthorizationStateError::InvalidRecord(error.to_string()))?;
        Ok(context)
    }

    #[tokio::test]
    async fn concurrent_context_commits_reuse_one_and_bound_active_overlap(
    ) -> Result<(), AuthorizationStateError> {
        let repository = Arc::new(SqliteAuthorizationStore::open_in_memory()?);
        let (base, snapshot_token) = seed_context(repository.as_ref()).await?;
        let commits = (0..100).map(|index| {
            let repository = Arc::clone(&repository);
            let snapshot_token = snapshot_token.clone();
            let context = replacement_context(&base, index, 23).expect("valid test context");
            async move {
                repository
                    .commit_context(AuthorizationContextCommit {
                        expected_snapshot_token: snapshot_token,
                        context,
                        idempotency: IdempotencyResultRecord {
                            scope_key: URL_SAFE_NO_PAD
                                .encode(Sha256::digest(format!("concurrent-{index}"))),
                            purpose: "authorizationContextIssue".to_owned(),
                            signer_id: "ses_context".to_owned(),
                            request_id: format!("req_concurrent_{index:03}"),
                            request_digest: DIGEST.to_owned(),
                            result: Value::Null,
                            created_at: NOW_MS,
                            expires_at: NOW_MS + 60_000,
                        },
                        now: NOW_SECONDS,
                        minimum_remaining_seconds: 1,
                    })
                    .await
            }
        });
        let outcomes = futures_util::future::join_all(commits).await;
        let mut digests = BTreeSet::new();
        for outcome in outcomes {
            match outcome? {
                IdempotentOutcome::Applied(context) => {
                    digests.insert(context.context_digest);
                }
                IdempotentOutcome::Replayed(_) => panic!("unique requests must not replay"),
            }
        }
        assert_eq!(digests.len(), 1);
        assert_eq!(
            repository
                .list_active_contexts_for_session("ses_context")
                .await?
                .len(),
            1
        );
        let publish_actions = repository
            .run(|connection| {
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM auth_post_commit_actions WHERE kind = 'context_publish'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(sql_error)
            })
            .await?;
        assert_eq!(publish_actions, 1);

        for (index, seed) in [(100, 24), (101, 25)] {
            let context = replacement_context(&base, index, seed)?;
            repository
                .commit_context(AuthorizationContextCommit {
                    expected_snapshot_token: snapshot_token.clone(),
                    context,
                    idempotency: IdempotencyResultRecord {
                        scope_key: URL_SAFE_NO_PAD
                            .encode(Sha256::digest(format!("overlap-{index}"))),
                        purpose: "authorizationContextIssue".to_owned(),
                        signer_id: "ses_context".to_owned(),
                        request_id: format!("req_overlap_{index}"),
                        request_digest: DIGEST.to_owned(),
                        result: Value::Null,
                        created_at: NOW_MS,
                        expires_at: NOW_MS + 60_000,
                    },
                    now: NOW_SECONDS,
                    minimum_remaining_seconds: 1,
                })
                .await?;
        }
        assert_eq!(
            repository
                .list_active_contexts_for_session("ses_context")
                .await?
                .len(),
            2
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_session_revocation_revokes_context() -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        repository
            .commit_context(AuthorizationContextCommit {
                expected_snapshot_token: snapshot_token,
                context: context.clone(),
                idempotency: IdempotencyResultRecord {
                    scope_key: DIGEST.to_owned(),
                    purpose: "authorizationContextIssue".to_owned(),
                    signer_id: "ses_context".to_owned(),
                    request_id: "req_context_expiry".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                now: NOW_SECONDS,
                minimum_remaining_seconds: 1,
            })
            .await?;

        repository
            .reconcile_authority(
                &AuthorityTarget {
                    kind: AuthorityKind::Identity,
                    authority_id: "iau_context".to_owned(),
                },
                NOW_MS + 1,
            )
            .await?;
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .state,
            AuthorizationContextState::Active
        );

        repository
            .revoke_session(SessionRevocation {
                session_id: "ses_context".to_owned(),
                expected_version: 1,
                revoked_at: NOW_MS + 600_000,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([8; 32]),
                    purpose: "session.revoke".to_owned(),
                    signer_id: "ses_context".to_owned(),
                    request_id: "req_context_revoke".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: json!({ "sessionId": "ses_context" }),
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let revoked = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");
        assert_eq!(revoked.state, AuthorizationContextState::Revoked);
        assert_eq!(
            revoked.revocation_reason,
            Some(AuthorizationContextRevocationReason::SessionRevoked)
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_device_delegation_version_only_update_keeps_context_active(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token,
            "req_device_delegation_noop_context",
            40,
        )
        .await?;
        let (device, delegation) = seed_device_delegation_records(&repository).await?;
        let mut updated_device = device.clone();
        updated_device.updated_at = NOW_MS + 1;
        updated_device.version = 2;
        assert!(matches!(
            repository
                .mutate_device_delegation(DeviceDelegationMutation {
                    device: updated_device.clone(),
                    delegation,
                    expected_version: device.version,
                    idempotency: device_delegation_idempotency(40),
                    actions: Vec::new(),
                })
                .await?,
            IdempotentOutcome::Applied(value) if value == updated_device
        ));
        let unchanged = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");
        assert_eq!(unchanged.state, AuthorizationContextState::Active);
        assert_eq!(unchanged.version, context.version);
        assert_eq!(unchanged.revocation_reason, None);
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_device_delegation_semantic_changes_revoke_context(
    ) -> Result<(), AuthorizationStateError> {
        for (byte, device_state, delegation_state, expires_at, reason) in [
            (
                41,
                DeviceState::Disabled,
                DeviceDelegationState::Active,
                Some(NOW_MS + 600_000),
                AuthorizationContextRevocationReason::DeviceChanged,
            ),
            (
                42,
                DeviceState::Active,
                DeviceDelegationState::Missing,
                Some(NOW_MS + 600_000),
                AuthorizationContextRevocationReason::DelegationChanged,
            ),
            (
                43,
                DeviceState::Active,
                DeviceDelegationState::Active,
                Some(NOW_MS + 500_000),
                AuthorizationContextRevocationReason::DelegationChanged,
            ),
        ] {
            let repository = SqliteAuthorizationStore::open_in_memory()?;
            let (context, snapshot_token) = seed_context(&repository).await?;
            commit_seed_context(
                &repository,
                context.clone(),
                snapshot_token,
                &format!("req_device_delegation_semantic_context_{byte}"),
                byte,
            )
            .await?;
            let (device, mut delegation) = seed_device_delegation_records(&repository).await?;
            let mut updated_device = device.clone();
            updated_device.state = device_state;
            updated_device.updated_at = NOW_MS + 1;
            updated_device.version = 2;
            delegation.state = delegation_state;
            delegation.expires_at = expires_at;
            repository
                .mutate_device_delegation(DeviceDelegationMutation {
                    device: updated_device,
                    delegation,
                    expected_version: device.version,
                    idempotency: device_delegation_idempotency(byte),
                    actions: Vec::new(),
                })
                .await?;
            let revoked = repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context");
            assert_eq!(revoked.state, AuthorizationContextState::Revoked);
            assert_eq!(revoked.revocation_reason, Some(reason));
        }
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_password_reuse_rejection_preserves_auth_state(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token,
            "req_password_reuse_context",
            44,
        )
        .await?;
        let (password_hash, hash_profile) = hash_password("current password", Some(12))?;
        repository
            .run(move |connection| {
                let changed = connection
                    .execute(
                        "UPDATE auth_local_credentials
                         SET password_hash = ?1, hash_profile = ?2
                         WHERE principal_id = ?3",
                        rusqlite::params![password_hash, hash_profile, "usr_context"],
                    )
                    .map_err(sql_error)?;
                if changed != 1 {
                    return Err(AuthorizationStateError::StorageConflict);
                }
                Ok(())
            })
            .await?;
        let service = AuthService::new(repository.clone(), AuthServiceConfig::default())?;
        let credential_before = repository
            .get_local_credential("usr_context")
            .await?
            .expect("credential");
        let session_before = repository
            .get_session("ses_context")
            .await?
            .expect("session");
        let context_before = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");

        assert_eq!(
            service
                .change_password(crate::platform::auth::ChangePasswordInput {
                    principal_id: "usr_context".to_owned(),
                    current_session_id: "ses_context".to_owned(),
                    current_password: "current password".to_owned(),
                    new_password: "current password".to_owned(),
                    changed_at: NOW_MS + 1,
                    idempotency: IdempotencyResultRecord {
                        scope_key: URL_SAFE_NO_PAD.encode([45; 32]),
                        purpose: "password.change".to_owned(),
                        signer_id: "usr_context".to_owned(),
                        request_id: "req_password_reuse_change".to_owned(),
                        request_digest: DIGEST.to_owned(),
                        result: Value::Null,
                        created_at: NOW_MS,
                        expires_at: NOW_MS + 60_000,
                    },
                    actions: Vec::new(),
                })
                .await,
            Err(AuthorizationStateError::InvalidRecord(
                "new password must differ from current password".to_owned()
            ))
        );
        assert_eq!(
            repository
                .get_local_credential("usr_context")
                .await?
                .expect("credential"),
            credential_before
        );
        assert_eq!(
            repository
                .get_session("ses_context")
                .await?
                .expect("session"),
            session_before
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context"),
            context_before
        );

        let reset_token = URL_SAFE_NO_PAD.encode([46; 32]);
        let reset_token_hash = URL_SAFE_NO_PAD.encode(Sha256::digest([46; 32]));
        repository
            .create_account_flow(AccountFlowCreation {
                flow: AccountFlowRecord {
                    flow_id: "flow_password_reuse".to_owned(),
                    kind: AccountFlowKind::PasswordReset,
                    token_hash: reset_token_hash,
                    target_principal_id: Some("usr_context".to_owned()),
                    target_provider_id: None,
                    return_location: None,
                    payload: Value::Null,
                    state: AccountFlowState::Pending,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                    consumed_at: None,
                    version: 1,
                },
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([47; 32]),
                    purpose: "account-flow.create".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_password_reuse_flow".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        assert_eq!(
            service
                .complete_password_reset(CompletePasswordResetInput {
                    token: reset_token,
                    expected_flow_version: 1,
                    username: None,
                    authority: None,
                    profile: None,
                    password: "current password".to_owned(),
                    consumed_at: NOW_MS + 2,
                    idempotency: IdempotencyResultRecord {
                        scope_key: URL_SAFE_NO_PAD.encode([48; 32]),
                        purpose: "password-reset.complete".to_owned(),
                        signer_id: "usr_context".to_owned(),
                        request_id: "req_password_reuse_reset".to_owned(),
                        request_digest: DIGEST.to_owned(),
                        result: Value::Null,
                        created_at: NOW_MS,
                        expires_at: NOW_MS + 60_000,
                    },
                    actions: Vec::new(),
                })
                .await,
            Err(AuthorizationStateError::InvalidRecord(
                "new password must differ from current password".to_owned()
            ))
        );
        assert_eq!(
            repository
                .get_local_credential("usr_context")
                .await?
                .expect("credential"),
            credential_before
        );
        assert_eq!(
            repository
                .get_session("ses_context")
                .await?
                .expect("session"),
            session_before
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context"),
            context_before
        );
        assert_eq!(
            repository
                .get_account_flow_by_hash(&URL_SAFE_NO_PAD.encode(Sha256::digest([46; 32])))
                .await?
                .expect("reset flow")
                .state,
            AccountFlowState::Pending
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_password_change_revokes_context_and_validates_replacement(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token,
            "req_password_change_context",
            12,
        )
        .await?;
        let current = repository
            .get_local_credential("usr_context")
            .await?
            .expect("credential");

        let mut wrong_version = current.clone();
        wrong_version.version = 3;
        wrong_version.password_changed_at = NOW_MS + 1;
        wrong_version.updated_at = NOW_MS + 1;
        assert_eq!(
            repository
                .change_password(PasswordChange {
                    principal_id: "usr_context".to_owned(),
                    current_session_id: "ses_other".to_owned(),
                    credential: wrong_version,
                    expected_version: 1,
                    changed_at: NOW_MS + 1,
                    idempotency: IdempotencyResultRecord {
                        scope_key: URL_SAFE_NO_PAD.encode([31; 32]),
                        purpose: "password.change".to_owned(),
                        signer_id: "usr_context".to_owned(),
                        request_id: "req_password_change_invalid_version".to_owned(),
                        request_digest: DIGEST.to_owned(),
                        result: Value::Null,
                        created_at: NOW_MS,
                        expires_at: NOW_MS + 60_000,
                    },
                    actions: Vec::new(),
                })
                .await,
            Err(AuthorizationStateError::StorageConflict)
        );

        let mut wrong_identity = current.clone();
        wrong_identity.normalized_username = "other".to_owned();
        wrong_identity.version = 2;
        wrong_identity.password_changed_at = NOW_MS + 1;
        wrong_identity.updated_at = NOW_MS + 1;
        assert_eq!(
            repository
                .change_password(PasswordChange {
                    principal_id: "usr_context".to_owned(),
                    current_session_id: "ses_other".to_owned(),
                    credential: wrong_identity,
                    expected_version: 1,
                    changed_at: NOW_MS + 1,
                    idempotency: IdempotencyResultRecord {
                        scope_key: URL_SAFE_NO_PAD.encode([13; 32]),
                        purpose: "password.change".to_owned(),
                        signer_id: "usr_context".to_owned(),
                        request_id: "req_password_change_invalid_identity".to_owned(),
                        request_digest: DIGEST.to_owned(),
                        result: Value::Null,
                        created_at: NOW_MS,
                        expires_at: NOW_MS + 60_000,
                    },
                    actions: Vec::new(),
                })
                .await,
            Err(AuthorizationStateError::StorageConflict)
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .state,
            AuthorizationContextState::Active
        );

        let replacement = LocalCredentialRecord {
            password_hash: "replacement-hash".to_owned(),
            password_changed_at: NOW_MS + 2,
            updated_at: NOW_MS + 2,
            version: 2,
            ..current.clone()
        };
        let mut expected_revoked = context.clone();
        expected_revoked.version = 2;
        let mut conflicting = context_action(
            &expected_revoked,
            PostCommitActionKind::ContextRevoke,
            Some(AuthorizationContextRevocationReason::CredentialChanged),
        )?;
        conflicting.payload = json!({ "conflict": true });
        let conflicting_action_id = conflicting.action_id.clone();
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "INSERT INTO auth_post_commit_actions (
                             action_id, kind, payload_json, created_at,
                             attempts, next_attempt_at, claimed_until, last_error
                         ) VALUES (?1, 'event', ?2, ?3, 0, ?3, NULL, NULL)",
                        rusqlite::params![conflicting_action_id, "{}", NOW_MS],
                    )
                    .map_err(sql_error)
            })
            .await?;
        let failed = repository
            .change_password(PasswordChange {
                principal_id: "usr_context".to_owned(),
                current_session_id: "ses_other".to_owned(),
                credential: replacement.clone(),
                expected_version: 1,
                changed_at: NOW_MS + 2,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([14; 32]),
                    purpose: "password.change".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_password_change_outbox_failure".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await;
        assert_eq!(failed, Err(AuthorizationStateError::StorageConflict));
        assert_eq!(
            repository.get_local_credential("usr_context").await?,
            Some(current.clone())
        );
        assert_eq!(
            repository
                .get_session("ses_context")
                .await?
                .expect("session")
                .state,
            SessionState::Active
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .state,
            AuthorizationContextState::Active
        );
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "DELETE FROM auth_post_commit_actions WHERE action_id = ?1",
                        [conflicting.action_id],
                    )
                    .map_err(sql_error)
            })
            .await?;
        repository
            .change_password(PasswordChange {
                principal_id: "usr_context".to_owned(),
                current_session_id: "ses_other".to_owned(),
                credential: replacement,
                expected_version: 1,
                changed_at: NOW_MS + 2,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([15; 32]),
                    purpose: "password.change".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_password_change_valid".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let revoked = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");
        assert_eq!(revoked.state, AuthorizationContextState::Revoked);
        assert_eq!(
            revoked.revocation_reason,
            Some(AuthorizationContextRevocationReason::CredentialChanged)
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_password_reset_revocation_rolls_back_with_flow_and_credential(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token,
            "req_password_reset_context",
            15,
        )
        .await?;
        let token_hash = DIGEST.to_owned();
        repository
            .create_account_flow(AccountFlowCreation {
                flow: AccountFlowRecord {
                    flow_id: "flow_context_reset".to_owned(),
                    kind: AccountFlowKind::PasswordReset,
                    token_hash: token_hash.clone(),
                    target_principal_id: Some("usr_context".to_owned()),
                    target_provider_id: None,
                    return_location: None,
                    payload: json!({}),
                    state: AccountFlowState::Pending,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                    consumed_at: None,
                    version: 1,
                },
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([16; 32]),
                    purpose: "account-flow.create".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_context_flow".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let current = repository
            .get_local_credential("usr_context")
            .await?
            .expect("credential");
        let replacement = LocalCredentialRecord {
            password_hash: "reset-hash".to_owned(),
            password_changed_at: NOW_MS + 3,
            updated_at: NOW_MS + 3,
            version: 2,
            ..current.clone()
        };
        let mut wrong_identity = replacement.clone();
        wrong_identity.normalized_username = "other".to_owned();
        assert_eq!(
            repository
                .complete_password_reset(PasswordResetCompletion {
                    token_hash: token_hash.clone(),
                    expected_flow_version: 1,
                    flow_kind: AccountFlowKind::PasswordReset,
                    requester_principal_id: None,
                    admin_target: false,
                    expected_credential_version: Some(1),
                    replacement: wrong_identity,
                    identity: None,
                    authority: None,
                    profile: None,
                    expected_authority_version: None,
                    consumed_at: NOW_MS + 3,
                    idempotency: IdempotencyResultRecord {
                        scope_key: URL_SAFE_NO_PAD.encode([32; 32]),
                        purpose: "password-reset.complete".to_owned(),
                        signer_id: "usr_context".to_owned(),
                        request_id: "req_context_reset_invalid_identity".to_owned(),
                        request_digest: DIGEST.to_owned(),
                        result: Value::Null,
                        created_at: NOW_MS,
                        expires_at: NOW_MS + 60_000,
                    },
                    actions: Vec::new(),
                })
                .await,
            Err(AuthorizationStateError::StorageConflict)
        );
        let mut conflicting = context_action(&context, PostCommitActionKind::ContextPublish, None)?;
        conflicting.payload = json!({ "conflict": true });
        let failed = repository
            .complete_password_reset(PasswordResetCompletion {
                token_hash: token_hash.clone(),
                expected_flow_version: 1,
                flow_kind: AccountFlowKind::PasswordReset,
                requester_principal_id: None,
                admin_target: false,
                expected_credential_version: Some(1),
                replacement: replacement.clone(),
                identity: None,
                authority: None,
                profile: None,
                expected_authority_version: None,
                consumed_at: NOW_MS + 3,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([17; 32]),
                    purpose: "password-reset.complete".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_context_reset_failed".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: vec![conflicting],
            })
            .await;
        assert_eq!(failed, Err(AuthorizationStateError::StorageConflict));
        assert_eq!(
            repository.get_local_credential("usr_context").await?,
            Some(current)
        );
        assert_eq!(
            repository
                .get_account_flow_by_hash(&token_hash)
                .await?
                .expect("flow")
                .state,
            AccountFlowState::Pending
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .state,
            AuthorizationContextState::Active
        );

        repository
            .complete_password_reset(PasswordResetCompletion {
                token_hash,
                expected_flow_version: 1,
                flow_kind: AccountFlowKind::PasswordReset,
                requester_principal_id: None,
                admin_target: false,
                expected_credential_version: Some(1),
                replacement,
                identity: None,
                authority: None,
                profile: None,
                expected_authority_version: None,
                consumed_at: NOW_MS + 3,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([18; 32]),
                    purpose: "password-reset.complete".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_context_reset_success".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let revoked = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");
        assert_eq!(revoked.state, AuthorizationContextState::Revoked);
        assert_eq!(
            revoked.revocation_reason,
            Some(AuthorizationContextRevocationReason::CredentialChanged)
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_principal_disable_and_revoke_context_but_profile_edits_do_not(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token.clone(),
            "req_principal_disable_context",
            19,
        )
        .await?;
        let second_context = replacement_context(&context, 302, 43)?;
        commit_seed_context(
            &repository,
            second_context.clone(),
            snapshot_token,
            "req_principal_disable_context_second",
            44,
        )
        .await?;
        let service = AuthService::new(repository.clone(), AuthServiceConfig::default())?;
        let account = repository
            .get_user_account("usr_context")
            .await?
            .expect("account");
        service
            .update_user(UpdateUserInput {
                principal_id: "usr_context".to_owned(),
                expected_version: 1,
                name: account.1.display_name.clone(),
                email: account.1.email.clone(),
                image: account.1.image_url.clone(),
                state: PrincipalState::Disabled,
                allow_admin_target: true,
                updated_at: NOW_MS + 1,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([20; 32]),
                    purpose: "account.update".to_owned(),
                    signer_id: "usr_admin".to_owned(),
                    request_id: "req_principal_disable".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        assert_eq!(
            repository
                .get_principal("usr_context")
                .await?
                .expect("principal")
                .state,
            PrincipalState::Disabled
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .revocation_reason,
            Some(AuthorizationContextRevocationReason::PrincipalInactive)
        );
        assert_eq!(
            repository
                .get_context_by_digest(&second_context.context_digest)
                .await?
                .expect("second context")
                .revocation_reason,
            Some(AuthorizationContextRevocationReason::PrincipalInactive)
        );

        let revoke_repository = SqliteAuthorizationStore::open_in_memory()?;
        let (revoke_context, revoke_snapshot_token) = seed_context(&revoke_repository).await?;
        commit_seed_context(
            &revoke_repository,
            revoke_context.clone(),
            revoke_snapshot_token,
            "req_principal_revoke_context",
            29,
        )
        .await?;
        let revoke_service =
            AuthService::new(revoke_repository.clone(), AuthServiceConfig::default())?;
        revoke_service
            .update_user(UpdateUserInput {
                principal_id: "usr_context".to_owned(),
                expected_version: 1,
                name: Some("Context user".to_owned()),
                email: None,
                image: None,
                state: PrincipalState::Revoked,
                allow_admin_target: true,
                updated_at: NOW_MS + 1,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([30; 32]),
                    purpose: "account.update".to_owned(),
                    signer_id: "usr_admin".to_owned(),
                    request_id: "req_principal_revoke".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let revoked_principal = revoke_repository
            .get_principal("usr_context")
            .await?
            .expect("revoked principal");
        assert_eq!(revoked_principal.state, PrincipalState::Revoked);
        assert_eq!(revoked_principal.revoked_at, Some(NOW_MS + 1));
        assert_eq!(
            revoke_repository
                .get_context_by_digest(&revoke_context.context_digest)
                .await?
                .expect("revoked context")
                .revocation_reason,
            Some(AuthorizationContextRevocationReason::PrincipalInactive)
        );

        let profile_repository = SqliteAuthorizationStore::open_in_memory()?;
        let (profile_context, profile_snapshot_token) = seed_context(&profile_repository).await?;
        commit_seed_context(
            &profile_repository,
            profile_context.clone(),
            profile_snapshot_token,
            "req_profile_context",
            21,
        )
        .await?;
        let profile_service =
            AuthService::new(profile_repository.clone(), AuthServiceConfig::default())?;
        profile_service
            .update_user(UpdateUserInput {
                principal_id: "usr_context".to_owned(),
                expected_version: 1,
                name: Some("Updated profile".to_owned()),
                email: None,
                image: None,
                state: PrincipalState::Active,
                allow_admin_target: true,
                updated_at: NOW_MS + 1,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([22; 32]),
                    purpose: "account.update".to_owned(),
                    signer_id: "usr_admin".to_owned(),
                    request_id: "req_profile_only".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        let profile = profile_repository
            .get_user_account("usr_context")
            .await?
            .expect("profile account");
        profile_service
            .update_user(UpdateUserInput {
                principal_id: "usr_context".to_owned(),
                expected_version: 2,
                name: profile.1.display_name.clone(),
                email: profile.1.email.clone(),
                image: profile.1.image_url.clone(),
                state: PrincipalState::Active,
                allow_admin_target: true,
                updated_at: NOW_MS + 2,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([23; 32]),
                    purpose: "account.update".to_owned(),
                    signer_id: "usr_admin".to_owned(),
                    request_id: "req_profile_noop".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?;
        assert_eq!(
            profile_repository
                .get_context_by_digest(&profile_context.context_digest)
                .await?
                .expect("profile context")
                .state,
            AuthorizationContextState::Active
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_principal_disable_rolls_back_when_context_outbox_fails(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token,
            "req_principal_rollback_context",
            24,
        )
        .await?;
        let mut expected_revoked = context.clone();
        expected_revoked.version = 2;
        let mut conflicting = context_action(
            &expected_revoked,
            PostCommitActionKind::ContextRevoke,
            Some(AuthorizationContextRevocationReason::PrincipalInactive),
        )?;
        conflicting.payload = json!({ "conflict": true });
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "INSERT INTO auth_post_commit_actions (
                             action_id, kind, payload_json, created_at, attempts,
                             next_attempt_at, claimed_until, last_error
                         ) VALUES (?1, 'event', ?2, ?3, 0, ?3, NULL, NULL)",
                        rusqlite::params![conflicting.action_id, "{}", NOW_MS,],
                    )
                    .map_err(sql_error)
            })
            .await?;
        let service = AuthService::new(repository.clone(), AuthServiceConfig::default())?;
        let result = service
            .update_user(UpdateUserInput {
                principal_id: "usr_context".to_owned(),
                expected_version: 1,
                name: Some("Context user".to_owned()),
                email: None,
                image: None,
                state: PrincipalState::Disabled,
                allow_admin_target: true,
                updated_at: NOW_MS + 1,
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([25; 32]),
                    purpose: "account.update".to_owned(),
                    signer_id: "usr_admin".to_owned(),
                    request_id: "req_principal_rollback".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await;
        assert_eq!(result, Err(AuthorizationStateError::StorageConflict));
        assert_eq!(
            repository
                .get_principal("usr_context")
                .await?
                .expect("principal")
                .state,
            PrincipalState::Active
        );
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .state,
            AuthorizationContextState::Active
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_provisioned_instance_noop_keeps_context_but_disable_and_remove_revoke_it(
    ) -> Result<(), AuthorizationStateError> {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        commit_seed_context(
            &repository,
            context.clone(),
            snapshot_token.clone(),
            "req_instance_context",
            26,
        )
        .await?;
        repository
            .create_principal(crate::platform::auth::PrincipalRecord {
                principal_id: "svc_instance_context".to_owned(),
                kind: PrincipalKind::Service,
                state: PrincipalState::Active,
                created_at: NOW_MS,
                updated_at: NOW_MS,
                version: 1,
                disabled_at: None,
                revoked_at: None,
            })
            .await?;
        repository
            .put_deployment_evidence(crate::platform::auth::DeploymentRecord {
                deployment_id: "dep_instance_context".to_owned(),
                participant_id: "instance-context-service".to_owned(),
                participant_kind: ParticipantKind::Service,
                active: true,
                expires_at: None,
            })
            .await?;
        repository
            .put_runtime_instance(crate::platform::auth::RuntimeInstanceRecord {
                instance_id: "inst_context".to_owned(),
                deployment_id: "dep_instance_context".to_owned(),
                principal_id: "svc_instance_context".to_owned(),
                state: crate::platform::auth::RuntimeInstanceState::Active,
                created_at: NOW_MS,
                updated_at: NOW_MS,
                version: 1,
            })
            .await?;
        let context_digest = context.context_digest.clone();
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "UPDATE auth_authorization_contexts
                         SET deployment_id = 'dep_instance_context', instance_id = 'inst_context'
                         WHERE context_digest = ?1",
                        [&context_digest],
                    )
                    .map_err(sql_error)
            })
            .await?;
        let removed_context = replacement_context(&context, 303, 46)?;
        commit_seed_context(
            &repository,
            removed_context.clone(),
            snapshot_token.clone(),
            "req_instance_removed_context",
            47,
        )
        .await?;
        let removed_context_digest = removed_context.context_digest.clone();
        repository
            .run(move |connection| {
                connection
                    .execute(
                        "UPDATE auth_authorization_contexts
                         SET deployment_id = 'dep_instance_context', instance_id = 'inst_context'
                         WHERE context_digest = ?1",
                        [&removed_context_digest],
                    )
                    .map_err(sql_error)
            })
            .await?;
        let proof = |request_id: &str, byte: u8| IdempotencyResultRecord {
            scope_key: URL_SAFE_NO_PAD.encode([byte; 32]),
            purpose: "instance.mutate".to_owned(),
            signer_id: "usr_admin".to_owned(),
            request_id: request_id.to_owned(),
            request_digest: DIGEST.to_owned(),
            result: Value::Null,
            created_at: NOW_MS,
            expires_at: NOW_MS + 60_000,
        };
        repository
            .mutate_provisioned_instance(ProvisionedInstanceMutation {
                instance: crate::platform::auth::RuntimeInstanceRecord {
                    instance_id: "inst_context".to_owned(),
                    deployment_id: "dep_instance_context".to_owned(),
                    principal_id: "svc_instance_context".to_owned(),
                    state: crate::platform::auth::RuntimeInstanceState::Active,
                    created_at: NOW_MS,
                    updated_at: NOW_MS + 1,
                    version: 2,
                },
                device: None,
                identity: None,
                expected_version: 1,
                idempotency: proof("req_instance_noop", 27),
                actions: Vec::new(),
            })
            .await?;
        assert_eq!(
            repository
                .get_context_by_digest(&context.context_digest)
                .await?
                .expect("context")
                .state,
            AuthorizationContextState::Active
        );
        repository
            .mutate_provisioned_instance(ProvisionedInstanceMutation {
                instance: crate::platform::auth::RuntimeInstanceRecord {
                    instance_id: "inst_context".to_owned(),
                    deployment_id: "dep_instance_context".to_owned(),
                    principal_id: "svc_instance_context".to_owned(),
                    state: crate::platform::auth::RuntimeInstanceState::Disabled,
                    created_at: NOW_MS,
                    updated_at: NOW_MS + 2,
                    version: 3,
                },
                device: None,
                identity: None,
                expected_version: 2,
                idempotency: proof("req_instance_disable", 28),
                actions: Vec::new(),
            })
            .await?;
        let revoked = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");
        assert_eq!(revoked.state, AuthorizationContextState::Revoked);
        assert_eq!(
            revoked.revocation_reason,
            Some(AuthorizationContextRevocationReason::InstanceChanged)
        );
        let removed_instance = repository
            .get_runtime_instance("inst_context")
            .await?
            .expect("instance after disable");
        repository
            .mutate_provisioned_instance(ProvisionedInstanceMutation {
                instance: crate::platform::auth::RuntimeInstanceRecord {
                    state: crate::platform::auth::RuntimeInstanceState::Revoked,
                    updated_at: NOW_MS + 3,
                    version: 4,
                    ..removed_instance
                },
                device: None,
                identity: None,
                expected_version: 3,
                idempotency: proof("req_instance_remove", 48),
                actions: Vec::new(),
            })
            .await?;
        let removed = repository
            .get_context_by_digest(&removed_context.context_digest)
            .await?
            .expect("removed context");
        assert_eq!(removed.state, AuthorizationContextState::Revoked);
        assert_eq!(
            removed.revocation_reason,
            Some(AuthorizationContextRevocationReason::InstanceChanged)
        );
        Ok(())
    }

    #[tokio::test]
    async fn sqlite_authority_change_revokes_active_context() -> Result<(), AuthorizationStateError>
    {
        let repository = SqliteAuthorizationStore::open_in_memory()?;
        let (context, snapshot_token) = seed_context(&repository).await?;
        repository
            .commit_context(AuthorizationContextCommit {
                expected_snapshot_token: snapshot_token,
                context: context.clone(),
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([9; 32]),
                    purpose: "authorizationContextIssue".to_owned(),
                    signer_id: "ses_context".to_owned(),
                    request_id: "req_context_authority_change".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                now: NOW_SECONDS,
                minimum_remaining_seconds: 1,
            })
            .await?;
        let mut authority = repository
            .get_identity_authority("usr_context", "context-test-app")
            .await?
            .expect("authority");
        authority.version = 2;
        authority.updated_at = NOW_MS + 1;
        authority.expires_at = Some(NOW_MS + 500_000);
        let service = AuthService::new(repository.clone(), AuthServiceConfig::default())?;
        let proposal = match service
            .create_authority_proposal(CreateAuthorityProposalInput {
                authority_kind: AuthorityKind::Identity,
                authority_id: authority.authority_id.clone(),
                deployment_id: None,
                proposal_kind: AuthorityProposalKind::Update,
                participant_id: authority.participant_id.clone(),
                participant_artifact_digest: authority.participant_artifact_digest.clone(),
                participant_needs_digest: authority.accepted_needs_digest.clone(),
                grant_set: authority.desired_grant_set.clone(),
                capabilities: authority.desired_capabilities.clone(),
                base_authority_version: Some(1),
                payload: json!({ "baseAuthorityVersion": 1 }),
                created_at: NOW_MS + 1,
                expires_at: Some(NOW_MS + 60_000),
                idempotency: IdempotencyResultRecord {
                    scope_key: URL_SAFE_NO_PAD.encode([10; 32]),
                    purpose: "authority.proposal.create".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_authority_proposal".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                actions: Vec::new(),
            })
            .await?
        {
            IdempotentOutcome::Applied(proposal) => proposal,
            IdempotentOutcome::Replayed(_) => {
                return Err(AuthorizationStateError::Storage(
                    "authority proposal unexpectedly replayed".to_owned(),
                ));
            }
        };
        service
            .decide_authority_proposal(DecideAuthorityProposalInput {
                proposal_id: proposal.proposal_id,
                expected_version: 1,
                expected_base_authority_version: Some(Some(1)),
                outcome: AuthorityDecisionOutcome::Accepted,
                decided_by: "usr_context".to_owned(),
                reason: None,
                desired_authority: Some(DesiredAuthorityRecord::Identity(authority)),
                decided_at: NOW_MS + 2,
                idempotency: IdempotencyResultRecord {
                    scope_key: DIGEST.to_owned(),
                    purpose: "authority.proposal.decide".to_owned(),
                    signer_id: "usr_context".to_owned(),
                    request_id: "req_authority_decide".to_owned(),
                    request_digest: DIGEST.to_owned(),
                    result: Value::Null,
                    created_at: NOW_MS,
                    expires_at: NOW_MS + 60_000,
                },
                portal_binding: None,
                expected_portal_binding: None,
                portal_policy_snapshot: None,
                actions: Vec::new(),
            })
            .await?;

        let revoked = repository
            .get_context_by_digest(&context.context_digest)
            .await?
            .expect("context");
        assert_eq!(revoked.state, AuthorizationContextState::Revoked);
        assert_eq!(
            revoked.revocation_reason,
            Some(AuthorizationContextRevocationReason::AuthorityChanged)
        );
        Ok(())
    }
}
