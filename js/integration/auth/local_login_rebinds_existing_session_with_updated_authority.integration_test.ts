import { assert, assertEquals } from "@std/assert";
import {
  type ConnectedTrellisClient,
  TrellisClient,
} from "@qlever-llc/trellis";
import type {
  AuthConnectionsListOutput,
  AuthSessionsListOutput,
} from "@qlever-llc/trellis/sdk/auth";
import { waitFor } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID =
  "auth.local-login-rebinds-existing-session-with-updated-authority" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);
type SessionAdminClient = Awaited<ReturnType<typeof fixture.setupSessionAdmin>>;
type AppSession = Extract<
  AuthSessionsListOutput["entries"][number],
  { participantKind: "app" }
>;
type AppConnection = Extract<
  AuthConnectionsListOutput["entries"][number],
  { participantKind: "app" }
>;

liveTrellisTest({
  name:
    "auth.local-login-rebinds-existing-session-with-updated-authority rebinds an existing app session and refreshes runtime authority",
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
    let reboundClient:
      | ConnectedTrellisClient<typeof fixture.updatedClientContract>
      | undefined;

    try {
      originalClient = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.clientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => await clientAuth.onAuthRequired(ctx),
      }).orThrow();
      await originalClient.rpc.authLogin.ping({
        message: fixture.pingMessage,
      }).orThrow();

      const beforeSession = await appSessionFor(admin, clientKey.sessionKey);
      const beforeConnection = await singleConnectionFor(
        admin,
        clientKey.sessionKey,
      );

      let authRequired = false;
      reboundClient = await TrellisClient.connect({
        trellisUrl: runtime.trellisUrl,
        name: fixture.clientName,
        contract: fixture.updatedClientContract,
        auth: clientAuth.auth,
        onAuthRequired: async (ctx) => {
          authRequired = true;
          return await clientAuth.onAuthRequired(ctx);
        },
      }).orThrow();

      assert(authRequired, "expected updated authority to require local login");
      const afterSession = await appSessionFor(admin, clientKey.sessionKey);
      assertEquals(afterSession.createdAt, beforeSession.createdAt);
      assertEquals(
        afterSession.principal.userId,
        beforeSession.principal.userId,
      );
      assertEquals(
        afterSession.contractDisplayName,
        fixture.updatedClientDisplayName,
      );

      const allowedByUpdatedAuthority = await reboundClient.rpc.auth
        .connectionsList({ sessionKey: clientKey.sessionKey, limit: 500 })
        .orThrow();
      assertEquals(allowedByUpdatedAuthority.entries.length, 1);

      await waitFor(async () => {
        const connection = await singleConnectionFor(
          admin,
          clientKey.sessionKey,
        );
        return connection.userNkey !== beforeConnection.userNkey && connection;
      });
      await waitFor(async () => {
        const result = await originalClient!.rpc.auth.sessionsMe({});
        return result.isErr();
      });
    } finally {
      await reboundClient?.connection.close().catch(() => undefined);
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

async function singleConnectionFor(
  admin: SessionAdminClient,
  sessionKey: string,
): Promise<AppConnection> {
  const page = await waitFor(async () => {
    const connections = await admin.rpc.auth.connectionsList({
      sessionKey,
      limit: 500,
    }).orThrow();
    return connections.entries.length === 1 && connections;
  });
  const [connection] = page.entries;
  assert(connection, "expected exactly one app connection");
  assertEquals(connection.participantKind, "app");
  if (connection.participantKind !== "app") {
    throw new Error("expected app connection");
  }
  return connection;
}
