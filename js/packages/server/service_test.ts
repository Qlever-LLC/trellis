import { core } from "@qlever-llc/trellis/sdk/core";
import { assertRejects } from "@std/assert";
import type { TrellisAuth } from "@qlever-llc/trellis/auth";
import type { NatsConnectFn, NatsCredsAuthenticatorFn, TrellisServiceRuntimeDeps } from "./runtime.ts";
import { connectService } from "./service.ts";

const fakeConnect: NatsConnectFn = async () => {
  throw new Error("connect should not be called");
};

const fakeRuntime: TrellisServiceRuntimeDeps = {
  connect: fakeConnect,
};

Deno.test("connectService rejects missing auth or session key seed", async () => {
  await assertRejects(
    () =>
      connectService(core, "svc", {
        nats: { servers: "nats://localhost" },
        server: {},
      }, fakeRuntime),
    Error,
    "requires either opts.auth or opts.sessionKeySeed",
  );
});

Deno.test("connectService requires some NATS authenticator source", async () => {
  const fakeAuth: TrellisAuth = {
    sessionKey: "fake",
    sign: async () => new Uint8Array(),
    oauthInitSig: async () => "sig",
    bindSig: async () => "sig",
    natsConnectSigForBindingToken: async () => "sig",
    natsConnectSigForIat: async () => "sig",
    createProof: async () => "proof",
    createNatsAuthTokenForService: async () => ({ v: 1, sessionKey: "fake", iat: 0, sig: "sig" }),
    natsConnectOptions: async () => ({ token: "t", inboxPrefix: "_INBOX.fake" }),
  };

  await assertRejects(
    () =>
      connectService(
        core,
        "svc",
        {
          auth: fakeAuth,
          nats: { servers: "nats://localhost" },
          server: {},
        },
        {
          connect: fakeConnect,
          credsAuthenticator: (_creds: Uint8Array) => {
            throw new Error("creds authenticator should not be called");
          },
        },
      ),
    Error,
    "requires opts.nats.authenticator",
  );
});

Deno.test("connectService requires auth or sessionKeySeed", async () => {
  await assertRejects(
    () =>
      connectService(core, "svc", {
        nats: { servers: "nats://localhost" },
        server: {},
      }, fakeRuntime),
    Error,
    "requires either opts.auth or opts.sessionKeySeed",
  );
});
