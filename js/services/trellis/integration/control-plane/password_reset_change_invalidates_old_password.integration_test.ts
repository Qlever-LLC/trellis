import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type ClientAuthContinuation,
  type ClientAuthRequiredContext,
  type ConnectedTrellisClient,
  defineAppContract,
  TrellisClient,
} from "@qlever-llc/trellis";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import {
  caseScopedContractId,
  caseScopedName,
} from "@qlever-llc/trellis-test/integration";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";

const CASE_ID =
  "control-plane.password-reset-change-invalidates-old-password" as const;
const localAdminUsername = caseScopedName("password-reset-admin", CASE_ID);
const knownOldPassword = `trellis-integration-${CASE_ID}-old-password-2026`;
const knownNewPassword = `trellis-integration-${CASE_ID}-new-password-2026`;

const passwordAdminContract = defineAppContract(() => ({
  id: caseScopedContractId(
    "trellis.integration.control-plane.password-reset-change-client",
    CASE_ID,
  ),
  displayName: "Trellis Control-Plane Password Reset Change Client",
  description:
    "Verifies live local password reset and authenticated password change behavior.",
  uses: {
    required: {
      auth: trellisAuth.use({
        rpc: {
          call: [
            "Auth.Sessions.Me",
            "Auth.Users.Create",
            "Auth.Users.Password.Change",
            "Auth.Users.PasswordReset.Create",
          ],
        },
      }),
    },
  },
}));

const initialClientName = caseScopedName("password-reset-initial", CASE_ID);
const oldPasswordClientName = caseScopedName("password-reset-old", CASE_ID);
const rejectedClientName = caseScopedName("password-reset-rejected", CASE_ID);
const newPasswordClientName = caseScopedName("password-reset-new", CASE_ID);

liveTrellisTest({
  name:
    "control-plane.password-reset-change-invalidates-old-password changes the local admin password and rejects the old password",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const initialClient = await runtime.connectClient({
      name: initialClientName,
      contract: passwordAdminContract,
    });
    let oldPasswordClient:
      | ConnectedTrellisClient<typeof passwordAdminContract>
      | undefined;
    let newPasswordClient:
      | ConnectedTrellisClient<typeof passwordAdminContract>
      | undefined;

    try {
      const created = await initialClient.rpc.auth.usersCreate({
        username: localAdminUsername,
        name: "Password Reset Change Admin",
        email: `${localAdminUsername}@example.test`,
        active: true,
        capabilityGroups: ["admin"],
      }).orThrow();

      const reset = await initialClient.rpc.auth.usersPasswordResetCreate({
        userId: created.user.userId,
      }).orThrow();
      await completeLocalPasswordAccountFlow({
        trellisUrl: runtime.trellisUrl,
        flowId: reset.flowId,
        username: localAdminUsername,
        password: knownOldPassword,
      });
      await initialClient.connection.close().catch(() => undefined);

      const oldPasswordKey = await runtime.registerClient({
        name: oldPasswordClientName,
        contract: passwordAdminContract,
      });
      oldPasswordClient = await connectWithLocalPassword({
        trellisUrl: runtime.trellisUrl,
        name: oldPasswordClientName,
        sessionKeySeed: oldPasswordKey.seed,
        username: localAdminUsername,
        password: knownOldPassword,
      });

      assertEquals(
        await oldPasswordClient.rpc.auth.usersPasswordChange({
          currentPassword: knownOldPassword,
          newPassword: knownNewPassword,
        }).orThrow(),
        { success: true },
      );

      const rejectedKey = await runtime.registerClient({
        name: rejectedClientName,
        contract: passwordAdminContract,
      });
      await assertLocalPasswordRejected({
        trellisUrl: runtime.trellisUrl,
        name: rejectedClientName,
        sessionKeySeed: rejectedKey.seed,
        username: localAdminUsername,
        password: knownOldPassword,
      });

      const newPasswordKey = await runtime.registerClient({
        name: newPasswordClientName,
        contract: passwordAdminContract,
      });
      newPasswordClient = await connectWithLocalPassword({
        trellisUrl: runtime.trellisUrl,
        name: newPasswordClientName,
        sessionKeySeed: newPasswordKey.seed,
        username: localAdminUsername,
        password: knownNewPassword,
      });
      const newPasswordMe = await newPasswordClient.rpc.auth.sessionsMe({})
        .orThrow();
      assertEquals(newPasswordMe.user?.userId, created.user.userId);
    } finally {
      await newPasswordClient?.connection.close().catch(() => undefined);
      await oldPasswordClient?.connection.close().catch(() => undefined);
      await initialClient.connection.close().catch(() => undefined);
    }
  },
});

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

async function connectWithLocalPassword(args: {
  trellisUrl: string;
  name: string;
  sessionKeySeed: string;
  username: string;
  password: string;
}): Promise<ConnectedTrellisClient<typeof passwordAdminContract>> {
  return await TrellisClient.connect({
    trellisUrl: args.trellisUrl,
    name: args.name,
    contract: passwordAdminContract,
    auth: {
      mode: "session_key",
      sessionKeySeed: args.sessionKeySeed,
      redirectTo: `${args.trellisUrl}/_trellis/test/password-reset-change`,
    },
    onAuthRequired: (ctx) => completeLocalLoginFlow({ ...args, ctx }),
  }).orThrow();
}

async function assertLocalPasswordRejected(args: {
  trellisUrl: string;
  name: string;
  sessionKeySeed: string;
  username: string;
  password: string;
}): Promise<void> {
  let loginFailure: { status: number; body: string } | undefined;
  await assertRejects(async () => {
    const client = await TrellisClient.connect({
      trellisUrl: args.trellisUrl,
      name: args.name,
      contract: passwordAdminContract,
      auth: {
        mode: "session_key",
        sessionKeySeed: args.sessionKeySeed,
        redirectTo: `${args.trellisUrl}/_trellis/test/password-reset-change`,
      },
      onAuthRequired: async (ctx) => {
        const flowId = flowIdFromUrl(ctx.loginUrl);
        const response = await fetch(`${args.trellisUrl}/auth/login/local`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            flowId,
            username: args.username,
            password: args.password,
          }),
        });
        loginFailure = { status: response.status, body: await response.text() };
        throw new Error("local password rejected");
      },
    }).orThrow();
    await client.connection.close().catch(() => undefined);
    throw new Error("old password unexpectedly connected");
  });

  assert(loginFailure !== undefined, "expected local login to be attempted");
  assertEquals(loginFailure.status, 403, loginFailure.body);
  assert(
    loginFailure.body.includes("invalid_credentials"),
    `expected invalid_credentials response, got: ${loginFailure.body}`,
  );
}

async function completeLocalLoginFlow(args: {
  trellisUrl: string;
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

  const state = await fetchJson(
    `${args.trellisUrl}/auth/flow/${encodeURIComponent(flowId)}`,
  );
  assert(isRecord(state), "expected portal flow state response object");
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
