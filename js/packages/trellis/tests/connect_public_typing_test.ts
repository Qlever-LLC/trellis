import { assertEquals } from "@std/assert";

import {
  defineAppContract,
  defineDeviceContract,
  defineServiceContract,
  TrellisClient,
  TrellisDevice,
} from "../index.ts";
import { checkDeviceActivation } from "../device/deno.ts";
import { auth } from "../sdk/auth.ts";
import { TrellisService } from "../service/deno.ts";

const appContract = defineAppContract(() => ({
  id: "trellis.connect-typing-app@v1",
  displayName: "Connect Typing App",
  description: "Typecheck the public client connect helper.",
  uses: {
    auth: auth.useDefaults(),
  },
}));

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

async function typecheckClientConnectRequestSurface() {
  const connected = await TrellisClient.connect({
    trellisUrl: "https://trellis.example",
    contract: appContract,
    auth: {
      mode: "session_key",
      sessionKeySeed: "test-session-seed",
      redirectTo: "https://app.example/callback",
    },
  }).orThrow();

  const me = await connected.request("Auth.Me", {}).orThrow();
  const deviceId: string | undefined = me.device?.deviceId;
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  type ClientMethod = Parameters<typeof connected.request>[0];
  const authMeMethod: ClientMethod = "Auth.Me";

  // @ts-expect-error undeclared RPC methods must not typecheck
  const invalidMethod: ClientMethod = "Auth.NotDeclared";

  return { authMeMethod, deviceId, invalidMethod, participantKind };
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

  // @ts-expect-error undeclared RPC methods must not typecheck
  const invalidMethod: DeviceMethod = "Auth.NotDeclared";

  return { authMeMethod, deviceId, invalidMethod, participantKind };
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
