import { assert, assertEquals } from "@std/assert";
import { TrellisClient, TrellisDevice } from "@qlever-llc/trellis";
import { waitForDeviceActivation } from "@qlever-llc/trellis/auth";
import { waitFor } from "@qlever-llc/trellis-test";
import { liveTrellisTest, runtimeScopeForCase } from "../_support/runtime.ts";
import { caseScopedName } from "../_support/names.ts";
import { createDeviceActivationFixture } from "../device-activation/_fixture.ts";
import { createAuthLocalLoginFixture } from "./_fixture.ts";

const CASE_ID =
  "auth.sessions-list-and-connections-list-report-participant-metadata" as const;
const fixture = createAuthLocalLoginFixture(CASE_ID);
const deviceFixture = createDeviceActivationFixture(CASE_ID);

liveTrellisTest({
  name:
    "auth.sessions-list-and-connections-list-report-participant-metadata reports app, agent, device, and service metadata",
  scope: runtimeScopeForCase(CASE_ID),
  async fn(runtime) {
    const service = await fixture.setupService(runtime);
    const admin = await fixture.setupSessionAdmin(runtime);
    const { clientKey, clientAuth } = await fixture.setupClientRegistration(
      runtime,
    );
    const agentKey = await runtime.registerClient({
      name: caseScopedName("auth-list-metadata-agent", CASE_ID),
      contract: fixture.agentContract,
    });
    const client = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: fixture.clientName,
      contract: fixture.clientContract,
      ...clientAuth,
    }).orThrow();
    const agent = await TrellisClient.connect({
      trellisUrl: runtime.trellisUrl,
      name: caseScopedName("auth-list-metadata-agent", CASE_ID),
      contract: fixture.agentContract,
      ...runtime.clientAuth(agentKey),
    }).orThrow();
    const { admin: deviceAdmin, deploymentId } = await deviceFixture
      .setupDeviceDeployment(runtime);
    const { identity, rootSecret, provisioned } = await deviceFixture
      .setupProvisionedDevice(deviceAdmin, deploymentId);
    const { nonce, flowId } = await deviceFixture.setupActivationRequest(
      runtime,
      identity,
    );
    await deviceFixture.setupResolveActivation(
      deviceAdmin,
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
      await client.rpc.authLogin.ping({ message: fixture.pingMessage })
        .orThrow();
      await agent.rpc.authLogin.ping({ message: fixture.pingMessage })
        .orThrow();
      await device.request("Auth.Sessions.Me", {}).orThrow();

      const sessions = await waitFor(async () => {
        const page = await admin.rpc.auth.sessionsList({ limit: 500 })
          .orThrow();
        return page.entries.some((entry) => entry.participantKind === "app") &&
            page.entries.some((entry) => entry.participantKind === "agent") &&
            page.entries.some((entry) => entry.participantKind === "device") &&
            page.entries.some((entry) => entry.participantKind === "service")
          ? page
          : false;
      });
      const appSession = sessions.entries.find((entry) =>
        entry.participantKind === "app" &&
        entry.sessionKey === clientKey.sessionKey
      );
      if (!appSession || appSession.participantKind !== "app") {
        throw new Error("expected Auth.Sessions.List to include app session");
      }
      assertEquals(appSession.principal.type, "user");
      assert(appSession.principal.userId.length > 0);
      assertEquals(appSession.contractId, fixture.clientContract.CONTRACT_ID);
      assertEquals(
        appSession.contractDisplayName,
        fixture.clientDisplayName,
      );

      const agentSession = sessions.entries.find((entry) =>
        entry.participantKind === "agent" &&
        entry.sessionKey === agentKey.sessionKey
      );
      if (!agentSession || agentSession.participantKind !== "agent") {
        throw new Error("expected Auth.Sessions.List to include agent session");
      }
      assertEquals(agentSession.principal.type, "user");
      assert(agentSession.principal.userId.length > 0);
      assertEquals(agentSession.contractId, fixture.agentContract.CONTRACT_ID);
      assertEquals(agentSession.contractDisplayName, fixture.agentDisplayName);

      const deviceSession = sessions.entries.find((entry) =>
        entry.participantKind === "device" &&
        entry.sessionKey === identity.publicIdentityKey
      );
      if (!deviceSession || deviceSession.participantKind !== "device") {
        throw new Error(
          "expected Auth.Sessions.List to include device session",
        );
      }
      assertEquals(deviceSession.principal.type, "device");
      assertEquals(
        deviceSession.principal.deviceId,
        provisioned.instance.instanceId,
      );
      assertEquals(deviceSession.principal.deploymentId, deploymentId);
      assertEquals(
        deviceSession.principal.runtimePublicKey,
        identity.publicIdentityKey,
      );
      assertEquals(
        deviceSession.contractId,
        deviceFixture.deviceContract.CONTRACT_ID,
      );

      const serviceSession = sessions.entries.find((entry) =>
        entry.participantKind === "service"
      );
      if (!serviceSession || serviceSession.participantKind !== "service") {
        throw new Error(
          "expected Auth.Sessions.List to include service session",
        );
      }
      assertEquals(serviceSession.principal.type, "service");
      assert(serviceSession.principal.instanceId.length > 0);
      assert(serviceSession.principal.deploymentId.length > 0);

      const connection = await waitFor(async () => {
        const page = await admin.rpc.auth.connectionsList({
          sessionKey: clientKey.sessionKey,
          limit: 500,
        }).orThrow();
        const entry = page.entries.find((entry) =>
          entry.participantKind === "app"
        );
        return entry?.participantKind === "app" ? entry : false;
      });
      assertEquals(connection.sessionKey, clientKey.sessionKey);
      assertEquals(connection.principal.type, "user");
      assert(connection.principal.userId.length > 0);
      assertEquals(connection.contractId, fixture.clientContract.CONTRACT_ID);
      assertEquals(connection.contractDisplayName, fixture.clientDisplayName);
      assert(connection.userNkey.length > 0);

      const agentConnection = await waitFor(async () => {
        const page = await admin.rpc.auth.connectionsList({
          sessionKey: agentKey.sessionKey,
          limit: 500,
        }).orThrow();
        const entry = page.entries.find((entry) =>
          entry.participantKind === "agent"
        );
        return entry?.participantKind === "agent" ? entry : false;
      });
      assertEquals(agentConnection.sessionKey, agentKey.sessionKey);
      assertEquals(agentConnection.principal.type, "user");
      assert(agentConnection.principal.userId.length > 0);
      assertEquals(
        agentConnection.contractId,
        fixture.agentContract.CONTRACT_ID,
      );
      assertEquals(
        agentConnection.contractDisplayName,
        fixture.agentDisplayName,
      );
      assert(agentConnection.userNkey.length > 0);
    } finally {
      await device.connection.close().catch(() => undefined);
      await deviceAdmin.connection.close().catch(() => undefined);
      await agent.connection.close().catch(() => undefined);
      await client.connection.close().catch(() => undefined);
      await admin.connection.close().catch(() => undefined);
      await service.stop();
    }
  },
});
