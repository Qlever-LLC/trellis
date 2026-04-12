import type { Context } from "@hono/hono";
import { AsyncResult } from "@qlever-llc/result";
import type { TrellisContractV1 } from "@qlever-llc/trellis/contracts";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { ContractStore } from "../../catalog/store.ts";
import type { ServiceRegistryEntry } from "../../state/schemas/catalog_state.ts";
import {
  SessionKeySchema,
  SignatureSchema,
} from "../../state/schemas/auth_state.ts";
import type { SentinelCreds } from "../../state/schemas.ts";

export const DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS = 30;

export function isServiceBootstrapProofIatFresh(
  iat: number,
  nowSeconds: number = Math.floor(Date.now() / 1_000),
  skewSeconds: number = DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS,
): boolean {
  return Math.abs(nowSeconds - iat) <= skewSeconds;
}

const DigestSchema = Type.String({ pattern: "^[A-Za-z0-9_-]+$" });

export const ServiceBootstrapRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  contractId: Type.String({ minLength: 1 }),
  contractDigest: DigestSchema,
  iat: Type.Number(),
  sig: SignatureSchema,
}, { additionalProperties: false });

export type ServiceBootstrapDeps = {
  contractStore: ContractStore;
  natsServers: string[];
  sentinel: SentinelCreds;
  loadService(sessionKey: string): Promise<ServiceRegistryEntry | null>;
  verifyIdentityProof(input: {
    sessionKey: string;
    iat: number;
    sig: string;
  }): Promise<boolean>;
  nowSeconds?(): number;
};

function buildContractView(contract: TrellisContractV1, digest: string) {
  return {
    id: contract.id,
    digest,
    displayName: contract.displayName,
    description: contract.description,
    ...(contract.resources ? { resources: contract.resources } : {}),
  };
}

export function createServiceBootstrapHandler(deps: ServiceBootstrapDeps) {
  return async (c: Context) => {
    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const body = bodyResult.take();
    if (!Value.Check(ServiceBootstrapRequestSchema, body)) {
      return c.json({ reason: "invalid_request" }, 400);
    }

    const request = body;
    const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1_000);
    if (!isServiceBootstrapProofIatFresh(request.iat, nowSeconds)) {
      return c.json({ reason: "iat_out_of_range" }, 400);
    }

    const proofOk = await deps.verifyIdentityProof({
      sessionKey: request.sessionKey,
      iat: request.iat,
      sig: request.sig,
    });
    if (!proofOk) {
      return c.json({ reason: "invalid_signature" }, 400);
    }

    const service = await deps.loadService(request.sessionKey);
    if (!service) {
      return c.json({ reason: "unknown_service" }, 404);
    }
    if (!service.active) {
      return c.json({ reason: "service_disabled" }, 403);
    }

    if (
      service.contractId !== request.contractId ||
      service.contractDigest !== request.contractDigest
    ) {
      return c.json({ reason: "service_contract_mismatch" }, 409);
    }

    const activeDigest = deps.contractStore.findActiveDigestById(request.contractId);
    if (activeDigest !== request.contractDigest) {
      return c.json({ reason: "contract_not_active" }, 409);
    }

    const contract = deps.contractStore.getContract(request.contractDigest);
    if (!contract || contract.id !== request.contractId) {
      return c.json({ reason: "contract_not_active" }, 409);
    }

    if (!service.resourceBindings) {
      return c.json({ reason: "service_bindings_not_found" }, 409);
    }

    return c.json({
      status: "ready",
      connectInfo: {
        sessionKey: request.sessionKey,
        contractId: request.contractId,
        contractDigest: request.contractDigest,
        transport: {
          natsServers: deps.natsServers,
          sentinel: deps.sentinel,
        },
        auth: {
          mode: "service_identity" as const,
          iatSkewSeconds: DEFAULT_SERVICE_BOOTSTRAP_IAT_SKEW_SECONDS,
        },
      },
      contract: buildContractView(contract, request.contractDigest),
      binding: {
        contractId: request.contractId,
        digest: request.contractDigest,
        resources: service.resourceBindings,
      },
    });
  };
}
