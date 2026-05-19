use std::path::PathBuf;

use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_auth::{connect_admin_client_async, AdminLoginOutcome};
use trellis_client::{
    DeleteStateOptions, ExpectedPutRevision, ListStateOptions, MapStateStore, PutStateOptions,
    StateGetResult, TrellisClient, ValueStateStore,
};
use trellis_contracts::{
    digest_contract_json, state, use_contract, ContractKind, ContractManifestBuilder,
    ContractStateKind,
};
use trellis_sdk_state::client::StateClient as SdkStateClient;
use trellis_sdk_state::types::{
    StateAdminDeleteRequest, StateAdminGetRequest, StateAdminListRequest, StateDeleteRequest,
    StateGetRequest, StateListRequest, StatePutRequest,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::workspace::repo_root;

const HARNESS_CONTRACT_ID: &str = "trellis.integration-state-agent@v1";
const HARNESS_DENIED_CONTRACT_ID: &str = "trellis.integration-state-denied-agent@v1";
const PASSING_CASES: usize = 22;

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

const TS_STATE_SCRIPT: &str = r#"import { defineAgentContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as state } from "@qlever-llc/trellis/sdk/state";
import { Type } from "typebox";

const schemas = {
  Preferences: Type.Object({ theme: Type.String(), density: Type.String() }),
  Draft: Type.Object({ title: Type.String(), body: Type.String() }),
} as const;

const contract = defineAgentContract({ schemas }, (ref) => ({
  id: "trellis.integration-state-agent@v1",
  displayName: "Trellis Integration State Agent",
  description: "Verify Rust and TypeScript state facade parity against Trellis runtime state stores.",
  state: {
    preferences: { kind: "value", schema: ref.schema("Preferences"), stateVersion: "preferences.v1" },
    drafts: { kind: "map", schema: ref.schema("Draft"), stateVersion: "drafts.v1" },
  },
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
      state: state.use({ rpc: { call: ["State.Get", "State.Put", "State.Delete", "State.List", "State.Admin.Get", "State.Admin.List", "State.Admin.Delete"] } }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`state contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: {
    mode: "session_key",
    sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!,
    redirectTo: "/_trellis/portal/users/login",
  },
  log: false,
}).orThrow();

const missing = await client.state.preferences.get().orThrow();
if (!("found" in missing) || missing.found !== false) {
  throw new Error(`expected missing TS preferences: ${JSON.stringify(missing)}`);
}

const created = await client.state.preferences.put({ theme: "ts-dark", density: "comfortable" }, { expectedRevision: null }).orThrow();
if (!created.applied || !created.entry || created.entry.value.theme !== "ts-dark") {
  throw new Error(`expected TS preferences create: ${JSON.stringify(created)}`);
}

const found = await client.state.preferences.get().orThrow();
if (!("found" in found) || !found.found || found.entry.value.density !== "comfortable") {
  throw new Error(`expected TS preferences get: ${JSON.stringify(found)}`);
}

const deleted = await client.state.preferences.delete({ expectedRevision: created.entry.revision }).orThrow();
if (!deleted.deleted) throw new Error(`expected TS preferences delete: ${JSON.stringify(deleted)}`);

const drafts = client.state.drafts.prefix("inspection");
const draft = await drafts.put("ts-draft", { title: "TS Draft", body: "from TypeScript" }, { expectedRevision: null }).orThrow();
if (!draft.applied || !draft.entry || draft.entry.key !== "inspection/ts-draft") {
  throw new Error(`expected TS draft create: ${JSON.stringify(draft)}`);
}

const gotDraft = await drafts.get("ts-draft").orThrow();
if (!("found" in gotDraft) || !gotDraft.found || gotDraft.entry.value.title !== "TS Draft") {
  throw new Error(`expected TS draft get: ${JSON.stringify(gotDraft)}`);
}

const listed = await drafts.list().orThrow();
const listedDraft = listed.entries.find((entry) => !("migrationRequired" in entry) && entry.key === "inspection/ts-draft");
if (!listedDraft) throw new Error(`expected TS draft in list: ${JSON.stringify(listed)}`);

const deletedDraft = await drafts.delete("ts-draft", { expectedRevision: draft.entry.revision }).orThrow();
if (!deletedDraft.deleted) throw new Error(`expected TS draft delete: ${JSON.stringify(deletedDraft)}`);

const finalDraft = await drafts.get("ts-draft").orThrow();
if (!("found" in finalDraft) || finalDraft.found !== false) {
  throw new Error(`expected missing TS draft: ${JSON.stringify(finalDraft)}`);
}

await client.natsConnection.drain();
console.log("TS_STATE_OK");
"#;

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
        trellis_client::StateValue::Current(entry) => entry,
        trellis_client::StateValue::MigrationRequired(_) => {
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
        trellis_client::StateValue::Current(entry) => entry,
        trellis_client::StateValue::MigrationRequired(_) => {
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
        trellis_client::StateValue::Current(entry) if entry.key == "inspection/rust-draft" => {
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
        .state_get(&StateGetRequest {
            store: "preferences".to_string(),
            key: None,
        })
        .await
        .into_diagnostic()?;
    assert_found_false(&initial.0, "generated State.Get initial preferences")?;

    let created = sdk
        .state_put(&StatePutRequest {
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
        .state_get(&StateGetRequest {
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
        .state_put(&StatePutRequest {
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
        .state_put(&StatePutRequest {
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
        .state_list(&StateListRequest(json!({
            "store": "drafts",
            "prefix": "sdk",
            "offset": 0,
            "limit": 10
        })))
        .await
        .into_diagnostic()?;
    if !entries_include_key(&listed.0, "sdk/draft") {
        return Err(miette!(
            "generated State.List did not include draft: {}",
            listed.0
        ));
    }

    let admin_target = admin_user_target(login);
    let admin_found = sdk
        .state_admin_get(&StateAdminGetRequest(json!({
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
        .state_admin_list(&StateAdminListRequest(json!({
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
    if !entries_include_key(&admin_listed.0, "sdk/draft") {
        return Err(miette!(
            "generated State.Admin.List did not include draft: {}",
            admin_listed.0
        ));
    }

    let admin_deleted = sdk
        .state_admin_delete(&StateAdminDeleteRequest(json!({
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
        .state_admin_get(&StateAdminGetRequest(json!({
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
        .state_delete(&StateDeleteRequest {
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

fn entries_include_key(value: &Value, key: &str) -> bool {
    value
        .pointer("/entries")
        .and_then(Value::as_array)
        .is_some_and(|entries| {
            entries
                .iter()
                .any(|entry| entry.get("key") == Some(&json!(key)))
        })
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
    let script_path = write_ts_fixture_script("state", TS_STATE_SCRIPT)?;
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
    match trellis_auth::start_admin_reauth(&admin_login.state, &contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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
    state: &trellis_auth::AdminSessionState,
    contract_json: &str,
    trellis_url: &str,
    browser: &BrowserContainer,
) -> Result<AdminLoginOutcome> {
    match trellis_auth::start_admin_reauth(state, contract_json)
        .await
        .into_diagnostic()?
    {
        trellis_auth::AdminReauthOutcome::Bound(outcome) => Ok(outcome),
        trellis_auth::AdminReauthOutcome::Flow(challenge) => {
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

fn write_ts_fixture_script(name: &str, contents: &str) -> Result<PathBuf> {
    let path = std::env::temp_dir().join(format!(
        "trellis-integration-{name}-{}-{}.ts",
        std::process::id(),
        unique_suffix()
    ));
    std::fs::write(&path, contents)
        .into_diagnostic()
        .map_err(|error| {
            miette!(
                "failed to write TS state fixture script {}: {error}",
                path.display()
            )
        })?;
    Ok(path)
}

fn unique_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}
