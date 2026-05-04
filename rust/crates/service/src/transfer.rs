use std::collections::BTreeMap;

use async_nats::header::HeaderMap;
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    encode_error_reply, OperationTransferProgress, RequestContext, RequestValidator, ServerError,
    ServiceResourceBindings, StoreResourceBinding, StoreResourceClient,
};

const UPLOAD_SUBJECT_PREFIX: &str = "transfer.v1.upload";
const DOWNLOAD_SUBJECT_PREFIX: &str = "transfer.v1.download";
/// Header carrying the zero-based transfer chunk sequence number.
pub const TRANSFER_SEQUENCE_HEADER: &str = "trellis-transfer-seq";
/// Header marking the final transfer frame.
pub const TRANSFER_EOF_HEADER: &str = "trellis-transfer-eof";

/// File metadata carried by receive transfer grants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferInfo {
    /// Object key within the bound store.
    pub key: String,
    /// Object size in bytes.
    pub size: u64,
    /// Last update timestamp encoded as an ISO-8601 string.
    pub updated_at: String,
    /// Optional object digest supplied by the store.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    /// Optional object content type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// Store metadata associated with the object.
    pub metadata: BTreeMap<String, String>,
}

/// Inputs for planning a service-owned upload transfer grant.
#[derive(Debug)]
pub struct TransferUploadGrantArgs<'a> {
    /// Service name exposed in the transfer grant.
    pub service_name: &'a str,
    /// Caller session key that owns this transfer grant.
    pub session_key: &'a str,
    /// Resolved service resource bindings from bootstrap.
    pub resources: &'a ServiceResourceBindings,
    /// Contract-local store alias used by the transfer declaration.
    pub store: &'a str,
    /// Object key that will receive uploaded bytes.
    pub key: &'a str,
    /// Preallocated transfer id supplied by the caller.
    pub transfer_id: &'a str,
    /// Grant expiration timestamp encoded as an ISO-8601 string.
    pub expires_at: &'a str,
    /// Maximum transfer frame size advertised to clients.
    pub chunk_bytes: u64,
    /// Optional operation-level upload size cap.
    pub max_bytes: Option<u64>,
    /// Optional content type for the stored object.
    pub content_type: Option<&'a str>,
    /// Optional object metadata to store with uploaded bytes.
    pub metadata: BTreeMap<String, String>,
}

/// Inputs for planning a service-owned download transfer grant.
#[derive(Debug)]
pub struct TransferDownloadGrantArgs<'a> {
    /// Service name exposed in the transfer grant.
    pub service_name: &'a str,
    /// Caller session key that owns this transfer grant.
    pub session_key: &'a str,
    /// Resolved service resource bindings from bootstrap.
    pub resources: &'a ServiceResourceBindings,
    /// Contract-local store alias used by the transfer declaration.
    pub store: &'a str,
    /// Preallocated transfer id supplied by the caller.
    pub transfer_id: &'a str,
    /// Grant expiration timestamp encoded as an ISO-8601 string.
    pub expires_at: &'a str,
    /// Maximum transfer frame size advertised to clients.
    pub chunk_bytes: u64,
    /// Object metadata for the file that will be streamed later.
    pub info: FileTransferInfo,
}

/// Public wire DTO for an upload transfer grant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadTransferGrant {
    #[serde(rename = "type")]
    /// Discriminator matching Trellis transfer grant wire DTOs.
    pub type_name: String,
    /// Transfer direction, always `send` for upload grants.
    pub direction: String,
    /// Service name exposed in the transfer grant.
    pub service: String,
    /// Caller session key that owns this transfer grant.
    pub session_key: String,
    /// Unique transfer id for the planned session.
    pub transfer_id: String,
    /// NATS subject that the follow-up upload session should bind.
    pub subject: String,
    /// Grant expiration timestamp encoded as an ISO-8601 string.
    pub expires_at: String,
    /// Maximum transfer frame size advertised to clients.
    pub chunk_bytes: u64,
    /// Effective upload cap after applying the bound store limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
    /// Optional content type for the stored object.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// Optional object metadata to store with uploaded bytes.
    pub metadata: BTreeMap<String, String>,
}

/// Planned upload transfer grant plus binding metadata needed by follow-up streaming.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadTransferGrantPlan {
    /// Public transfer grant that is safe to serialize and return to callers.
    pub grant: UploadTransferGrant,
    /// Contract-local store alias selected by the transfer declaration.
    pub store_alias: String,
    /// Concrete object-store bucket name resolved from bindings.
    pub store: String,
    /// Object key that will receive uploaded bytes.
    pub key: String,
}

/// Public wire DTO for a download transfer grant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTransferGrant {
    #[serde(rename = "type")]
    /// Discriminator matching Trellis transfer grant wire DTOs.
    pub type_name: String,
    /// Transfer direction, always `receive` for download grants.
    pub direction: String,
    /// Service name exposed in the transfer grant.
    pub service: String,
    /// Caller session key that owns this transfer grant.
    pub session_key: String,
    /// Unique transfer id for the planned session.
    pub transfer_id: String,
    /// NATS subject that the follow-up download session should bind.
    pub subject: String,
    /// Grant expiration timestamp encoded as an ISO-8601 string.
    pub expires_at: String,
    /// Maximum transfer frame size advertised to clients.
    pub chunk_bytes: u64,
    /// Object metadata for the file that will be streamed later.
    pub info: FileTransferInfo,
}

/// Planned download transfer grant plus binding metadata needed by follow-up streaming.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadTransferGrantPlan {
    /// Public transfer grant that is safe to serialize and return to callers.
    pub grant: DownloadTransferGrant,
    /// Contract-local store alias selected by the transfer declaration.
    pub store_alias: String,
    /// Concrete object-store bucket name resolved from bindings.
    pub store: String,
    /// Effective object size limit from the store binding, when configured.
    pub(crate) max_object_bytes: Option<u64>,
}

/// One upload frame decoded from the transfer chunk protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadTransferChunk {
    /// Zero-based chunk sequence number from `trellis-transfer-seq`.
    pub seq: u64,
    /// Raw chunk payload bytes.
    pub payload: Bytes,
    /// Whether this chunk carries `trellis-transfer-eof: true`.
    pub eof: bool,
}

/// Service reply payload for an upload chunk request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum UploadTransferAck {
    /// More chunks are expected.
    Continue,
    /// EOF was accepted and bytes were stored.
    Complete {
        /// Metadata for the stored object.
        info: FileTransferInfo,
    },
}

/// Store-backed upload transfer executor for a single planned grant.
#[derive(Debug, Clone)]
pub struct UploadTransferSession {
    plan: UploadTransferGrantPlan,
    bytes: BytesMut,
    next_seq: u64,
    complete: bool,
    updated_at: String,
}

impl UploadTransferSession {
    /// Create an upload transfer session with the timestamp to report on completion.
    pub fn new(plan: UploadTransferGrantPlan, updated_at: impl Into<String>) -> Self {
        Self {
            plan,
            bytes: BytesMut::new(),
            next_seq: 0,
            complete: false,
            updated_at: updated_at.into(),
        }
    }

    /// NATS subject that this planned upload session accepts chunks on.
    pub fn subject(&self) -> &str {
        &self.plan.grant.subject
    }

    /// Caller session key that owns this planned upload session.
    pub fn session_key(&self) -> &str {
        &self.plan.grant.session_key
    }

    /// Build the operation transfer progress snapshot that would result from this chunk.
    pub fn progress_for_chunk(&self, chunk: &UploadTransferChunk) -> OperationTransferProgress {
        OperationTransferProgress {
            chunk_index: chunk.seq,
            chunk_bytes: chunk.payload.len() as u64,
            transferred_bytes: self.bytes.len() as u64 + chunk.payload.len() as u64,
        }
    }

    /// Accept one ordered upload chunk, writing the object to `store` on EOF.
    pub async fn receive<C>(
        &mut self,
        store: &C,
        chunk: UploadTransferChunk,
    ) -> Result<UploadTransferAck, ServerError>
    where
        C: StoreResourceClient,
    {
        let now = current_time_iso()?;
        self.receive_at(store, chunk, &now).await
    }

    /// Accept one ordered upload chunk using an explicit timestamp for expiry checks.
    pub async fn receive_at<C>(
        &mut self,
        store: &C,
        chunk: UploadTransferChunk,
        now_iso: &str,
    ) -> Result<UploadTransferAck, ServerError>
    where
        C: StoreResourceClient,
    {
        if self.complete {
            return Err(ServerError::TransferAlreadyComplete {
                transfer_id: self.plan.grant.transfer_id.clone(),
            });
        }
        enforce_transfer_not_expired(
            &self.plan.grant.transfer_id,
            &self.plan.grant.expires_at,
            now_iso,
        )?;

        if chunk.seq != self.next_seq {
            return Err(ServerError::TransferSequenceOutOfOrder {
                transfer_id: self.plan.grant.transfer_id.clone(),
                expected_seq: self.next_seq,
                actual_seq: chunk.seq,
            });
        }

        let chunk_limit = self.plan.grant.chunk_bytes;
        if chunk.payload.len() as u64 > chunk_limit {
            return Err(ServerError::TransferObjectTooLarge {
                service_name: self.plan.grant.service.clone(),
                store: self.plan.store_alias.clone(),
                key: self.plan.key.clone(),
                size: chunk.payload.len() as u64,
                max_bytes: chunk_limit,
            });
        }

        let next_size = self.bytes.len() as u64 + chunk.payload.len() as u64;
        enforce_upload_max_bytes(&self.plan, next_size)?;

        if !chunk.eof {
            self.bytes.extend_from_slice(&chunk.payload);
            self.next_seq += 1;
            return Ok(UploadTransferAck::Continue);
        }

        let mut completed_bytes = self.bytes.clone();
        completed_bytes.extend_from_slice(&chunk.payload);

        let info = FileTransferInfo {
            key: self.plan.key.clone(),
            size: completed_bytes.len() as u64,
            updated_at: self.updated_at.clone(),
            digest: None,
            content_type: self.plan.grant.content_type.clone(),
            metadata: self.plan.grant.metadata.clone(),
        };
        store
            .write(&self.plan.key, completed_bytes.clone().freeze())
            .await?;
        self.bytes = completed_bytes;
        self.next_seq += 1;
        self.complete = true;
        Ok(UploadTransferAck::Complete { info })
    }

    /// Fail if the session has not received an EOF completion frame.
    pub fn ensure_complete(&self) -> Result<(), ServerError> {
        if self.complete {
            Ok(())
        } else {
            Err(ServerError::TransferMissingEof {
                transfer_id: self.plan.grant.transfer_id.clone(),
            })
        }
    }
}

/// Decode one upload transfer request frame from NATS headers and payload.
pub fn decode_upload_transfer_chunk(
    headers: Option<&HeaderMap>,
    payload: Bytes,
) -> Result<UploadTransferChunk, ServerError> {
    let seq = required_header(headers, TRANSFER_SEQUENCE_HEADER)?;
    let seq = seq
        .parse::<u64>()
        .map_err(|_| ServerError::InvalidTransferHeader {
            header: TRANSFER_SEQUENCE_HEADER,
            value: seq.to_string(),
        })?;
    let eof = optional_header(headers, TRANSFER_EOF_HEADER).is_some_and(|value| value == "true");

    Ok(UploadTransferChunk { seq, payload, eof })
}

/// Run a NATS upload transfer endpoint for a single planned grant until its subscriber closes.
pub async fn run_upload_transfer_endpoint<C, V>(
    client: async_nats::Client,
    subscriber: impl futures_util::Stream<Item = async_nats::Message>,
    session: UploadTransferSession,
    store: C,
    validator: V,
) -> Result<(), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator + 'static,
{
    run_upload_transfer_endpoint_with_progress(
        client,
        subscriber,
        session,
        store,
        validator,
        |_| {},
    )
    .await
}

/// Run a NATS upload transfer endpoint and report operation progress for accepted body chunks.
pub async fn run_upload_transfer_endpoint_with_progress<C, V, F>(
    client: async_nats::Client,
    subscriber: impl futures_util::Stream<Item = async_nats::Message>,
    mut session: UploadTransferSession,
    store: C,
    validator: V,
    on_progress: F,
) -> Result<(), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator + 'static,
    F: Fn(OperationTransferProgress) + Send + Sync + 'static,
{
    let mut subscriber = Box::pin(subscriber);
    while let Some(message) = subscriber.next().await {
        let reply_to = message.reply.as_ref().map(ToString::to_string);
        let result =
            handle_upload_transfer_message(&mut session, &store, &validator, &message).await;
        if let Some(reply_to) = reply_to {
            match result {
                Ok((ack, progress)) => {
                    if matches!(ack, UploadTransferAck::Continue) && progress.chunk_bytes > 0 {
                        on_progress(progress);
                    }
                    client
                        .publish(reply_to, Bytes::from(serde_json::to_vec(&ack)?))
                        .await
                        .map_err(|error| ServerError::Nats(error.to_string()))?;
                }
                Err(error) => publish_error_reply(&client, reply_to, &error).await?,
            }
        }
    }

    Ok(())
}

/// Run a NATS download transfer endpoint for a single planned grant until its subscriber closes.
pub async fn run_download_transfer_endpoint<C, V>(
    client: async_nats::Client,
    subscriber: impl futures_util::Stream<Item = async_nats::Message>,
    plan: DownloadTransferGrantPlan,
    store: C,
    validator: V,
) -> Result<(), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator + 'static,
{
    let mut subscriber = Box::pin(subscriber);
    while let Some(message) = subscriber.next().await {
        let Some(reply_to) = message.reply.as_ref().map(ToString::to_string) else {
            continue;
        };

        match handle_download_transfer_message(&plan, &store, &validator, &message).await {
            Ok(chunks) => publish_download_chunks(&client, reply_to, chunks).await?,
            Err(error) => publish_error_reply(&client, reply_to, &error).await?,
        }
    }

    Ok(())
}

/// Subscribe and run one planned upload transfer endpoint in the background.
pub async fn spawn_upload_transfer_endpoint<C, V>(
    client: async_nats::Client,
    session: UploadTransferSession,
    store: C,
    validator: V,
) -> Result<(), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator + 'static,
{
    spawn_upload_transfer_endpoint_with_progress(client, session, store, validator, |_| {}).await
}

/// Subscribe and run an upload transfer endpoint that reports operation progress.
pub async fn spawn_upload_transfer_endpoint_with_progress<C, V, F>(
    client: async_nats::Client,
    session: UploadTransferSession,
    store: C,
    validator: V,
    on_progress: F,
) -> Result<(), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator + 'static,
    F: Fn(OperationTransferProgress) + Send + Sync + 'static,
{
    let subject = session.subject().to_string();
    tracing::info!(subject = %subject, "subscribing upload transfer endpoint");
    let subscriber = client.subscribe(subject.clone()).await.map_err(|error| {
        ServerError::Nats(format!(
            "failed to subscribe to upload transfer subject '{subject}': {error}"
        ))
    })?;
    client.flush().await.map_err(|error| {
        ServerError::Nats(format!(
            "failed to flush upload transfer subscription '{subject}': {error}"
        ))
    })?;
    tracing::debug!(subject = %subject, "upload transfer subscription flushed");
    tokio::spawn(async move {
        tracing::debug!(subject = %subject, "upload transfer endpoint task started");
        if let Err(error) = run_upload_transfer_endpoint_with_progress(
            client,
            subscriber,
            session,
            store,
            validator,
            on_progress,
        )
        .await
        {
            tracing::error!(subject = %subject, error = %error, "upload transfer endpoint failed");
        }
        tracing::debug!(subject = %subject, "upload transfer endpoint task ended");
    });
    Ok(())
}

/// Subscribe and run one planned download transfer endpoint in the background.
pub async fn spawn_download_transfer_endpoint<C, V>(
    client: async_nats::Client,
    plan: DownloadTransferGrantPlan,
    store: C,
    validator: V,
) -> Result<(), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator + 'static,
{
    let subject = plan.grant.subject.clone();
    tracing::info!(subject = %subject, "subscribing download transfer endpoint");
    let subscriber = client.subscribe(subject.clone()).await.map_err(|error| {
        ServerError::Nats(format!(
            "failed to subscribe to download transfer subject '{subject}': {error}"
        ))
    })?;
    client.flush().await.map_err(|error| {
        ServerError::Nats(format!(
            "failed to flush download transfer subscription '{subject}': {error}"
        ))
    })?;
    tracing::debug!(subject = %subject, "download transfer subscription flushed");
    tokio::spawn(async move {
        tracing::debug!(subject = %subject, "download transfer endpoint task started");
        if let Err(error) =
            run_download_transfer_endpoint(client, subscriber, plan, store, validator).await
        {
            tracing::error!(subject = %subject, error = %error, "download transfer endpoint failed");
        }
        tracing::debug!(subject = %subject, "download transfer endpoint task ended");
    });
    Ok(())
}

async fn handle_upload_transfer_message<C, V>(
    session: &mut UploadTransferSession,
    store: &C,
    validator: &V,
    message: &async_nats::Message,
) -> Result<(UploadTransferAck, OperationTransferProgress), ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator,
{
    let context = transfer_request_context(message);
    validate_transfer_request(
        session.subject(),
        &message.payload,
        &context,
        session.session_key(),
        validator,
    )
    .await?;
    let chunk = decode_upload_transfer_chunk(message.headers.as_ref(), message.payload.clone())?;
    let progress = session.progress_for_chunk(&chunk);
    tracing::debug!(
        subject = %session.subject(),
        seq = chunk.seq,
        bytes = chunk.payload.len(),
        eof = chunk.eof,
        "received upload transfer chunk"
    );
    let now = current_time_iso()?;
    let ack = session.receive_at(store, chunk, &now).await?;
    Ok((ack, progress))
}

async fn handle_download_transfer_message<C, V>(
    plan: &DownloadTransferGrantPlan,
    store: &C,
    validator: &V,
    message: &async_nats::Message,
) -> Result<Vec<DownloadTransferChunk>, ServerError>
where
    C: StoreResourceClient,
    V: RequestValidator,
{
    let context = transfer_request_context(message);
    validate_transfer_request(
        &plan.grant.subject,
        &message.payload,
        &context,
        &plan.grant.session_key,
        validator,
    )
    .await?;
    let now = current_time_iso()?;
    plan_download_transfer_chunks_at(plan, store, &now).await
}

fn transfer_request_context(message: &async_nats::Message) -> RequestContext {
    RequestContext {
        subject: message.subject.to_string(),
        session_key: optional_header(message.headers.as_ref(), "session-key")
            .map(ToString::to_string),
        proof: optional_header(message.headers.as_ref(), "proof").map(ToString::to_string),
    }
}

async fn validate_transfer_request<V>(
    subject: &str,
    payload: &Bytes,
    context: &RequestContext,
    expected_session_key: &str,
    validator: &V,
) -> Result<(), ServerError>
where
    V: RequestValidator,
{
    let actual_session_key =
        context
            .session_key
            .clone()
            .ok_or_else(|| ServerError::MissingSessionKey {
                subject: subject.to_string(),
            })?;
    if context.proof.as_deref().is_none_or(str::is_empty) {
        return Err(ServerError::MissingProof {
            subject: subject.to_string(),
        });
    }
    if actual_session_key != expected_session_key {
        return Err(ServerError::TransferSessionMismatch {
            subject: subject.to_string(),
            actual_session_key,
        });
    }

    if validator.validate(subject, payload, context).await? {
        Ok(())
    } else {
        Err(ServerError::RequestDenied {
            subject: subject.to_string(),
            session_key: actual_session_key,
        })
    }
}

async fn publish_download_chunks(
    client: &async_nats::Client,
    reply_to: String,
    chunks: Vec<DownloadTransferChunk>,
) -> Result<(), ServerError> {
    for chunk in chunks {
        let mut headers = HeaderMap::new();
        headers.insert(TRANSFER_SEQUENCE_HEADER, chunk.seq.to_string().as_str());
        if chunk.eof {
            headers.insert(TRANSFER_EOF_HEADER, "true");
        }
        client
            .publish_with_headers(reply_to.clone(), headers, chunk.payload)
            .await
            .map_err(|error| ServerError::Nats(error.to_string()))?;
    }
    Ok(())
}

async fn publish_error_reply(
    client: &async_nats::Client,
    reply_to: String,
    error: &ServerError,
) -> Result<(), ServerError> {
    let reply = encode_error_reply(reply_to, error);
    let mut headers = HeaderMap::new();
    headers.insert("status", "error");
    client
        .publish_with_headers(reply.reply_to, headers, reply.payload)
        .await
        .map_err(|error| ServerError::Nats(error.to_string()))
}

fn required_header<'a>(
    headers: Option<&'a HeaderMap>,
    header: &'static str,
) -> Result<&'a str, ServerError> {
    optional_header(headers, header).ok_or(ServerError::MissingTransferHeader { header })
}

fn optional_header<'a>(headers: Option<&'a HeaderMap>, header: &str) -> Option<&'a str> {
    headers
        .and_then(|headers| headers.get(header))
        .map(async_nats::header::HeaderValue::as_str)
}

/// One encoded download frame ready to publish to the transfer reply inbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadTransferChunk {
    /// Zero-based chunk sequence number.
    pub seq: u64,
    /// Raw chunk payload bytes.
    pub payload: Bytes,
    /// Whether this chunk should carry `trellis-transfer-eof: true`.
    pub eof: bool,
}

/// Build upload transfer grant metadata from resolved service resource bindings.
pub fn plan_upload_transfer_grant(
    args: TransferUploadGrantArgs<'_>,
) -> Result<UploadTransferGrantPlan, ServerError> {
    validate_chunk_bytes(args.chunk_bytes)?;
    let store = store_binding(args.service_name, args.resources, args.store)?;
    let max_bytes = effective_upload_max_bytes(args.max_bytes, store.max_object_bytes);
    validate_transfer_id(args.transfer_id)?;

    Ok(UploadTransferGrantPlan {
        grant: UploadTransferGrant {
            type_name: "TransferGrant".to_string(),
            direction: "send".to_string(),
            service: args.service_name.to_string(),
            session_key: args.session_key.to_string(),
            transfer_id: args.transfer_id.to_string(),
            subject: transfer_subject(UPLOAD_SUBJECT_PREFIX, args.session_key, args.transfer_id),
            expires_at: args.expires_at.to_string(),
            chunk_bytes: args.chunk_bytes,
            max_bytes,
            content_type: args.content_type.map(ToString::to_string),
            metadata: args.metadata,
        },
        store_alias: args.store.to_string(),
        store: store.name.clone(),
        key: args.key.to_string(),
    })
}

/// Build download transfer grant metadata from resolved service resource bindings.
pub fn plan_download_transfer_grant(
    args: TransferDownloadGrantArgs<'_>,
) -> Result<DownloadTransferGrantPlan, ServerError> {
    validate_chunk_bytes(args.chunk_bytes)?;
    let store = store_binding(args.service_name, args.resources, args.store)?;
    enforce_max_object_bytes(
        args.service_name,
        args.store,
        &args.info,
        store.max_object_bytes,
    )?;
    validate_transfer_id(args.transfer_id)?;

    Ok(DownloadTransferGrantPlan {
        grant: DownloadTransferGrant {
            type_name: "TransferGrant".to_string(),
            direction: "receive".to_string(),
            service: args.service_name.to_string(),
            session_key: args.session_key.to_string(),
            transfer_id: args.transfer_id.to_string(),
            subject: transfer_subject(DOWNLOAD_SUBJECT_PREFIX, args.session_key, args.transfer_id),
            expires_at: args.expires_at.to_string(),
            chunk_bytes: args.chunk_bytes,
            info: args.info,
        },
        store_alias: args.store.to_string(),
        store: store.name.clone(),
        max_object_bytes: store
            .max_object_bytes
            .and_then(|value| u64::try_from(value).ok()),
    })
}

/// Read a planned download object from `store` and encode ordered transfer chunks.
pub async fn plan_download_transfer_chunks<C>(
    plan: &DownloadTransferGrantPlan,
    store: &C,
) -> Result<Vec<DownloadTransferChunk>, ServerError>
where
    C: StoreResourceClient,
{
    let now = current_time_iso()?;
    plan_download_transfer_chunks_at(plan, store, &now).await
}

/// Read a planned download object and encode chunks using an explicit timestamp for expiry checks.
pub async fn plan_download_transfer_chunks_at<C>(
    plan: &DownloadTransferGrantPlan,
    store: &C,
    now_iso: &str,
) -> Result<Vec<DownloadTransferChunk>, ServerError>
where
    C: StoreResourceClient,
{
    enforce_transfer_not_expired(&plan.grant.transfer_id, &plan.grant.expires_at, now_iso)?;
    let key = &plan.grant.info.key;
    let bytes = store
        .read(key)
        .await?
        .ok_or_else(|| ServerError::TransferObjectMissing {
            store: plan.store_alias.clone(),
            key: key.clone(),
        })?;
    let actual_size = bytes.len() as u64;
    if actual_size != plan.grant.info.size {
        return Err(ServerError::TransferObjectSizeMismatch {
            store: plan.store_alias.clone(),
            key: key.clone(),
            expected_size: plan.grant.info.size,
            actual_size,
        });
    }
    if let Some(max_bytes) = plan.max_object_bytes {
        if actual_size > max_bytes {
            return Err(ServerError::TransferObjectTooLarge {
                service_name: plan.grant.service.clone(),
                store: plan.store_alias.clone(),
                key: key.clone(),
                size: actual_size,
                max_bytes,
            });
        }
    }

    let chunk_bytes = usize::try_from(plan.grant.chunk_bytes)
        .unwrap_or(usize::MAX)
        .max(1);
    if bytes.is_empty() {
        return Ok(vec![DownloadTransferChunk {
            seq: 0,
            payload: Bytes::new(),
            eof: true,
        }]);
    }

    let chunk_count = bytes.len().div_ceil(chunk_bytes);
    Ok(bytes
        .chunks(chunk_bytes)
        .enumerate()
        .map(|(index, chunk)| DownloadTransferChunk {
            seq: index as u64,
            payload: Bytes::copy_from_slice(chunk),
            eof: index + 1 == chunk_count,
        })
        .collect())
}

fn store_binding<'a>(
    service_name: &str,
    resources: &'a ServiceResourceBindings,
    store: &str,
) -> Result<&'a StoreResourceBinding, ServerError> {
    resources
        .store
        .get(store)
        .ok_or_else(|| ServerError::MissingResourceBinding {
            service_name: service_name.to_string(),
            resource_kind: "store".to_string(),
            resource_name: store.to_string(),
        })
}

fn effective_upload_max_bytes(
    requested: Option<u64>,
    store_max_object_bytes: Option<i64>,
) -> Option<u64> {
    match (
        requested,
        store_max_object_bytes.and_then(|value| u64::try_from(value).ok()),
    ) {
        (Some(requested), Some(store_max)) => Some(requested.min(store_max)),
        (Some(requested), None) => Some(requested),
        (None, Some(store_max)) => Some(store_max),
        (None, None) => None,
    }
}

fn enforce_max_object_bytes(
    service_name: &str,
    store: &str,
    info: &FileTransferInfo,
    store_max_object_bytes: Option<i64>,
) -> Result<(), ServerError> {
    let Some(max_bytes) = store_max_object_bytes.and_then(|value| u64::try_from(value).ok()) else {
        return Ok(());
    };

    if info.size > max_bytes {
        return Err(ServerError::TransferObjectTooLarge {
            service_name: service_name.to_string(),
            store: store.to_string(),
            key: info.key.clone(),
            size: info.size,
            max_bytes,
        });
    }

    Ok(())
}

fn enforce_upload_max_bytes(plan: &UploadTransferGrantPlan, size: u64) -> Result<(), ServerError> {
    let Some(max_bytes) = plan.grant.max_bytes else {
        return Ok(());
    };

    if size > max_bytes {
        return Err(ServerError::TransferObjectTooLarge {
            service_name: plan.grant.service.clone(),
            store: plan.store_alias.clone(),
            key: plan.key.clone(),
            size,
            max_bytes,
        });
    }

    Ok(())
}

fn validate_chunk_bytes(chunk_bytes: u64) -> Result<(), ServerError> {
    if chunk_bytes == 0 {
        return Err(ServerError::InvalidTransferChunkSize { chunk_bytes });
    }
    Ok(())
}

fn current_time_iso() -> Result<String, ServerError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| ServerError::InvalidTransferExpiry {
            expires_at: "now".to_string(),
            details: error.to_string(),
        })
}

fn enforce_transfer_not_expired(
    transfer_id: &str,
    expires_at: &str,
    now_iso: &str,
) -> Result<(), ServerError> {
    let expires_at_time = parse_transfer_time(expires_at)?;
    let now = parse_transfer_time(now_iso)?;
    if now >= expires_at_time {
        return Err(ServerError::TransferExpired {
            transfer_id: transfer_id.to_string(),
            expires_at: expires_at.to_string(),
        });
    }
    Ok(())
}

fn parse_transfer_time(value: &str) -> Result<OffsetDateTime, ServerError> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|error| ServerError::InvalidTransferExpiry {
        expires_at: value.to_string(),
        details: error.to_string(),
    })
}

fn transfer_subject(prefix: &str, session_key: &str, transfer_id: &str) -> String {
    let session_prefix: String = session_key.chars().take(16).collect();
    format!("{prefix}.{session_prefix}.{transfer_id}")
}

fn validate_transfer_id(transfer_id: &str) -> Result<(), ServerError> {
    let invalid = transfer_id.is_empty()
        || transfer_id
            .chars()
            .any(|ch| matches!(ch, '.' | '*' | '>' | '/') || ch.is_whitespace() || ch.is_control());

    if invalid {
        return Err(ServerError::InvalidTransferId {
            value: transfer_id.to_string(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    use futures_util::future::BoxFuture;

    use super::*;

    #[derive(Debug, Clone)]
    struct CountingValidator {
        calls: Arc<AtomicUsize>,
        allowed: bool,
    }

    impl RequestValidator for CountingValidator {
        fn validate<'a>(
            &'a self,
            _subject: &'a str,
            _payload: &'a Bytes,
            _context: &'a RequestContext,
        ) -> BoxFuture<'a, Result<bool, ServerError>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                Ok(self.allowed)
            })
        }
    }

    #[tokio::test]
    async fn transfer_validation_rejects_session_mismatch_before_validator() {
        let calls = Arc::new(AtomicUsize::new(0));
        let validator = CountingValidator {
            calls: Arc::clone(&calls),
            allowed: true,
        };
        let context = RequestContext {
            subject: "transfer.v1.upload.session.transfer-1".to_string(),
            session_key: Some("wrong-session".to_string()),
            proof: Some("proof".to_string()),
        };

        let error = validate_transfer_request(
            "transfer.v1.upload.session.transfer-1",
            &Bytes::new(),
            &context,
            "expected-session",
            &validator,
        )
        .await
        .expect_err("session mismatch");

        assert!(matches!(
            error,
            ServerError::TransferSessionMismatch { actual_session_key, .. }
                if actual_session_key == "wrong-session"
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn transfer_validation_requires_proof_before_session_mismatch() {
        let calls = Arc::new(AtomicUsize::new(0));
        let validator = CountingValidator {
            calls: Arc::clone(&calls),
            allowed: true,
        };
        let context = RequestContext {
            subject: "transfer.v1.upload.session.transfer-1".to_string(),
            session_key: Some("wrong-session".to_string()),
            proof: None,
        };

        let error = validate_transfer_request(
            "transfer.v1.upload.session.transfer-1",
            &Bytes::new(),
            &context,
            "expected-session",
            &validator,
        )
        .await
        .expect_err("missing proof");

        assert!(matches!(error, ServerError::MissingProof { .. }));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn transfer_validation_maps_denied_validator_to_request_denied() {
        let calls = Arc::new(AtomicUsize::new(0));
        let validator = CountingValidator {
            calls: Arc::clone(&calls),
            allowed: false,
        };
        let context = RequestContext {
            subject: "transfer.v1.download.session.transfer-1".to_string(),
            session_key: Some("expected-session".to_string()),
            proof: Some("proof".to_string()),
        };

        let error = validate_transfer_request(
            "transfer.v1.download.session.transfer-1",
            &Bytes::new(),
            &context,
            "expected-session",
            &validator,
        )
        .await
        .expect_err("denied");

        assert!(matches!(
            error,
            ServerError::RequestDenied { session_key, .. } if session_key == "expected-session"
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
