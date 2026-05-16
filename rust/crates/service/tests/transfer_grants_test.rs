use std::{collections::BTreeMap, sync::Arc};

use async_nats::header::HeaderMap;
use bytes::Bytes;
use tokio::sync::Mutex;
use trellis_service::{
    decode_upload_transfer_chunk, plan_download_transfer_chunks, plan_download_transfer_chunks_at,
    plan_download_transfer_grant, plan_upload_transfer_grant, FileTransferInfo, ServerError,
    ServiceResourceBindings, StoreResourceBinding, StoreResourceClient, TransferDownloadGrantArgs,
    TransferUploadGrantArgs, UploadTransferAck, UploadTransferChunk, UploadTransferSession,
    TRANSFER_EOF_HEADER, TRANSFER_SEQUENCE_HEADER,
};

#[derive(Debug, Clone, Default)]
struct FakeStoreClient {
    values: Arc<Mutex<BTreeMap<String, Bytes>>>,
}

impl StoreResourceClient for FakeStoreClient {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        Ok(self.values.lock().await.get(key).cloned())
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        self.values.lock().await.insert(key.to_string(), value);
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        Ok(self.values.lock().await.keys().cloned().collect())
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.values.lock().await.remove(key);
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
struct FailOnceStoreClient {
    inner: FakeStoreClient,
    fail_next_write: Arc<Mutex<bool>>,
}

impl FailOnceStoreClient {
    fn new() -> Self {
        Self {
            inner: FakeStoreClient::default(),
            fail_next_write: Arc::new(Mutex::new(true)),
        }
    }
}

impl StoreResourceClient for FailOnceStoreClient {
    async fn read(&self, key: &str) -> Result<Option<Bytes>, ServerError> {
        self.inner.read(key).await
    }

    async fn write(&self, key: &str, value: Bytes) -> Result<(), ServerError> {
        let mut fail_next_write = self.fail_next_write.lock().await;
        if *fail_next_write {
            *fail_next_write = false;
            return Err(ServerError::Nats("temporary store failure".to_string()));
        }
        drop(fail_next_write);
        self.inner.write(key, value).await
    }

    async fn list(&self) -> Result<Vec<String>, ServerError> {
        self.inner.list().await
    }

    async fn delete(&self, key: &str) -> Result<(), ServerError> {
        self.inner.delete(key).await
    }
}

fn resources() -> ServiceResourceBindings {
    ServiceResourceBindings {
        store: BTreeMap::from([(
            "evidence".to_string(),
            StoreResourceBinding {
                name: "field_ops_evidence".to_string(),
                max_object_bytes: Some(1_024),
                max_total_bytes: None,
                ttl_ms: 0,
            },
        )]),
        ..ServiceResourceBindings::default()
    }
}

fn upload_plan(max_bytes: Option<u64>) -> trellis_service::UploadTransferGrantPlan {
    plan_upload_transfer_grant(TransferUploadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        key: "evidence/photo.jpg",
        transfer_id: "transfer-1",
        expires_at: "2099-05-02T12:00:00.000Z",
        chunk_bytes: 4,
        max_bytes,
        content_type: Some("image/jpeg"),
        metadata: BTreeMap::from([("source".to_string(), "camera".to_string())]),
    })
    .expect("upload grant")
}

fn download_plan(size: u64) -> trellis_service::DownloadTransferGrantPlan {
    plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        transfer_id: "transfer-3",
        expires_at: "2099-05-02T12:00:00.000Z",
        chunk_bytes: 4,
        info: FileTransferInfo {
            key: "evidence/photo.jpg".to_string(),
            size,
            updated_at: "2026-05-02T11:00:00.000Z".to_string(),
            digest: None,
            content_type: Some("image/jpeg".to_string()),
            metadata: BTreeMap::new(),
        },
    })
    .expect("download grant")
}

#[tokio::test]
async fn upload_transfer_session_stores_ordered_chunks_on_eof() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");

    let ack = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abc"),
                eof: false,
            },
        )
        .await
        .expect("first chunk");
    assert_eq!(ack, UploadTransferAck::Continue);

    let ack = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 1,
                payload: Bytes::from_static(b"def"),
                eof: true,
            },
        )
        .await
        .expect("eof chunk");

    let UploadTransferAck::Complete { info } = ack else {
        panic!("expected completion ack");
    };
    assert_eq!(info.key, "evidence/photo.jpg");
    assert_eq!(info.size, 6);
    assert_eq!(info.updated_at, "2026-05-02T12:01:00.000Z");
    assert_eq!(info.content_type.as_deref(), Some("image/jpeg"));
    assert_eq!(
        store.read("evidence/photo.jpg").await.unwrap().unwrap(),
        b"abcdef"[..]
    );
    session.ensure_complete().expect("complete");
}

#[test]
fn upload_transfer_chunk_decodes_sequence_and_eof_headers() {
    let mut headers = HeaderMap::new();
    headers.insert(TRANSFER_SEQUENCE_HEADER, "7");
    headers.insert(TRANSFER_EOF_HEADER, "true");

    let chunk = decode_upload_transfer_chunk(Some(&headers), Bytes::from_static(b"abc"))
        .expect("decoded chunk");

    assert_eq!(chunk.seq, 7);
    assert_eq!(chunk.payload, b"abc"[..]);
    assert!(chunk.eof);
}

#[test]
fn upload_transfer_chunk_requires_sequence_header() {
    let error = decode_upload_transfer_chunk(None, Bytes::new()).expect_err("missing seq");

    assert!(matches!(
        error,
        ServerError::MissingTransferHeader { header } if header == TRANSFER_SEQUENCE_HEADER
    ));
}

#[test]
fn upload_transfer_chunk_rejects_invalid_sequence_header() {
    let mut headers = HeaderMap::new();
    headers.insert(TRANSFER_SEQUENCE_HEADER, "not-a-number");

    let error =
        decode_upload_transfer_chunk(Some(&headers), Bytes::new()).expect_err("invalid seq");

    assert!(matches!(
        error,
        ServerError::InvalidTransferHeader { header, value }
            if header == TRANSFER_SEQUENCE_HEADER && value == "not-a-number"
    ));
}

#[tokio::test]
async fn upload_transfer_session_rejects_out_of_order_chunks() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");

    let error = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 1,
                payload: Bytes::from_static(b"abc"),
                eof: false,
            },
        )
        .await
        .expect_err("out of order");

    assert!(matches!(
        error,
        ServerError::TransferSequenceOutOfOrder { transfer_id, expected_seq, actual_seq }
            if transfer_id == "transfer-1" && expected_seq == 0 && actual_seq == 1
    ));
}

#[tokio::test]
async fn upload_transfer_session_rejects_expired_grant_before_write() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");

    let error = session
        .receive_at(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abc"),
                eof: true,
            },
            "2100-05-02T12:00:00.000Z",
        )
        .await
        .expect_err("expired upload");

    assert!(matches!(
        error,
        ServerError::TransferExpired { transfer_id, expires_at }
            if transfer_id == "transfer-1" && expires_at == "2099-05-02T12:00:00.000Z"
    ));
    assert!(store.read("evidence/photo.jpg").await.unwrap().is_none());
}

#[tokio::test]
async fn upload_transfer_session_rejects_oversized_uploads() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(5)), "2026-05-02T12:01:00.000Z");
    session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abcd"),
                eof: false,
            },
        )
        .await
        .expect("first chunk");

    let error = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 1,
                payload: Bytes::from_static(b"ef"),
                eof: true,
            },
        )
        .await
        .expect_err("oversized upload");

    assert!(matches!(
        error,
        ServerError::TransferObjectTooLarge { service_name, store, key, size, max_bytes }
            if service_name == "field-ops-service"
                && store == "evidence"
                && key == "evidence/photo.jpg"
                && size == 6
                && max_bytes == 5
    ));
}

#[tokio::test]
async fn upload_transfer_session_rejects_chunks_larger_than_grant_frame_size() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");

    let error = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abcde"),
                eof: true,
            },
        )
        .await
        .expect_err("oversized chunk");

    assert!(matches!(
        error,
        ServerError::TransferObjectTooLarge { service_name, store, key, size, max_bytes }
            if service_name == "field-ops-service"
                && store == "evidence"
                && key == "evidence/photo.jpg"
                && size == 5
                && max_bytes == 4
    ));
}

#[tokio::test]
async fn upload_transfer_session_rejects_chunks_after_completion() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");
    session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abc"),
                eof: true,
            },
        )
        .await
        .expect("complete");

    let error = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 1,
                payload: Bytes::new(),
                eof: true,
            },
        )
        .await
        .expect_err("already complete");

    assert!(matches!(
        error,
        ServerError::TransferAlreadyComplete { transfer_id } if transfer_id == "transfer-1"
    ));
}

#[tokio::test]
async fn upload_transfer_session_can_retry_eof_after_store_write_failure() {
    let store = FailOnceStoreClient::new();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");
    session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abc"),
                eof: false,
            },
        )
        .await
        .expect("first chunk");

    let error = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 1,
                payload: Bytes::from_static(b"def"),
                eof: true,
            },
        )
        .await
        .expect_err("first write fails");
    assert!(matches!(error, ServerError::Nats(_)));

    let ack = session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 1,
                payload: Bytes::from_static(b"def"),
                eof: true,
            },
        )
        .await
        .expect("retry eof");

    assert!(matches!(ack, UploadTransferAck::Complete { .. }));
    assert_eq!(
        store
            .read("evidence/photo.jpg")
            .await
            .expect("read")
            .expect("stored"),
        b"abcdef"[..]
    );
}

#[tokio::test]
async fn upload_transfer_session_reports_missing_eof() {
    let store = FakeStoreClient::default();
    let mut session = UploadTransferSession::new(upload_plan(Some(16)), "2026-05-02T12:01:00.000Z");
    session
        .receive(
            &store,
            UploadTransferChunk {
                seq: 0,
                payload: Bytes::from_static(b"abc"),
                eof: false,
            },
        )
        .await
        .expect("first chunk");

    let error = session.ensure_complete().expect_err("missing eof");

    assert!(matches!(
        error,
        ServerError::TransferMissingEof { transfer_id } if transfer_id == "transfer-1"
    ));
    assert!(store.read("evidence/photo.jpg").await.unwrap().is_none());
}

#[tokio::test]
async fn download_transfer_chunks_read_store_and_mark_final_frame_eof() {
    let store = FakeStoreClient::default();
    store
        .write("evidence/photo.jpg", Bytes::from_static(b"abcdefghi"))
        .await
        .expect("seed object");

    let chunks = plan_download_transfer_chunks(&download_plan(9), &store)
        .await
        .expect("download chunks");

    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].seq, 0);
    assert_eq!(chunks[0].payload, b"abcd"[..]);
    assert!(!chunks[0].eof);
    assert_eq!(chunks[1].seq, 1);
    assert_eq!(chunks[1].payload, b"efgh"[..]);
    assert!(!chunks[1].eof);
    assert_eq!(chunks[2].seq, 2);
    assert_eq!(chunks[2].payload, b"i"[..]);
    assert!(chunks[2].eof);
}

#[tokio::test]
async fn download_transfer_chunks_reject_expired_grant_before_read() {
    let store = FakeStoreClient::default();
    store
        .write("evidence/photo.jpg", Bytes::from_static(b"abcdefghi"))
        .await
        .expect("seed object");

    let error =
        plan_download_transfer_chunks_at(&download_plan(9), &store, "2100-05-02T12:00:00.000Z")
            .await
            .expect_err("expired download");

    assert!(matches!(
        error,
        ServerError::TransferExpired { transfer_id, expires_at }
            if transfer_id == "transfer-3" && expires_at == "2099-05-02T12:00:00.000Z"
    ));
}

#[tokio::test]
async fn download_transfer_chunks_frame_empty_object_as_single_eof_chunk() {
    let store = FakeStoreClient::default();
    store
        .write("evidence/photo.jpg", Bytes::new())
        .await
        .expect("seed object");

    let chunks = plan_download_transfer_chunks(&download_plan(0), &store)
        .await
        .expect("download chunks");

    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].seq, 0);
    assert!(chunks[0].payload.is_empty());
    assert!(chunks[0].eof);
}

#[tokio::test]
async fn download_transfer_chunks_reject_changed_object_size() {
    let store = FakeStoreClient::default();
    store
        .write("evidence/photo.jpg", Bytes::from_static(b"changed"))
        .await
        .expect("seed object");

    let error = plan_download_transfer_chunks(&download_plan(9), &store)
        .await
        .expect_err("size mismatch");

    assert!(matches!(
        error,
        ServerError::TransferObjectSizeMismatch { store, key, expected_size, actual_size }
            if store == "evidence"
                && key == "evidence/photo.jpg"
                && expected_size == 9
                && actual_size == 7
    ));
}

#[tokio::test]
async fn download_transfer_chunks_report_missing_store_object() {
    let store = FakeStoreClient::default();

    let error = plan_download_transfer_chunks(&download_plan(9), &store)
        .await
        .expect_err("missing object");

    assert!(matches!(
        error,
        ServerError::TransferObjectMissing { store, key }
            if store == "evidence" && key == "evidence/photo.jpg"
    ));
}

#[test]
fn upload_transfer_grant_uses_store_binding_and_effective_max_bytes() {
    let grant = plan_upload_transfer_grant(TransferUploadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        key: "evidence/photo.jpg",
        transfer_id: "transfer-1",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        max_bytes: Some(2_048),
        content_type: Some("image/jpeg"),
        metadata: BTreeMap::from([("source".to_string(), "camera".to_string())]),
    })
    .expect("upload grant");

    assert_eq!(grant.grant.type_name, "TransferGrant");
    assert_eq!(grant.grant.direction, "send");
    assert_eq!(grant.grant.service, "field-ops-service");
    assert_eq!(grant.store, "field_ops_evidence");
    assert_eq!(grant.key, "evidence/photo.jpg");
    assert_eq!(
        grant.grant.subject,
        "transfer.v1.upload.service-key-1234.transfer-1"
    );
    assert_eq!(grant.grant.max_bytes, Some(1_024));
    assert_eq!(grant.grant.content_type.as_deref(), Some("image/jpeg"));
    assert_eq!(
        grant.grant.metadata.get("source").map(String::as_str),
        Some("camera")
    );
}

#[test]
fn upload_transfer_grant_serializes_only_wire_fields() {
    let plan = plan_upload_transfer_grant(TransferUploadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        key: "evidence/photo.jpg",
        transfer_id: "transfer-1",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        max_bytes: Some(2_048),
        content_type: Some("image/jpeg"),
        metadata: BTreeMap::from([("source".to_string(), "camera".to_string())]),
    })
    .expect("upload grant");

    let json = serde_json::to_value(&plan.grant).expect("wire grant json");

    assert_eq!(
        json,
        serde_json::json!({
            "type": "TransferGrant",
            "direction": "send",
            "service": "field-ops-service",
            "sessionKey": "session-key-1234567890",
            "transferId": "transfer-1",
            "subject": "transfer.v1.upload.service-key-1234.transfer-1",
            "expiresAt": "2026-05-02T12:00:00.000Z",
            "chunkBytes": 65536,
            "maxBytes": 1024,
            "contentType": "image/jpeg",
            "metadata": {
                "source": "camera"
            }
        })
    );
    assert!(json.get("storeAlias").is_none());
    assert!(json.get("store").is_none());
    assert!(json.get("key").is_none());
}

#[test]
fn upload_transfer_grant_reports_unknown_store_alias() {
    let error = plan_upload_transfer_grant(TransferUploadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &ServiceResourceBindings::default(),
        store: "evidence",
        key: "evidence/photo.jpg",
        transfer_id: "transfer-1",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        max_bytes: None,
        content_type: None,
        metadata: BTreeMap::new(),
    })
    .expect_err("missing store");

    assert!(matches!(
        error,
        ServerError::MissingResourceBinding { service_name, resource_kind, resource_name }
            if service_name == "field-ops-service"
                && resource_kind == "store"
                && resource_name == "evidence"
    ));
}

#[test]
fn upload_transfer_grant_rejects_zero_chunk_size() {
    let error = plan_upload_transfer_grant(TransferUploadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        key: "evidence/photo.jpg",
        transfer_id: "transfer-1",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 0,
        max_bytes: None,
        content_type: None,
        metadata: BTreeMap::new(),
    })
    .expect_err("zero chunk size");

    assert!(matches!(
        error,
        ServerError::InvalidTransferChunkSize { chunk_bytes } if chunk_bytes == 0
    ));
}

#[test]
fn download_transfer_grant_rejects_info_that_exceeds_store_max_object_bytes() {
    let error = plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        transfer_id: "transfer-2",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        info: FileTransferInfo {
            key: "evidence/large.bin".to_string(),
            size: 2_048,
            updated_at: "2026-05-02T11:00:00.000Z".to_string(),
            digest: None,
            content_type: None,
            metadata: BTreeMap::new(),
        },
    })
    .expect_err("oversized download");

    assert!(matches!(
        error,
        ServerError::TransferObjectTooLarge {
            service_name,
            store,
            key,
            size,
            max_bytes,
        } if service_name == "field-ops-service"
            && store == "evidence"
            && key == "evidence/large.bin"
            && size == 2_048
            && max_bytes == 1_024
    ));
}

#[test]
fn download_transfer_grant_uses_store_binding_and_file_info() {
    let grant = plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        transfer_id: "transfer-3",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        info: FileTransferInfo {
            key: "evidence/photo.jpg".to_string(),
            size: 512,
            updated_at: "2026-05-02T11:00:00.000Z".to_string(),
            digest: Some("sha256:photo".to_string()),
            content_type: Some("image/jpeg".to_string()),
            metadata: BTreeMap::new(),
        },
    })
    .expect("download grant");

    assert_eq!(grant.grant.type_name, "TransferGrant");
    assert_eq!(grant.grant.direction, "receive");
    assert_eq!(grant.store, "field_ops_evidence");
    assert_eq!(grant.grant.info.key, "evidence/photo.jpg");
    assert_eq!(grant.grant.info.size, 512);
    assert_eq!(
        grant.grant.subject,
        "transfer.v1.download.service-key-1234.transfer-3"
    );
}

#[test]
fn download_transfer_grant_serializes_only_wire_fields() {
    let plan = plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        transfer_id: "transfer-3",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        info: FileTransferInfo {
            key: "evidence/photo.jpg".to_string(),
            size: 512,
            updated_at: "2026-05-02T11:00:00.000Z".to_string(),
            digest: Some("sha256:photo".to_string()),
            content_type: Some("image/jpeg".to_string()),
            metadata: BTreeMap::from([("source".to_string(), "camera".to_string())]),
        },
    })
    .expect("download grant");

    let json = serde_json::to_value(&plan.grant).expect("wire grant json");

    assert_eq!(
        json,
        serde_json::json!({
            "type": "TransferGrant",
            "direction": "receive",
            "service": "field-ops-service",
            "sessionKey": "session-key-1234567890",
            "transferId": "transfer-3",
            "subject": "transfer.v1.download.service-key-1234.transfer-3",
            "expiresAt": "2026-05-02T12:00:00.000Z",
            "chunkBytes": 65536,
            "info": {
                "key": "evidence/photo.jpg",
                "size": 512,
                "updatedAt": "2026-05-02T11:00:00.000Z",
                "digest": "sha256:photo",
                "contentType": "image/jpeg",
                "metadata": {
                    "source": "camera"
                }
            }
        })
    );
    assert!(json.get("storeAlias").is_none());
    assert!(json.get("store").is_none());
    assert!(json.get("key").is_none());
}

#[test]
fn upload_transfer_grant_rejects_unsafe_transfer_ids() {
    for transfer_id in [
        "",
        ".",
        "nested.token",
        "*",
        ">",
        "has space",
        "has/slash",
        "line\nbreak",
    ] {
        let error = plan_upload_transfer_grant(TransferUploadGrantArgs {
            service_name: "field-ops-service",
            session_key: "session-key-1234567890",
            service_session_key: "service-key-1234567890",
            resources: &resources(),
            store: "evidence",
            key: "evidence/photo.jpg",
            transfer_id,
            expires_at: "2026-05-02T12:00:00.000Z",
            chunk_bytes: 65_536,
            max_bytes: None,
            content_type: None,
            metadata: BTreeMap::new(),
        })
        .expect_err("unsafe transfer id");

        assert!(matches!(
            error,
            ServerError::InvalidTransferId { value } if value == transfer_id
        ));
    }
}

#[test]
fn download_transfer_grant_rejects_unsafe_transfer_ids() {
    let error = plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        transfer_id: "bad/id",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 65_536,
        info: FileTransferInfo {
            key: "evidence/photo.jpg".to_string(),
            size: 512,
            updated_at: "2026-05-02T11:00:00.000Z".to_string(),
            digest: None,
            content_type: None,
            metadata: BTreeMap::new(),
        },
    })
    .expect_err("unsafe transfer id");

    assert!(matches!(
        error,
        ServerError::InvalidTransferId { value } if value == "bad/id"
    ));
}

#[test]
fn download_transfer_grant_rejects_zero_chunk_size() {
    let error = plan_download_transfer_grant(TransferDownloadGrantArgs {
        service_name: "field-ops-service",
        session_key: "session-key-1234567890",
        service_session_key: "service-key-1234567890",
        resources: &resources(),
        store: "evidence",
        transfer_id: "transfer-3",
        expires_at: "2026-05-02T12:00:00.000Z",
        chunk_bytes: 0,
        info: FileTransferInfo {
            key: "evidence/photo.jpg".to_string(),
            size: 512,
            updated_at: "2026-05-02T11:00:00.000Z".to_string(),
            digest: None,
            content_type: None,
            metadata: BTreeMap::new(),
        },
    })
    .expect_err("zero chunk size");

    assert!(matches!(
        error,
        ServerError::InvalidTransferChunkSize { chunk_bytes } if chunk_bytes == 0
    ));
}
