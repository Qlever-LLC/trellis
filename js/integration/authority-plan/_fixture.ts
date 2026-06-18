import { assert } from "@std/assert";
import { defineAppContract, defineServiceContract } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/service/deno";
import { Type } from "typebox";
import type {
  LiveTrellisRuntime,
  RuntimeContract,
} from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  caseScopedSubject,
  integrationSlug,
} from "../_support/names.ts";

export type AuthorityPlanEntry = {
  readonly planId: string;
  readonly deploymentId: string;
  readonly classification: "update" | "migration";
  readonly state?: "pending" | "accepted" | "rejected" | "expired";
  readonly decisionReason?: string | null;
  readonly proposal: {
    readonly contractId: string;
    readonly contractDigest: string;
    readonly contract?: Record<string, unknown>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string") {
    throw new Error(`expected string field '${field}'`);
  }
  return value[field];
}

function integerField(value: unknown, field: string): number {
  if (
    !isRecord(value) || typeof value[field] !== "number" ||
    !Number.isInteger(value[field])
  ) {
    throw new Error(`expected integer field '${field}'`);
  }
  return value[field];
}

function isAuthorityPlanEntry(value: unknown): value is AuthorityPlanEntry {
  if (!isRecord(value)) return false;
  const entry = value;
  const proposal = entry.proposal;
  return typeof entry.planId === "string" &&
    typeof entry.deploymentId === "string" &&
    (entry.classification === "update" ||
      entry.classification === "migration") &&
    isRecord(proposal) &&
    typeof proposal.contractId === "string" &&
    typeof proposal.contractDigest === "string";
}

function requireAuthority(runtime: LiveTrellisRuntime) {
  if (runtime.authority === undefined) {
    throw new Error("authority-plan tests require runtime.authority support");
  }
  return runtime.authority;
}

export function createAuthorityPlanFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const serviceContractId = caseScopedContractId(
    "trellis.integration.authority-plan.service",
    caseId,
  );
  const resourceServiceContractId = caseScopedContractId(
    "trellis.integration.authority-plan.resource-service",
    caseId,
  );
  const dependencyServiceContractId = caseScopedContractId(
    "trellis.integration.authority-plan.dependency-service",
    caseId,
  );

  const schemas = {
    PingInput: Type.Object({ message: Type.String() }),
    PingOutput: Type.Object({ message: Type.String(), variant: Type.String() }),
    AddedPingInput: Type.Object({ message: Type.String() }),
    AddedPingOutput: Type.Object({
      message: Type.String(),
      variant: Type.String(),
      added: Type.Boolean(),
    }),
    IncompatiblePingInput: Type.Object({ count: Type.Integer() }),
    IncompatiblePingOutput: Type.Object({
      count: Type.Integer(),
      variant: Type.String(),
    }),
    ResourcePingInput: Type.Object({
      key: Type.String(),
      message: Type.String(),
    }),
    ResourcePingOutput: Type.Object({
      key: Type.String(),
      message: Type.String(),
      history: Type.Integer(),
    }),
    ResourceRecord: Type.Object({ message: Type.String() }),
  } as const;

  const pingSubject = caseScopedSubject(
    "rpc.v1.Integration.AuthorityPlan",
    caseId,
    "Plan.Ping",
  );
  const addedPingSubject = caseScopedSubject(
    "rpc.v1.Integration.AuthorityPlan",
    caseId,
    "Plan.AddedPing",
  );
  const dependencyPingSubject = caseScopedSubject(
    "rpc.v1.Integration.AuthorityPlan",
    caseId,
    "Plan.DependencyPing",
  );
  const resourcePingSubject = caseScopedSubject(
    "rpc.v1.Integration.AuthorityPlan",
    caseId,
    "Plan.ResourcePing",
  );

  const baseContract = defineServiceContract({ schemas }, (ref) => ({
    id: serviceContractId,
    displayName: `Authority Plan Service (${slug})`,
    description: "Base authority-plan service contract.",
    capabilities: {
      ping: {
        displayName: "Ping authority-plan service",
        description: "Call the base authority-plan ping RPC.",
      },
      addedPing: {
        displayName: "Call added ping",
        description: "Call the additive authority-plan ping RPC.",
      },
    },
    rpc: {
      "Plan.Ping": {
        version: "v1",
        subject: pingSubject,
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        capabilities: { call: ["ping"] },
        errors: [],
      },
    },
  }));

  const compatibleMetadataContract = defineServiceContract(
    { schemas },
    (ref) => ({
      id: serviceContractId,
      displayName: `Authority Plan Service Metadata Refresh (${slug})`,
      description: "Metadata-only authority-plan service contract refresh.",
      docs: { markdown: "Metadata-only integration contract refresh." },
      capabilities: {
        ping: {
          displayName: "Ping authority-plan service",
          description: "Call the base authority-plan ping RPC.",
        },
        addedPing: {
          displayName: "Call added ping",
          description: "Call the additive authority-plan ping RPC.",
        },
      },
      rpc: {
        "Plan.Ping": {
          version: "v1",
          subject: pingSubject,
          input: ref.schema("PingInput"),
          output: ref.schema("PingOutput"),
          capabilities: { call: ["ping"] },
          errors: [],
          docs: { markdown: "Metadata-only RPC docs refresh." },
        },
      },
    }),
  );

  const dependencyContract = defineServiceContract({ schemas }, (ref) => ({
    id: dependencyServiceContractId,
    displayName: `Authority Plan Dependency Service (${slug})`,
    description: "Dependency used to force an authority update requested need.",
    rpc: {
      "Plan.DependencyPing": {
        version: "v1",
        subject: dependencyPingSubject,
        input: ref.schema("PingInput"),
        output: ref.schema("PingOutput"),
        capabilities: { call: [] },
        errors: [],
      },
    },
  }));

  const compatibleAdditiveContract = defineServiceContract(
    { schemas },
    (ref) => ({
      id: serviceContractId,
      displayName: `Authority Plan Service Additive (${slug})`,
      description: "Additive authority-plan service contract update.",
      capabilities: {
        ping: {
          displayName: "Ping authority-plan service",
          description: "Call the base authority-plan ping RPC.",
        },
        addedPing: {
          displayName: "Call added ping",
          description: "Call the additive authority-plan ping RPC.",
        },
      },
      resources: {
        kv: {
          additiveRecords: {
            purpose: "Store additive authority-plan update records.",
            schema: ref.schema("ResourceRecord"),
            required: true,
            history: 1,
            ttlMs: 0,
          },
        },
      },
      uses: {
        optional: {
          dependencyService: dependencyContract.use({
            rpc: { call: ["Plan.DependencyPing"] },
          }),
        },
      },
      rpc: {
        "Plan.Ping": {
          version: "v1",
          subject: pingSubject,
          input: ref.schema("PingInput"),
          output: ref.schema("PingOutput"),
          capabilities: { call: ["ping"] },
          errors: [],
        },
        "Plan.AddedPing": {
          version: "v1",
          subject: addedPingSubject,
          input: ref.schema("AddedPingInput"),
          output: ref.schema("AddedPingOutput"),
          capabilities: { call: ["addedPing"] },
          errors: [],
        },
      },
    }),
  );

  const incompatibleSchemaContract = defineServiceContract(
    { schemas },
    (ref) => ({
      id: serviceContractId,
      displayName: `Authority Plan Service Incompatible (${slug})`,
      description: "Incompatible authority-plan service contract migration.",
      capabilities: {
        ping: {
          displayName: "Ping authority-plan service",
          description: "Call the incompatible authority-plan ping RPC.",
        },
      },
      rpc: {
        "Plan.Ping": {
          version: "v1",
          subject: pingSubject,
          input: ref.schema("IncompatiblePingInput"),
          output: ref.schema("IncompatiblePingOutput"),
          capabilities: { call: ["ping"] },
          errors: [],
        },
      },
    }),
  );

  const resourceBaseContract = defineServiceContract({ schemas }, (ref) => ({
    id: resourceServiceContractId,
    displayName: `Authority Plan Resource Service (${slug})`,
    description: "Base resource authority-plan service contract.",
    resources: {
      kv: {
        records: {
          purpose: "Store authority-plan resource records.",
          schema: ref.schema("ResourceRecord"),
          required: true,
          history: 1,
          ttlMs: 0,
        },
      },
    },
    rpc: {
      "Plan.ResourcePing": {
        version: "v1",
        subject: resourcePingSubject,
        input: ref.schema("ResourcePingInput"),
        output: ref.schema("ResourcePingOutput"),
        capabilities: { call: [] },
        errors: [],
      },
    },
  }));

  const resourceChangedContract = defineServiceContract({ schemas }, (ref) => ({
    id: resourceServiceContractId,
    displayName: `Authority Plan Resource Service Changed (${slug})`,
    description: "Changed resource authority-plan service contract.",
    resources: {
      kv: {
        records: {
          purpose: "Store changed authority-plan resource records.",
          schema: ref.schema("ResourceRecord"),
          required: true,
          history: 2,
          ttlMs: 0,
        },
      },
    },
    rpc: {
      "Plan.ResourcePing": {
        version: "v1",
        subject: resourcePingSubject,
        input: ref.schema("ResourcePingInput"),
        output: ref.schema("ResourcePingOutput"),
        capabilities: { call: [] },
        errors: [],
      },
    },
  }));

  const baseClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.authority-plan.base-client",
      caseId,
    ),
    displayName: `Authority Plan Base Client (${slug})`,
    description: "Client for the base authority-plan ping RPC.",
    uses: {
      required: {
        planService: baseContract.use({ rpc: { call: ["Plan.Ping"] } }),
      },
    },
  }));

  const additiveClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.authority-plan.additive-client",
      caseId,
    ),
    displayName: `Authority Plan Additive Client (${slug})`,
    description: "Client for the additive authority-plan ping RPC.",
    uses: {
      required: {
        planService: compatibleAdditiveContract.use({
          rpc: { call: ["Plan.Ping", "Plan.AddedPing"] },
        }),
      },
    },
  }));

  const incompatibleClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.authority-plan.incompatible-client",
      caseId,
    ),
    displayName: `Authority Plan Incompatible Client (${slug})`,
    description: "Client for the incompatible authority-plan ping RPC.",
    uses: {
      required: {
        planService: incompatibleSchemaContract.use({
          rpc: { call: ["Plan.Ping"] },
        }),
      },
    },
  }));

  const resourceClientContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.authority-plan.resource-client",
      caseId,
    ),
    displayName: `Authority Plan Resource Client (${slug})`,
    description: "Client for the resource authority-plan ping RPC.",
    uses: {
      required: {
        resourceService: resourceChangedContract.use({
          rpc: { call: ["Plan.ResourcePing"] },
        }),
      },
    },
  }));

  async function connectService<TContract extends RuntimeContract>(args: {
    readonly runtime: LiveTrellisRuntime;
    readonly contract: TContract;
    readonly name: string;
    readonly seed: string;
  }) {
    return await TrellisService.connect({
      trellisUrl: args.runtime.trellisUrl,
      contract: args.contract,
      name: args.name,
      sessionKeySeed: args.seed,
      telemetry: false,
      server: {},
    }).orThrow();
  }

  function connectServicePending<TContract extends RuntimeContract>(args: {
    readonly runtime: LiveTrellisRuntime;
    readonly contract: TContract;
    readonly name: string;
    readonly seed: string;
  }) {
    const promise = connectService(args);
    promise.catch(() => undefined);
    return promise;
  }

  async function expectPromisePending(
    promise: Promise<unknown>,
    message: string,
    timeoutMs = 750,
  ): Promise<void> {
    const sentinel = Symbol("pending");
    const result = await Promise.race([
      promise.then(() => "resolved" as const),
      new Promise<typeof sentinel>((resolve) =>
        setTimeout(() => resolve(sentinel), timeoutMs)
      ),
    ]);
    assert(result === sentinel, message);
  }

  async function listPlans(
    runtime: LiveTrellisRuntime,
    args: {
      readonly deploymentId: string;
      readonly state?: "pending" | "accepted" | "rejected";
      readonly classification?: "update" | "migration";
    },
  ): Promise<AuthorityPlanEntry[]> {
    const response = await requireAuthority(runtime).plans.list({
      deploymentId: args.deploymentId,
      state: args.state,
      classification: args.classification,
      limit: 50,
    });
    return response.entries.filter(isAuthorityPlanEntry);
  }

  async function waitForPendingPlan(
    runtime: LiveTrellisRuntime,
    args: {
      readonly deploymentId: string;
      readonly classification: "update" | "migration";
      readonly contractDigest?: string;
    },
  ): Promise<AuthorityPlanEntry> {
    return await runtime.waitFor(async () => {
      const plans = await listPlans(runtime, {
        deploymentId: args.deploymentId,
        state: "pending",
        classification: args.classification,
      });
      return plans.find((plan) =>
        args.contractDigest === undefined ||
        plan.proposal.contractDigest === args.contractDigest
      );
    }, { timeoutMs: 10_000, intervalMs: 100 });
  }

  async function findAcceptedPlan(
    runtime: LiveTrellisRuntime,
    args: {
      readonly deploymentId: string;
      readonly classification: "update" | "migration";
      readonly contractDigest?: string;
    },
  ): Promise<AuthorityPlanEntry> {
    return await runtime.waitFor(async () => {
      const plans = await listPlans(runtime, {
        deploymentId: args.deploymentId,
        state: "accepted",
        classification: args.classification,
      });
      return plans.find((plan) =>
        args.contractDigest === undefined ||
        plan.proposal.contractDigest === args.contractDigest
      );
    }, { timeoutMs: 10_000, intervalMs: 100 });
  }

  async function findRejectedPlan(
    runtime: LiveTrellisRuntime,
    args: { readonly deploymentId: string; readonly planId: string },
  ): Promise<AuthorityPlanEntry> {
    return await runtime.waitFor(async () => {
      const plans = await listPlans(runtime, {
        deploymentId: args.deploymentId,
        state: "rejected",
      });
      return plans.find((plan) => plan.planId === args.planId);
    }, { timeoutMs: 10_000, intervalMs: 100 });
  }

  async function acceptPlan(
    runtime: LiveTrellisRuntime,
    plan: AuthorityPlanEntry,
  ): Promise<void> {
    const authority = requireAuthority(runtime);
    if (plan.classification === "update") {
      await authority.acceptUpdate({ planId: plan.planId });
    } else {
      await authority.acceptMigration({
        planId: plan.planId,
        acknowledgement: "Accepted by authority-plan integration test.",
      });
    }
  }

  async function rejectPlan(
    runtime: LiveTrellisRuntime,
    plan: AuthorityPlanEntry,
    reason = "integration rejection",
  ): Promise<AuthorityPlanEntry> {
    const rejected = await requireAuthority(runtime).plans.reject({
      planId: plan.planId,
      reason,
    });
    assert(rejected.success, "authority plan reject did not report success");
    return await findRejectedPlan(runtime, {
      deploymentId: plan.deploymentId,
      planId: plan.planId,
    });
  }

  async function connectClientAndPing(
    runtime: LiveTrellisRuntime,
    message: string,
  ) {
    const client = await runtime.connectClient({
      name: caseScopedName("authority-plan-client", caseId),
      contract: baseClientContract,
    });
    return await client.rpc.plan.ping({ message }).orThrow();
  }

  return {
    slug,
    baseContract,
    compatibleMetadataContract,
    dependencyContract,
    compatibleAdditiveContract,
    incompatibleSchemaContract,
    resourceBaseContract,
    resourceChangedContract,
    baseClientContract,
    additiveClientContract,
    incompatibleClientContract,
    resourceClientContract,
    baseServiceName: caseScopedName("authority-plan-base-service", caseId),
    additiveServiceName: caseScopedName(
      "authority-plan-additive-service",
      caseId,
    ),
    replacementServiceName: caseScopedName(
      "authority-plan-replacement-service",
      caseId,
    ),
    dependencyServiceName: caseScopedName(
      "authority-plan-dependency-service",
      caseId,
    ),
    resourceServiceName: caseScopedName(
      "authority-plan-resource-service",
      caseId,
    ),
    clientName: caseScopedName("authority-plan-client", caseId),
    additiveClientName: caseScopedName(
      "authority-plan-additive-client",
      caseId,
    ),
    incompatibleClientName: caseScopedName(
      "authority-plan-incompatible-client",
      caseId,
    ),
    resourceClientName: caseScopedName(
      "authority-plan-resource-client",
      caseId,
    ),
    strictDeployment: caseScopedName("authority-plan-strict", caseId),
    mutableDeployment: caseScopedName("authority-plan-mutable", caseId),
    resourceKey: caseScopedName("authority-plan-resource", caseId),
    connectService,
    connectServicePending,
    connectClientAndPing,
    pingMessage: (input: unknown) => stringField(input, "message"),
    pingCount: (input: unknown) => integerField(input, "count"),
    resourceInput: (input: unknown) => ({
      key: stringField(input, "key"),
      message: stringField(input, "message"),
    }),
    resourceRecordMessage: (value: unknown) => stringField(value, "message"),
    expectPromisePending,
    listPlans,
    waitForPendingPlan,
    findAcceptedPlan,
    findRejectedPlan,
    acceptPlan,
    rejectPlan,
  };
}
