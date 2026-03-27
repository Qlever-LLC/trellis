import { core } from "@qlever-llc/trellis-sdk-core";
import { assertRejects } from "@std/assert";
import { connectService } from "./service.ts";

const fakeRuntime = {
  connect: (() => {
    throw new Error("connect should not be called");
  }) as never,
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
  const fakeAuth = {
    sessionKey: "fake",
    sign: async () => new Uint8Array(),
    natsConnectOptions: async () => ({ token: "t", inboxPrefix: "_INBOX.fake" }),
  } as never;

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
          connect: (() => {
            throw new Error("connect should not be called");
          }) as never,
          credsAuthenticator: (() => {
            throw new Error("creds authenticator should not be called");
          }) as never,
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
