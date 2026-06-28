import { assert, assertEquals } from "@std/assert";
import { isErr, TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { waitFor } from "@qlever-llc/trellis-test";
import { createServiceApprovalFixture } from "../service-approval/_fixture.ts";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import {
  createDeviceActivationFixture,
  requireDeviceAuthorityList,
} from "../device-activation/_fixture.ts";

const CASE_ID =
  "auth.sessions-revoke-revokes-device-and-service-access" as const;
const deviceFixture = createDeviceActivationFixture(CASE_ID);
const serviceFixture = createServiceApprovalFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-revoke-revokes-device-and-service-access revokes device activation and disables service instance",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const { admin, deploymentId } = await deviceFixture.setupDeviceDeployment(
      runtime,
    );
    const { identity, rootSecret, provisioned } = await deviceFixture
      .setupProvisionedDevice(
        admin,
        deploymentId,
      );
    const { nonce, flowId } = await deviceFixture.setupActivationRequest(
      runtime,
      identity,
    );
    await deviceFixture.setupResolveActivation(
      admin,
      flowId,
      deploymentId,
      provisioned.instance.instanceId,
    );
    await waitForDeviceActivation({
      trellisUrl: runtime.trellisUrl,
      flowId,
      publicIdentityKey: identity.publicIdentityKey,
      nonce,
      identitySeed: identity.identitySeed,
      contractDigest: deviceFixture.deviceContract.CONTRACT_DIGEST,
      pollIntervalMs: 25,
    });

    const device = await TrellisDevice.connect({
      trellisUrl: runtime.trellisUrl,
      contract: deviceFixture.deviceContract,
      rootSecret,
      log: false,
    }).orThrow();
    try {
      const me = await device.request("Auth.Sessions.Me", {}).orThrow();
      const sessionKey = await sessionKeyFor(
        admin,
        "device",
        provisioned.instance.instanceId,
      );

      const revoked = await admin.rpc.auth.sessionsRevoke({ sessionKey })
        .orThrow();
      assertEquals(revoked.success, true);

      await waitFor(async () => {
        const activations = requireDeviceAuthorityList(
          await admin.rpc.auth.deviceUserAuthoritiesList({
            deploymentId,
            instanceId: provisioned.instance.instanceId,
            state: "revoked",
            limit: 20,
          }).orThrow(),
        );
        return activations.entries.some((entry) =>
          entry.instanceId === provisioned.instance.instanceId &&
          entry.publicIdentityKey === identity.publicIdentityKey &&
          entry.deploymentId === deploymentId &&
          entry.state === "revoked"
        );
      });
      await waitForSessionAbsent(admin, sessionKey);
      await waitFor(async () =>
        (await device.request("Auth.Sessions.Me", {})).isErr()
      );
      assertEquals(me.participantKind, "device");
    } finally {
      await device.connection.close().catch(() => undefined);
    }

    const reconnectDevice = await TrellisDevice.connect({
      trellisUrl: runtime.trellisUrl,
      contract: deviceFixture.deviceContract,
      rootSecret,
      log: false,
    });
    const reconnectDeviceValue = reconnectDevice.take();
    if (!isErr(reconnectDeviceValue)) {
      await reconnectDeviceValue.connection.close();
    }
    assert(isErr(reconnectDeviceValue), "revoked device should not reconnect");

    const serviceKey = await runtime.registerService({
      name: serviceFixture.serviceName,
      contract: serviceFixture.serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceFixture.serviceContract,
      name: serviceFixture.serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    }).orThrow();
    try {
      const serviceSessionKey = await sessionKeyFor(
        admin,
        "service",
        serviceKey.sessionKey,
      );
      const revoked = await admin.rpc.auth.sessionsRevoke({
        sessionKey: serviceSessionKey,
      }).orThrow();
      assertEquals(revoked.success, true);

      await waitForSessionAbsent(admin, serviceSessionKey);
      await waitFor(async () =>
        (await admin.rpc.auth.serviceInstancesList({
          deploymentId: "test",
          disabled: true,
          limit: 100,
        }).orThrow()).entries.some((entry) =>
          entry.instanceKey === serviceKey.sessionKey && entry.disabled
        )
      );
    } finally {
      await service.stop().catch(() => undefined);
    }

    const reconnectService = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceFixture.serviceContract,
      name: serviceFixture.serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: {},
    });
    const reconnectServiceValue = reconnectService.take();
    if (!isErr(reconnectServiceValue)) {
      await reconnectServiceValue.stop();
    }
    assert(
      isErr(reconnectServiceValue),
      "disabled service instance should not reconnect",
    );
  },
});

async function sessionKeyFor(
  admin: Awaited<
    ReturnType<typeof deviceFixture.setupDeviceDeployment>
  >["admin"],
  kind: "device" | "service",
  id: string,
): Promise<string> {
  const sessions = await admin.rpc.auth.sessionsList({ limit: 500 }).orThrow();
  const session = sessions.entries.find((entry) => {
    if (entry.sessionKey === id) return true;
    if (entry.participantKind !== kind) return false;
    if (entry.principal.type === "device") {
      return entry.principal.deviceId === id;
    }
    if (entry.principal.type === "service") {
      return entry.principal.id === id || entry.principal.instanceId === id;
    }
    return false;
  });
  assert(session, `expected ${kind} session`);
  return session.sessionKey;
}

async function waitForSessionAbsent(
  admin: Awaited<
    ReturnType<typeof deviceFixture.setupDeviceDeployment>
  >["admin"],
  sessionKey: string,
) {
  await waitFor(async () => {
    const sessions = await admin.rpc.auth.sessionsList({ limit: 500 })
      .orThrow();
    return sessions.entries.every((entry) => entry.sessionKey !== sessionKey);
  });
}
