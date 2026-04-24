import { assertEquals } from "@std/assert";
import { Type } from "typebox";

import {
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
  type ConnectedTrellisClient,
  TrellisDevice,
} from "../index.ts";
import { checkDeviceActivation } from "../device/deno.ts";
import { auth } from "../sdk/auth.ts";
import { TrellisService } from "../service/deno.ts";

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
    uses: {
      auth: auth.useDefaults(),
    },
    state: {
      preferences: { kind: "value", schema: ref.schema("Preferences") },
    },
  }),
);

const deviceContract = defineDeviceContract(() => ({
  id: "trellis.connect-typing-device@v1",
  displayName: "Connect Typing Device",
  description: "Typecheck the public device connect helper.",
  uses: {
    auth: auth.useDefaults(),
  },
}));

const serviceContract = defineServiceContract({}, () => ({
  id: "trellis.connect-typing-service@v1",
  displayName: "Connect Typing Service",
  description: "Typecheck the public service connect helper.",
}));

declare const connectedAppClient: ConnectedTrellisClient<typeof appContract>;

async function typecheckClientConnectRequestSurface() {
  const connected = connectedAppClient;

  const me = await connected.request("Auth.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type ClientMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: ClientMethod = "Auth.Me";

  const preferences = await connected.state.preferences.get().orThrow();
  if (preferences.found) {
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

  return {
    authMeMethod,
    deviceId,
    invalidMethod,
    invalidStateList,
    participantKind,
  };
}

async function typecheckDeviceConnectRequestSurface() {
  const connected = await TrellisDevice.connect({
    trellisUrl: "https://trellis.example",
    contract: deviceContract,
    rootSecret: new Uint8Array([1]),
  }).orThrow();

  const me = await connected.request("Auth.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type DeviceMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: DeviceMethod = "Auth.Me";

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

void typecheckClientConnectRequestSurface;
void typecheckDeviceConnectRequestSurface;
void typecheckDeviceActivationSurface;
void typecheckServiceConnectSurface;

Deno.test("public connect helpers preserve contract-derived request typing", () => {
  assertEquals(true, true);
});
