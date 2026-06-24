import type {
  ClientAuthContinuation,
  ClientAuthRequiredContext,
} from "@qlever-llc/trellis";
import type { TrellisTestAuthorityPlanClassification } from "../types.ts";
import {
  contractDescriptor,
  TRELLIS_TEST_SHARED_RUNTIME_ENV,
  type TrellisIntegrationContractDescriptor,
  type TrellisIntegrationCoordinatorPath,
  type TrellisIntegrationCoordinatorRequest,
  type TrellisIntegrationCoordinatorResponse,
  type TrellisIntegrationSharedRuntimeManifest,
} from "./shared_runtime_protocol.ts";

/** Returns whether the current process was given a shared runtime manifest. */
export function hasSharedRuntimeManifest(): boolean {
  return Deno.env.get(TRELLIS_TEST_SHARED_RUNTIME_ENV) !== undefined;
}

/** Reads and validates the shared runtime manifest from the worker environment. */
export async function readSharedRuntimeManifest(): Promise<
  TrellisIntegrationSharedRuntimeManifest
> {
  const path = Deno.env.get(TRELLIS_TEST_SHARED_RUNTIME_ENV);
  if (!path) throw new Error(`${TRELLIS_TEST_SHARED_RUNTIME_ENV} is not set`);
  const text = await Deno.readTextFile(path);
  const manifest: unknown = JSON.parse(text);
  if (!isSharedRuntimeManifest(manifest)) {
    throw new Error("invalid Trellis integration shared runtime manifest");
  }
  return manifest;
}

/** Client for the localhost shared-runtime coordinator used by worker tests. */
export class TrellisIntegrationSharedRuntimeCoordinatorClient {
  readonly #coordinatorUrl: string;
  readonly #token: string;

  /** Creates a coordinator client from a shared runtime manifest. */
  constructor(manifest: TrellisIntegrationSharedRuntimeManifest) {
    this.#coordinatorUrl = manifest.coordinatorUrl;
    this.#token = manifest.token;
  }

  async #post<TPath extends TrellisIntegrationCoordinatorPath>(
    path: TPath,
    body: TrellisIntegrationCoordinatorRequest<TPath>,
  ): Promise<TrellisIntegrationCoordinatorResponse<TPath>> {
    const response = await fetch(`${this.#coordinatorUrl}${path}`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.#token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const message = isRecord(data) && typeof data.error === "string"
        ? data.error
        : `HTTP ${response.status}`;
      throw new Error(`coordinator ${path} failed: ${message}`);
    }
    return data as TrellisIntegrationCoordinatorResponse<TPath>;
  }

  /** Creates a deployment in the shared runtime. */
  async createDeployment(
    args: { readonly deployment?: string; readonly mutableDev?: boolean } = {},
  ): Promise<void> {
    await this.#post("/deployments/create", args);
  }

  /** Reconciles a deployment in the shared runtime. */
  async reconcile(deployment: string): Promise<void> {
    await this.#post("/deployments/reconcile", { deployment });
  }

  /** Waits for a deployment to become ready in the shared runtime. */
  async waitReady(deployment: string): Promise<void> {
    await this.#post("/deployments/wait-ready", { deployment });
  }

  /** Approves a contract in the shared runtime. */
  async approveContract(args: {
    readonly deployment?: string;
    readonly contract: TrellisIntegrationContractDescriptor;
    readonly allowPlanClassifications?:
      readonly TrellisTestAuthorityPlanClassification[];
  }): Promise<{
    readonly planId: string;
    readonly classification: TrellisTestAuthorityPlanClassification;
  }> {
    return await this.#post("/contracts/approve", args);
  }

  /** Registers a service in the shared runtime. */
  async registerService(args: {
    readonly deployment?: string;
    readonly name: string;
    readonly contract: TrellisIntegrationContractDescriptor;
    readonly sessionKeySeed?: string;
  }): Promise<{ readonly seed: string; readonly sessionKey: string }> {
    return await this.#post("/services/register", args);
  }

  /** Creates a service instance in the shared runtime. */
  async createServiceInstance(args: {
    readonly deployment?: string;
    readonly contract: TrellisIntegrationContractDescriptor;
    readonly sessionKeySeed?: string;
  }): Promise<{ readonly seed: string; readonly sessionKey: string }> {
    return await this.#post("/services/create-instance", args);
  }

  /** Provisions service session-key material without declaring a catalog instance. */
  async provisionServiceInstanceOnly(args: {
    readonly deployment?: string;
    readonly sessionKeySeed?: string;
  }): Promise<{ readonly seed: string; readonly sessionKey: string }> {
    return await this.#post("/services/provision-instance-only", args);
  }

  /** Completes a client auth continuation through shared runtime admin automation. */
  async completeClientAuth(
    args: ClientAuthRequiredContext,
  ): Promise<ClientAuthContinuation> {
    return await this.#post("/client-auth/complete", args);
  }

  /** Flushes coordinator-visible runtime transport work. */
  async flush(): Promise<void> {
    await this.#post("/flush", {});
  }

  /** Lists authority plans from the shared runtime. */
  async listAuthorityPlans(args: {
    readonly deploymentId?: string;
    readonly state?: "pending" | "accepted" | "rejected";
    readonly classification?: "update" | "migration";
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<
    {
      readonly entries: unknown[];
      readonly count: number;
      readonly offset: number;
      readonly limit: number;
    }
  > {
    return await this.#post("/authority/plans/list", args);
  }

  /** Rejects an authority plan in the shared runtime. */
  async rejectAuthorityPlan(args: {
    readonly planId: string;
    readonly reason?: string;
  }): Promise<{ readonly success: boolean }> {
    return await this.#post("/authority/plans/reject", args);
  }

  /** Accepts an authority update plan in the shared runtime. */
  async acceptAuthorityUpdate(args: {
    readonly planId: string;
    readonly expectedDesiredVersion?: string;
  }): Promise<Record<string, unknown>> {
    return await this.#post("/authority/accept-update", args);
  }

  /** Accepts an authority migration plan in the shared runtime. */
  async acceptAuthorityMigration(args: {
    readonly planId: string;
    readonly acknowledgement: string;
    readonly expectedDesiredVersion?: string;
  }): Promise<Record<string, unknown>> {
    return await this.#post("/authority/accept-migration", args);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSharedRuntimeManifest(
  value: unknown,
): value is TrellisIntegrationSharedRuntimeManifest {
  return isRecord(value) &&
    value.version === 1 &&
    typeof value.runId === "string" &&
    typeof value.trellisUrl === "string" &&
    typeof value.natsUrl === "string" &&
    typeof value.workdir === "string" &&
    typeof value.coordinatorUrl === "string" &&
    typeof value.token === "string";
}

export { contractDescriptor };
