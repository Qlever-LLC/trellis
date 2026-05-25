use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis::auth::{connect_admin_client_async, AdminLoginOutcome};
use trellis::client::{
    DeleteStateOptions, ExpectedPutRevision, ListStateOptions, MapStateStore, PutStateOptions,
    StateGetResult, TrellisClient, ValueStateStore,
};
use trellis::contracts::{
    digest_contract_json, state, use_contract, ContractKind, ContractManifestBuilder,
    ContractStateKind,
};
use trellis::sdk::state::client::StateClient as SdkStateClient;
use trellis::sdk::state::types::{
    StateAdminDeleteRequest, StateAdminGetRequest, StateAdminListRequest, StateDeleteRequest,
    StateGetRequest, StateListRequest, StatePutRequest,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::deno_fixture::deno_fixture_path;
use crate::workspace::repo_root;

const HARNESS_CONTRACT_ID: &str = "trellis.integration-state-agent@v1";
const HARNESS_DENIED_CONTRACT_ID: &str = "trellis.integration-state-denied-agent@v1";
const PASSING_CASES: usize = 23;

fn harness_state_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration State Agent",
        "Verify Rust and TypeScript state facade parity against Trellis runtime state stores.",
        ContractKind::Agent,
    )
    .schema("Preferences", preferences_schema())
    .schema("Draft", draft_schema())
    .state(
        "preferences",
        state(ContractStateKind::Value, "Preferences").state_version("preferences.v1"),
    )
    .state(
        "drafts",
        state(ContractStateKind::Map, "Draft").state_version("drafts.v1"),
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "state",
        use_contract("trellis.state@v1").with_rpc_call([
            "State.Get",
            "State.Put",
            "State.Delete",
            "State.List",
            "State.Admin.Get",
            "State.Admin.List",
            "State.Admin.Delete",
        ]),
    )
    .build()
    .map_err(|error| miette!("failed to build state harness contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize state harness contract: {error}"))
}

fn harness_denied_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        HARNESS_DENIED_CONTRACT_ID,
        "Trellis Integration State Denied Agent",
        "Verify state store access is denied when the active contract declares no stores.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "state",
        use_contract("trellis.state@v1").with_rpc_call([
            "State.Get",
            "State.Put",
            "State.Delete",
            "State.List",
        ]),
    )
    .build()
    .map_err(|error| miette!("failed to build denied state harness contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize denied state harness contract: {error}"))
}

fn preferences_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "theme": { "type": "string" },
            "density": { "type": "string" }
        },
        "required": ["theme", "density"]
    })
}

fn draft_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "title": { "type": "string" },
            "body": { "type": "string" }
        },
        "required": ["title", "body"]
    })
}

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

pub(crate) async fn run_state_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let caller_contract_json = harness_state_contract_json()?;
    let caller_login = reauth_contract(
        &setup_login.state,
        &caller_contract_json,
        trellis_url,
        browser,
    )
    .await?;
    {
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;

        assert_rust_value_state(&caller_client)
            .await
            .map_err(|error| miette!("Rust value state case failed: {error}"))?;
        assert_rust_map_state(&caller_client)
            .await
            .map_err(|error| miette!("Rust map state case failed: {error}"))?;
        assert_generated_state_sdk(&caller_client, &caller_login)
            .await
            .map_err(|error| miette!("generated Rust state SDK case failed: {error}"))?;
    }

    run_ts_state_client(trellis_url, &caller_login.state.session_seed)
        .await
        .map_err(|error| miette!("TypeScript state case failed: {error}"))?;

    let denied_login = reauth_contract(
        &caller_login.state,
        &harness_denied_contract_json()?,
        trellis_url,
        browser,
    )
    .await?;
    let denied_client = connect_admin_client_async(&denied_login.state)
        .await
        .into_diagnostic()?;
    assert_state_store_declaration_denied(&denied_client)
        .await
        .map_err(|error| miette!("state declaration denial case failed: {error}"))?;

    Ok(PASSING_CASES)
}

async fn assert_rust_value_state(client: &TrellisClient) -> Result<()> {
    let store = ValueStateStore::<_, Preferences>::new(client, "preferences");
    let initial = store.get().await.into_diagnostic()?;
    if !matches!(initial, StateGetResult::Missing { found: false }) {
        return Err(miette!("expected missing initial preferences: {initial:?}"));
    }

    let created = store
        .put_with_options(
            &Preferences {
                theme: "rust-dark".to_string(),
                density: "compact".to_string(),
            },
            &PutStateOptions {
                ttl_ms: None,
                expected_revision: ExpectedPutRevision::CreateIfAbsent,
            },
        )
        .await
        .into_diagnostic()?;
    if !created.applied {
        return Err(miette!(
            "unexpected preferences create response: {created:?}"
        ));
    }
    let created_entry = created
        .entry
        .ok_or_else(|| miette!("preferences create response did not include entry"))?;
    let created_entry = match created_entry {
        trellis::client::StateValue::Current(entry) => entry,
        trellis::client::StateValue::MigrationRequired(_) => {
            return Err(miette!(
                "preferences create unexpectedly required migration"
            ));
        }
    };
    if created_entry.value.theme != "rust-dark" {
        return Err(miette!(
            "unexpected preferences create entry: {created_entry:?}"
        ));
    }

    let found = store.get().await.into_diagnostic()?;
    let found_entry = match found {
        StateGetResult::Found { entry, .. } => entry,
        other => return Err(miette!("expected found preferences: {other:?}")),
    };
    if found_entry.value.density != "compact" {
        return Err(miette!("unexpected preferences value: {found_entry:?}"));
    }

    let stale = store
        .put_with_options(
            &Preferences {
                theme: "rust-light".to_string(),
                density: "comfortable".to_string(),
            },
            &PutStateOptions {
                ttl_ms: None,
                expected_revision: ExpectedPutRevision::Revision("stale-revision".to_string()),
            },
        )
        .await
        .into_diagnostic()?;
    if stale.applied || stale.found != Some(true) {
        return Err(miette!(
            "expected stale preferences put rejection: {stale:?}"
        ));
    }

    let deleted = store
        .delete_with_options(&DeleteStateOptions {
            expected_revision: Some(created_entry.revision),
        })
        .await
        .into_diagnostic()?;
    if !deleted.deleted {
        return Err(miette!("expected preferences delete: {deleted:?}"));
    }

    let final_get = store.get().await.into_diagnostic()?;
    if !matches!(final_get, StateGetResult::Missing { found: false }) {
        return Err(miette!("expected missing final preferences: {final_get:?}"));
    }

    let expiring = store
        .put_with_options(
            &Preferences {
                theme: "rust-expiring".to_string(),
                density: "temporary".to_string(),
            },
            &PutStateOptions {
                ttl_ms: Some(250),
                expected_revision: ExpectedPutRevision::CreateIfAbsent,
            },
        )
        .await
        .into_diagnostic()?;
    if !expiring.applied {
        return Err(miette!(
            "unexpected expiring preferences create response: {expiring:?}"
        ));
    }
    tokio::time::sleep(std::time::Duration::from_millis(750)).await;
    let expired = store.get().await.into_diagnostic()?;
    if !matches!(expired, StateGetResult::Missing { found: false }) {
        return Err(miette!(
            "expected expired preferences to be missing: {expired:?}"
        ));
    }
    Ok(())
}

async fn assert_rust_map_state(client: &TrellisClient) -> Result<()> {
    let drafts = MapStateStore::<_, Draft>::new(client, "drafts").prefix("inspection");
    let created = drafts
        .put_with_options(
            "rust-draft",
            &Draft {
                title: "Rust Draft".to_string(),
                body: "from Rust".to_string(),
            },
            &PutStateOptions {
                ttl_ms: None,
                expected_revision: ExpectedPutRevision::CreateIfAbsent,
            },
        )
        .await
        .into_diagnostic()?;
    if !created.applied {
        return Err(miette!("unexpected draft create response: {created:?}"));
    }
    let created_entry = created
        .entry
        .ok_or_else(|| miette!("draft create response did not include entry"))?;
    let created_entry = match created_entry {
        trellis::client::StateValue::Current(entry) => entry,
        trellis::client::StateValue::MigrationRequired(_) => {
            return Err(miette!("draft create unexpectedly required migration"));
        }
    };
    if created_entry.key != "inspection/rust-draft" {
        return Err(miette!("unexpected draft create entry: {created_entry:?}"));
    }

    let found = drafts.get("rust-draft").await.into_diagnostic()?;
    let found_entry = match found {
        StateGetResult::Found { entry, .. } => entry,
        other => return Err(miette!("expected found draft: {other:?}")),
    };
    if found_entry.value.title != "Rust Draft" {
        return Err(miette!("unexpected draft value: {found_entry:?}"));
    }

    let listed = drafts
        .list(&ListStateOptions {
            offset: None,
            limit: Some(10),
        })
        .await
        .into_diagnostic()?;
    let listed_entry = listed.entries.iter().find_map(|entry| match entry {
        trellis::client::StateValue::Current(entry) if entry.key == "inspection/rust-draft" => {
            Some(entry)
        }
        _ => None,
    });
    if listed_entry.is_none() {
        return Err(miette!("expected draft in prefix list: {listed:?}"));
    }

    let deleted = drafts
        .delete_with_options(
            "rust-draft",
            &DeleteStateOptions {
                expected_revision: Some(created_entry.revision),
            },
        )
        .await
        .into_diagnostic()?;
    if !deleted.deleted {
        return Err(miette!("expected draft delete: {deleted:?}"));
    }

    let final_get = drafts.get("rust-draft").await.into_diagnostic()?;
    if !matches!(final_get, StateGetResult::Missing { found: false }) {
        return Err(miette!("expected missing final draft: {final_get:?}"));
    }
    Ok(())
}

async fn assert_state_store_declaration_denied(client: &TrellisClient) -> Result<()> {
    let store = ValueStateStore::<_, Preferences>::new(client, "preferences");
    if store.get().await.is_ok() {
        return Err(miette!(
            "preferences get unexpectedly succeeded for contract without state declarations"
        ));
    }
    Ok(())
}

async fn assert_generated_state_sdk(
    client: &TrellisClient,
    login: &AdminLoginOutcome,
) -> Result<()> {
    let sdk = SdkStateClient::new(client);
    let initial = sdk
        .rpc()
        .state()
        .get(&StateGetRequest {
            store: "preferences".to_string(),
            key: None,
        })
        .await
        .into_diagnostic()?;
    assert_found_false(&initial.0, "generated State.Get initial preferences")?;

    let created = sdk
        .rpc()
        .state()
        .put(&StatePutRequest {
            store: "preferences".to_string(),
            key: None,
            value: json!({ "theme": "sdk-dark", "density": "roomy" }),
            ttl_ms: None,
            expected_revision: Some(Value::Null),
        })
        .await
        .into_diagnostic()?;
    let created_revision = current_revision(&created.0, "generated State.Put preferences")?;

    let found = sdk
        .rpc()
        .state()
        .get(&StateGetRequest {
            store: "preferences".to_string(),
            key: None,
        })
        .await
        .into_diagnostic()?;
    if found.0.pointer("/entry/value/theme") != Some(&json!("sdk-dark")) {
        return Err(miette!(
            "generated State.Get returned unexpected preferences: {}",
            found.0
        ));
    }

    let stale = sdk
        .rpc()
        .state()
        .put(&StatePutRequest {
            store: "preferences".to_string(),
            key: None,
            value: json!({ "theme": "sdk-light", "density": "compact" }),
            ttl_ms: None,
            expected_revision: Some(json!("stale-revision")),
        })
        .await
        .into_diagnostic()?;
    if stale.0.get("applied") != Some(&json!(false)) || stale.0.get("found") != Some(&json!(true)) {
        return Err(miette!(
            "expected generated State.Put stale revision rejection: {}",
            stale.0
        ));
    }

    let draft = sdk
        .rpc()
        .state()
        .put(&StatePutRequest {
            store: "drafts".to_string(),
            key: Some("sdk/draft".to_string()),
            value: json!({ "title": "SDK Draft", "body": "from generated Rust SDK" }),
            ttl_ms: None,
            expected_revision: Some(Value::Null),
        })
        .await
        .into_diagnostic()?;
    let draft_revision = current_revision(&draft.0, "generated State.Put draft")?;

    let listed = sdk
        .rpc()
        .state()
        .list(&StateListRequest {
            store: "drafts".to_string(),
            prefix: Some("sdk".to_string()),
            offset: Some(0),
            limit: 10,
        })
        .await
        .into_diagnostic()?;
    if !entries_include_key(&listed.entries, "sdk/draft") {
        return Err(miette!(
            "generated State.List did not include draft: {:?}",
            listed.entries
        ));
    }

    let admin_target = admin_user_target(login);
    let admin_found = sdk
        .rpc()
        .state()
        .admin_get(&StateAdminGetRequest(json!({
            "scope": "userApp",
            "contractId": HARNESS_CONTRACT_ID,
            "contractDigest": caller_contract_digest()?,
            "store": "drafts",
            "user": admin_target,
            "key": "sdk/draft"
        })))
        .await
        .into_diagnostic()?;
    if admin_found.0.pointer("/entry/value/title") != Some(&json!("SDK Draft")) {
        return Err(miette!(
            "generated State.Admin.Get returned unexpected draft: {}",
            admin_found.0
        ));
    }

    let admin_listed = sdk
        .rpc()
        .state()
        .admin_list(&StateAdminListRequest(json!({
            "scope": "userApp",
            "contractId": HARNESS_CONTRACT_ID,
            "contractDigest": caller_contract_digest()?,
            "store": "drafts",
            "user": admin_user_target(login),
            "prefix": "sdk",
            "offset": 0,
            "limit": 10
        })))
        .await
        .into_diagnostic()?;
    if !entries_include_key(&admin_listed.entries, "sdk/draft") {
        return Err(miette!(
            "generated State.Admin.List did not include draft: {:?}",
            admin_listed.entries
        ));
    }

    let admin_deleted = sdk
        .rpc()
        .state()
        .admin_delete(&StateAdminDeleteRequest(json!({
            "scope": "userApp",
            "contractId": HARNESS_CONTRACT_ID,
            "contractDigest": caller_contract_digest()?,
            "store": "drafts",
            "user": admin_user_target(login),
            "key": "sdk/draft",
            "expectedRevision": draft_revision
        })))
        .await
        .into_diagnostic()?;
    if !admin_deleted.deleted {
        return Err(miette!("generated State.Admin.Delete did not delete draft"));
    }

    let admin_missing = sdk
        .rpc()
        .state()
        .admin_get(&StateAdminGetRequest(json!({
            "scope": "userApp",
            "contractId": HARNESS_CONTRACT_ID,
            "contractDigest": caller_contract_digest()?,
            "store": "drafts",
            "user": admin_user_target(login),
            "key": "sdk/draft"
        })))
        .await
        .into_diagnostic()?;
    assert_found_false(&admin_missing.0, "generated State.Admin.Get deleted draft")?;

    let deleted = sdk
        .rpc()
        .state()
        .delete(&StateDeleteRequest {
            store: "preferences".to_string(),
            key: None,
            expected_revision: Some(created_revision),
        })
        .await
        .into_diagnostic()?;
    if !deleted.deleted {
        return Err(miette!("generated State.Delete did not delete preferences"));
    }

    Ok(())
}

fn assert_found_false(value: &Value, label: &str) -> Result<()> {
    if value.get("found") != Some(&json!(false)) {
        return Err(miette!("expected {label} to be missing: {value}"));
    }
    Ok(())
}

fn current_revision(value: &Value, label: &str) -> Result<String> {
    value
        .pointer("/entry/revision")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| miette!("{label} did not include current entry revision: {value}"))
}

fn entries_include_key(entries: &[Value], key: &str) -> bool {
    entries
        .iter()
        .any(|entry| entry.get("key") == Some(&json!(key)))
}

fn admin_user_target(login: &AdminLoginOutcome) -> Value {
    json!({
        "origin": login.user.identity.provider,
        "id": login.user.identity.subject,
        "userId": login.user.user_id,
    })
}

async fn run_ts_state_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = deno_fixture_path("state/state.ts")?;
    let output = std::process::Command::new("deno")
        .arg("run")
        .arg("-c")
        .arg(repo.join("js/deno.json"))
        .arg("--allow-env")
        .arg("--allow-sys")
        .arg("--allow-net")
        .arg("--allow-read")
        .arg(&script_path)
        .current_dir(repo.join("js"))
        .env("TRELLIS_URL", trellis_url)
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_contract_digest()?)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS state fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS state fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_STATE_OK") {
        return Err(miette!("TS state fixture did not report success: {stdout}"));
    }
    Ok(())
}

async fn reauth_admin_setup(
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    let contract_json = admin_setup_contract_json()?;
    match trellis::auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge
                .complete(&admin_login.state.trellis_url)
                .await
                .into_diagnostic()
        }
    }
}

async fn reauth_contract(
    state: &trellis::auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis::auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis::auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis::auth::AdminReauthOutcome::Flow(challenge) => {
            let login_url = challenge.login_url().to_string();
            let driver = browser.driver().await?;
            let login_result =
                complete_local_login(&driver, &login_url, "admin", "trellis-admin-password").await;
            let quit_result = driver
                .quit()
                .await
                .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
            login_result?;
            quit_result?;
            challenge.complete(trellis_url).await.into_diagnostic()
        }
    }
}

fn caller_contract_digest() -> Result<String> {
    digest_contract_json(&harness_state_contract_json()?).into_diagnostic()
}
