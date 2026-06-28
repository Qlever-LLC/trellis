import { assert, assertEquals } from "@std/assert";
import { Result, TrellisClient } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { createRpcFixture } from "./_fixture.ts";

const CASE_ID =
  "rpc.auth-validation-retries-transient-session-not-found" as const;
const fixture = createRpcFixture(CASE_ID);

function isSessionNotFoundAuthError(payload: string): boolean {
  try {
    const value: unknown = JSON.parse(payload);
    return typeof value === "object" && value !== null &&
      Reflect.get(value, "type") === "AuthError" &&
      Reflect.get(value, "reason") === "session_not_found";
  } catch {
    return false;
  }
}

liveTrellisTest({
  name:
    "rpc.auth-validation-retries-transient-session-not-found retries after a transient missing auth session",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const sqlite = runtime.controlPlane?.sqlite;
    assert(sqlite, "live runtime must expose control-plane SQLite");

    const serviceKey = await runtime.registerService({
      name: fixture.serviceName,
      contract: fixture.serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.serviceContract,
      name: fixture.serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();
    const clientKey = await runtime.registerClient({
      name: fixture.clientName,
      contract: fixture.clientContract,
    });
    const clientAuth = runtime.clientAuth(clientKey);
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      contract: fixture.clientContract,
      name: fixture.clientName,
      ...clientAuth,
    }).orThrow();
    assert(
      runtime.startNatsMessageObserver,
      "live runtime must expose raw NATS observation",
    );
    const observer = await runtime.startNatsMessageObserver(
      "rpc.v1.Auth.Requests.Validate",
    );
    const authReplyObserver = await runtime.startNatsMessageObserver(
      `_INBOX.${serviceKey.sessionKey.slice(0, 16)}.>`,
      ["status"],
    );

    try {
      let handlerCalls = 0;
      await service.handle.rpc.entity.get(({ input }) => {
        handlerCalls += 1;
        return Result.ok({ id: input.id, found: true });
      });

      const sessionSnapshot = await runtime.waitFor(() =>
        sqlite.takeSession(clientKey.sessionKey)
      );
      const call = client.rpc.entity.get({ id: fixture.entityId }).orThrow();
      await runtime.waitFor(
        () =>
          authReplyObserver.frames().some((frame) =>
            frame.headers.status === "error" &&
            isSessionNotFoundAuthError(frame.payload)
          ),
        { intervalMs: 1 },
      );
      await sessionSnapshot.restore();

      const result = await call;
      assertEquals(result.id, fixture.entityId);
      assertEquals(result.found, true);
      assertEquals(handlerCalls, 1);
      assertEquals(observer.frames().length, 2);
      assertEquals(observer.errors().length, 0);
    } finally {
      await authReplyObserver.stop();
      await observer.stop();
      await client.connection.close();
      await service.stop();
    }
  },
});
