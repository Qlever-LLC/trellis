import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { isErr } from "@qlever-llc/result";

import type { AccountFlow, UserAccount } from "../schemas.ts";
import { hashKey } from "../crypto.ts";
import {
  createAuthAccountFlowsCreateIdentityLinkHandler,
  createAuthAccountFlowsCreateInviteHandler,
  createAuthAccountFlowsCreatePasswordResetHandler,
  createAuthAccountFlowsCreatePasswordSetupHandler,
} from "./account_flows.ts";

const logger = { trace: () => {} };
const caller = {
  type: "user",
  userId: "usr_admin",
  capabilities: ["admin"],
};
const now = new Date("2026-05-10T12:00:00.000Z");
const portalBaseUrl = "https://trellis.example";

function makeAccount(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    userId: "usr_ada",
    name: "Ada Lovelace",
    email: "ada@example.com",
    active: true,
    capabilities: ["catalog.read"],
    capabilityGroups: [],
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

function stores(saved: { flow?: AccountFlow }, account?: UserAccount) {
  return {
    accountStorage: {
      get: (userId: string) =>
        Promise.resolve(account?.userId === userId ? account : undefined),
    },
    accountFlowStorage: {
      put: (record: AccountFlow) => {
        saved.flow = record;
        return Promise.resolve();
      },
    },
  };
}

Deno.test("Auth.AccountFlows.CreateInvite persists a hashed account invite flow", async () => {
  const saved: { flow?: AccountFlow } = {};
  const handler = createAuthAccountFlowsCreateInviteHandler({
    ...stores(saved, makeAccount()),
    logger,
    portalBaseUrl,
    now,
  });

  const result = await handler({
    input: {
      userId: "usr_ada",
      allowedProviders: ["github", "oidc.acme"],
      profileHint: { email: "ada@example.com" },
      expiresInSeconds: 120,
    },
    context: { caller },
  });

  const value = result.take();
  assert(!isErr(value));
  assertMatch(value.flowId, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(
    value.url,
    `https://trellis.example/_trellis/portal/admin/invite?flowId=${value.flowId}`,
  );
  assertEquals(value.expiresAt, "2026-05-10T12:02:00.000Z");

  assert(saved.flow !== undefined);
  assertEquals(saved.flow.flowIdHash, await hashKey(value.flowId));
  assertEquals(saved.flow.kind, "account_invite");
  assertEquals(saved.flow.targetUserId, "usr_ada");
  assertEquals(saved.flow.createdByUserId, "usr_admin");
  assertEquals(saved.flow.allowedProviders, ["github", "oidc.acme"]);
  assertEquals(saved.flow.capabilities, null);
  assertEquals(saved.flow.profileHint, { email: "ada@example.com" });
  assertEquals(saved.flow.createdAt, "2026-05-10T12:00:00.000Z");
  assertEquals(saved.flow.expiresAt, "2026-05-10T12:02:00.000Z");
  assertEquals(saved.flow.consumedAt, null);
});

Deno.test("account flow create handlers map kind, route, providers, and default TTL", async () => {
  const cases = [{
    name: "password setup",
    create: createAuthAccountFlowsCreatePasswordSetupHandler,
    input: { userId: "usr_ada" },
    kind: "local_password_setup",
    route: "/_trellis/portal/account/password",
    allowedProviders: ["local"],
  }, {
    name: "password reset",
    create: createAuthAccountFlowsCreatePasswordResetHandler,
    input: { userId: "usr_ada" },
    kind: "local_password_reset",
    route: "/_trellis/portal/account/password",
    allowedProviders: ["local"],
  }];

  for (const testCase of cases) {
    const saved: { flow?: AccountFlow } = {};
    const handler = testCase.create({
      ...stores(saved, makeAccount()),
      logger,
      portalBaseUrl,
      now,
    });

    const result = await handler({
      input: testCase.input,
      context: { caller },
    });

    const value = result.take();
    assert(!isErr(value), testCase.name);
    assertEquals(
      value.url,
      `https://trellis.example${testCase.route}?flowId=${value.flowId}`,
    );
    assertEquals(value.expiresAt, "2026-05-11T12:00:00.000Z");
    assert(saved.flow !== undefined);
    assertEquals(saved.flow.kind, testCase.kind);
    assertEquals(saved.flow.allowedProviders, [...testCase.allowedProviders]);
    assertEquals(saved.flow.profileHint, null);
    assertEquals(saved.flow.capabilities, null);
  }
});

Deno.test("Auth.AccountFlows.CreateIdentityLink targets the caller account", async () => {
  const saved: { flow?: AccountFlow } = {};
  const account = makeAccount({ userId: "usr_self" });
  const result = await createAuthAccountFlowsCreateIdentityLinkHandler({
    ...stores(saved, account),
    logger,
    portalBaseUrl: "https://auth.example.test",
    now,
  })({
    input: {},
    context: { caller: { type: "user", userId: "usr_self" } },
  });

  const value = result.take();
  assert(!isErr(value));
  assert(saved.flow !== undefined);
  assertEquals(saved.flow.kind, "identity_link");
  assertEquals(saved.flow.targetUserId, "usr_self");
  assertEquals(saved.flow.allowedProviders, null);
  assert(
    value.url.startsWith(
      "https://auth.example.test/_trellis/portal/account/link?flowId=",
    ),
  );
});

Deno.test("account flow creation returns user_not_found for a missing target account", async () => {
  const saved: { flow?: AccountFlow } = {};
  const handler = createAuthAccountFlowsCreatePasswordResetHandler({
    ...stores(saved, undefined),
    logger,
    portalBaseUrl,
    now,
  });

  const result = await handler({
    input: { userId: "usr_missing" },
    context: { caller },
  });

  const value = result.take();
  assert(isErr(value));
  assertEquals(value.error.reason, "user_not_found");
  assertEquals(value.error.toSerializable().context, { userId: "usr_missing" });
  assertEquals(saved.flow, undefined);
});

Deno.test("account flow creation requires an authenticated user caller", async () => {
  const saved: { flow?: AccountFlow } = {};
  const handler = createAuthAccountFlowsCreateInviteHandler({
    ...stores(saved, makeAccount()),
    logger,
    portalBaseUrl,
    now,
  });

  await assertRejects(
    () =>
      handler({
        input: { userId: "usr_ada" },
        context: { caller: { type: "service" } },
      }),
    Error,
    "insufficient_permissions",
  );
  assertEquals(saved.flow, undefined);
});
