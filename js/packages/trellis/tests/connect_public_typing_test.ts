import { assertEquals } from "@std/assert";

import {
  defineAppContract,
  defineDeviceContract,
  TrellisClient,
  TrellisDevice,
} from "../index.ts";
import { auth } from "../sdk/auth.ts";

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

async function typecheckClientConnectRequestSurface() {
  const connected = await TrellisClient.connect({
    trellisUrl: "https://trellis.example",
    contract: appContract,
    auth: {
      mode: "session_key",
      sessionKeySeed: "test-session-seed",
      redirectTo: "https://app.example/callback",
    },
  });

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
  });

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

void typecheckClientConnectRequestSurface;
void typecheckDeviceConnectRequestSurface;

Deno.test("public connect helpers preserve contract-derived request typing", () => {
  assertEquals(true, true);
});
