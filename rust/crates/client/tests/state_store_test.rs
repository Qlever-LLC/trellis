use std::future::Future;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use trellis_client::{
    DeleteStateOptions, ExpectedPutRevision, ListStateOptions, MapStateListResult, MapStateStore,
    PutStateOptions, StateGetResult, StateTransport, TrellisClientError, ValueStateStore,
};

#[derive(Debug, Clone)]
struct FakeStateTransport {
    calls: Arc<Mutex<Vec<(String, Value)>>>,
    response: Value,
}

impl FakeStateTransport {
    fn new(response: Value) -> Self {
        Self {
            calls: Arc::new(Mutex::new(Vec::new())),
            response,
        }
    }

    fn calls(&self) -> Vec<(String, Value)> {
        self.calls.lock().expect("calls lock").clone()
    }
}

impl StateTransport for FakeStateTransport {
    fn request_state_json<'a>(
        &'a self,
        subject: &'static str,
        body: Value,
    ) -> impl Future<Output = Result<Value, TrellisClientError>> + Send + 'a {
        async move {
            self.calls
                .lock()
                .expect("calls lock")
                .push((subject.to_string(), body));
            Ok(self.response.clone())
        }
    }
}

#[tokio::test]
async fn value_store_sends_get_put_and_delete_payloads() {
    let transport = FakeStateTransport::new(json!({
        "applied": false,
        "found": false,
        "deleted": false
    }));
    let store = ValueStateStore::<_, Value>::new(&transport, "selectedSite");

    store.get().await.unwrap();
    store
        .put_with_options(
            &json!({ "siteId": "north" }),
            &PutStateOptions {
                ttl_ms: Some(5000),
                expected_revision: ExpectedPutRevision::CreateIfAbsent,
            },
        )
        .await
        .unwrap();
    store
        .delete_with_options(&DeleteStateOptions {
            expected_revision: Some("rev-1".to_string()),
        })
        .await
        .unwrap();

    assert_eq!(
        transport.calls(),
        vec![
            (
                "rpc.v1.State.Get".to_string(),
                json!({ "store": "selectedSite" })
            ),
            (
                "rpc.v1.State.Put".to_string(),
                json!({
                    "store": "selectedSite",
                    "value": { "siteId": "north" },
                    "ttlMs": 5000,
                    "expectedRevision": null
                })
            ),
            (
                "rpc.v1.State.Delete".to_string(),
                json!({ "store": "selectedSite", "expectedRevision": "rev-1" })
            ),
        ]
    );
}

#[tokio::test]
async fn map_store_composes_prefix_and_sends_list_payloads() {
    let transport = FakeStateTransport::new(json!({
        "found": false,
        "applied": false,
        "entries": [],
        "count": 0,
        "offset": 10,
        "limit": 20
    }));
    let store = MapStateStore::<_, Value>::new(&transport, "draftInspections")
        .prefix("/inspection//active/")
        .prefix("/site-1/");

    store.get("/open").await.unwrap();
    store
        .put_with_options(
            "open",
            &json!({ "title": "Open" }),
            &PutStateOptions {
                ttl_ms: None,
                expected_revision: ExpectedPutRevision::Revision("rev-2".to_string()),
            },
        )
        .await
        .unwrap();
    store
        .list(&ListStateOptions {
            offset: Some(10),
            limit: Some(20),
        })
        .await
        .unwrap();

    assert_eq!(
        transport.calls(),
        vec![
            (
                "rpc.v1.State.Get".to_string(),
                json!({ "store": "draftInspections", "key": "inspection/active/site-1/open" })
            ),
            (
                "rpc.v1.State.Put".to_string(),
                json!({
                    "store": "draftInspections",
                    "key": "inspection/active/site-1/open",
                    "value": { "title": "Open" },
                    "expectedRevision": "rev-2"
                })
            ),
            (
                "rpc.v1.State.List".to_string(),
                json!({
                    "store": "draftInspections",
                    "prefix": "inspection/active/site-1",
                    "offset": 10,
                    "limit": 20
                })
            ),
        ]
    );
}

#[tokio::test]
async fn value_store_decodes_migration_required_get_and_failed_put_found() {
    let found_transport = FakeStateTransport::new(json!({
        "found": true,
        "entry": {
            "value": { "siteId": "north" },
            "revision": "rev-1",
            "updatedAt": "2026-01-01T00:00:00.000Z"
        }
    }));
    let store = ValueStateStore::<_, Value>::new(&found_transport, "selectedSite");
    let result = store.get().await.unwrap();
    assert!(matches!(result, StateGetResult::Found { .. }));

    let get_transport = FakeStateTransport::new(json!({
        "migrationRequired": true,
        "entry": {
            "value": { "legacy": true },
            "revision": "rev-old",
            "updatedAt": "2026-01-01T00:00:00.000Z"
        },
        "stateVersion": "selected-site.v0",
        "currentStateVersion": "selected-site.v1",
        "writerContractDigest": "digest-old"
    }));
    let store = ValueStateStore::<_, Value>::new(&get_transport, "selectedSite");
    let result = store.get().await.unwrap();
    assert!(matches!(result, StateGetResult::MigrationRequired(_)));

    let put_transport = FakeStateTransport::new(json!({
        "applied": false,
        "found": true,
        "entry": {
            "value": { "siteId": "north" },
            "revision": "rev-1",
            "updatedAt": "2026-01-01T00:00:00.000Z"
        }
    }));
    let store = ValueStateStore::<_, Value>::new(&put_transport, "selectedSite");
    let result = store.put(&json!({ "siteId": "south" })).await.unwrap();
    assert_eq!(result.found, Some(true));
}

#[tokio::test]
async fn map_store_decodes_list_pagination_and_sends_default_pagination() {
    let transport = FakeStateTransport::new(json!({
        "entries": [],
        "count": 42,
        "offset": 0,
        "limit": 100,
        "next": 100
    }));
    let store = MapStateStore::<_, Value>::new(&transport, "draftInspections");
    let result: MapStateListResult<Value> = store.list(&ListStateOptions::default()).await.unwrap();

    assert_eq!(result.count, 42);
    assert_eq!(result.next, Some(100));
    assert_eq!(
        transport.calls(),
        vec![(
            "rpc.v1.State.List".to_string(),
            json!({ "store": "draftInspections", "offset": 0, "limit": 100 })
        )]
    );
}
