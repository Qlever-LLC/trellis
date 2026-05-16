use std::collections::BTreeMap;
use std::fs::File;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{StreamExt, TryStreamExt};
use miette::{miette, IntoDiagnostic, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use trellis_auth::{connect_admin_client_async, generate_session_keypair, AdminLoginOutcome};
use trellis_auth_adapters::AuthRequestValidatorAdapter;
use trellis_client::{
    OperationEvent, OperationSnapshot, OperationState, ServiceConnectOptions, TrellisClient,
};
use trellis_contracts::{
    digest_contract_json, operation, use_contract, ContractKind, ContractManifestBuilder,
};
use trellis_sdk_auth::client::AuthClient as SdkAuthClient;
use trellis_sdk_auth::types::AuthEnvelopesExpandRequest;
use trellis_service::{
    bootstrap_service_host, BootstrapBinding, InMemoryOperationRuntime, Router, ServerError,
};

use crate::app::admin_setup_contract_json;
use crate::browser::{complete_local_login, BrowserContainer};
use crate::workspace::repo_root;

const HARNESS_DEPLOYMENT_ID: &str = "harness.operations";
const HARNESS_RUST_SERVICE_NAME: &str = "harness-operations-rust";
const HARNESS_CONTRACT_ID: &str = "trellis.integration-harness.operations@v1";
const HARNESS_RUST_OPERATION_SUBJECT: &str = "operations.v1.Harness.Rust.Operation";
const HARNESS_TS_OPERATION_SUBJECT: &str = "operations.v1.Harness.Ts.Operation";

fn harness_service_contract_json() -> Result<String> {
    let payload_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "message": { "type": "string" },
            "mode": { "type": "string" }
        },
        "required": ["message"]
    });
    let select_workspace_signal_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "workspaceId": { "type": "string" }
        },
        "required": ["workspaceId"]
    });
    let continue_signal_schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "confirmed": { "type": "boolean" }
        },
        "required": ["confirmed"]
    });
    let manifest = ContractManifestBuilder::new(
        HARNESS_CONTRACT_ID,
        "Trellis Integration Harness Operations",
        "Harness-owned service contract for full-stack Rust/TypeScript operations verification.",
        ContractKind::Service,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Requests.Validate"]),
    )
    .schema("OperationInput", payload_schema.clone())
    .schema("OperationProgress", payload_schema.clone())
    .schema("OperationOutput", payload_schema)
    .schema("SelectWorkspaceSignal", select_workspace_signal_schema)
    .schema("ContinueSignal", continue_signal_schema)
    .operation(
        "Harness.Rust.Operation",
        operation(
            "v1",
            HARNESS_RUST_OPERATION_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_read_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .signal("selectWorkspace", "SelectWorkspaceSignal")
        .signal("continue", "ContinueSignal")
        .cancel(true),
    )
    .operation(
        "Harness.Ts.Operation",
        operation(
            "v1",
            HARNESS_TS_OPERATION_SUBJECT,
            "OperationInput",
            Some("OperationProgress"),
            Some("OperationOutput"),
        )
        .with_call_capabilities(std::iter::empty::<&str>())
        .with_read_capabilities(std::iter::empty::<&str>())
        .with_cancel_capabilities(std::iter::empty::<&str>())
        .signal("selectWorkspace", "SelectWorkspaceSignal")
        .signal("continue", "ContinueSignal")
        .cancel(true),
    )
    .build()
    .map_err(|error| miette!("failed to build operations harness service contract: {error}"))?;

    serde_json::to_string(&manifest).map_err(|error| {
        miette!("failed to serialize operations harness service contract: {error}")
    })
}

fn harness_caller_contract_json() -> Result<String> {
    let manifest = ContractManifestBuilder::new(
        "trellis.integration-operations-agent@v1",
        "Trellis Integration Agent",
        "Verify delegated Rust agent login and harness operation calls.",
        ContractKind::Agent,
    )
    .use_ref(
        "auth",
        use_contract("trellis.auth@v1").with_rpc_call(["Auth.Sessions.Logout", "Auth.Sessions.Me"]),
    )
    .use_ref(
        "harness",
        use_contract(HARNESS_CONTRACT_ID)
            .with_operation_call(["Harness.Rust.Operation", "Harness.Ts.Operation"]),
    )
    .build()
    .map_err(|error| miette!("failed to build operations harness caller contract: {error}"))?;

    serde_json::to_string(&manifest)
        .map_err(|error| miette!("failed to serialize operations harness caller contract: {error}"))
}

const TS_SERVICE_SCRIPT: &str = r#"import { defineServiceContract, ok } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";

const schemas = {
  OperationInput: Type.Object({ message: Type.String(), mode: Type.Optional(Type.String()) }, { additionalProperties: false }),
  OperationProgress: Type.Object({ message: Type.String(), mode: Type.Optional(Type.String()) }, { additionalProperties: false }),
  OperationOutput: Type.Object({ message: Type.String(), mode: Type.Optional(Type.String()) }, { additionalProperties: false }),
  SelectWorkspaceSignal: Type.Object({ workspaceId: Type.String() }, { additionalProperties: false }),
  ContinueSignal: Type.Object({ confirmed: Type.Boolean() }, { additionalProperties: false }),
} as const;

const contract = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.operations@v1",
  displayName: "Trellis Integration Harness Operations",
  description: "Harness-owned service contract for full-stack Rust/TypeScript operations verification.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    health: health.use({ events: { publish: ["Health.Heartbeat"] } }),
  },
  operations: {
    "Harness.Rust.Operation": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.Operation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], read: [], cancel: [] },
      signals: {
        selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
        continue: { input: ref.schema("ContinueSignal") },
      },
      cancel: true,
    },
    "Harness.Ts.Operation": {
      version: "v1",
      subject: "operations.v1.Harness.Ts.Operation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], read: [], cancel: [] },
      signals: {
        selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
        continue: { input: ref.schema("ContinueSignal") },
      },
      cancel: true,
    },
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
}

const service = await TrellisService.connect({
  trellisUrl: Deno.env.get("TRELLIS_URL")!,
  contract,
  name: "harness-operations-ts",
  sessionKeySeed: Deno.env.get("HARNESS_TS_SERVICE_SEED")!,
  server: { log: false },
}).orThrow();

await service.operation("Harness.Ts.Operation").handle(async ({ input, op }) => {
  await op.started().orThrow();
  if (input.mode === "signal") {
    const seen: string[] = [];
    for await (const signal of op.signals()) {
      seen.push(signal.signal);
      if (signal.signal === "selectWorkspace") {
        const payload = signal.input as { workspaceId?: string };
        if (payload.workspaceId !== input.message) {
          throw new Error(`selectWorkspace returned ${JSON.stringify(signal.input)}`);
        }
        await op.progress({ message: "workspace selected", mode: input.mode }).orThrow();
      }
      if (signal.signal === "continue") {
        const payload = signal.input as { confirmed?: boolean };
        if (payload.confirmed !== true) {
          throw new Error(`continue returned ${JSON.stringify(signal.input)}`);
        }
        if (seen.join(",") !== "selectWorkspace,continue") {
          throw new Error(`signals arrived out of order: ${seen.join(",")}`);
        }
        await op.complete({ message: input.message, mode: input.mode }).orThrow();
        return ok({ message: input.message, mode: input.mode });
      }
    }
    throw new Error("signal stream ended before continue");
  }
  if (input.mode === "watch") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await op.progress({ message: input.message, mode: input.mode }).orThrow();
  if (input.mode === "cancel") {
    return op.defer();
  }
  if (input.mode === "deferred") {
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const controlled = await service.operation("Harness.Ts.Operation").control(op.id).orThrow();
      await controlled.complete({ message: input.message, mode: input.mode }).orThrow();
    })();
    return op.defer();
  }
  if (input.mode === "watch") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return ok({ message: input.message, mode: input.mode });
});
console.log("TS_OPERATIONS_SERVICE_READY");

await new Promise<void>(() => {});
"#;

const TS_CLIENT_SCRIPT: &str = r#"import { defineAgentContract, defineServiceContract, TrellisClient } from "@qlever-llc/trellis";
import { sdk as auth } from "@qlever-llc/trellis/sdk/auth";
import { sdk as health } from "@qlever-llc/trellis/sdk/health";
import { Type } from "typebox";

const schemas = {
  OperationInput: Type.Object({ message: Type.String(), mode: Type.Optional(Type.String()) }, { additionalProperties: false }),
  OperationProgress: Type.Object({ message: Type.String(), mode: Type.Optional(Type.String()) }, { additionalProperties: false }),
  OperationOutput: Type.Object({ message: Type.String(), mode: Type.Optional(Type.String()) }, { additionalProperties: false }),
  SelectWorkspaceSignal: Type.Object({ workspaceId: Type.String() }, { additionalProperties: false }),
  ContinueSignal: Type.Object({ confirmed: Type.Boolean() }, { additionalProperties: false }),
} as const;

const harness = defineServiceContract({ schemas }, (ref) => ({
  id: "trellis.integration-harness.operations@v1",
  displayName: "Trellis Integration Harness Operations",
  description: "Harness-owned service contract for full-stack Rust/TypeScript operations verification.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Requests.Validate"] } }),
    health: health.use({ events: { publish: ["Health.Heartbeat"] } }),
  },
  operations: {
    "Harness.Rust.Operation": {
      version: "v1",
      subject: "operations.v1.Harness.Rust.Operation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], read: [], cancel: [] },
      signals: {
        selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
        continue: { input: ref.schema("ContinueSignal") },
      },
      cancel: true,
    },
    "Harness.Ts.Operation": {
      version: "v1",
      subject: "operations.v1.Harness.Ts.Operation",
      input: ref.schema("OperationInput"),
      progress: ref.schema("OperationProgress"),
      output: ref.schema("OperationOutput"),
      capabilities: { call: [], read: [], cancel: [] },
      signals: {
        selectWorkspace: { input: ref.schema("SelectWorkspaceSignal") },
        continue: { input: ref.schema("ContinueSignal") },
      },
      cancel: true,
    },
  },
}));

const contract = defineAgentContract(() => ({
  id: "trellis.integration-operations-agent@v1",
  displayName: "Trellis Integration Agent",
  description: "Verify delegated Rust agent login and harness operation calls.",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
    harness: harness.use({ operations: { call: ["Harness.Rust.Operation", "Harness.Ts.Operation"] } }),
  },
}));

const expectedDigest = Deno.env.get("HARNESS_CALLER_CONTRACT_DIGEST");
if (contract.CONTRACT_DIGEST !== expectedDigest) {
  throw new Error(`caller contract digest mismatch: ${contract.CONTRACT_DIGEST} !== ${expectedDigest}`);
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

type OperationName = "Harness.Rust.Operation" | "Harness.Ts.Operation";

async function assertNormalOperation(method: OperationName, message: string) {
  const ref = await client.operation(method).input({ message }).start().orThrow();
  const snapshot = await ref.get().orThrow();
  if (snapshot.state !== "pending" && snapshot.state !== "running" && snapshot.state !== "completed") {
    throw new Error(`${method} get returned ${snapshot.state}`);
  }
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} wait returned ${terminal.state}`);
  }
  const output = terminal.output as { message?: string } | undefined;
  if (output?.message !== message) {
    throw new Error(`${method} returned ${JSON.stringify(terminal.output)}`);
  }
}

async function assertWatchedOperation(method: OperationName, message: string) {
  const ref = await client.operation(method).input({ message, mode: "watch" }).start().orThrow();
  const events = await ref.watch().orThrow();
  let sawProgress = false;
  for await (const event of events) {
    if (event.type === "progress") {
      sawProgress = true;
      const progress = event.progress as { message?: string; mode?: string };
      if (progress.message !== message || progress.mode !== "watch") {
        throw new Error(`${method} watch progress returned ${JSON.stringify(progress)}`);
      }
    }
    if (event.type === "completed") {
      const output = event.snapshot.output as { message?: string; mode?: string } | undefined;
      if (output?.message !== message || output?.mode !== "watch") {
        throw new Error(`${method} watch completed with ${JSON.stringify(event.snapshot.output)}`);
      }
      if (!sawProgress) {
        throw new Error(`${method} watch completed before progress`);
      }
      return;
    }
  }
  throw new Error(`${method} watch ended before completion`);
}

async function assertCancelOperation(method: OperationName, message: string) {
  const ref = await client.operation(method).input({ message, mode: "cancel" }).start().orThrow();
  const cancelled = await ref.cancel().orThrow();
  if (cancelled.state !== "cancelled") {
    throw new Error(`${method} cancel returned ${cancelled.state}`);
  }
}

async function assertDeferredOperation(method: OperationName, message: string) {
  const ref = await client.operation(method).input({ message, mode: "deferred" }).start().orThrow();
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} deferred wait returned ${terminal.state}`);
  }
  const output = terminal.output as { message?: string; mode?: string } | undefined;
  if (output?.message !== message || output?.mode !== "deferred") {
    throw new Error(`${method} deferred returned ${JSON.stringify(terminal.output)}`);
  }
}

async function assertSignalOperation(method: OperationName, message: string) {
  const ref = await client.operation(method).input({ message, mode: "signal" }).start().orThrow();
  await waitFor(async () => {
    const snapshot = await ref.get().orThrow();
    return snapshot.state === "running";
  }, `${method} running before signal`);
  const first = await ref.signal("selectWorkspace", { workspaceId: message }).orThrow();
  if (first.kind !== "signal-accepted" || first.signalSequence !== 1) {
    throw new Error(`${method} first signal ack was ${JSON.stringify(first)}`);
  }
  const second = await ref.signal("continue", { confirmed: true }).orThrow();
  if (second.signalSequence !== 2) {
    throw new Error(`${method} second signal ack was ${JSON.stringify(second)}`);
  }
  const terminal = await ref.wait().orThrow();
  if (terminal.state !== "completed") {
    throw new Error(`${method} signal wait returned ${terminal.state}`);
  }
  const terminalSignal = await ref.signal("continue", { confirmed: true });
  if (terminalSignal.isOk()) {
    throw new Error(`${method} accepted terminal signal`);
  }
}

async function assertInvalidSignalRejected(method: OperationName, message: string) {
  const ref = await client.operation(method).input({ message, mode: "cancel" }).start().orThrow();
  await waitFor(async () => {
    const snapshot = await ref.get().orThrow();
    return snapshot.state === "running";
  }, `${method} running before invalid signal`);
  const invalid = await ref.signal("selectWorkspace", { workspaceId: 123 });
  if (invalid.isOk()) {
    throw new Error(`${method} accepted invalid signal payload`);
  }
  await ref.cancel().orThrow();
}

async function waitFor(condition: () => boolean | Promise<boolean>, description: string) {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timeout waiting for ${description}`);
}

await assertNormalOperation("Harness.Rust.Operation", "ts-client-rust-operation");
await assertNormalOperation("Harness.Ts.Operation", "ts-client-ts-operation");
await assertWatchedOperation("Harness.Rust.Operation", "ts-client-rust-watch");
await assertWatchedOperation("Harness.Ts.Operation", "ts-client-ts-watch");
await assertCancelOperation("Harness.Rust.Operation", "ts-client-rust-cancel");
await assertCancelOperation("Harness.Ts.Operation", "ts-client-ts-cancel");
await assertDeferredOperation("Harness.Rust.Operation", "ts-client-rust-deferred");
await assertDeferredOperation("Harness.Ts.Operation", "ts-client-ts-deferred");
await assertSignalOperation("Harness.Rust.Operation", "ts-client-rust-signal");
await assertSignalOperation("Harness.Ts.Operation", "ts-client-ts-signal");
await assertInvalidSignalRejected("Harness.Rust.Operation", "ts-client-rust-invalid-signal");
await assertInvalidSignalRejected("Harness.Ts.Operation", "ts-client-ts-invalid-signal");
await client.natsConnection.drain();
console.log("TS_OPERATIONS_CLIENT_OK");
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct HarnessOperationPayload {
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
}

struct HarnessRustOperation;

impl trellis_client::OperationDescriptor for HarnessRustOperation {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Rust.Operation";
    const SUBJECT: &'static str = HARNESS_RUST_OPERATION_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const READ_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = true;
}

impl trellis_service::OperationDescriptor for HarnessRustOperation {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Rust.Operation";
    const SUBJECT: &'static str = HARNESS_RUST_OPERATION_SUBJECT;
    const CANCELABLE: bool = true;
}

struct HarnessTsOperation;

impl trellis_client::OperationDescriptor for HarnessTsOperation {
    type Input = HarnessOperationPayload;
    type Progress = HarnessOperationPayload;
    type Output = HarnessOperationPayload;

    const KEY: &'static str = "Harness.Ts.Operation";
    const SUBJECT: &'static str = HARNESS_TS_OPERATION_SUBJECT;
    const CALLER_CAPABILITIES: &'static [&'static str] = &[];
    const READ_CAPABILITIES: &'static [&'static str] = &[];
    const CANCEL_CAPABILITIES: &'static [&'static str] = &[];
    const CANCELABLE: bool = true;
}

pub(crate) async fn run_operations_fixture(
    trellis_url: &str,
    admin_login: &AdminLoginOutcome,
    browser: &BrowserContainer,
) -> Result<usize> {
    let setup_login = reauth_admin_setup(admin_login, browser).await?;
    let admin_client = connect_admin_client_async(&setup_login.state)
        .await
        .into_diagnostic()?;
    let auth_client = trellis_auth::AuthClient::new(&admin_client);
    auth_client
        .create_service_deployment(HARNESS_DEPLOYMENT_ID, vec!["harness".to_string()])
        .await
        .into_diagnostic()?;

    let service_contract_json = harness_service_contract_json()?;
    let contract_digest = digest_contract_json(&service_contract_json).into_diagnostic()?;
    let sdk_auth_client = SdkAuthClient::new(&admin_client);
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

    let service_client = Arc::new(
        connect_service_with_retry(trellis_url, &contract_digest, &rust_service_seed)
            .await
            .into_diagnostic()?,
    );

    let operations = InMemoryOperationRuntime::new(HARNESS_RUST_SERVICE_NAME)
        .operation::<HarnessRustOperation>();
    let mut router = Router::new();
    router.register_operation_with_watch_and_signal::<HarnessRustOperation, _, _, _, _, _, _, _, _, _>(
        {
            let operations = operations.clone();
            move |_ctx, input| {
                let operations = operations.clone();
                async move {
                    let operation_id = format!("harness-rust-{}", unique_suffix());
                    let accepted = operations.accept(operation_id.clone()).await?;
                    let control = operations.control(operation_id).await?;
                    tokio::spawn(async move {
                        if let Err(error) = update_rust_operation(control, input).await {
                            eprintln!("warning: failed to update Rust operation fixture: {error}");
                        }
                    });
                    Ok(accepted)
                }
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id| {
                let operations = operations.clone();
                async move { operations.get(operation_id).await }
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id| {
                let operations = operations.clone();
                Box::pin(
                    futures_util::stream::once(async move { operations.watch(operation_id).await })
                        .try_flatten(),
                )
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id| {
                let operations = operations.clone();
                async move { operations.cancel(operation_id).await }
            }
        },
        {
            let operations = operations.clone();
            move |_ctx, operation_id, signal, input| {
                let operations = operations.clone();
                async move {
                    validate_rust_signal(&signal, input.as_ref())?;
                    operations.signal(operation_id, signal, input).await
                }
            }
        },
    );
    let validator = AuthRequestValidatorAdapter::new(Arc::clone(&service_client));
    let host = bootstrap_service_host(
        HARNESS_RUST_SERVICE_NAME,
        BootstrapBinding {
            contract_id: HARNESS_CONTRACT_ID.to_string(),
            digest: contract_digest.clone(),
        },
        router,
        validator,
    );
    let service_nats = service_client.nats().clone();
    let service_task = tokio::spawn(async move {
        let rust_control_subject = trellis_service::control_subject(HARNESS_RUST_OPERATION_SUBJECT);
        let subjects = [
            HARNESS_RUST_OPERATION_SUBJECT,
            rust_control_subject.as_str(),
        ];
        trellis_service::run_multi_subject_service(service_nats, &subjects, host).await
    });

    let ts_service = TsServiceProcess::start(trellis_url, &contract_digest, &ts_service_seed)?;
    ts_service.wait_ready().await?;

    let call_result = async {
        let caller_contract_json = harness_caller_contract_json()?;
        let caller_login =
            match trellis_auth::start_admin_reauth(&setup_login.state, &caller_contract_json)
                .await
                .into_diagnostic()?
            {
                trellis_auth::AdminReauthOutcome::Bound(outcome) => outcome,
                trellis_auth::AdminReauthOutcome::Flow(challenge) => {
                    let login_url = challenge.login_url().to_string();
                    let driver = browser.driver().await?;
                    let login_result = complete_local_login(
                        &driver,
                        &login_url,
                        "admin",
                        "trellis-admin-password",
                    )
                    .await;
                    let quit_result = driver
                        .quit()
                        .await
                        .map_err(|error| miette!("failed to stop WebDriver session: {error}"));
                    login_result?;
                    quit_result?;
                    challenge.complete(trellis_url).await.into_diagnostic()?
                }
            };
        let caller_client = connect_admin_client_async(&caller_login.state)
            .await
            .into_diagnostic()?;
        assert_rust_client_normal::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-operation",
        )
        .await?;
        assert_rust_client_normal::<HarnessTsOperation>(&caller_client, "rust-client-ts-operation")
            .await?;
        assert_rust_client_watch::<HarnessRustOperation>(&caller_client, "rust-client-rust-watch")
            .await?;
        assert_rust_client_watch::<HarnessTsOperation>(&caller_client, "rust-client-ts-watch")
            .await?;
        assert_rust_client_cancel::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-cancel",
        )
        .await?;
        assert_rust_client_cancel::<HarnessTsOperation>(&caller_client, "rust-client-ts-cancel")
            .await?;
        assert_rust_client_deferred::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-deferred",
        )
        .await?;
        assert_rust_client_deferred::<HarnessTsOperation>(
            &caller_client,
            "rust-client-ts-deferred",
        )
        .await?;
        assert_rust_client_signal::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-signal",
        )
        .await?;
        assert_rust_client_signal::<HarnessTsOperation>(&caller_client, "rust-client-ts-signal")
            .await?;
        assert_rust_client_invalid_signal::<HarnessRustOperation>(
            &caller_client,
            "rust-client-rust-invalid-signal",
        )
        .await?;
        assert_rust_client_invalid_signal::<HarnessTsOperation>(
            &caller_client,
            "rust-client-ts-invalid-signal",
        )
        .await?;
        run_ts_client(trellis_url, &caller_login.state.session_seed).await?;

        Ok(24)
    }
    .await;
    service_task.abort();
    drop(ts_service);
    call_result
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

async fn update_rust_operation(
    control: trellis_service::OperationControl<HarnessRustOperation>,
    input: HarnessOperationPayload,
) -> Result<(), ServerError> {
    let mut signals = if input.mode.as_deref() == Some("signal") {
        Some(control.signals().await?)
    } else {
        None
    };
    control.started().await?;
    if let Some(signals) = signals.as_mut() {
        let first = signals.try_next().await?.ok_or_else(|| {
            ServerError::Nats("signal stream ended before selectWorkspace".into())
        })?;
        if first.signal != "selectWorkspace" {
            return Err(ServerError::Nats(format!(
                "expected selectWorkspace signal, got {}",
                first.signal
            )));
        }
        control.progress(input.clone()).await?;
        let second = signals
            .try_next()
            .await?
            .ok_or_else(|| ServerError::Nats("signal stream ended before continue".into()))?;
        if second.signal != "continue" {
            return Err(ServerError::Nats(format!(
                "expected continue signal, got {}",
                second.signal
            )));
        }
        control.complete(input).await?;
        return Ok(());
    }
    if input.mode.as_deref() == Some("watch") {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    control.progress(input.clone()).await?;
    if input.mode.as_deref() == Some("watch") {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    if input.mode.as_deref() == Some("deferred") {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if input.mode.as_deref() != Some("cancel") {
        control.complete(input).await?;
    }
    Ok(())
}

fn validate_rust_signal(signal: &str, input: Option<&Value>) -> Result<(), ServerError> {
    let valid = match signal {
        "selectWorkspace" => input
            .and_then(|value| value.get("workspaceId"))
            .and_then(Value::as_str)
            .is_some(),
        "continue" => input
            .and_then(|value| value.get("confirmed"))
            .and_then(Value::as_bool)
            .is_some(),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(ServerError::Nats(format!("invalid signal '{signal}'")))
    }
}

async fn assert_rust_client_normal<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: None,
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let snapshot = reference.get().await.into_diagnostic()?;
    if !matches!(
        snapshot.state,
        OperationState::Pending | OperationState::Running | OperationState::Completed
    ) {
        return Err(miette!("{} get returned {:?}", O::KEY, snapshot.state));
    }
    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)
}

async fn assert_rust_client_watch<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("watch".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let mut events = reference.watch().await.into_diagnostic()?;
    let mut saw_progress = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

    loop {
        let event = tokio::time::timeout_at(deadline, events.next())
            .await
            .map_err(|_| miette!("{} watch timed out before completion", O::KEY))?
            .ok_or_else(|| miette!("{} watch ended before completion", O::KEY))?
            .into_diagnostic()?;

        match event {
            OperationEvent::Progress { snapshot } => {
                if snapshot.progress.as_ref() != Some(&input) {
                    return Err(miette!("{} watch progress did not echo input", O::KEY));
                }
                saw_progress = true;
            }
            OperationEvent::Completed { snapshot } => {
                if !saw_progress {
                    return Err(miette!("{} watch completed before progress", O::KEY));
                }
                return assert_completed_output::<O>(snapshot, &input);
            }
            OperationEvent::Failed { snapshot } => {
                return Err(miette!("{} watch failed: {:?}", O::KEY, snapshot));
            }
            OperationEvent::Cancelled { snapshot } => {
                return Err(miette!("{} watch cancelled: {:?}", O::KEY, snapshot));
            }
            OperationEvent::Accepted { .. }
            | OperationEvent::Started { .. }
            | OperationEvent::Transfer { .. } => {}
        }
    }
}

async fn assert_rust_client_cancel<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("cancel".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let cancelled = reference.cancel().await.into_diagnostic()?;
    if cancelled.state != OperationState::Cancelled {
        return Err(miette!("{} cancel returned {:?}", O::KEY, cancelled.state));
    }
    Ok(())
}

async fn assert_rust_client_deferred<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("deferred".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)
}

async fn assert_rust_client_signal<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("signal".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    wait_until_running::<O>(&reference).await?;

    let first = reference
        .signal("selectWorkspace", Some(json!({ "workspaceId": message })))
        .await
        .into_diagnostic()?;
    if first.signal_sequence != 1 {
        return Err(miette!(
            "{} first signal sequence was {}",
            O::KEY,
            first.signal_sequence
        ));
    }

    let second = reference
        .signal("continue", Some(json!({ "confirmed": true })))
        .await
        .into_diagnostic()?;
    if second.signal_sequence != 2 {
        return Err(miette!(
            "{} second signal sequence was {}",
            O::KEY,
            second.signal_sequence
        ));
    }

    let terminal = reference.wait().await.into_diagnostic()?;
    assert_completed_output::<O>(terminal, &input)?;

    let terminal_signal = reference
        .signal("continue", Some(json!({ "confirmed": true })))
        .await;
    if terminal_signal.is_ok() {
        return Err(miette!("{} accepted terminal signal", O::KEY));
    }
    Ok(())
}

async fn assert_rust_client_invalid_signal<O>(client: &TrellisClient, message: &str) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let input = HarnessOperationPayload {
        message: message.to_string(),
        mode: Some("cancel".to_string()),
    };
    let reference = client
        .operation::<O>()
        .start(&input)
        .await
        .into_diagnostic()?;
    wait_until_running::<O>(&reference).await?;

    let invalid = reference
        .signal("selectWorkspace", Some(json!({ "workspaceId": 123 })))
        .await;
    if invalid.is_ok() {
        return Err(miette!("{} accepted invalid signal payload", O::KEY));
    }
    let cancelled = reference.cancel().await.into_diagnostic()?;
    if cancelled.state != OperationState::Cancelled {
        return Err(miette!(
            "{} cancel after invalid signal returned {:?}",
            O::KEY,
            cancelled.state
        ));
    }
    Ok(())
}

async fn wait_until_running<O>(
    reference: &trellis_client::OperationRef<'_, TrellisClient, O>,
) -> Result<()>
where
    O: trellis_client::OperationDescriptor<
        Input = HarnessOperationPayload,
        Progress = HarnessOperationPayload,
        Output = HarnessOperationPayload,
    >,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = reference.get().await.into_diagnostic()?;
        if snapshot.state == OperationState::Running {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(miette!("{} did not reach running state", O::KEY));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

fn assert_completed_output<O>(
    terminal: OperationSnapshot<HarnessOperationPayload, HarnessOperationPayload>,
    input: &HarnessOperationPayload,
) -> Result<()>
where
    O: trellis_client::OperationDescriptor,
{
    if terminal.state != OperationState::Completed {
        return Err(miette!("{} wait returned {:?}", O::KEY, terminal.state));
    }
    if terminal.output.as_ref() != Some(input) {
        return Err(miette!("{} output did not echo the request", O::KEY));
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
        let script_path = write_ts_fixture_script("operations-service", TS_SERVICE_SCRIPT)?;
        let stdout_log = script_path.with_extension("stdout.log");
        let stderr_log = script_path.with_extension("stderr.log");
        let stdout = File::create(&stdout_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS operations service stdout log: {error}")
            })?;
        let stderr = File::create(&stderr_log)
            .into_diagnostic()
            .map_err(|error| {
                miette!("failed to create TS operations service stderr log: {error}")
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
            .map_err(|error| miette!("failed to start TS operations service fixture: {error}"))?;
        Ok(Self {
            child,
            stdout_log,
            stderr_log,
        })
    }

    async fn wait_ready(&self) -> Result<()> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
        loop {
            if std::fs::read_to_string(&self.stdout_log)
                .unwrap_or_default()
                .contains("TS_OPERATIONS_SERVICE_READY")
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                let stdout = std::fs::read_to_string(&self.stdout_log).unwrap_or_default();
                let stderr = std::fs::read_to_string(&self.stderr_log).unwrap_or_default();
                return Err(miette!(
                    "timed out waiting for TS operations service fixture readiness; stdout: {}; stderr: {}",
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
                eprintln!("warning: failed to inspect TS operations service child: {error}");
                return;
            }
        }
        if let Err(error) = self.child.kill() {
            eprintln!("warning: failed to kill TS operations service child: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("warning: failed to wait for TS operations service child: {error}");
        }
    }
}

async fn run_ts_client(trellis_url: &str, caller_session_seed: &str) -> Result<()> {
    let repo = repo_root()?;
    let script_path = write_ts_fixture_script("operations-client", TS_CLIENT_SCRIPT)?;
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
        .map_err(|error| miette!("failed to run TS operations client fixture: {error}"))?;
    if !output.status.success() {
        return Err(miette!(
            "TS operations client fixture failed with status {}: stdout: {}; stderr: {}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    if !stdout.contains("TS_OPERATIONS_CLIENT_OK") {
        return Err(miette!(
            "TS operations client fixture did not report success: {stdout}"
        ));
    }
    Ok(())
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
                "failed to write TS operations fixture script {}: {error}",
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
) -> Result<TrellisClient, trellis_client::TrellisClientError> {
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
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }

    Err(last_error.expect("service connect retry should record at least one error"))
}

fn contract_json_object(contract_json: &str) -> Result<BTreeMap<String, Value>> {
    serde_json::from_str(contract_json)
        .map_err(|error| miette!("failed to parse harness operations contract JSON: {error}"))
}
