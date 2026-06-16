use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::support::assertions::assert_case_registered;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Preferences {
    theme: String,
    density: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Draft {
    title: String,
    body: String,
}

#[tokio::test]
async fn state_value_store_missing_read() {
    assert_case_registered("state.value-store-missing-read", "state", "state");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_client_contract().expect("build state client test contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust state client");

    let preferences =
        trellis_rs::client::ValueStateStore::<_, Preferences>::new(&client, "preferences");

    assert_eq!(
        call_state_get_missing_with_retry(&preferences).await,
        trellis_rs::client::StateGetResult::Missing { found: false }
    );
}

#[tokio::test]
async fn state_value_store_create_read_delete() {
    assert_case_registered("state.value-store-create-read-delete", "state", "state");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_client_contract().expect("build state client test contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust state client");

    let preferences =
        trellis_rs::client::ValueStateStore::<_, Preferences>::new(&client, "preferences");

    let created = preferences
        .put_with_options(
            &Preferences {
                theme: "dark".to_string(),
                density: "comfortable".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("create preferences");
    assert!(created.applied);
    let created_entry = match created.entry {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        _ => panic!("expected current preferences entry"),
    };
    assert_eq!(created_entry.value.theme, "dark");

    match preferences.get().await.expect("read preferences") {
        trellis_rs::client::StateGetResult::Found { entry, .. } => {
            assert_eq!(entry.value.density, "comfortable");
        }
        other => panic!("expected found preferences, got {other:?}"),
    }

    let deleted = preferences
        .delete_with_options(&trellis_rs::client::DeleteStateOptions {
            expected_revision: Some(created_entry.revision),
        })
        .await
        .expect("delete preferences");
    assert!(deleted.deleted);

    assert_eq!(
        preferences.get().await.expect("read deleted preferences"),
        trellis_rs::client::StateGetResult::Missing { found: false }
    );
}

#[tokio::test]
async fn state_value_store_stale_revision_rejected() {
    assert_case_registered(
        "state.value-store-stale-revision-rejected",
        "state",
        "state",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_client_contract().expect("build state client test contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust state client");

    let preferences =
        trellis_rs::client::ValueStateStore::<_, Preferences>::new(&client, "preferences");

    let created = preferences
        .put_with_options(
            &Preferences {
                theme: "dark".to_string(),
                density: "comfortable".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("create preferences");
    assert!(created.applied);

    let stale_write = preferences
        .put_with_options(
            &Preferences {
                theme: "light".to_string(),
                density: "compact".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::Revision(
                    "stale-revision".to_string(),
                ),
                ..Default::default()
            },
        )
        .await
        .expect("stale write should not error");
    assert!(!stale_write.applied);

    let stale_delete = preferences
        .delete_with_options(&trellis_rs::client::DeleteStateOptions {
            expected_revision: Some("stale-revision".to_string()),
        })
        .await
        .expect("stale delete should not error");
    assert!(!stale_delete.deleted);
}

#[tokio::test]
async fn state_map_store_prefix_put_get_list_delete() {
    assert_case_registered(
        "state.map-store-prefix-put-get-list-delete",
        "state",
        "state",
    );

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_client_contract().expect("build state client test contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust state client");

    let drafts =
        trellis_rs::client::MapStateStore::<_, Draft>::new(&client, "drafts").prefix("inspection");

    let created = drafts
        .put_with_options(
            "state-draft",
            &Draft {
                title: "State Draft".to_string(),
                body: "from Rust".to_string(),
            },
            &trellis_rs::client::PutStateOptions {
                expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                ..Default::default()
            },
        )
        .await
        .expect("create draft");
    let created_entry = match created.entry {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        _ => panic!("expected current draft entry"),
    };
    assert_eq!(created_entry.key, "inspection/state-draft");

    match drafts.get("state-draft").await.expect("read draft") {
        trellis_rs::client::StateGetResult::Found { entry, .. } => {
            assert_eq!(entry.value.title, "State Draft");
        }
        other => panic!("expected found draft, got {other:?}"),
    }

    let listed = drafts
        .list(&trellis_rs::client::ListStateOptions {
            limit: Some(10),
            ..Default::default()
        })
        .await
        .expect("list drafts");
    assert_eq!(listed.count, 1);
    let listed_entry = match listed.entries.first() {
        Some(trellis_rs::client::StateValue::Current(entry)) => entry,
        other => panic!("expected listed current draft, got {other:?}"),
    };
    assert_eq!(listed_entry.key, "inspection/state-draft");

    let deleted = drafts
        .delete_with_options(
            "state-draft",
            &trellis_rs::client::DeleteStateOptions {
                expected_revision: Some(created_entry.revision),
            },
        )
        .await
        .expect("delete draft");
    assert!(deleted.deleted);

    assert_eq!(
        drafts.get("state-draft").await.expect("read deleted draft"),
        trellis_rs::client::StateGetResult::Missing { found: false }
    );
}

#[tokio::test]
async fn state_map_store_list_limit() {
    assert_case_registered("state.map-store-list-limit", "state", "state");

    let runtime =
        trellis_test::TrellisTestRuntime::start(trellis_test::TrellisTestRuntimeOptions::default())
            .await
            .expect("start live Trellis test runtime");
    let bootstrap_url = runtime
        .wait_for_bootstrap_url(Duration::from_secs(10))
        .await
        .expect("observe first admin bootstrap URL");
    let mut admin = runtime.admin();

    let contract = state_client_contract().expect("build state client test contract");

    let client = admin
        .connect_client(&bootstrap_url, &contract)
        .await
        .expect("connect live Rust state client");

    let drafts =
        trellis_rs::client::MapStateStore::<_, Draft>::new(&client, "drafts").prefix("limit-test");

    for i in 1..=5 {
        let result = drafts
            .put_with_options(
                &format!("entry-{i}"),
                &Draft {
                    title: format!("Entry {i}"),
                    body: "body".to_string(),
                },
                &trellis_rs::client::PutStateOptions {
                    expected_revision: trellis_rs::client::ExpectedPutRevision::CreateIfAbsent,
                    ..Default::default()
                },
            )
            .await
            .expect("create draft entry");
        assert!(result.applied);
    }

    let listed = drafts
        .list(&trellis_rs::client::ListStateOptions {
            limit: Some(2),
            ..Default::default()
        })
        .await
        .expect("list drafts");
    assert!(
        listed.entries.len() <= 2,
        "expected ≤ 2 entries, got {}",
        listed.entries.len()
    );
}

fn state_client_contract(
) -> Result<trellis_test::TrellisTestContract, trellis_test::TrellisTestError> {
    let manifest = trellis_rs::contracts::ContractManifestBuilder::new(
        "trellis.integration.state-client@v1",
        "Trellis Integration State Client",
        "Exercises generated contract-owned state store surfaces.",
        trellis_rs::contracts::ContractKind::App,
    )
    .schema(
        "Preferences",
        json!({
            "type": "object",
            "required": ["theme", "density"],
            "properties": {
                "theme": { "type": "string" },
                "density": { "type": "string" }
            }
        }),
    )
    .schema(
        "Draft",
        json!({
            "type": "object",
            "required": ["title", "body"],
            "properties": {
                "title": { "type": "string" },
                "body": { "type": "string" }
            }
        }),
    )
    .use_ref(
        "state",
        trellis_rs::contracts::use_contract("trellis.state@v1").with_rpc_call([
            "State.Get",
            "State.Put",
            "State.Delete",
            "State.List",
        ]),
    )
    .state(
        "preferences",
        trellis_rs::contracts::state(
            trellis_rs::contracts::ContractStateKind::Value,
            "Preferences",
        )
        .state_version("preferences.v1"),
    )
    .state(
        "drafts",
        trellis_rs::contracts::state(trellis_rs::contracts::ContractStateKind::Map, "Draft")
            .state_version("drafts.v1"),
    )
    .build()?;

    trellis_test::TrellisTestContract::from_manifest_value(serde_json::to_value(manifest)?)
}

async fn call_state_get_missing_with_retry(
    store: &trellis_rs::client::ValueStateStore<'_, trellis_rs::client::TrellisClient, Preferences>,
) -> trellis_rs::client::StateGetResult<trellis_rs::client::StateEntry<Preferences>> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match store.get().await {
            Ok(result) => return result,
            Err(error) if is_retryable_state_error(&error) && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("state get: {error}"),
        }
    }
}

fn is_retryable_state_error(error: &trellis_rs::client::TrellisClientError) -> bool {
    match error {
        trellis_rs::client::TrellisClientError::NatsRequest(message) => {
            message.contains("no responders") || message.contains("NoResponders")
        }
        trellis_rs::client::TrellisClientError::Timeout => true,
        _ => false,
    }
}
