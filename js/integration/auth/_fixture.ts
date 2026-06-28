import {
  defineAgentContract,
  defineAppContract,
  defineServiceContract,
  Result,
} from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import {
  type AuthSessionsMeOutput,
  sdk as trellisAuth,
} from "@qlever-llc/trellis/sdk/auth";
import { Type } from "typebox";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export function createAuthLocalLoginFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const schemas = {
    PingInput: Type.Object({ message: Type.String() }),
    PingOutput: Type.Object({
      message: Type.String(),
      accepted: Type.Boolean(),
      participantKind: Type.Optional(Type.String()),
      serviceActive: Type.Optional(Type.Boolean()),
      serviceCapabilities: Type.Optional(Type.Array(Type.String())),
    }),
  } as const;

  const serviceContract = defineServiceContract({ schemas }, (ref) => ({
    id: caseScopedContractId(
      "trellis.integration.auth-local-login-service",
      caseId,
    ),
    displayName: `Trellis Integration Auth Local Login Service (${slug})`,
    description:
      "Service RPC used to prove an approved local-login app session can call services.",
    capabilities: {
      authLocalLoginPing: {
        displayName: "Call local-login ping",
        description: "Call the RPC used by the auth local-login fixture.",
      },
    },
    uses: {
      required: {
        auth: trellisAuth.use({ rpc: { call: ["Auth.Sessions.Me"] } }),
      },
    },
    rpc: {
      "AuthLogin.Ping": {
        version: "v1",
        subject: caseScopedSubject(
          "rpc.v1.Integration.AuthLocalLogin",
          caseId,
          "AuthLogin.Ping",
        ),
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        capabilities: { call: ["authLocalLoginPing"] },
        errors: [],
      },
    },
  }));

  const clientDisplayName =
    `Trellis Integration Auth Local Login Client (${slug})`;
  const updatedClientDisplayName =
    `Trellis Integration Auth Local Login Client Updated (${slug})`;
  const agentDisplayName =
    `Trellis Integration Auth Local Login Agent (${slug})`;

  const clientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.auth-local-login-client",
      caseId,
    ),
    displayName: clientDisplayName,
    description: "App participant for the auth local-login binding fixture.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: { call: ["Auth.Sessions.Logout", "Auth.Sessions.Me"] },
        }),
        loginService: serviceContract.use({
          rpc: { call: ["AuthLogin.Ping"] },
        }),
      },
    },
  }));

  const agentContract = defineAgentContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.auth-local-login-agent",
      caseId,
    ),
    displayName: agentDisplayName,
    description: "Agent participant for the auth local-login binding fixture.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: { call: ["Auth.Sessions.Me"] },
        }),
        loginService: serviceContract.use({
          rpc: { call: ["AuthLogin.Ping"] },
        }),
      },
    },
  }));

  const updatedClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.auth-local-login-client",
      caseId,
    ),
    displayName: updatedClientDisplayName,
    description:
      "Updated app participant for proving local-login rebinds refresh authority.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: { call: ["Auth.Sessions.Me", "Auth.Connections.List"] },
        }),
        loginService: serviceContract.use({
          rpc: { call: ["AuthLogin.Ping"] },
        }),
      },
    },
  }));

  const sessionAdminContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.auth-session-revoke-admin",
      caseId,
    ),
    displayName: `Trellis Integration Auth Session Revoke Admin (${slug})`,
    description:
      "Admin participant for revoking app sessions through public Auth RPCs.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: {
            call: [
              "Auth.Connections.List",
              "Auth.Sessions.List",
              "Auth.Sessions.Revoke",
              "Auth.Users.Create",
              "Auth.Users.PasswordReset.Create",
              "Auth.Users.Update",
            ],
          },
        }),
      },
    },
  }));

  const serviceName = caseScopedName(
    "auth-local-login-fixture-service",
    caseId,
  );
  const clientName = caseScopedName("auth-local-login-fixture-client", caseId);

  async function setupServiceWithKey(runtime: LiveTrellisRuntime) {
    const serviceKey = await runtime.registerService({
      name: serviceName,
      contract: serviceContract,
    });
    const service = await TrellisService.connect({
      trellisUrl: runtime.trellisUrl,
      contract: serviceContract,
      name: serviceName,
      sessionKeySeed: serviceKey.seed,
      telemetry: false,
      server: { log: false },
    }).orThrow();

    service.handle.rpc.authLogin.ping(async ({ input, client }) => {
      if (input.message !== "sessions-me") {
        return Result.ok({ message: input.message, accepted: true });
      }
      const me: AuthSessionsMeOutput = await client.request(
        "Auth.Sessions.Me",
        {},
      ).orThrow();
      return Result.ok({
        message: input.message,
        accepted: true,
        participantKind: me.participantKind,
        serviceActive: me.service?.active,
        serviceCapabilities: me.service?.capabilities,
      });
    });

    return { service, serviceKey };
  }

  async function setupService(runtime: LiveTrellisRuntime) {
    const { service } = await setupServiceWithKey(runtime);
    return service;
  }

  async function setupClientRegistration(runtime: LiveTrellisRuntime) {
    const clientKey = await runtime.registerClient({
      name: clientName,
      contract: clientContract,
    });
    return { clientKey, clientAuth: runtime.clientAuth(clientKey) };
  }

  async function setupSessionAdmin(runtime: LiveTrellisRuntime) {
    return await runtime.connectClient({
      name: caseScopedName("auth-session-revoke-fixture-admin", caseId),
      contract: sessionAdminContract,
    });
  }

  return {
    agentContract,
    agentDisplayName,
    clientContract,
    clientDisplayName,
    clientName,
    pingMessage: caseScopedName("auth-local-login", caseId),
    setupClientRegistration,
    setupSessionAdmin,
    setupService,
    setupServiceWithKey,
    updatedClientContract,
    updatedClientDisplayName,
  };
}
