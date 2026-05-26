import { assertEquals } from "@std/assert";
import type { NatsConnection } from "@nats-io/nats-core";
import { Type } from "typebox";

import {
  type ConnectedTrellisClient,
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
  type Trellis as RootTrellis,
  TrellisClient,
  TrellisDevice,
} from "../index.ts";
import { checkDeviceActivation } from "../device/deno.ts";
import { API as CORE_API, type Client as CoreClient } from "../sdk/core.ts";
import { sdk as jobs } from "../sdk/jobs.ts";
import { TrellisService } from "../service/deno.ts";
import { StoreHandle } from "../server/mod.ts";
import { Trellis, type TrellisAuth, type TrellisOpts } from "../trellis.ts";

const selectionSchemas = {
  Empty: Type.Object({}),
  SelectedOutput: Type.Object({ value: Type.String() }),
  HiddenOutput: Type.Object({ hidden: Type.Boolean() }),
} as const;

const selectionContract = defineServiceContract(
  { schemas: selectionSchemas },
  (ref) => ({
    id: "trellis.connect-typing-selection@v1",
    displayName: "Connect Typing Selection Service",
    description: "Expose multiple RPCs for selected-use typing tests.",
    rpc: {
      "Selection.Selected": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("SelectedOutput"),
        errors: [],
      },
      "Selection.Hidden": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("HiddenOutput"),
        errors: [],
      },
    },
  }),
);

const appUses = {
  required: {
    jobs: jobs.use({
      rpc: { call: ["Jobs.List", "Jobs.ListServices"] },
    }),
    selection: selectionContract.use({
      rpc: { call: ["Selection.Selected"] },
    }),
  },
} as const;

const appContract = defineAppContract(
  {
    schemas: {
      Preferences: Type.Object({ theme: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.connect-typing-app@v1",
    displayName: "Connect Typing App",
    description: "Typecheck the public client connect helper.",
    uses: appUses,
    state: {
      preferences: { kind: "value", schema: ref.schema("Preferences") },
    },
  }),
);

const deviceContract = defineDeviceContract(() => ({
  id: "trellis.connect-typing-device@v1",
  displayName: "Connect Typing Device",
  description: "Typecheck the public device connect helper.",
}));

const serviceContract = defineServiceContract({}, () => ({
  id: "trellis.connect-typing-service@v1",
  displayName: "Connect Typing Service",
  description: "Typecheck the public service connect helper.",
}));

declare const connectedAppClient: ConnectedTrellisClient<typeof appContract>;
declare const rootAppTrellis: RootTrellis<typeof appContract.API.trellis>;
declare const coreClient: CoreClient;
declare const natsConnection: NatsConnection;
declare const trellisAuth: TrellisAuth;

async function typecheckClientConnectRequestSurface() {
  const connected = connectedAppClient;

  const me = await connected.request("Auth.Sessions.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type ClientMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: ClientMethod = "Auth.Sessions.Me";
  const selectedMethod: ClientMethod = "Selection.Selected";

  const selected = await connected.request("Selection.Selected", {}).orThrow();
  const selectedValue: string = selected.value;
  // @ts-expect-error selected output must be concrete, not any.
  const selectedOutputCheck: number = selected;

  const jobsResult = await connected.request("Jobs.List", { limit: 8 })
    .orThrow();
  const jobCount: number = jobsResult.entries.length;
  // @ts-expect-error generated SDK request output must be concrete, not any.
  const jobsOutputCheck: number = jobsResult;

  const preferences = await connected.state.preferences.get().orThrow();
  if (!("migrationRequired" in preferences) && preferences.found) {
    const theme: string = preferences.entry.value.theme;
    // @ts-expect-error declared state values must preserve schema-derived fields
    const missingField: number = preferences.entry.value.missingField;
    return { authMeMethod, deviceId, missingField, participantKind, theme };
  }
  await connected.state.preferences.put({ theme: "dark" }).orThrow();

  // @ts-expect-error value state stores do not expose map-only list
  const invalidStateList = connected.state.preferences.list;

  // @ts-expect-error undeclared RPC methods must not typecheck
  const invalidMethod: ClientMethod = "Auth.NotDeclared";
  // @ts-expect-error unselected dependency RPCs must not typecheck
  const hiddenMethod: ClientMethod = "Selection.Hidden";
  // @ts-expect-error unselected dependency RPCs must not be callable
  const hiddenResult = connected.request("Selection.Hidden", {});
  // @ts-expect-error unselected generated SDK RPCs must not be callable
  const hiddenJobsResult = connected.request("Jobs.Cancel", { id: "job" });

  return {
    authMeMethod,
    hiddenMethod,
    hiddenResult,
    hiddenJobsResult,
    jobCount,
    jobsOutputCheck,
    deviceId,
    invalidMethod,
    invalidStateList,
    participantKind,
    selectedMethod,
    selectedOutputCheck,
    selectedValue,
  };
}

async function typecheckRootTrellisRequestSurface() {
  const selected = await rootAppTrellis.request(
    "Selection.Selected",
    {},
  ).orThrow();
  const selectedValue: string = selected.value;
  const jobsResult = await rootAppTrellis.request("Jobs.List", {
    limit: 8,
  }).orThrow();
  const jobCount: number = jobsResult.entries.length;
  type RootMethod = Parameters<typeof rootAppTrellis.request>[0];
  const selectedMethod: RootMethod = "Selection.Selected";

  // @ts-expect-error root Trellis must preserve concrete request output typing.
  const selectedOutputCheck: number = selected;
  // @ts-expect-error root Trellis generated SDK output must be concrete, not any.
  const jobsOutputCheck: number = jobsResult;
  // @ts-expect-error unselected dependency RPCs must not typecheck on root Trellis
  const hiddenMethod: RootMethod = "Selection.Hidden";
  // @ts-expect-error unselected dependency RPCs must not be callable on root Trellis
  const hiddenResult = rootAppTrellis.request("Selection.Hidden", {});
  // @ts-expect-error unselected generated SDK RPCs must not be callable on root Trellis
  const hiddenJobsResult = rootAppTrellis.request("Jobs.Cancel", { id: "job" });

  return {
    hiddenMethod,
    hiddenResult,
    hiddenJobsResult,
    jobCount,
    jobsOutputCheck,
    selectedMethod,
    selectedOutputCheck,
    selectedValue,
  };
}

async function typecheckTrellisClientConnectRequestSurface() {
  const connected = await TrellisClient.connect({
    trellisUrl: "https://trellis.example",
    contract: appContract,
  }).orThrow();

  const me = await connected.request("Auth.Sessions.Me", {}).orThrow();
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  const preferences = await connected.state.preferences.get().orThrow();
  if (!("migrationRequired" in preferences) && preferences.found) {
    const theme: string = preferences.entry.value.theme;
    // @ts-expect-error declared state values must preserve schema-derived fields
    const missingField: number = preferences.entry.value.missingField;
    return { missingField, participantKind, theme };
  }

  type ClientMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: ClientMethod = "Auth.Sessions.Me";
  const selectedMethod: ClientMethod = "Selection.Selected";
  const selected = await connected.request("Selection.Selected", {}).orThrow();
  const selectedValue: string = selected.value;
  // @ts-expect-error selected output must be concrete, not any.
  const selectedOutputCheck: number = selected;

  const jobsResult = await connected.request("Jobs.List", { limit: 8 })
    .orThrow();
  const jobCount: number = jobsResult.entries.length;
  // @ts-expect-error generated SDK request output must be concrete, not any.
  const jobsOutputCheck: number = jobsResult;

  // @ts-expect-error undeclared RPC methods must not typecheck
  const invalidMethod: ClientMethod = "Auth.NotDeclared";
  // @ts-expect-error unselected dependency RPCs must not typecheck
  const hiddenMethod: ClientMethod = "Selection.Hidden";
  // @ts-expect-error unselected dependency RPCs must not be callable
  const hiddenResult = connected.request("Selection.Hidden", {});
  // @ts-expect-error unselected generated SDK RPCs must not be callable
  const hiddenJobsResult = connected.request("Jobs.Cancel", { id: "job" });

  return {
    authMeMethod,
    hiddenMethod,
    hiddenResult,
    hiddenJobsResult,
    invalidMethod,
    jobCount,
    jobsOutputCheck,
    participantKind,
    selectedMethod,
    selectedOutputCheck,
    selectedValue,
  };
}

async function typecheckDeviceConnectRequestSurface() {
  const connected = await TrellisDevice.connect({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
  }).orThrow();

  const me = await connected.request("Auth.Sessions.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type DeviceMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: DeviceMethod = "Auth.Sessions.Me";

  return { authMeMethod, deviceId, participantKind };
}

async function typecheckDeviceActivationSurface() {
  const activation = await checkDeviceActivation({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
  });

  if (activation.status === "activation_required") {
    const pendingStatus: "activation_required" = activation.status;
    const activationUrl: string = activation.activationUrl;

    const resumed = await activation.waitForOnlineApproval();
    const activatedStatus: "activated" = resumed.status;

    // @ts-expect-error activation details must stay hidden from callers
    const localState = activation.localState;

    return { pendingStatus, activationUrl, activatedStatus, localState };
  }

  if (activation.status === "not_ready") {
    const reason: string = activation.reason;
    return { reason };
  }

  const activatedStatus: "activated" = activation.status;

  void TrellisDevice.connect({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
    // @ts-expect-error callback-based activation was removed from connect
    onActivationRequired: async () => {},
  });

  // @ts-expect-error root TrellisDevice no longer exposes activation helpers
  const startActivation = TrellisDevice.startActivation;

  return { activatedStatus, startActivation };
}

async function typecheckServiceConnectSurface() {
  const service = await TrellisService.connect({
    trellisUrl: "https://trellis.example",
    contract: serviceContract,
    name: "svc",
    sessionKeySeed: "test-session-seed",
    server: {},
  }).orThrow();

  return service.name;
}

function typecheckResolvedRuntimeBindingsAreNotPublicAuthoringSurface() {
  const publicOpts: TrellisOpts<typeof serviceContract.API.owned> = {
    api: serviceContract.API.owned,
    // @ts-expect-error resolved event consumer bindings are internal runtime state
    eventConsumers: {},
  };

  new Trellis("client", natsConnection, trellisAuth, {
    api: serviceContract.API.owned,
    // @ts-expect-error public Trellis constructor must not accept resolved bindings
    eventConsumers: {},
  });

  // @ts-expect-error StoreHandle instances are provisioned by TrellisService
  new StoreHandle(natsConnection, { name: "objects", ttlMs: 0 });

  // @ts-expect-error TrellisService instances are created by connect/bootstrap
  new TrellisService();

  return publicOpts;
}

function typecheckGeneratedCoreInternalRpcSurface() {
  const descriptor = CORE_API.owned.rpc["Trellis.Bindings.Get"];
  const subject: string = descriptor.subject;

  return { coreClient, descriptor, subject };
}

void typecheckClientConnectRequestSurface;
void typecheckRootTrellisRequestSurface;
void typecheckTrellisClientConnectRequestSurface;
void typecheckDeviceConnectRequestSurface;
void typecheckDeviceActivationSurface;
void typecheckServiceConnectSurface;
void typecheckResolvedRuntimeBindingsAreNotPublicAuthoringSurface;
void typecheckGeneratedCoreInternalRpcSurface;

Deno.test("public connect helpers preserve contract-derived request typing", () => {
  assertEquals(true, true);
});
