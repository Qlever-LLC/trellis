import type {
  ClientAuthContinuation,
  ClientAuthRequiredContext,
} from "@qlever-llc/trellis";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestRawAuthConnectionPresence,
  TrellisTestServiceKey,
} from "../types.ts";

/** Environment variable containing the shared runtime manifest path for workers. */
export const TRELLIS_TEST_SHARED_RUNTIME_ENV = "TRELLIS_TEST_SHARED_RUNTIME";

/** Manifest written by a shared runtime host and read by worker test processes. */
export type TrellisIntegrationSharedRuntimeManifest = {
  /** Manifest format version. */
  readonly version: 1;
  /** Unique id for this shared runtime run. */
  readonly runId: string;
  /** Base URL for the shared Trellis control plane. */
  readonly trellisUrl: string;
  /** NATS URL used by services and clients in this shared runtime. */
  readonly natsUrl: string;
  /** Runtime working directory containing the manifest. */
  readonly workdir: string;
  /** Local coordinator URL used for admin operations from workers. */
  readonly coordinatorUrl: string;
  /** Bearer token required by the local coordinator. */
  readonly token: string;
};

/** Serializable contract descriptor carrying only admin automation inputs. */
export type TrellisIntegrationContractDescriptor = {
  /** Contract manifest object. */
  readonly CONTRACT: Record<string, unknown>;
  /** Optional contract digest from generated contract modules. */
  readonly CONTRACT_DIGEST: string | undefined;
};

/** Shared-runtime coordinator request and response shapes by endpoint path. */
export type TrellisIntegrationCoordinatorEndpoints = {
  "/deployments/create": {
    request: { readonly deployment?: string; readonly mutableDev?: boolean };
    response: { readonly ok: true };
  };
  "/deployments/reconcile": {
    request: { readonly deployment: string };
    response: { readonly ok: true };
  };
  "/deployments/wait-ready": {
    request: { readonly deployment: string };
    response: { readonly ok: true };
  };
  "/contracts/approve": {
    request: {
      readonly deployment?: string;
      readonly contract: TrellisIntegrationContractDescriptor;
      readonly allowPlanClassifications?:
        readonly TrellisTestAuthorityPlanClassification[];
    };
    response: {
      readonly planId: string;
      readonly classification: TrellisTestAuthorityPlanClassification;
    };
  };
  "/services/register": {
    request: {
      readonly deployment?: string;
      readonly name: string;
      readonly contract: TrellisIntegrationContractDescriptor;
      readonly sessionKeySeed?: string;
    };
    response: TrellisTestServiceKey;
  };
  "/services/create-instance": {
    request: {
      readonly deployment?: string;
      readonly contract: TrellisIntegrationContractDescriptor;
      readonly sessionKeySeed?: string;
    };
    response: TrellisTestServiceKey;
  };
  "/services/provision-instance-only": {
    request: { readonly deployment?: string; readonly sessionKeySeed?: string };
    response: TrellisTestServiceKey;
  };
  "/client-auth/complete": {
    request: ClientAuthRequiredContext;
    response: ClientAuthContinuation;
  };
  "/flush": {
    request: Record<string, never>;
    response: { readonly ok: true };
  };
  "/auth/connection-presence/seed-raw": {
    request: TrellisTestRawAuthConnectionPresence;
    response: { readonly ok: true };
  };
  "/authority/plans/list": {
    request: {
      readonly deploymentId?: string;
      readonly state?: "pending" | "accepted" | "rejected";
      readonly classification?: "update" | "migration";
      readonly limit?: number;
      readonly offset?: number;
    };
    response: {
      readonly entries: unknown[];
      readonly count: number;
      readonly offset: number;
      readonly limit: number;
    };
  };
  "/authority/plans/reject": {
    request: { readonly planId: string; readonly reason?: string };
    response: { readonly success: boolean };
  };
  "/authority/accept-update": {
    request: {
      readonly planId: string;
      readonly expectedDesiredVersion?: string;
    };
    response: Record<string, unknown>;
  };
  "/authority/accept-migration": {
    request: {
      readonly planId: string;
      readonly acknowledgement: string;
      readonly expectedDesiredVersion?: string;
    };
    response: Record<string, unknown>;
  };
};

/** Shared-runtime coordinator endpoint path. */
export type TrellisIntegrationCoordinatorPath =
  keyof TrellisIntegrationCoordinatorEndpoints;

/** Request payload for a shared-runtime coordinator endpoint. */
export type TrellisIntegrationCoordinatorRequest<
  TPath extends TrellisIntegrationCoordinatorPath,
> = TrellisIntegrationCoordinatorEndpoints[TPath]["request"];

/** Response payload for a shared-runtime coordinator endpoint. */
export type TrellisIntegrationCoordinatorResponse<
  TPath extends TrellisIntegrationCoordinatorPath,
> = TrellisIntegrationCoordinatorEndpoints[TPath]["response"];

/** Extracts a serializable contract descriptor from a contract module. */
export function contractDescriptor(contract: {
  readonly CONTRACT: Record<string, unknown>;
  readonly CONTRACT_DIGEST?: string;
}): TrellisIntegrationContractDescriptor {
  return {
    CONTRACT: contract.CONTRACT,
    CONTRACT_DIGEST: contract.CONTRACT_DIGEST,
  };
}
