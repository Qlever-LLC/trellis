import type { TrellisTestServiceKey } from "@qlever-llc/trellis-test";
import type {
  ClientAuthContinuation,
  ClientAuthRequiredContext,
} from "@qlever-llc/trellis";

// ---------------------------------------------------------------------------
// Environment variable used to pass the manifest path to parallel workers.
// ---------------------------------------------------------------------------

export const SHARED_RUNTIME_ENV = "TRELLIS_INTEGRATION_SHARED_RUNTIME";

// ---------------------------------------------------------------------------
// Manifest – written by the host, read by workers.
// ---------------------------------------------------------------------------

export type SharedRuntimeManifest = {
  readonly version: 1;
  readonly runId: string;
  readonly trellisUrl: string;
  readonly natsUrl: string;
  readonly workdir: string;
  readonly coordinatorUrl: string;
  readonly token: string;
};

// ---------------------------------------------------------------------------
// Serializable contract descriptor (carries only what admin automation needs).
// ---------------------------------------------------------------------------

export type ContractDescriptor = {
  readonly CONTRACT: Record<string, unknown>;
  readonly CONTRACT_DIGEST: string | undefined;
};

// ---------------------------------------------------------------------------
// Coordinator request / response shapes – one entry per endpoint.
// ---------------------------------------------------------------------------

export type CoordinatorEndpoints = {
  "/deployments/create": {
    request: { deployment?: string; mutableDev?: boolean };
    response: { ok: true };
  };
  "/deployments/reconcile": {
    request: { deployment: string };
    response: { ok: true };
  };
  "/deployments/wait-ready": {
    request: { deployment: string };
    response: { ok: true };
  };
  "/contracts/approve": {
    request: {
      deployment?: string;
      contract: ContractDescriptor;
      allowPlanClassifications?: readonly string[];
    };
    response: { planId: string; classification: string };
  };
  "/services/register": {
    request: {
      deployment?: string;
      contract: ContractDescriptor;
      sessionKeySeed?: string;
    };
    response: TrellisTestServiceKey;
  };
  "/services/create-instance": {
    request: {
      deployment?: string;
      contract: ContractDescriptor;
      sessionKeySeed?: string;
    };
    response: TrellisTestServiceKey;
  };
  "/client-auth/complete": {
    request: ClientAuthRequiredContext;
    response: ClientAuthContinuation;
  };
  "/flush": {
    request: Record<string, never>;
    response: { ok: true };
  };
  "/authority/plans/list": {
    request: {
      deploymentId?: string;
      state?: "pending" | "accepted" | "rejected";
      classification?: "update" | "migration";
      limit?: number;
      offset?: number;
    };
    response: {
      entries: unknown[];
      count: number;
      offset: number;
      limit: number;
    };
  };
  "/authority/plans/reject": {
    request: { planId: string; reason?: string };
    response: { success: boolean };
  };
  "/authority/accept-update": {
    request: { planId: string; expectedDesiredVersion?: string };
    response: Record<string, unknown>;
  };
  "/authority/accept-migration": {
    request: {
      planId: string;
      acknowledgement: string;
      expectedDesiredVersion?: string;
    };
    response: Record<string, unknown>;
  };
  "/services/provision-instance-only": {
    request: { deployment?: string; sessionKeySeed?: string };
    response: { seed: string; sessionKey: string };
  };
};

// ---------------------------------------------------------------------------
// Helper: extract a contract descriptor from a contract module.
// ---------------------------------------------------------------------------

export function contractDescriptor(
  contract: {
    readonly CONTRACT: Record<string, unknown>;
    readonly CONTRACT_DIGEST?: string;
  },
): ContractDescriptor {
  return {
    CONTRACT: contract.CONTRACT,
    CONTRACT_DIGEST: contract.CONTRACT_DIGEST,
  };
}
