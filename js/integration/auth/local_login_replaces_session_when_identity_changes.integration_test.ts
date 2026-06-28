import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  type ClientAuthContinuation,
  type ClientAuthRequiredContext,
  type ConnectedTrellisClient,
  TrellisClient,
} from "@qlever-llc/trellis";
import type { AuthSessionsListOutput } from "@qlever-llc/trellis/sdk/auth";
import { waitFor } from "@qlever-llc/trellis-test";
import { caseScopedName } from "../_support/names.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID =
  "auth.local-login-replaces-session-when-identity-changes" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);
const alternateUsername = caseScopedName(
  "auth-local-login-replacement",
  CASE_ID,
);
const alternatePassword =
  `trellis-integration-${CASE_ID}-replacement-password-2026`;
type SessionAdminClient = Awaited<ReturnType<typeof fixture.setupSessionAdmin>>;
type AppSession = Extract<
  AuthSessionsListOutput["entries"][number],
  { participantKind: "app" }
>;

liveTrellisTest({
  name:
    "auth.local-login-replaces-session-when-identity-changes replaces an app session bound to a different identity",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const admin = await fixture.setupSessionAdmin(runtime);
    const { clientKey, clientAuth } = await fixture.setupClientRegistration(
      runtime,
    );
    let originalClient:
      | ConnectedTrellisClient<typeof fixture.clientContract>
      | undefined;
    let replacementClient:
      | ConnectedTrellisClient<typeof fixture.updatedClientContract>
      | undefined;

    try {
      const replacementUser = await admin.rpc.auth.usersCreate({
        username: alternateUsername,
        name: "Replacement Local Login Admin",
        email: `${alternateUsername}@example.test`,
        active: true,
        capabilityGroups: ["admin"],
      }).orThrow();
      const reset = await admin.rpc.auth.usersPasswordResetCreate({
        userId: replacementUser.user.userId,
      }).orThrow();
      await completeLocalPasswordAccountFlow({
        trellisUrl: runtime.trellisUrl,
        flowId: reset.flowId,
        username: alternateUsername,
        password: alternatePassword,
      });

      originalClient = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => await clientAuth.onAuthRequired(ctx),
      }).orThrow();
      const beforeSession = await appSessionFor(admin, clientKey.sessionKey);

      let authRequired = false;
      replacementClient = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.updatedClientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => {
          authRequired = true;
          return await completeLocalLoginFlow({
            admin,
            trellisUrl: runtime.trellisUrl,
            userId: replacementUser.user.userId,
            username: alternateUsername,
            password: alternatePassword,
            ctx,
          });
        },
      }).orThrow();

      assert(
        authRequired,
        "expected identity replacement to require local login",
      );
      const afterSession = await waitFor(async () => {
        const session = await appSessionFor(admin, clientKey.sessionKey);
        return session.principal.userId === replacementUser.user.userId &&
          session;
      });
      assertEquals(afterSession.sessionKey, beforeSession.sessionKey);
      assertNotEquals(
        afterSession.principal.userId,
        beforeSession.principal.userId,
      );
      assertEquals(
        afterSession.contractDisplayName,
        fixture.updatedClientDisplayName,
      );

      const me = await replacementClient.rpc.auth.sessionsMe({}).orThrow();
      assertEquals(me.user?.userId, replacementUser.user.userId);
      await waitFor(async () => {
        const result = await originalClient!.rpc.auth.sessionsMe({});
        return result.isErr();
      });
    } finally {
      await replacementClient?.connection.close().catch(() => undefined);
      await originalClient?.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});

async function appSessionFor(
  admin: SessionAdminClient,
  sessionKey: string,
): Promise<AppSession> {
  const sessions = await admin.rpc.auth.sessionsList({ limit: 500 }).orThrow();
  const session = sessions.entries.find((entry): entry is AppSession =>
    entry.participantKind === "app" && entry.sessionKey === sessionKey
  );
  assert(session, "expected Auth.Sessions.List to include app session");
  return session;
}

async function completeLocalPasswordAccountFlow(args: {
  trellisUrl: string;
  flowId: string;
  username: string;
  password: string;
}): Promise<void> {
  const response = await fetch(
    `${args.trellisUrl}/auth/account-flow/${
      encodeURIComponent(args.flowId)
    }/local-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: args.username,
        password: args.password,
      }),
    },
  );
  const body = await response.text();
  assertEquals(response.status, 200, body);
  const payload: unknown = JSON.parse(body);
  assert(isRecord(payload), "expected account-flow completion response object");
  assertEquals(payload.status, "created");
}

async function completeLocalLoginFlow(args: {
  admin: SessionAdminClient;
  trellisUrl: string;
  userId: string;
  username: string;
  password: string;
  ctx: ClientAuthRequiredContext;
}): Promise<ClientAuthContinuation> {
  const flowId = flowIdFromUrl(args.ctx.loginUrl);
  const loginResponse = await fetch(`${args.trellisUrl}/auth/login/local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      flowId,
      username: args.username,
      password: args.password,
    }),
  });
  if (!loginResponse.ok) {
    const body = await loginResponse.text().catch(() => "");
    throw new Error(
      `local login failed (${loginResponse.status})${body ? `: ${body}` : ""}`,
    );
  }

  let state = await fetchJson(
    `${args.trellisUrl}/auth/flow/${encodeURIComponent(flowId)}`,
  );
  assert(isRecord(state), "expected portal flow state response object");
  if (state.status === "insufficient_capabilities") {
    const missingCapabilities = stringArray(state.missingCapabilities);
    await args.admin.rpc.auth.usersUpdate({
      userId: args.userId,
      capabilities: [...new Set(["admin", ...missingCapabilities])].sort(),
    }).orThrow();
    state = await fetchJson(
      `${args.trellisUrl}/auth/flow/${encodeURIComponent(flowId)}`,
    );
    assert(isRecord(state), "expected portal flow state response object");
  }
  if (state.status === "approval_required") {
    const approved = await fetchJson(
      `${args.trellisUrl}/auth/flow/${encodeURIComponent(flowId)}/approval`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      },
    );
    assert(isRecord(approved), "expected portal approval response object");
    assertEquals(approved.status, "redirect");
  } else {
    assertEquals(state.status, "redirect");
  }

  return { status: "bound", flowId };
}

function flowIdFromUrl(url: string): string {
  const flowId = new URL(url).searchParams.get("flowId");
  if (!flowId) throw new Error(`Trellis auth URL is missing flowId: ${url}`);
  return flowId;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `HTTP request failed (${response.status}) for ${url}${
        body ? `: ${body}` : ""
      }`,
    );
  }
  return await response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  assert(Array.isArray(value), "expected missingCapabilities array");
  for (const entry of value) {
    assert(typeof entry === "string", "expected capability string");
  }
  return value;
}
