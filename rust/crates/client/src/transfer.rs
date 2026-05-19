use std::collections::BTreeMap;
use std::time::Duration;

use async_nats::header::HeaderMap;
use bytes::Bytes;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::client::signed_headers;
use crate::{SessionAuth, TrellisClient, TrellisClientError};

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
    #[serde(rename = "direction", alias = "kind")]
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
    #[serde(rename = "direction", alias = "kind")]
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
#[serde(tag = "status", rename_all = "lowercase")]
enum UploadAck {
    Continue,
    Complete { info: FileInfo },
}

fn upload_headers(
    auth: &SessionAuth,
    subject: &str,
    payload: &[u8],
    seq: u64,
    eof: bool,
) -> HeaderMap {
    let mut headers = signed_headers(auth, subject, payload);
    headers.insert(TRANSFER_SEQUENCE_HEADER, seq.to_string().as_str());
    if eof {
        headers.insert(TRANSFER_EOF_HEADER, "true");
    }
    headers
}

fn upload_chunk_size(chunk_bytes: u64) -> usize {
    (chunk_bytes as usize).max(1)
}

pub(crate) async fn put_upload_grant(
    client: &TrellisClient,
    grant: &UploadTransferGrant,
    body: impl AsRef<[u8]>,
) -> Result<FileInfo, TrellisClientError> {
    validate_grant(&grant.session_key, client)?;

    let bytes = body.as_ref();
    if let Some(max_bytes) = grant.max_bytes {
        let attempted_bytes = bytes.len() as u64;
        if attempted_bytes > max_bytes {
            return Err(TrellisClientError::TransferProtocol(format!(
                "upload exceeds max bytes: attempted {attempted_bytes}, max {max_bytes}"
            )));
        }
    }
    let max_chunk = upload_chunk_size(grant.chunk_bytes);
    let mut seq: u64 = 0;

    for chunk in bytes.chunks(max_chunk) {
        let headers = upload_headers(client.auth(), &grant.subject, chunk, seq, false);
        let response = tokio::time::timeout(
            Duration::from_millis(client.timeout_ms()),
            client.nats().request_with_headers(
                grant.subject.clone(),
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

    let headers = upload_headers(client.auth(), &grant.subject, &[], seq, true);
    let response = tokio::time::timeout(
        Duration::from_millis(client.timeout_ms()),
        client
            .nats()
            .request_with_headers(grant.subject.clone(), headers, Bytes::new()),
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

pub(crate) async fn get_download_grant(
    client: &TrellisClient,
    grant: &DownloadTransferGrant,
) -> Result<Vec<u8>, TrellisClientError> {
    validate_grant(&grant.session_key, client)?;

    let headers = client.signed_headers(&grant.subject, &[]);

    let inbox = client.nats().new_inbox();
    let mut subscriber = tokio::time::timeout(
        Duration::from_millis(client.timeout_ms()),
        client.nats().subscribe(inbox.clone()),
    )
    .await
    .map_err(|_| TrellisClientError::Timeout)?
    .map_err(|error| TrellisClientError::NatsRequest(error.to_string()))?;

    tokio::time::timeout(
        Duration::from_millis(client.timeout_ms()),
        client.nats().publish_with_reply_and_headers(
            grant.subject.clone(),
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
            Duration::from_millis(client.timeout_ms()),
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

/// Parse a receive transfer grant from generated SDK or raw JSON values.
pub fn download_transfer_grant_from_value(
    value: serde_json::Value,
) -> Result<DownloadTransferGrant, TrellisClientError> {
    Ok(serde_json::from_value(value)?)
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

#[cfg(test)]
mod tests {
    use crate::verify_proof;

    use super::*;

    fn test_auth() -> SessionAuth {
        SessionAuth::from_seed_base64url("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
            .expect("session auth")
    }

    #[test]
    fn upload_chunk_size_never_returns_zero() {
        assert_eq!(upload_chunk_size(0), 1);
        assert_eq!(upload_chunk_size(6), 6);
    }

    #[test]
    fn upload_chunks_match_raw_transfer_sequence() {
        let body = b"hello world";
        let chunks: Vec<&[u8]> = body.chunks(upload_chunk_size(6)).collect();

        assert_eq!(chunks, vec![b"hello ".as_slice(), b"world".as_slice()]);
        assert_eq!(chunks.len() as u64, 2);
    }

    #[test]
    fn upload_headers_include_session_proof_sequence_and_eof_marker() {
        let auth = test_auth();
        let subject = "transfer.v1.upload.test.tx1";
        let payload = b"hello ";

        let chunk_headers = upload_headers(&auth, subject, payload, 0, false);

        assert_eq!(
            chunk_headers
                .get("session-key")
                .expect("session-key")
                .as_str(),
            auth.session_key
        );
        assert!(verify_proof(
            &auth.session_key,
            subject,
            payload,
            chunk_headers
                .get("iat")
                .expect("iat")
                .as_str()
                .parse()
                .expect("iat integer"),
            chunk_headers
                .get("request-id")
                .expect("request-id")
                .as_str(),
            chunk_headers.get("proof").expect("proof").as_str()
        )
        .expect("proof verifies"));
        assert_eq!(
            chunk_headers
                .get(TRANSFER_SEQUENCE_HEADER)
                .expect("sequence")
                .as_str(),
            "0"
        );
        assert!(chunk_headers.get(TRANSFER_EOF_HEADER).is_none());

        let eof_headers = upload_headers(&auth, subject, &[], 2, true);

        assert_eq!(
            eof_headers
                .get(TRANSFER_SEQUENCE_HEADER)
                .expect("eof sequence")
                .as_str(),
            "2"
        );
        assert_eq!(
            eof_headers
                .get(TRANSFER_EOF_HEADER)
                .expect("eof marker")
                .as_str(),
            "true"
        );
        assert!(verify_proof(
            &auth.session_key,
            subject,
            &[],
            eof_headers
                .get("iat")
                .expect("eof iat")
                .as_str()
                .parse()
                .expect("eof iat integer"),
            eof_headers
                .get("request-id")
                .expect("eof request-id")
                .as_str(),
            eof_headers.get("proof").expect("eof proof").as_str()
        )
        .expect("eof proof verifies"));
    }
}
