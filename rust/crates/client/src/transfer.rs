use std::collections::BTreeMap;
use std::time::Duration;

use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::{TrellisClient, TrellisClientError};

const TRANSFER_SEQUENCE_HEADER: &str = "trellis-transfer-seq";
const TRANSFER_EOF_HEADER: &str = "trellis-transfer-eof";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub key: String,
    pub size: u64,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadTransferGrant {
    #[serde(rename = "type")]
    pub type_name: String,
    pub kind: String,
    pub service: String,
    pub session_key: String,
    pub transfer_id: String,
    pub subject: String,
    pub expires_at: String,
    pub chunk_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTransferGrant {
    #[serde(rename = "type")]
    pub type_name: String,
    pub kind: String,
    pub service: String,
    pub session_key: String,
    pub transfer_id: String,
    pub subject: String,
    pub expires_at: String,
    pub chunk_bytes: u64,
    pub info: FileInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum TransferGrant {
    Upload(UploadTransferGrant),
    Download(DownloadTransferGrant),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "lowercase")]
enum UploadAck {
    Continue,
    Complete { info: FileInfo },
}

pub trait TransferGrantBinding<'a> {
    type Handle;

    fn bind(self, client: &'a TrellisClient) -> Self::Handle;
}

pub struct UploadTransfer<'a> {
    client: &'a TrellisClient,
    grant: UploadTransferGrant,
}

pub struct DownloadTransfer<'a> {
    client: &'a TrellisClient,
    grant: DownloadTransferGrant,
}

impl TrellisClient {
    pub fn transfer<'a, G>(&'a self, grant: G) -> G::Handle
    where
        G: TransferGrantBinding<'a>,
    {
        grant.bind(self)
    }
}

impl<'a> TransferGrantBinding<'a> for UploadTransferGrant {
    type Handle = UploadTransfer<'a>;

    fn bind(self, client: &'a TrellisClient) -> Self::Handle {
        UploadTransfer {
            client,
            grant: self,
        }
    }
}

impl<'a> TransferGrantBinding<'a> for DownloadTransferGrant {
    type Handle = DownloadTransfer<'a>;

    fn bind(self, client: &'a TrellisClient) -> Self::Handle {
        DownloadTransfer {
            client,
            grant: self,
        }
    }
}

impl<'a> UploadTransfer<'a> {
    pub async fn put(&self, body: impl AsRef<[u8]>) -> Result<FileInfo, TrellisClientError> {
        validate_grant(&self.grant.session_key, self.client)?;

        let bytes = body.as_ref();
        let max_chunk = self.grant.chunk_bytes as usize;
        let mut seq: u64 = 0;

        for chunk in bytes.chunks(max_chunk.max(1)) {
            let headers = self.headers(chunk, seq, false);
            let response = tokio::time::timeout(
                Duration::from_millis(self.client.timeout_ms()),
                self.client.nats().request_with_headers(
                    self.grant.subject.clone(),
                    headers,
                    Bytes::copy_from_slice(chunk),
                ),
            )
            .await
            .map_err(|_| TrellisClientError::Timeout)?
            .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

            let ack = parse_upload_ack(response)?;
            if matches!(ack, UploadAck::Complete { .. }) {
                return Err(TrellisClientError::TransferProtocol(
                    "upload completed before eof frame".into(),
                ));
            }
            seq += 1;
        }

        let headers = self.headers(&[], seq, true);
        let response = tokio::time::timeout(
            Duration::from_millis(self.client.timeout_ms()),
            self.client.nats().request_with_headers(
                self.grant.subject.clone(),
                headers,
                Bytes::new(),
            ),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        match parse_upload_ack(response)? {
            UploadAck::Continue => Err(TrellisClientError::TransferProtocol(
                "upload finished without completion payload".into(),
            )),
            UploadAck::Complete { info } => Ok(info),
        }
    }

    fn headers(&self, payload: &[u8], seq: u64, eof: bool) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.client.auth().session_key.as_str());
        headers.insert(
            "proof",
            self.client
                .auth()
                .create_proof(&self.grant.subject, payload)
                .as_str(),
        );
        headers.insert(TRANSFER_SEQUENCE_HEADER, seq.to_string().as_str());
        if eof {
            headers.insert(TRANSFER_EOF_HEADER, "true");
        }
        headers
    }
}

impl<'a> DownloadTransfer<'a> {
    pub async fn get_bytes(&self) -> Result<Vec<u8>, TrellisClientError> {
        validate_grant(&self.grant.session_key, self.client)?;

        let mut headers = HeaderMap::new();
        headers.insert("session-key", self.client.auth().session_key.as_str());
        headers.insert(
            "proof",
            self.client
                .auth()
                .create_proof(&self.grant.subject, &[])
                .as_str(),
        );

        let inbox = self.client.nats().new_inbox();
        let mut subscriber = tokio::time::timeout(
            Duration::from_millis(self.client.timeout_ms()),
            self.client.nats().subscribe(inbox.clone()),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        tokio::time::timeout(
            Duration::from_millis(self.client.timeout_ms()),
            self.client.nats().publish_with_reply_and_headers(
                self.grant.subject.clone(),
                inbox,
                headers,
                Bytes::new(),
            ),
        )
        .await
        .map_err(|_| TrellisClientError::Timeout)?
        .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

        let mut out = Vec::new();
        loop {
            let next = tokio::time::timeout(
                Duration::from_millis(self.client.timeout_ms()),
                subscriber.next(),
            )
            .await
            .map_err(|_| TrellisClientError::Timeout)?;

            let message = next.ok_or_else(|| {
                TrellisClientError::TransferProtocol("download stream closed early".into())
            })?;

            if message
                .headers
                .as_ref()
                .and_then(|headers| headers.get("status"))
                .is_some_and(|status| status.as_str() == "error")
            {
                let value: serde_json::Value = serde_json::from_slice(&message.payload)?;
                return Err(TrellisClientError::TransferProtocol(value.to_string()));
            }

            out.extend_from_slice(&message.payload);

            if message
                .headers
                .as_ref()
                .and_then(|headers| headers.get(TRANSFER_EOF_HEADER))
                .is_some_and(|value| value.as_str() == "true")
            {
                return Ok(out);
            }
        }
    }
}

fn validate_grant(
    expected_session_key: &str,
    client: &TrellisClient,
) -> Result<(), TrellisClientError> {
    if expected_session_key != client.auth().session_key {
        return Err(TrellisClientError::TransferProtocol(
            "transfer grant session key does not match client session".into(),
        ));
    }
    Ok(())
}

fn parse_upload_ack(message: async_nats::Message) -> Result<UploadAck, TrellisClientError> {
    if message
        .headers
        .as_ref()
        .and_then(|headers| headers.get("status"))
        .is_some_and(|status| status.as_str() == "error")
    {
        let value: serde_json::Value = serde_json::from_slice(&message.payload)?;
        return Err(TrellisClientError::TransferProtocol(value.to_string()));
    }

    Ok(serde_json::from_slice(&message.payload)?)
}
