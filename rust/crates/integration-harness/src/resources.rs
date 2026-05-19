use std::collections::BTreeMap;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_auth::{
    connect_admin_client_async, generate_session_keypair, AdminLoginOutcome, AdminSessionState,
};
use trellis_auth_adapters::AuthRequestValidatorAdapter;
use trellis_client::{ServiceConnectOptions, TrellisClient, TrellisClientError};
use trellis_contracts::{
    digest_contract_json, kv, rpc, store, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis_core_bootstrap::CoreBootstrapBinding;
use trellis_sdk_auth::client::AuthClient as SdkAuthClient;
use trellis_sdk_auth::types::AuthEnvelopesExpandRequest;
use trellis_sdk_core::types::TrellisBindingsGetResponseBinding;
use trellis_service::{
    ConnectedService, KvResourceEntry, KvResourceHandle, KvResourceOperation, NatsKvResourceClient,
    NatsStoreResourceClient, RequestValidator, Router, ServerError, StoreResourceHandle,
    StoreWaitOptions,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::workspace::repo_root;

const PASSING_CASES: usize = 4;
const HARNESS_DEPLOYMENT_ID: &str = "harness.resources";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.resources@v1";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-resources-rust";
const HARNESS_RUST_SUBJECT: &str = "rpc.v1.Harness.Rust.Resources";
const HARNESS_TS_SUBJECT: &str = "rpc.v1.Harness.Ts.Resources";

pub(crate) fn harness_service_contract_json() -> Result<String> {
    harness_service_contract_json_with_store_limits(0, 4_194_304)
}

fn stale_harness_service_contract_json() -> Result<String> {
    harness_service_contract_json_with_store_limits(60_000, 4_096)
}

fn harness_service_contract_json_with_store_limits(
    store_ttl_ms: i64,
    max_total_bytes: i64,
) -> Result<String> {
    let input_schema = json!({
        "type": "object",
        "properties": {
            "key": { "type": "string" },
            "message": { "type": "string" }
        },
        "required": ["key", "message"]
    });
    let output_schema = json!({
        "type": "object",
        "properties": {
            "provider": { "type": "string" },
            "storeText": { "type": "string" },
            "kvMessage": { "type": "string" }
        },
        "required": ["provider", "storeText", "kvMessage"]
    });
    let record_schema = json!({
        "type": "object",
        "properties": {
            "message": { "type": "string" }
        },
        "required": ["message"]
    });

    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Resources",
        "Harness-owned service contract for service-bound resource lifecycle verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("ResourceExerciseInput", input_schema)
    .schema("ResourceExerciseOutput", output_schema)
    .schema("ResourceRecord", record_schema)
    .kv_resource(
        "records",
        kv("Store harness resource lifecycle records", "ResourceRecord")
            .required(true)
            .history(1)
            .ttl_ms(0),
    )
    .store_resource(
        "blobs",
        store("Store harness resource lifecycle blobs")
            .required(true)
            .ttl_ms(store_ttl_ms)
            .max_object_bytes(1_048_576)
            .max_total_bytes(max_total_bytes),
    )
    .rpc(
        "Harness.Rust.Resources",
        rpc(
            "v1",
            HARNESS_RUST_SUBJECT,
            "ResourceExerciseInput",
            "ResourceExerciseOutput",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .rpc(
        "Harness.Ts.Resources",
        rpc(
            "v1",
            HARNESS_TS_SUBJECT,
            "ResourceExerciseInput",
            "ResourceExerciseOutput",
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_error_types(["UnexpectedError"]),
    )
    .build()
    .map_err(|error| miette!("failed to build resources harness service contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize resources harness service contract: {error}"))
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-resources-agent@v1",
        "Trellis Integration Resources Agent",
        "Verify delegated Rust agent login and harness resource calls.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_rpc_call(["Harness.Rust.Resources", "Harness.Ts.Resources"]),
    )
    .build()
    .map_err(|error| miette!("failed to build resources harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize resources harness caller contract: {error}"))
}

const TS_SERVICE_SCRIPT: &str = r#"import { defineServiceContract, ok, TypedKVEntry } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  ResourceExerciseInput: Type.Object({ key: Type.String(), message: Type.String() }),
  ResourceExerciseOutput: Type.Object({ provider: Type.String(), storeText: Type.String(), kvMessage: Type.String() }),
  ResourceRecord: Type.Object({ message: Type.String() }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.resources@v1",
  displayName: "Trellis Integration Harness Resources",
  description: "Harness-owned service contract for service-bound resource lifecycle verification.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    },
  },
  resources: {
    kv: {
      records: { purpose: "Store harness resource lifecycle records", schema: ref.schema("ResourceRecord"), required: true, history: 1, ttlMs: 0 },
    },
    store: {
      blobs: { purpose: "Store harness resource lifecycle blobs", required: true, ttlMs: 0, maxObjectBytes: 1048576, maxTotalBytes: 4194304 },
    },
  },
  rpc: {
    "Harness.Rust.Resources": { version: "v1", subject: "rpc.v1.Harness.Rust.Resources", input: ref.schema("ResourceExerciseInput"), output: ref.schema("ResourceExerciseOutput"), capabilities: { call: [] }, errors: [ref.error("UnexpectedError")] },
    "Harness.Ts.Resources": { version: "v1", subject: "rpc.v1.Harness.Ts.Resources", input: ref.schema("ResourceExerciseInput"), output: ref.schema("ResourceExerciseOutput"), capabilities: { call: [] }, errors: [ref.error("UnexpectedError")] },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-resources-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: false },
}).orThrow();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
    totalLength += next.value.length;
  }
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function waitForCondition(condition: () => boolean, description: string): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > 5000) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

await service.trellis.mount("Harness.Ts.Resources", async ({ input, trellis }) => {
  const store = await trellis.store.blobs.open().orThrow();
  const storeKey = `${input.key}.ts.store`;
  const typedWaitKey = `${input.key}.ts.typed-wait`;
  const delayedWaitKey = `${input.key}.ts.delayed-wait`;
  const storeText = `ts-store:${input.message}`;
  await store.create(storeKey, encoder.encode(storeText), { contentType: "text/plain" }).orThrow();
  const duplicate = await store.create(storeKey, encoder.encode("duplicate"));
  if (duplicate.isOk()) throw new Error(`store create unexpectedly overwrote ${storeKey}`);
  const handleEntry = await trellis.store.blobs.waitFor(storeKey, { timeoutMs: 5000, pollIntervalMs: 25 }).orThrow();
  if (handleEntry.info.contentType !== "text/plain") throw new Error(`store content type did not round-trip for ${storeKey}`);
  const readText = decoder.decode(await handleEntry.bytes().orThrow());
  const streamText = decoder.decode(await readAll(await handleEntry.stream().orThrow()));
  if (streamText !== readText) throw new Error(`store stream returned ${streamText} instead of ${readText}`);
  await store.put(typedWaitKey, encoder.encode("typed-wait"), { contentType: "text/plain" }).orThrow();
  await store.waitFor(typedWaitKey, { timeoutMs: 5000, pollIntervalMs: 25 }).orThrow();
  const delayedWait = store.waitFor(delayedWaitKey, { timeoutMs: 5000, pollIntervalMs: 25 }).orThrow();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await store.put(delayedWaitKey, encoder.encode("delayed"), { contentType: "text/plain", metadata: { source: "harness" } }).orThrow();
  const delayedEntry = await delayedWait;
  if (delayedEntry.info.metadata.source !== "harness") throw new Error(`store metadata did not round-trip for ${delayedWaitKey}`);
  if (decoder.decode(await delayedEntry.bytes().orThrow()) !== "delayed") throw new Error(`delayed wait returned unexpected bytes for ${delayedWaitKey}`);
  const typedTimeout = await store.waitFor(`${input.key}.ts.typed-timeout`, { timeoutMs: 25, pollIntervalMs: 5 });
  if (typedTimeout.isOk()) throw new Error("TypedStore.waitFor unexpectedly succeeded for missing object");
  if (typedTimeout.error.getContext().reason !== "timeout") throw new Error(`TypedStore.waitFor returned unexpected timeout context: ${JSON.stringify(typedTimeout.error.getContext())}`);
  const typedAbortController = new AbortController();
  const typedAborted = store.waitFor(`${input.key}.ts.typed-abort`, { signal: typedAbortController.signal, pollIntervalMs: 5000 });
  typedAbortController.abort("cancelled");
  const typedAbortResult = await typedAborted;
  if (typedAbortResult.isOk()) throw new Error("TypedStore.waitFor unexpectedly succeeded after abort");
  if (typedAbortResult.error.getContext().reason !== "aborted") throw new Error(`TypedStore.waitFor returned unexpected abort context: ${JSON.stringify(typedAbortResult.error.getContext())}`);
  const handleAbortController = new AbortController();
  const handleAborted = trellis.store.blobs.waitFor(`${input.key}.ts.handle-abort`, { signal: handleAbortController.signal, pollIntervalMs: 5000 });
  handleAbortController.abort("cancelled");
  const handleAbortResult = await handleAborted;
  if (handleAbortResult.isOk()) throw new Error("StoreHandle.waitFor unexpectedly succeeded after abort");
  if (handleAbortResult.error.getContext().reason !== "aborted") throw new Error(`StoreHandle.waitFor returned unexpected abort context: ${JSON.stringify(handleAbortResult.error.getContext())}`);
  const status = await store.status().orThrow();
  if (status.ttlMs !== 0 || status.maxTotalBytes !== 4194304) throw new Error(`store status did not include configured limits: ${JSON.stringify(status)}`);
  const listed = await store.list({ prefix: input.key, limit: 10 }).orThrow();
  if (!listed.some((entry) => entry.key === storeKey)) throw new Error(`store list did not include ${storeKey}`);
  await store.delete(storeKey).orThrow();
  await store.delete(typedWaitKey).orThrow();
  await store.delete(delayedWaitKey).orThrow();
  const missing = await store.get(storeKey);
  if (missing.isOk()) throw new Error(`store get unexpectedly found deleted object ${storeKey}`);
  if (missing.error.getContext().reason !== "not_found") throw new Error(`store get returned unexpected missing context: ${JSON.stringify(missing.error.getContext())}`);

  const kvKey = `${input.key}.ts.kv`;
  await trellis.kv.records.create(kvKey, { message: input.message }).orThrow();
  await trellis.kv.records.put(kvKey, { message: `ts-kv:${input.message}` }).orThrow();
  const entry = await trellis.kv.records.get(kvKey).orThrow();
  const updateEvents: Array<{ type: string; value?: { message: string } }> = [];
  const unsubscribeUpdates = await entry.watch((event) => {
    updateEvents.push(event);
  }, { includeDeletes: true });
  await entry.put({ message: `ts-kv-watch:${input.message}` }).orThrow();
  await waitForCondition(() => updateEvents.some((event) => event.type === "update" && event.value?.message === `ts-kv-watch:${input.message}`), "typed KV update watch event");
  await entry.delete().orThrow();
  await waitForCondition(() => updateEvents.some((event) => event.type === "delete"), "typed KV delete watch event");
  const eventsBeforeUnsubscribe = updateEvents.length;
  unsubscribeUpdates();
  await trellis.kv.records.put(kvKey, { message: "after-unsubscribe" }).orThrow();
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (updateEvents.length !== eventsBeforeUnsubscribe) throw new Error("TypedKVEntry.watch emitted after unsubscribe");

  const invalidGetKey = `${input.key}.ts.invalid-get`;
  await trellis.kv.records.kv.put(invalidGetKey, JSON.stringify({ missing: "message" }));
  const invalidGet = await trellis.kv.records.get(invalidGetKey);
  if (invalidGet.isOk()) throw new Error("TypedKV.get unexpectedly accepted invalid raw entry");
  if (!(await trellis.kv.records.kv.get(invalidGetKey))) throw new Error("TypedKV.get removed invalid raw entry");

  const invalidCreateKey = `${input.key}.ts.invalid-create`;
  await trellis.kv.records.kv.put(invalidCreateKey, JSON.stringify({ missing: "message" }));
  const invalidRawEntry = await trellis.kv.records.kv.get(invalidCreateKey);
  if (!invalidRawEntry) throw new Error("raw invalid create entry was not written");
  const invalidCreate = await TypedKVEntry.create(schemas.ResourceRecord, trellis.kv.records.kv, invalidRawEntry);
  if (invalidCreate.isOk()) throw new Error("TypedKVEntry.create unexpectedly accepted invalid raw entry");
  if (!(await trellis.kv.records.kv.get(invalidCreateKey))) throw new Error("TypedKVEntry.create removed invalid raw entry");

  const invalidWatchKey = `${input.key}.ts.invalid-watch`;
  await trellis.kv.records.create(invalidWatchKey, { message: "valid" }).orThrow();
  const invalidWatchEntry = await trellis.kv.records.get(invalidWatchKey).orThrow();
  const invalidEvents: Array<{ type: string }> = [];
  const unsubscribeInvalid = await invalidWatchEntry.watch((event) => {
    invalidEvents.push(event);
  }, { includeDeletes: true });
  await trellis.kv.records.kv.put(invalidWatchKey, JSON.stringify({ missing: "message" }));
  await waitForCondition(() => invalidEvents.some((event) => event.type === "error"), "typed KV invalid watch event");
  if (!(await trellis.kv.records.kv.get(invalidWatchKey))) throw new Error("TypedKV.watch removed invalid raw entry");
  unsubscribeInvalid();

  const staleCasKey = `${input.key}.ts.cas-stale`;
  await trellis.kv.records.create(staleCasKey, { message: "initial" }).orThrow();
  const staleCasEntry = await trellis.kv.records.get(staleCasKey).orThrow();
  await trellis.kv.records.put(staleCasKey, { message: "updated" }).orThrow();
  const staleDelete = await staleCasEntry.delete(true);
  if (staleDelete.isOk()) throw new Error("TypedKVEntry.delete(vcc) unexpectedly succeeded with stale revision");

  const casKey = `${input.key}.ts.cas-delete`;
  await trellis.kv.records.create(casKey, { message: "initial" }).orThrow();
  const casEntry = await trellis.kv.records.get(casKey).orThrow();
  await casEntry.delete(true).orThrow();
  const secondCasDelete = await casEntry.delete(true);
  if (secondCasDelete.isOk()) throw new Error("TypedKVEntry.delete(vcc) unexpectedly reused stale delete revision");

  let foundKey = false;
  for await (const key of await trellis.kv.records.keys(`${input.key}.>`).orThrow()) {
    if (key === kvKey) foundKey = true;
  }
  if (!foundKey) throw new Error(`kv keys did not include ${kvKey}`);
  await trellis.kv.records.delete(kvKey).orThrow();
  await trellis.kv.records.delete(invalidGetKey).orThrow();
  await trellis.kv.records.delete(invalidCreateKey).orThrow();
  await trellis.kv.records.delete(invalidWatchKey).orThrow();
  await trellis.kv.records.delete(staleCasKey).orThrow();

  return ok({ provider: "ts", storeText: readText, kvMessage: entry.value.message });
});

console.log("TS_RESOURCES_SERVICE_READY");
await new Promise<void>(() => {});
"#;

const TS_CLIENT_SCRIPT: &str = r#"import { defineAgentContract, defineServiceContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

const schemas = {
  ResourceExerciseInput: Type.Object({ key: Type.String(), message: Type.String() }),
  ResourceExerciseOutput: Type.Object({ provider: Type.String(), storeText: Type.String(), kvMessage: Type.String() }),
  ResourceRecord: Type.Object({ message: Type.String() }),
} as const;

const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.resources@v1",
  displayName: "Trellis Integration Harness Resources",
  description: "Harness-owned service contract for service-bound resource lifecycle verification.",
  uses: { required: { auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }) } },
  resources: {
    kv: { records: { purpose: "Store harness resource lifecycle records", schema: ref.schema("ResourceRecord"), required: true, history: 1, ttlMs: 0 } },
    store: { blobs: { purpose: "Store harness resource lifecycle blobs", required: true, ttlMs: 0, maxObjectBytes: 1048576, maxTotalBytes: 4194304 } },
  },
  rpc: {
    "Harness.Rust.Resources": { version: "v1", subject: "rpc.v1.Harness.Rust.Resources", input: ref.schema("ResourceExerciseInput"), output: ref.schema("ResourceExerciseOutput"), capabilities: { call: [] }, errors: [ref.error("UnexpectedError")] },
    "Harness.Ts.Resources": { version: "v1", subject: "rpc.v1.Harness.Ts.Resources", input: ref.schema("ResourceExerciseInput"), output: ref.schema("ResourceExerciseOutput"), capabilities: { call: [] }, errors: [ref.error("UnexpectedError")] },
  },
}));

const contract = defineAgentContract(() => ({
  id: "trellis.integration-resources-agent@v1",
  displayName: "Trellis Integration Resources Agent",
  description: "Verify delegated Rust agent login and harness resource calls.",
  uses: {
    required: {
      auth: auth.use({ rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] } }),
      harness: harness.use({ rpc: { call: ["Harness.Rust.Resources", "Harness.Ts.Resources"] } }),
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const client = await TrellisClient.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  auth: { mode: "session_key", sessionKeySeed: Deno.env.get("HARNESS_CALLER_SESSION_SEED")!, redirectTo: "/_trellis/portal/users/login" },
  log: false,
}).orThrow();

async function assertResourceRpc(method: "Harness.Rust.Resources" | "Harness.Ts.Resources", provider: "rust" | "ts", key: string, message: string) {
  const output = await client.request(method, { key, message }).orThrow();
  if (output.provider !== provider) throw new Error(`${method} provider mismatch: ${JSON.stringify(output)}`);
  if (output.storeText !== `${provider}-store:${message}`) throw new Error(`${method} store mismatch: ${JSON.stringify(output)}`);
  if (output.kvMessage !== `${provider}-kv:${message}`) throw new Error(`${method} kv mismatch: ${JSON.stringify(output)}`);
}

await assertResourceRpc("Harness.Rust.Resources", "rust", "ts-client.rust-provider", "ts to rust resources");
await assertResourceRpc("Harness.Ts.Resources", "ts", "ts-client.ts-provider", "ts to ts resources");
await client.natsConnection.drain();
console.log("TS_RESOURCES_CLIENT_OK");
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceExerciseInput {
    key: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ResourceExerciseOutput {
    provider: String,
    store_text: String,
    kv_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ResourceRecord {
    message: String,
}

struct HarnessRustResourcesRpc;

impl trellis_client::RpcDescriptor for HarnessRustResourcesRpc {
    type Input = ResourceExerciseInput;
    type Output = ResourceExerciseOutput;

    const KEY: &'static str = "Harness.Rust.Resources";
    const SUBJECT: &'static str = HARNESS_RUST_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

impl trellis_service::RpcDescriptor for HarnessRustResourcesRpc {
    type Input = ResourceExerciseInput;
    type Output = ResourceExerciseOutput;

    const KEY: &'static str = "Harness.Rust.Resources";
    const SUBJECT: &'static str = HARNESS_RUST_SUBJECT;
}

struct HarnessTsResourcesRpc;

impl trellis_client::RpcDescriptor for HarnessTsResourcesRpc {
    type Input = ResourceExerciseInput;
    type Output = ResourceExerciseOutput;

    const KEY: &'static str = "Harness.Ts.Resources";
    const SUBJECT: &'static str = HARNESS_TS_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const ERRORS: &'static [&'static str] = &["UnexpectedError"];
}

pub(crate) async fn run_resources_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let (contract_digest, rust_service_seed, ts_service_seed) = {
        let admin_client = connect_admin_client_async(&setup_login.state)
            .await
            .into_diagnostic()?;
        let auth_client = trellis_auth::AuthClient::new(&admin_client);
        auth_client
            .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
            .await
            .into_diagnostic()?;

        let stale_service_contract_json = stale_harness_service_contract_json()?;
        let stale_contract_digest =
            digest_contract_json(&stale_service_contract_json).into_diagnostic()?;
        let sdk_auth_client = SdkAuthClient::new(&admin_client);
        sdk_auth_client
            .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
                contract: contract_json_object(&stale_service_contract_json)?,
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                expected_digest: stale_contract_digest,
            })
            .await
            .into_diagnostic()?;

        let service_contract_json = harness_service_contract_json()?;
        let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
        sdk_auth_client
            .auth_envelopes_expand(&AuthEnvelopesExpandRequest {
                contract: contract_json_object(&service_contract_json)?,
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                expected_digest: contract_digest.clone(),
            })
            .await
            .into_diagnostic()?;

        let (rust_service_seed, rust_service_key) = generate_session_keypair();
        auth_client
            .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: rust_service_key,
            })
            .await
            .into_diagnostic()?;
        let (ts_service_seed, ts_service_key) = generate_session_keypair();
        auth_client
            .provision_service_instance(&trellis_sdk_auth::AuthServiceInstancesProvisionRequest {
                deployment_id: HARNESS_DEPLOYMENT_ID.to_string(),
                instance_key: ts_service_key,
            })
            .await
            .into_diagnostic()?;

        (contract_digest, rust_service_seed, ts_service_seed)
    };

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await
            .into_diagnostic()?,
    );
    let validator = AuthRequestValidatorAdapter::new(Arc::clone(&service_client));
    let connected = connected_rust_service(
        HARNESS_RUST_SERVICE_NAME,
        &contract_digest,
        Arc::clone(&service_client),
        validator,
    )?;
    let kv: KvResourceHandle<NatsKvResourceClient> = connected
        .kv("records")
        .await
        .map_err(|error| miette!("failed to open Rust KV resource handle: {error}"))?;
    let store: StoreResourceHandle<NatsStoreResourceClient> = connected
        .store("blobs")
        .await
        .map_err(|error| miette!("failed to open Rust store resource handle: {error}"))?;
    let mut router = Router::new();
    router.register_rpc::<HarnessRustResourcesRpc, _, _>(move |_ctx, input| {
        let kv = kv.clone();
        let store = store.clone();
        async move { exercise_rust_resources(&kv, &store, input).await }
    });
    let host = connected
        .bootstrap(router)
        .map_err(|error| miette!("failed to bootstrap Rust resources service: {error}"))?;
    let service_nats = service_client.nats().clone();
    let service_task = tokio::spawn(async move {
        trellis_service::run_multi_subject_service(service_nats, &[HARNESS_RUST_SUBJECT], host)
            .await
    });

    let call_result = async {
        let mut ts_service =
            TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
        ts_service.wait_ready().await?;

        let caller_contract_json = harness_caller_contract_json()?;
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
        assert_rust_resource_rpc::<HarnessRustResourcesRpc>(
            &caller_client,
            "rust-client.rust-provider",
            "rust to rust resources",
            "rust",
        )
        .await?;
        assert_rust_resource_rpc::<HarnessTsResourcesRpc>(
            &caller_client,
            "rust-client.ts-provider",
            "rust to ts resources",
            "ts",
        )
        .await?;
        run_ts_client(trellis_url, &caller_login.state.session_seed).await?;
        drop(ts_service);
        Ok(PASSING_CASES)
    }
    .await;
    service_task.abort();
    call_result
}

fn connected_rust_service<'service, V>(
    service_name: &'service str,
    contract_digest: &str,
    client: Arc<TrellisClient>,
    validator: V,
) -> Result<ConnectedService<'service, CoreBootstrapBinding, V, async_nats::Client>, miette::Report>
where
    V: RequestValidator,
{
    let binding_value = client
        .service_bootstrap_binding()
        .cloned()
        .ok_or_else(|| miette!("service bootstrap response did not include resource bindings"))?;
    let binding = serde_json::from_value::<TrellisBindingsGetResponseBinding>(binding_value)
        .map(CoreBootstrapBinding::new)
        .map_err(|error| miette!("invalid service bootstrap binding: {error}"))?;
    if binding.contract_id != HARNESS_CONTRACT_ID || binding.digest != contract_digest {
        return Err(miette!(
            "resource service bootstrap returned unexpected contract {} digest {}",
            binding.contract_id,
            binding.digest
        ));
    }
    Ok(ConnectedService::new(
        service_name,
        binding,
        client.nats().clone(),
        validator,
    ))
}

async fn exercise_rust_resources(
    kv: &KvResourceHandle<NatsKvResourceClient>,
    store: &StoreResourceHandle<NatsStoreResourceClient>,
    input: ResourceExerciseInput,
) -> Result<ResourceExerciseOutput, ServerError> {
    let store_key = format!("{}.rust.store", input.key);
    let store_text = format!("rust-store:{}", input.message);
    store
        .write(&store_key, Bytes::from(store_text.clone()))
        .await?;
    let waited_text = store
        .wait_for(
            &store_key,
            StoreWaitOptions {
                timeout: Some(Duration::from_secs(5)),
                poll_interval: Duration::from_millis(25),
            },
        )
        .await?;
    let read_text = store
        .read(&store_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing store object {store_key}")))?;
    if waited_text != read_text {
        return Err(ServerError::Nats(format!(
            "store wait returned different bytes for {store_key}"
        )));
    }
    let missing_key = format!("{}.rust.wait-missing", input.key);
    let timeout = store
        .wait_for(
            &missing_key,
            StoreWaitOptions {
                timeout: Some(Duration::from_millis(50)),
                poll_interval: Duration::from_millis(10),
            },
        )
        .await
        .expect_err("missing object wait should time out");
    if !matches!(timeout, ServerError::StoreWaitTimeout { ref key, .. } if key == &missing_key) {
        return Err(ServerError::Nats(format!(
            "store wait returned unexpected timeout error for {missing_key}: {timeout}"
        )));
    }
    let canceled_key = format!("{}.rust.wait-canceled", input.key);
    let canceled = store
        .wait_for_with_cancel(
            &canceled_key,
            StoreWaitOptions {
                timeout: Some(Duration::from_secs(5)),
                poll_interval: Duration::from_millis(25),
            },
            async {
                tokio::time::sleep(Duration::from_millis(25)).await;
            },
        )
        .await
        .expect_err("missing object wait should be canceled");
    if !matches!(canceled, ServerError::StoreWaitCanceled { ref key, .. } if key == &canceled_key) {
        return Err(ServerError::Nats(format!(
            "store wait returned unexpected cancellation error for {canceled_key}: {canceled}"
        )));
    }
    if !store.list().await?.iter().any(|key| key == &store_key) {
        return Err(ServerError::Nats(format!(
            "store list did not include {store_key}"
        )));
    }
    store.delete(&store_key).await?;
    if store.read(&store_key).await?.is_some() {
        return Err(ServerError::Nats(format!(
            "store object {store_key} remained after delete"
        )));
    }

    let kv_key = format!("{}.rust.kv", input.key);
    let record = ResourceRecord {
        message: format!("rust-kv:{}", input.message),
    };
    let record_bytes = serde_json::to_vec(&record).map_err(ServerError::Json)?;
    let mut kv_watch = kv.watch(&kv_key).await?;
    kv.put(&kv_key, Bytes::from(record_bytes)).await?;
    let update_event = next_kv_event(&mut kv_watch, &kv_key, "initial put").await?;
    if update_event.operation != KvResourceOperation::Update {
        return Err(ServerError::Nats(format!(
            "kv watch returned unexpected operation for {kv_key}: {:?}",
            update_event.operation
        )));
    }
    let entry = kv
        .get_entry(&kv_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing kv entry metadata {kv_key}")))?;
    if entry.revision != update_event.revision || entry.operation != KvResourceOperation::Update {
        return Err(ServerError::Nats(format!(
            "kv entry metadata did not match update event for {kv_key}"
        )));
    }
    let read_record = kv
        .get(&kv_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing kv record {kv_key}")))?;
    if !kv.list().await?.iter().any(|key| key == &kv_key) {
        return Err(ServerError::Nats(format!(
            "kv list did not include {kv_key}"
        )));
    }
    let updated_record = ResourceRecord {
        message: format!("rust-kv-updated:{}", input.message),
    };
    let updated_revision = kv
        .update_revision(
            &kv_key,
            Bytes::from(serde_json::to_vec(&updated_record).map_err(ServerError::Json)?),
            entry.revision,
        )
        .await?;
    let revision_event = next_kv_event(&mut kv_watch, &kv_key, "revision update").await?;
    if revision_event.revision != updated_revision
        || revision_event.operation != KvResourceOperation::Update
    {
        return Err(ServerError::Nats(format!(
            "kv watch did not observe revision update for {kv_key}"
        )));
    }
    let stale_delete = kv.delete_revision(&kv_key, entry.revision).await;
    if stale_delete.is_ok() {
        return Err(ServerError::Nats(format!(
            "kv stale revision delete unexpectedly succeeded for {kv_key}"
        )));
    }
    kv.delete_revision(&kv_key, updated_revision).await?;
    let delete_event = next_kv_event(&mut kv_watch, &kv_key, "revision delete").await?;
    if delete_event.operation != KvResourceOperation::Delete {
        return Err(ServerError::Nats(format!(
            "kv watch returned unexpected delete operation for {kv_key}: {:?}",
            delete_event.operation
        )));
    }
    if kv.get(&kv_key).await?.is_some() {
        return Err(ServerError::Nats(format!(
            "kv record {kv_key} remained after delete"
        )));
    }
    let delete_entry = kv
        .get_entry(&kv_key)
        .await?
        .ok_or_else(|| ServerError::Nats(format!("missing kv delete entry metadata {kv_key}")))?;
    if delete_entry.operation != KvResourceOperation::Delete {
        return Err(ServerError::Nats(format!(
            "kv delete entry metadata had unexpected operation for {kv_key}: {:?}",
            delete_entry.operation
        )));
    }
    let read_record: ResourceRecord =
        serde_json::from_slice(&read_record).map_err(ServerError::Json)?;

    Ok(ResourceExerciseOutput {
        provider: "rust".to_string(),
        store_text: String::from_utf8(read_text.to_vec())
            .map_err(|error| ServerError::Nats(format!("store object was not UTF-8: {error}")))?,
        kv_message: read_record.message,
    })
}

async fn next_kv_event<W>(
    watch: &mut W,
    expected_key: &str,
    label: &str,
) -> Result<KvResourceEntry, ServerError>
where
    W: futures_util::Stream<Item = std::result::Result<KvResourceEntry, ServerError>> + Unpin,
{
    let event = tokio::time::timeout(Duration::from_secs(5), watch.next())
        .await
        .map_err(|_| ServerError::Nats(format!("timed out waiting for kv {label} event")))?
        .ok_or_else(|| ServerError::Nats(format!("kv watch ended before {label} event")))??;
    if event.key != expected_key {
        return Err(ServerError::Nats(format!(
            "kv watch returned key '{}' while waiting for {label} event for {expected_key}",
            event.key
        )));
    }
    Ok(event)
}

async fn assert_rust_resource_rpc<R>(
    client: &TrellisClient,
    key: &str,
    message: &str,
    provider: &str,
) -> Result<()>
where
    R: trellis_client::RpcDescriptor<
        Input = ResourceExerciseInput,
        Output = ResourceExerciseOutput,
    >,
{
    let output = client
        .call::<R>(&ResourceExerciseInput {
            key: key.to_string(),
            message: message.to_string(),
        })
        .await
        .into_diagnostic()?;
    if output.provider != provider {
        return Err(miette!("{} provider mismatch: {output:?}", R::KEY));
    }
    let expected_store = format!("{provider}-store:{message}");
    let expected_kv = format!("{provider}-kv:{message}");
    if output.store_text != expected_store || output.kv_message != expected_kv {
        return Err(miette!("{} output mismatch: {output:?}", R::KEY));
    }
    Ok(())
}

#[derive(Debug)]
struct TsServiceProcess {
    child: Child,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

impl TsServiceProcess {
    fn start(trellis_url: &str, contract_digest: &str, service_seed: &str) -> Result<Self> {
        let repo = repo_root()?;
        let script_path = write_ts_fixture_script("resources-service", TS_SERVICE_SCRIPT)?;
        let stdout_log = script_path.with_extension("stdout.log");
        let stderr_log = script_path.with_extension("stderr.log");
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS resources service stdout log: {error}")
            })?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS resources service stderr log: {error}")
            })?;
        let child = std::process::Command::new("deno")
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
            .env("HARNESS_CONTRACT_DIGEST", contract_digest)
            .env("HARNESS_TS_SERVICE_SEED", service_seed)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .into_diagnostic()
            .map_err(|error| miette!("failed to start TS resources service fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&mut self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains("TS_RESOURCES_SERVICE_READY")
            {
                return Ok(());
            }
            if let Some(status) =
                self.child.try_wait().into_diagnostic().map_err(|error| {
                    miette!("failed to inspect TS resources service child: {error}")
                })?
            {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "TS resources service fixture exited before readiness with status {status}; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS resources service fixture readiness; stdout: {}; stderr: {}",
                    stdout,
                    stderr
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }
}

impl Drop for TsServiceProcess {
    fn drop(&mut self) {
        match self.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("warning: failed to inspect TS resources service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS resources service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS resources service child: {error}");
        }
    }
}

async fn run_ts_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = write_ts_fixture_script("resources-client", TS_CLIENT_SCRIPT)?;
    let caller_contract_json = harness_caller_contract_json()?;
    let caller_digest = digest_contract_json(&caller_contract_json).into_diagnostic()?;
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
        .env("HARNESS_CALLER_CONTRACT_DIGEST", caller_digest)
        .env("HARNESS_CALLER_SESSION_SEED", caller_session_seed)
        .output()
        .into_diagnostic()
        .map_err(|error| miette!("failed to run TS resources client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS resources client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_RESOURCES_CLIENT_OK") {
        return Err(miette!(
            "TS resources client fixture did not report success: {stdout}"
        ));
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
    state: &AdminSessionState,
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

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse contract JSON object: {error}"))
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
                "failed to write TS resources fixture script {}: {error}",
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

async fn connect_service_with_retry(
    trellis_url: &str,
    contract_digest: &str,
    service_seed: &str,
) -> Result<TrellisClient, TrellisClientError> {
    let mut last_error = None;
    for _ in 0..10 {
        match TrellisClient::connect_service(ServiceConnectOptions {
            trellis_url,
            contract_id: HARNESS_CONTRACT_ID,
            contract_digest,
            session_key_seed_base64url: service_seed,
            timeout_ms: 5_000,
        })
        .await
        {
            Ok(client) => return Ok(client),
            Err(error) => {
                last_error = Some(error);
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }
    Err(last_error.expect("service connect retry should record at least one error"))
}
