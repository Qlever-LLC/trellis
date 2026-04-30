import type { Hono } from "@hono/hono";
import { buildNatsConnectSignaturePayload } from "@qlever-llc/trellis/auth";

import { createClientBootstrapHandler } from "../bootstrap/client.ts";
import { createServiceBootstrapHandler } from "../bootstrap/service.ts";
import { verifyDomainSig } from "../crypto.ts";
import { buildClientTransports } from "../transports.ts";
import type { AuthHttpRouteContext } from "./route_context.ts";
import { parseContractApprovalKey } from "./support.ts";

/** Registers client and service bootstrap HTTP endpoints. */
export function registerBootstrapRoutes(
  app: Hono,
  context: AuthHttpRouteContext,
): void {
  const { config, opts } = context;
  const { sentinelCreds, sessionStorage } = opts.runtimeDeps;

  app.post(
    "/bootstrap/client",
    createClientBootstrapHandler({
      contractStore: opts.contractStore,
      transports: buildClientTransports(config),
      sentinel: sentinelCreds,
      sessionStorage,
      loadUserProjection: async (trellisId) => {
        return await opts.userStorage.get(trellisId) ?? null;
      },
      loadStoredApproval: async (key) => {
        const approvalKey = parseContractApprovalKey(key);
        if (!approvalKey) return null;
        return await opts.contractApprovalStorage.get(
          approvalKey.userTrellisId,
          approvalKey.contractDigest,
        ) ?? null;
      },
      loadInstanceGrantPolicies: async (contractId: string) => {
        return await opts.loadEffectiveGrantPolicies(contractId);
      },
      verifyIdentityProof: ({ sessionKey, iat, sig }) =>
        verifyDomainSig(sessionKey, "bootstrap-client", String(iat), sig),
    }),
  );

  app.post(
    "/bootstrap/service",
    createServiceBootstrapHandler({
      contractStore: opts.contractStore,
      transports: buildClientTransports(config),
      sentinel: sentinelCreds,
      loadServiceInstance: async (instanceKey) => {
        return await opts.serviceInstanceStorage.getByInstanceKey(
          instanceKey,
        ) ??
          null;
      },
      saveServiceInstance: async (instance) => {
        await opts.serviceInstanceStorage.put({
          ...instance,
          createdAt: instance.createdAt instanceof Date
            ? instance.createdAt.toISOString()
            : instance.createdAt,
        });
      },
      loadServiceDeployment: async (deploymentId) => {
        return await opts.serviceDeploymentStorage.get(deploymentId) ?? null;
      },
      verifyIdentityProof: ({ sessionKey, iat, contractDigest, sig }) =>
        verifyDomainSig(
          sessionKey,
          "nats-connect",
          buildNatsConnectSignaturePayload(iat, contractDigest),
          sig,
        ),
    }),
  );
}
