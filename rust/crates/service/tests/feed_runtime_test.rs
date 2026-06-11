use bytes::Bytes;
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use trellis_service::internal::HandlerResponse;
use trellis_service::{FeedDescriptor, RequestContext, Router};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct FeedInput {
    room: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct FeedEvent {
    text: String,
}

struct ChatFeed;

impl FeedDescriptor for ChatFeed {
    type Input = FeedInput;
    type Event = FeedEvent;

    const KEY: &'static str = "Chat.Live";
    const SUBJECT: &'static str = "feeds.v1.Chat.Live";
}

#[tokio::test]
async fn registered_feed_returns_ready_stream_response_and_json_events() {
    let mut router = Router::new();
    router.register_feed::<ChatFeed, _, _>(|_context, input| {
        stream::iter([Ok(FeedEvent {
            text: format!("hello {}", input.room),
        })])
    });

    let response = router
        .handle_request_response(
            ChatFeed::SUBJECT,
            Bytes::from(serde_json::to_vec(&json!({ "room": "general" })).expect("json")),
            RequestContext {
                subject: ChatFeed::SUBJECT.to_string(),
                session_key: Some("abcdefghijklmnop-session".to_string()),
                proof: Some("proof".to_string()),
                iat: None,
                request_id: None,
                required_capabilities: None,
                reply_to: Some("_INBOX.abcdefghijklmnop.1".to_string()),
                caller: None,
                traceparent: None,
                tracestate: None,
            },
        )
        .await
        .expect("feed response");

    let HandlerResponse::FeedStream(mut events) = response else {
        panic!("feed should return a feed stream response");
    };

    let first = events
        .next()
        .await
        .expect("first event")
        .expect("event payload");
    let event: FeedEvent = serde_json::from_slice(&first).expect("decode event");
    assert_eq!(
        event,
        FeedEvent {
            text: "hello general".to_string(),
        }
    );
}
