import { assertEquals, assertNotEquals } from "@std/assert";
import { Result } from "@qlever-llc/result";
import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import * as trellisAuth from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";

import { caseScopedContractId, caseScopedName } from "../_support/names.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID = "auth.user-lifecycle-service-automation";
const fixture = createAuthLocalLoginFixture(CASE_ID);
const targetUsername = caseScopedName("lifecycle-target", CASE_ID);
const targetPassword = `trellis-integration-${CASE_ID}-password-2026`;

const schemas = {
  LifecycleRunInput: Type.Object({
    action: Type.Union([
      Type.Literal("inspect"),
      Type.Literal("deactivate"),
      Type.Literal("unlink"),
    ]),
    userId: Type.String({ minLength: 1 }),
    provider: Type.String({ minLength: 1 }),
    subject: Type.String({ minLength: 1 }),
  }),
  LifecycleRunOutput: Type.Object({
    found: Type.Boolean(),
    active: Type.Union([Type.Boolean(), Type.Null()]),
    deactivated: Type.Boolean(),
    revokedSessions: Type.Integer({ minimum: 0 }),
    unlinked: Type.Boolean(),
    hasAdmin: Type.Boolean(),
    hasLifecycleManage: Type.Boolean(),
  }),
};

const lifecycleServiceContract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: caseScopedContractId("trellis.integration.lifecycle-service", CASE_ID),
    displayName: "Lifecycle Automation Integration Service",
    description:
      "Proves exact-identity lifecycle automation through service authority.",
    uses: [
      trellisAuth.AuthUserLifecycleInspect,
      trellisAuth.AuthUserLifecycleDeactivate,
      trellisAuth.AuthUserLifecycleUnlink,
      trellisAuth.AuthSessionsMe,
    ],
    rpc: {
      "Lifecycle.Run": {
        version: "v1",
        input: ref.schema("LifecycleRunInput"),
        output: ref.schema("LifecycleRunOutput"),
        capabilities: { call: [] },
        errors: ["AuthError", "UnexpectedError"],
      },
    },
  }),
);

const lifecycleClientContract = defineAppContract(() => ({
  id: caseScopedContractId("trellis.integration.lifecycle-client", CASE_ID),
  displayName: "Lifecycle Automation Integration Client",
  description: "Invokes the lifecycle integration service.",
  uses: [lifecycleServiceContract.LifecycleRun],
}));

liveTrellisTest({
  name:
    "auth.user-lifecycle-service-automation permits exact lifecycle actions without admin authority",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const admin = await fixture.setupSessionAdmin(runtime);
    const target = await admin.authUsersCreate({
      username: targetUsername,
      name: "Lifecycle Automation Target",
      email: `${targetUsername}@example.test`,
      active: true,
    }).orThrow();
    const reset = await admin.authUsersPasswordResetCreate({
      userId: target.user.userId,
    }).orThrow();
    await completeLocalPasswordAccountFlow({
      trellisUrl: runtime.trellisUrl,
      flowId: reset.flowId,
      username: targetUsername,
      password: targetPassword,
    });
    const sqlite = runtime.controlPlane?.sqlite;
    if (!sqlite) {
      throw new Error("Expected isolated control-plane SQLite access");
    }
    const credentialRows = await sqlite.query(
      `select local_credentials.identity_id as identityId
       from local_credentials
       inner join user_identities using (identity_id)
       where user_identities.provider = 'local'
         and user_identities.subject = ?`,
      [targetUsername],
    );
    assertEquals(credentialRows.length, 1);
    const identityId = credentialRows[0]?.identityId;
    if (typeof identityId !== "string") {
      throw new Error("Expected local credential identity id");
    }
    const serviceKey = await runtime.registerService({
      name: caseScopedName("lifecycle-service", CASE_ID),
      contract: lifecycleServiceContract,
      deployment: caseScopedName("lifecycle-service", CASE_ID),
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: lifecycleServiceContract,
      name: caseScopedName("lifecycle-service", CASE_ID),
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();
    await service.handleLifecycleRun(async ({ input, client }) => {
      if (input.action === "inspect") {
        const result = await client.authUserLifecycleInspect(input).orThrow();
        const session = await client.authSessionsMe({}).orThrow();
        const capabilities = session.service?.capabilities ?? [];
        return Result.ok({
          found: result.found,
          active: result.active,
          deactivated: false,
          revokedSessions: 0,
          unlinked: false,
          hasAdmin: capabilities.includes("admin"),
          hasLifecycleManage: capabilities.some((capability) =>
            capability.endsWith("::user_lifecycle.manage")
          ),
        });
      }
      if (input.action === "deactivate") {
        const result = await client.authUserLifecycleDeactivate(input)
          .orThrow();
        return Result.ok({
          found: true,
          active: false,
          deactivated: result.deactivated,
          revokedSessions: result.revokedSessions,
          unlinked: false,
          hasAdmin: false,
          hasLifecycleManage: true,
        });
      }
      const result = await client.authUserLifecycleUnlink(input).orThrow();
      return Result.ok({
        found: true,
        active: false,
        deactivated: false,
        revokedSessions: 0,
        unlinked: result.unlinked,
        hasAdmin: false,
        hasLifecycleManage: true,
      });
    });
    const client = await runtime.connectClient({
      name: caseScopedName("lifecycle-client", CASE_ID),
      contract: lifecycleClientContract,
    });
    const input = {
      userId: target.user.userId,
      provider: "local",
      subject: targetUsername,
    };

    try {
      const inspected = await client.lifecycleRun({
        ...input,
        action: "inspect",
      }).orThrow();
      assertEquals(inspected.found, true);
      assertEquals(inspected.active, true);
      assertEquals(inspected.hasAdmin, false);
      assertEquals(inspected.hasLifecycleManage, true);

      const deactivated = await client.lifecycleRun({
        ...input,
        action: "deactivate",
      }).orThrow();
      assertEquals(deactivated.deactivated, true);
      const alreadyDeactivated = await client.lifecycleRun({
        ...input,
        action: "deactivate",
      }).orThrow();
      assertEquals(alreadyDeactivated.deactivated, false);
      assertEquals(alreadyDeactivated.revokedSessions, 0);

      const unlinked = await client.lifecycleRun({
        ...input,
        action: "unlink",
      }).orThrow();
      assertEquals(unlinked.unlinked, true);
      assertEquals(
        (await sqlite.query(
          "select identity_id from local_credentials where identity_id = ?",
          [identityId],
        )).length,
        0,
      );
      const alreadyUnlinked = await client.lifecycleRun({
        ...input,
        action: "unlink",
      }).orThrow();
      assertEquals(alreadyUnlinked.unlinked, false);

      const missing = await client.lifecycleRun({
        ...input,
        action: "inspect",
      }).orThrow();
      assertEquals(missing.found, false);

      const replacement = await admin.authUsersCreate({
        username: targetUsername,
        name: "Lifecycle Automation Replacement",
        email: `${targetUsername}@example.test`,
        active: true,
      }).orThrow();
      assertNotEquals(replacement.user.userId, target.user.userId);
      const replacementReset = await admin.authUsersPasswordResetCreate({
        userId: replacement.user.userId,
      }).orThrow();
      await completeLocalPasswordAccountFlow({
        trellisUrl: runtime.trellisUrl,
        flowId: replacementReset.flowId,
        username: targetUsername,
        password: targetPassword,
      });
    } finally {
      await client.connection.close().catch(() => undefined);
      await service.stop();
      await admin.connection.close().catch(() => undefined);
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
}
