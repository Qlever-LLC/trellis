use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use trellis_rs::service::GeneratedServiceContract;

use crate::support::assertions::assert_case_registered;

const FEEDS_SERVICE_ID: &str = "trellis.integration.feeds-service@v1";
const FEEDS_CLIENT_ID: &str = "trellis.integration.feeds-client@v1";

const FEEDS_SERVICE_CONTRACT_JSON: &str = r#"{
  "format": "trellis.contract.v1",
  "id": "trellis.integration.feeds-service@v1",
  "displayName": "Trellis Integration Feeds Service",
  "description": "Exercises generated feed subscribe and handler surfaces.",
  "kind": "service",
  "capabilities": {
    "trellis.integration.feeds-service::readFeeds": {
      "displayName": "Read feeds",
      "description": "Subscribe to entity feed updates."
    }
  },
  "schemas": {
    "FeedInput": {
      "type": "object",
      "required": ["topic"],
      "properties": { "topic": { "type": "string" } }
    },
    "FeedFrame": {
      "type": "object",
      "required": ["topic", "message", "sequence"],
      "properties": {
        "topic": { "type": "string" },
        "message": { "type": "string" },
        "sequence": { "type": "number" }
      }
    }
  },
  "uses": {
    "required": {
      "health": {
        "contract": "trellis.health@v1",
        "events": { "publish": ["Health.Heartbeat"] }
      }
    }
  },
  "feeds": {
    "Entity.Live": {
      "version": "v1",
      "subject": "feeds.v1.Entity.Live",
      "input": { "schema": "FeedInput" },
      "event": { "schema": "FeedFrame" },
      "capabilities": { "subscribe": ["readFeeds"] }
    }
  }
}"#;

struct FeedsServiceContract;

impl trellis_rs::service::GeneratedServiceContract for FeedsServiceContract {
    const CONTRACT_ID: &'static str = FEEDS_SERVICE_ID;
    const CONTRACT_DIGEST: &'static str = "qLQNm6CIyYRca0ejRThbr6v2hFx8bvtJqX89v-5UJHw";
    const CONTRACT_JSON: &'static str = FEEDS_SERVICE_CONTRACT_JSON;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityFeedInput {
    topic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct EntityFeedFrame {
    topic: String,
    message: String,
    sequence: u64,
}

struct EntityLiveFeed;

impl trellis_rs::client::FeedDescriptor for EntityLiveFeed {
    type Input = EntityFeedInput;
    type Event = EntityFeedFrame;

    const KEY: &'static str = "Entity.Live";
    const SUBJECT: &'static str = "feeds.v1.Entity.Live";
    const SUBSCRIBE_CAPABILITIES: &'static [&'static str] = &["readFeeds"];
    const INPUT_SCHEMA_JSON: &'static str =
        r#"{"type":"object","required":["topic"],"properties":{"topic":{"type":"string"}}}"#;
    const EVENT_SCHEMA_JSON: &'static str = r#"{"type":"object","required":["topic","message","sequence"],"properties":{"topic":{"type":"string"},"message":{"type":"string"},"sequence":{"type":"number"}}}"#;
}

struct AbortOnDrop<T> {
    handle: Option<JoinHandle<T>>,
}

impl<T> AbortOnDrop<T> {
    fn new(handle: JoinHandle<T>) -> Self {
        Self {
            handle: Some(handle),
        }
    }

    async fn abort_and_wait(mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            let _ = handle.await;
        }
    }
}

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        if let Some(handle) = &self.handle {
            handle.abort();
        }
    }
}

#[tokio::test]
async fn feeds_client_receives_first_frame() {
    assert_case_registered("feeds.client-receives-first-frame", "feeds", "feeds");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(FEEDS_SERVICE_CONTRACT_JSON)
            .expect("build feeds service test contract");
    assert_eq!(
        service_contract.digest(),
        FeedsServiceContract::CONTRACT_DIGEST
    );

    let client_contract = feeds_client_contract().expect("build feeds client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live feeds service instance");

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<FeedsServiceContract>::connect(
            runtime.service_connect_options("feeds-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust feeds service");

    service.register_feed::<EntityLiveFeed, _, _>(|_context, input| {
        assert_eq!(input.topic, "entity-feed-1");

        futures_util::stream::iter(vec![Ok(EntityFeedFrame {
            topic: input.topic.clone(),
            message: format!("feed:{}:1", input.topic),
            sequence: 1,
        })])
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust feeds client");

    let frames = subscribe_entity_feed_n(&client, "entity-feed-1", 1).await;

    service_task.abort_and_wait().await;

    assert_eq!(frames.len(), 1);
    assert_eq!(
        frames[0],
        EntityFeedFrame {
            topic: "entity-feed-1".to_string(),
            message: "feed:entity-feed-1:1".to_string(),
            sequence: 1,
        }
    );
}

#[tokio::test]
async fn feeds_client_receives_ordered_frames() {
    assert_case_registered("feeds.client-receives-ordered-frames", "feeds", "feeds");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(FEEDS_SERVICE_CONTRACT_JSON)
            .expect("build feeds service test contract");
    assert_eq!(
        service_contract.digest(),
        FeedsServiceContract::CONTRACT_DIGEST
    );

    let client_contract = feeds_client_contract().expect("build feeds client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live feeds service instance");

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<FeedsServiceContract>::connect(
            runtime.service_connect_options("feeds-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust feeds service");

    service.register_feed::<EntityLiveFeed, _, _>(|_context, input| {
        assert_eq!(input.topic, "entity-feed-1");

        futures_util::stream::iter(vec![
            Ok(EntityFeedFrame {
                topic: input.topic.clone(),
                message: format!("feed:{}:1", input.topic),
                sequence: 1,
            }),
            Ok(EntityFeedFrame {
                topic: input.topic.clone(),
                message: format!("feed:{}:2", input.topic),
                sequence: 2,
            }),
        ])
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust feeds client");

    let frames = subscribe_entity_feed_n(&client, "entity-feed-1", 2).await;

    service_task.abort_and_wait().await;

    assert_eq!(frames.len(), 2);
    assert_eq!(
        frames[0],
        EntityFeedFrame {
            topic: "entity-feed-1".to_string(),
            message: "feed:entity-feed-1:1".to_string(),
            sequence: 1,
        }
    );
    assert_eq!(
        frames[1],
        EntityFeedFrame {
            topic: "entity-feed-1".to_string(),
            message: "feed:entity-feed-1:2".to_string(),
            sequence: 2,
        }
    );
}

#[tokio::test]
async fn feeds_abort_stops_client_subscription() {
    assert_case_registered("feeds.abort-stops-client-subscription", "feeds", "feeds");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(FEEDS_SERVICE_CONTRACT_JSON)
            .expect("build feeds service test contract");
    assert_eq!(
        service_contract.digest(),
        FeedsServiceContract::CONTRACT_DIGEST
    );

    let client_contract = feeds_client_contract().expect("build feeds client test contract");

    let service_key = admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live feeds service instance");

    let mut service =
        trellis_rs::service::ConnectedServiceRuntime::<FeedsServiceContract>::connect(
            runtime.service_connect_options("feeds-fixture-service", &service_key),
        )
        .await
        .expect("connect live Rust feeds service");

    service.register_feed::<EntityLiveFeed, _, _>(|_context, input| {
        futures_util::stream::unfold(
            (1u64, input.topic.clone()),
            move |(seq, topic)| async move {
                tokio::time::sleep(Duration::from_millis(50)).await;
                Some((
                    Ok(EntityFeedFrame {
                        topic: topic.clone(),
                        message: format!("feed:{}:{}", topic, seq),
                        sequence: seq,
                    }),
                    (seq + 1, topic),
                ))
            },
        )
    });

    let service_task = AbortOnDrop::new(tokio::spawn(async move { service.run().await }));

    let client = admin
        .connect_client(&bootstrap_url, &client_contract)
        .await
        .expect("connect live Rust feeds client");

    let mut stream = client
        .feed::<EntityLiveFeed>(&EntityFeedInput {
            topic: "entity-feed-1".to_string(),
        })
        .await
        .expect("subscribe to Entity.Live feed");

    let first = stream
        .next()
        .await
        .expect("first frame")
        .expect("first frame ok");
    assert_eq!(first.sequence, 1);

    drop(stream);

    tokio::time::sleep(Duration::from_millis(200)).await;

    service_task.abort_and_wait().await;
}

#[tokio::test]
async fn feeds_denies_subscribe_without_authority() {
    assert_case_registered("feeds.denies-subscribe-without-authority", "feeds", "feeds");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let service_contract =
        trellis_test::TrellisTestContract::from_manifest_json(FEEDS_SERVICE_CONTRACT_JSON)
            .expect("build feeds service test contract");
    assert_eq!(
        service_contract.digest(),
        FeedsServiceContract::CONTRACT_DIGEST
    );

    let unauthorized_client_contract = feeds_unauthorized_client_contract()
        .expect("build feeds unauthorized client test contract");

    admin
        .provision_service_instance(&bootstrap_url, &service_contract, None, None)
        .await
        .expect("provision live feeds service instance");

    let client = admin
        .connect_client(&bootstrap_url, &unauthorized_client_contract)
        .await
        .expect("connect live Rust feeds unauthorized client");

    let result = client
        .feed::<EntityLiveFeed>(&EntityFeedInput {
            topic: "entity-feed-1".to_string(),
        })
        .await;

    assert!(
        result.is_err(),
        "expected feed subscribe to be denied for unauthorized client"
    );
}

async fn subscribe_entity_feed_n(
    client: &trellis_rs::client::TrellisClient,
    topic: &str,
    count: usize,
) -> Vec<EntityFeedFrame> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match client
            .feed::<EntityLiveFeed>(&EntityFeedInput {
                topic: topic.to_string(),
            })
            .await
        {
            Ok(stream) => {
                let mut stream = stream;
                let mut frames = Vec::new();
                while let Some(frame_result) = stream.next().await {
                    match frame_result {
                        Ok(frame) => {
                            frames.push(frame);
                            if frames.len() == count {
                                return frames;
                            }
                        }
                        Err(error)
                            if is_retryable_feed_error(&error) && Instant::now() < deadline =>
                        {
                            tokio::time::sleep(Duration::from_millis(100)).await;
                            break;
                        }
                        Err(error) => panic!("feed frame error: {error}"),
                    }
                }
                if frames.len() < count && Instant::now() < deadline {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
            Err(error) if is_retryable_feed_error(&error) && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("call live Entity.Live feed: {error}"),
        }
    }
}

fn is_retryable_feed_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}

fn feeds_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        FEEDS_CLIENT_ID,
        "Trellis Integration Feeds Client",
        "App/client participant for the feeds integration fixture.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "feedsService",
        trellis_rs::contracts::use_contract(FEEDS_SERVICE_ID).with_feed_subscribe(["Entity.Live"]),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

fn feeds_unauthorized_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.feeds-unauthorized-client@v1",
        "Trellis Integration Feeds Unauthorized Client",
        "App/client participant without feed subscribe authority.",
        trellis_rs::contracts::ContractKind::App,
    )
    .use_ref(
        "feedsService",
        trellis_rs::contracts::use_contract(FEEDS_SERVICE_ID),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}
