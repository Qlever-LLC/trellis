import type {
  ClientAuthContinuation,
  ClientAuthRequiredContext,
} from "@qlever-llc/trellis";
import {
  type ContractDescriptor,
  SHARED_RUNTIME_ENV,
  type SharedRuntimeManifest,
} from "./shared_runtime_protocol.ts";

export function hasSharedRuntimeManifest(): boolean {
  return Deno.env.get(SHARED_RUNTIME_ENV) !== undefined;
}

export async function readSharedRuntimeManifest(): Promise<
  SharedRuntimeManifest
> {
  const path = Deno.env.get(SHARED_RUNTIME_ENV);
  if (!path) throw new Error(`${SHARED_RUNTIME_ENV} is not set`);
  const text = await Deno.readTextFile(path);
  const manifest = JSON.parse(text) as SharedRuntimeManifest;
  if (manifest.version !== 1) {
    throw new Error(
      `unexpected shared runtime manifest version: ${manifest.version}`,
    );
  }
  return manifest;
}

export class SharedRuntimeCoordinatorClient {
  readonly #coordinatorUrl: string;
  readonly #token: string;

  constructor(manifest: SharedRuntimeManifest) {
    this.#coordinatorUrl = manifest.coordinatorUrl;
    this.#token = manifest.token;
  }

  async #post(path: string, body: unknown): Promise<unknown> {
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
      const errMsg = data && typeof data === "object" && "error" in data
        ? String(data.error)
        : `HTTP ${response.status}`;
      throw new Error(`coordinator ${path} failed: ${errMsg}`);
    }
    return data;
  }

  async createDeployment(
    args: { deployment?: string; mutableDev?: boolean } = {},
  ): Promise<void> {
    await this.#post("/deployments/create", args);
  }

  async reconcile(deployment: string): Promise<void> {
    await this.#post("/deployments/reconcile", { deployment });
  }

  async waitReady(deployment: string): Promise<void> {
    await this.#post("/deployments/wait-ready", { deployment });
  }

  async approveContract(args: {
    deployment?: string;
    contract: ContractDescriptor;
    allowPlanClassifications?: readonly string[];
  }): Promise<{ planId: string; classification: string }> {
    return await this.#post("/contracts/approve", args) as {
      planId: string;
      classification: string;
    };
  }

  async registerService(args: {
    deployment?: string;
    contract: ContractDescriptor;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    return await this.#post("/services/register", args) as {
      seed: string;
      sessionKey: string;
    };
  }

  async createServiceInstance(args: {
    deployment?: string;
    contract: ContractDescriptor;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    return await this.#post("/services/create-instance", args) as {
      seed: string;
      sessionKey: string;
    };
  }

  async completeClientAuth(
    args: ClientAuthRequiredContext,
  ): Promise<ClientAuthContinuation> {
    return await this.#post(
      "/client-auth/complete",
      args,
    ) as ClientAuthContinuation;
  }

  async flush(): Promise<void> {
    await this.#post("/flush", {});
  }

  async listAuthorityPlans(args: {
    deploymentId?: string;
    state?: "pending" | "accepted" | "rejected";
    classification?: "update" | "migration";
    limit?: number;
    offset?: number;
  }): Promise<
    { entries: unknown[]; count: number; offset: number; limit: number }
  > {
    return await this.#post("/authority/plans/list", args) as {
      entries: unknown[];
      count: number;
      offset: number;
      limit: number;
    };
  }

  async rejectAuthorityPlan(args: {
    planId: string;
    reason?: string;
  }): Promise<{ success: boolean }> {
    return await this.#post("/authority/plans/reject", args) as {
      success: boolean;
    };
  }

  async acceptAuthorityUpdate(args: {
    planId: string;
    expectedDesiredVersion?: string;
  }): Promise<Record<string, unknown>> {
    return await this.#post("/authority/accept-update", args) as Record<
      string,
      unknown
    >;
  }

  async acceptAuthorityMigration(args: {
    planId: string;
    acknowledgement: string;
    expectedDesiredVersion?: string;
  }): Promise<Record<string, unknown>> {
    return await this.#post("/authority/accept-migration", args) as Record<
      string,
      unknown
    >;
  }

  async provisionServiceInstanceOnly(args: {
    deployment?: string;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    return await this.#post("/services/provision-instance-only", args) as {
      seed: string;
      sessionKey: string;
    };
  }
}

export { contractDescriptor } from "./shared_runtime_protocol.ts";
