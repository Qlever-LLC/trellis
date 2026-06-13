import {
  AuthError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";
import { AuthRequestsValidateResponseSchema } from "@qlever-llc/trellis/auth";
import type { StaticDecode } from "typebox";
import { ulid } from "ulid";

import type { AuthRuntimeDeps } from "../runtime_deps.ts";
import {
  mergeAuthorityNeeds,
  normalizeAuthorityNeeds,
} from "../authority_needs.ts";
import {
  AuthorityReconciliationError,
  type AuthorityReconciliationResult,
} from "../reconciliation/authority_reconciler.ts";
import type {
  AuthorityNeedSet,
  DeploymentAuthority,
  DeploymentAuthorityCapabilityDefinition,
  DeploymentAuthorityGrantOverride,
  DeploymentAuthorityMaterialization,
  DeploymentAuthorityPlan,
  DeploymentAuthorityReconciliationStatus,
  DeploymentPortalRoute,
} from "../schemas.ts";
import type { BoundedListQuery, ListPage } from "../storage.ts";
import { type AdminCaller, requireAdmin } from "./shared.ts";

type RpcUser =
  & StaticDecode<
    typeof AuthRequestsValidateResponseSchema
  >["caller"]
  & AdminCaller;

type DeploymentAuthorityStorage = {
  get(deploymentId: string): Promise<DeploymentAuthority | undefined>;
  put(record: DeploymentAuthority): Promise<void>;
  acceptAuthorityPlan?(
    authority: DeploymentAuthority,
    plan: DeploymentAuthorityPlan,
    expectedCurrentAuthorityVersion: string,
  ): Promise<boolean>;
  listFiltered(
    filters: { kind?: DeploymentAuthority["kind"]; disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<DeploymentAuthority[]>;
  listFilteredPage(
    filters: { kind?: DeploymentAuthority["kind"]; disabled?: boolean },
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthority>>;
};

type DeploymentAuthorityPlanStorage = {
  get(planId: string): Promise<DeploymentAuthorityPlan | undefined>;
  put(record: DeploymentAuthorityPlan): Promise<void>;
};

type DeploymentAuthorityPlanListStorage = DeploymentAuthorityPlanStorage & {
  listFilteredPage(
    filters: {
      deploymentId?: string;
      state?: DeploymentAuthorityPlan["state"];
      classification?: DeploymentAuthorityPlan["classification"];
      kind?: DeploymentAuthority["kind"];
    },
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthorityPlan>>;
};

type MaterializedAuthorityStorage = {
  get(
    deploymentId: string,
  ): Promise<DeploymentAuthorityMaterialization | undefined>;
};

type DeploymentPortalRouteStorage = {
  get(deploymentId: string): Promise<DeploymentPortalRoute | undefined>;
};

type DeploymentAuthorityGrantOverrideStorage = {
  listByDeployment(
    deploymentId: string,
  ): Promise<DeploymentAuthorityGrantOverride[]>;
  listCountedPage(
    query: BoundedListQuery,
  ): Promise<ListPage<DeploymentAuthorityGrantOverride>>;
  replaceForDeployment(
    deploymentId: string,
    records: DeploymentAuthorityGrantOverride[],
  ): Promise<void>;
};

type DeploymentAuthorityCapabilityDefinitionStorage = {
  replaceForDeployment(
    deploymentId: string,
    definitions: DeploymentAuthorityCapabilityDefinition[],
  ): Promise<void>;
};

type AuthorityReconciler = {
  reconcileDeployment(
    deploymentId: string,
    opts?: { desiredVersion?: string },
  ): Promise<AuthorityReconciliationResult>;
};

type AcceptLogger =
  & Pick<AuthRuntimeDeps["logger"], "trace">
  & Partial<Pick<AuthRuntimeDeps["logger"], "warn">>;

const AUTHORITY_SURFACE_KINDS = new Set(["rpc", "operation", "event", "feed"]);
const AUTHORITY_SURFACE_ACTIONS = new Set([
  "call",
  "publish",
  "subscribe",
  "observe",
  "cancel",
]);
const AUTHORITY_RESOURCE_KINDS = new Set([
  "kv",
  "store",
  "jobs",
  "event-consumer",
  "transfer",
]);

function invalid(
  path: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return Result.err(
    new ValidationError({
      errors: [{ path, message }],
      ...(context ? { context } : {}),
    }),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function decisionBy(caller: RpcUser): Record<string, unknown> {
  const actor: Record<string, unknown> = { type: caller.type };
  if ("participantKind" in caller) {
    actor.participantKind = caller.participantKind;
  }
  if ("userId" in caller) actor.userId = caller.userId;
  if ("identity" in caller) actor.identity = caller.identity;
  return {
    ...actor,
  };
}

function desiredVersion(): string {
  return ulid();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthorityNeedSetContract(value: unknown): boolean {
  return isRecord(value) && typeof value.contractId === "string" &&
    value.contractId.length > 0 &&
    typeof value.required === "boolean";
}

function isAuthorityNeedSetSurface(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const action = value.action;
  return typeof value.contractId === "string" &&
    value.contractId.length > 0 &&
    typeof value.kind === "string" &&
    AUTHORITY_SURFACE_KINDS.has(value.kind) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.required === "boolean" &&
    (action === undefined ||
      (typeof action === "string" && AUTHORITY_SURFACE_ACTIONS.has(action)));
}

function isAuthorityNeedSetResource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const definition = value.definition;
  return typeof value.kind === "string" &&
    AUTHORITY_RESOURCE_KINDS.has(value.kind) &&
    typeof value.alias === "string" &&
    value.alias.length > 0 &&
    typeof value.required === "boolean" &&
    (definition === undefined || isRecord(definition));
}

function isAuthorityNeedSet(value: unknown): value is AuthorityNeedSet {
  if (typeof value !== "object" || value === null) return false;
  if (!("contracts" in value) || !("surfaces" in value)) return false;
  if (!("capabilities" in value) || !("resources" in value)) return false;
  return Array.isArray(value.contracts) &&
    value.contracts.every(isAuthorityNeedSetContract) &&
    Array.isArray(value.surfaces) &&
    value.surfaces.every(isAuthorityNeedSetSurface) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every((capability) =>
      isRecord(capability) && typeof capability.capability === "string" &&
      capability.capability.length > 0 &&
      typeof capability.required === "boolean"
    ) &&
    Array.isArray(value.resources) &&
    value.resources.every(isAuthorityNeedSetResource);
}

function surfaceKey(surface: {
  contractId: string;
  kind: string;
  name: string;
  action?: string;
}): string {
  return JSON.stringify([
    surface.contractId,
    surface.kind,
    surface.name,
    surface.action ?? "",
  ]);
}

function resourceKey(resource: { kind: string; alias: string }): string {
  return `${resource.kind}:${resource.alias}`;
}

function mergeDesiredChange(
  authority: DeploymentAuthority,
  desiredChange: AuthorityNeedSet,
  providedSurfaces: DeploymentAuthorityPlan["proposal"]["providedSurfaces"],
): DeploymentAuthority["desiredState"] {
  const resources = new Map<
    string,
    DeploymentAuthority["desiredState"]["resources"][number]
  >();
  const surfaces = new Map<
    string,
    DeploymentAuthority["desiredState"]["surfaces"][number]
  >();

  for (const resource of authority.desiredState.resources) {
    resources.set(resourceKey(resource), resource);
  }
  for (const surface of authority.desiredState.surfaces) {
    surfaces.set(surfaceKey(surface), surface);
  }
  for (const surface of providedSurfaces) {
    surfaces.set(surfaceKey(surface), surface);
  }

  for (const surface of desiredChange.surfaces) {
    const desiredSurface = {
      contractId: surface.contractId,
      kind: surface.kind,
      name: surface.name,
      ...(surface.action === undefined ? {} : { action: surface.action }),
    };
    surfaces.set(surfaceKey(desiredSurface), desiredSurface);
  }
  for (const resource of desiredChange.resources) {
    const desiredResource = {
      kind: resource.kind,
      alias: resource.alias,
      required: resource.required,
      ...(resource.definition === undefined
        ? {}
        : { definition: resource.definition }),
    };
    resources.set(resourceKey(desiredResource), desiredResource);
  }

  return {
    needs: mergeAuthorityNeeds(authority.desiredState.needs, desiredChange),
    capabilities: [
      ...new Set([
        ...authority.desiredState.capabilities,
        ...desiredChange.capabilities.map((need) => need.capability),
      ]),
    ],
    resources: [...resources.values()],
    surfaces: [...surfaces.values()],
  };
}

function desiredStateFromProposal(
  proposal: DeploymentAuthorityPlan["proposal"],
): DeploymentAuthority["desiredState"] {
  const capabilities = new Set<string>();
  const resources = new Map<
    string,
    DeploymentAuthority["desiredState"]["resources"][number]
  >();
  const surfaces = new Map<
    string,
    DeploymentAuthority["desiredState"]["surfaces"][number]
  >();

  for (const need of proposal.requestedNeeds.capabilities) {
    capabilities.add(need.capability);
  }
  for (const resource of proposal.requestedNeeds.resources) {
    resources.set(resourceKey(resource), resource);
  }
  for (const surface of proposal.providedSurfaces) {
    surfaces.set(surfaceKey(surface), surface);
  }

  return {
    needs: normalizeAuthorityNeeds(proposal.requestedNeeds),
    capabilities: [...capabilities].sort(),
    resources: [...resources.values()].sort((left, right) =>
      resourceKey(left).localeCompare(resourceKey(right))
    ),
    surfaces: [...surfaces.values()].sort((left, right) =>
      surfaceKey(left).localeCompare(surfaceKey(right))
    ),
  };
}

function isEmptyAuthorityNeedSet(needs: AuthorityNeedSet): boolean {
  return needs.contracts.length === 0 && needs.surfaces.length === 0 &&
    needs.capabilities.length === 0 && needs.resources.length === 0;
}

function proposalScopedReplacementAllowed(
  authority: DeploymentAuthority,
  plan: DeploymentAuthorityPlan,
): boolean {
  const allowedContractIds = new Set<string>([plan.proposal.contractId]);
  for (const need of plan.proposal.requestedNeeds.contracts) {
    allowedContractIds.add(need.contractId);
  }
  for (const need of plan.proposal.requestedNeeds.surfaces) {
    allowedContractIds.add(need.contractId);
  }
  for (const surface of plan.proposal.providedSurfaces) {
    allowedContractIds.add(surface.contractId);
  }

  const currentContractIds = [
    ...authority.desiredState.needs.contracts.map((need) => need.contractId),
    ...authority.desiredState.needs.surfaces.map((need) => need.contractId),
    ...authority.desiredState.surfaces.map((surface) => surface.contractId),
  ];
  return currentContractIds.length > 0 &&
    currentContractIds.every((contractId) =>
      allowedContractIds.has(contractId)
    );
}

function desiredStateForAcceptedPlan(
  authority: DeploymentAuthority,
  plan: DeploymentAuthorityPlan,
  desiredChange: AuthorityNeedSet,
  classification: "update" | "migration",
):
  | { ok: true; desiredState: DeploymentAuthority["desiredState"] }
  | { ok: false; error: ReturnType<typeof invalid> } {
  if (classification === "update") {
    return {
      ok: true,
      desiredState: mergeDesiredChange(
        authority,
        desiredChange,
        plan.proposal.providedSurfaces,
      ),
    };
  }
  if (!proposalScopedReplacementAllowed(authority, plan)) {
    return {
      ok: false,
      error: invalid(
        "/planId",
        "migration replacement is outside the proposal contract scope",
        { planId: plan.planId, contractId: plan.proposal.contractId },
      ),
    };
  }
  if (isEmptyAuthorityNeedSet(desiredChange)) {
    return {
      ok: true,
      desiredState: desiredStateFromProposal(plan.proposal),
    };
  }
  return {
    ok: true,
    desiredState: desiredStateFromProposal(plan.proposal),
  };
}

function authorityCapabilityDefinitions(
  plan: DeploymentAuthorityPlan,
): DeploymentAuthorityCapabilityDefinition[] {
  const summary = plan.proposal.summary;
  if (!isRecord(summary)) return [];
  const definitions = summary.authorityCapabilityDefinitions;
  if (!Array.isArray(definitions)) return [];
  return definitions.flatMap((definition) =>
    isAuthorityCapabilityDefinition(definition) ? [definition] : []
  );
}

function isAuthorityCapabilityDefinition(
  value: unknown,
): value is DeploymentAuthorityCapabilityDefinition {
  if (!isRecord(value)) return false;
  if (typeof value.deploymentId !== "string") return false;
  if (typeof value.key !== "string") return false;
  if (typeof value.displayName !== "string") return false;
  if (typeof value.description !== "string") return false;
  if (
    value.consequence !== undefined && typeof value.consequence !== "string"
  ) {
    return false;
  }
  if (value.source !== "contract" && value.source !== "platform") return false;
  if (value.contractId !== undefined && typeof value.contractId !== "string") {
    return false;
  }
  if (
    value.contractDigest !== undefined &&
    typeof value.contractDigest !== "string"
  ) {
    return false;
  }
  if (
    value.contractDisplayName !== undefined &&
    typeof value.contractDisplayName !== "string"
  ) {
    return false;
  }
  return value.direction === "creates" || value.direction === "given";
}

function validatePendingPlan(
  plan: DeploymentAuthorityPlan | undefined,
  classification?: DeploymentAuthorityPlan["classification"],
): { ok: true; plan: DeploymentAuthorityPlan } | {
  ok: false;
  error: ValidationError;
} {
  if (!plan) {
    return {
      ok: false,
      error: new ValidationError({
        errors: [{
          path: "/planId",
          message: "deployment authority plan not found",
        }],
      }),
    };
  }
  if ((plan.state ?? "pending") !== "pending") {
    return {
      ok: false,
      error: new ValidationError({
        errors: [{
          path: "/planId",
          message: "deployment authority plan is not pending",
        }],
        context: { state: plan.state },
      }),
    };
  }
  if (
    plan.expiresAt !== undefined && Date.parse(plan.expiresAt) <= Date.now()
  ) {
    return {
      ok: false,
      error: new ValidationError({
        errors: [{
          path: "/planId",
          message: "deployment authority plan is expired",
        }],
        context: { expiresAt: plan.expiresAt },
      }),
    };
  }
  if (classification !== undefined && plan.classification !== classification) {
    return {
      ok: false,
      error: new ValidationError({
        errors: [{
          path: "/planId",
          message: "deployment authority plan classification mismatch",
        }],
        context: {
          expectedClassification: classification,
          actualClassification: plan.classification,
        },
      }),
    };
  }
  return { ok: true, plan };
}

function plannedDesiredVersion(
  plan: DeploymentAuthorityPlan,
): string | undefined {
  const summary = plan.proposal.summary;
  if (!isRecord(summary)) return undefined;
  const version = summary.desiredVersion;
  return typeof version === "string" && version.length > 0
    ? version
    : undefined;
}

function grantOverrideKey(record: DeploymentAuthorityGrantOverride): string {
  return JSON.stringify([
    record.deploymentId,
    record.identityKind,
    record.grantKind,
    record.contractId,
    record.origin,
    record.sessionPublicKey,
    record.capability,
    record.capabilityGroupKey,
  ]);
}

function grantOverrideDeploymentIdError(input: {
  deploymentId: string;
  overrides: DeploymentAuthorityGrantOverride[];
}): ValidationError | null {
  const mismatch = input.overrides.find((override) =>
    override.deploymentId !== input.deploymentId
  );
  if (!mismatch) return null;
  return new ValidationError({
    errors: [{
      path: "/overrides",
      message: "grant override deployment id mismatch",
    }],
    context: {
      deploymentId: input.deploymentId,
      overrideDeploymentId: mismatch.deploymentId,
    },
  });
}

function reconciliationValidationError(
  error: AuthorityReconciliationError,
): ValidationError {
  const path = error.code === "desired_version_mismatch"
    ? "/desiredVersion"
    : "/deploymentId";
  return new ValidationError({
    errors: [{ path, message: error.message }],
    context: error.context,
  });
}

/** Creates the deployment authority reconcile RPC handler. */
export function createAuthDeploymentAuthorityReconcileHandler(deps: {
  authorityReconciler: AuthorityReconciler;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: { deploymentId: string; desiredVersion?: string };
    context: { caller: RpcUser };
  }): Promise<
    Result<{
      authority: DeploymentAuthority;
      materializedAuthority: DeploymentAuthorityMaterialization;
      reconciliation: DeploymentAuthorityReconciliationStatus;
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.Reconcile",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    try {
      return Result.ok(
        await deps.authorityReconciler.reconcileDeployment(req.deploymentId, {
          desiredVersion: req.desiredVersion,
        }),
      );
    } catch (error) {
      if (error instanceof AuthorityReconciliationError) {
        return Result.err(reconciliationValidationError(error));
      }
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority update acceptance RPC handler. */
export function createAuthDeploymentAuthorityAcceptUpdateHandler(deps: {
  deploymentAuthorityStorage: Pick<
    DeploymentAuthorityStorage,
    "get" | "put" | "acceptAuthorityPlan"
  >;
  deploymentAuthorityPlanStorage: DeploymentAuthorityPlanStorage;
  capabilityDefinitionStorage?: DeploymentAuthorityCapabilityDefinitionStorage;
  authorityReconciler: AuthorityReconciler;
  logger: AcceptLogger;
}) {
  return createAcceptDeploymentAuthorityPlanHandler(deps, "update");
}

/** Creates the deployment authority migration acceptance RPC handler. */
export function createAuthDeploymentAuthorityAcceptMigrationHandler(deps: {
  deploymentAuthorityStorage: Pick<
    DeploymentAuthorityStorage,
    "get" | "put" | "acceptAuthorityPlan"
  >;
  deploymentAuthorityPlanStorage: DeploymentAuthorityPlanStorage;
  capabilityDefinitionStorage?: DeploymentAuthorityCapabilityDefinitionStorage;
  authorityReconciler: AuthorityReconciler;
  logger: AcceptLogger;
}) {
  return createAcceptDeploymentAuthorityPlanHandler(deps, "migration");
}

function createAcceptDeploymentAuthorityPlanHandler(
  deps: {
    deploymentAuthorityStorage: Pick<
      DeploymentAuthorityStorage,
      "get" | "put" | "acceptAuthorityPlan"
    >;
    deploymentAuthorityPlanStorage: DeploymentAuthorityPlanStorage;
    capabilityDefinitionStorage?:
      DeploymentAuthorityCapabilityDefinitionStorage;
    authorityReconciler: AuthorityReconciler;
    logger: AcceptLogger;
  },
  classification: "update" | "migration",
) {
  return async (args: {
    input: {
      planId: string;
      expectedDesiredVersion?: string;
      acknowledgement?: string;
    };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { authority: DeploymentAuthority },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: classification === "update"
        ? "Auth.DeploymentAuthority.AcceptUpdate"
        : "Auth.DeploymentAuthority.AcceptMigration",
      caller,
      planId: req.planId,
    }, "RPC request");

    try {
      const pending = validatePendingPlan(
        await deps.deploymentAuthorityPlanStorage.get(req.planId),
        classification,
      );
      if (!pending.ok) return Result.err(pending.error);
      const plan = pending.plan;
      if (classification === "migration" && req.acknowledgement === undefined) {
        return invalid(
          "/acknowledgement",
          "migration acknowledgement is required",
        );
      }
      const decisionReason = classification === "migration"
        ? req.acknowledgement
        : "accepted";
      if (!isAuthorityNeedSet(plan.desiredChange)) {
        return invalid(
          "/planId",
          "deployment authority plan desired change is invalid",
        );
      }
      const authority = await deps.deploymentAuthorityStorage.get(
        plan.deploymentId,
      );
      if (!authority) {
        return invalid("/deploymentId", "deployment authority does not exist", {
          deploymentId: plan.deploymentId,
        });
      }
      const planDesiredVersion = plannedDesiredVersion(plan);
      if (planDesiredVersion === undefined) {
        return invalid(
          "/planId",
          "deployment authority plan desired version is missing",
          { planId: plan.planId },
        );
      }
      if (planDesiredVersion !== authority.version) {
        return invalid("/planId", "desired version mismatch", {
          plannedDesiredVersion: planDesiredVersion,
          actualDesiredVersion: authority.version,
        });
      }
      if (
        req.expectedDesiredVersion !== undefined &&
        req.expectedDesiredVersion !== authority.version
      ) {
        return invalid("/expectedDesiredVersion", "desired version mismatch", {
          expectedDesiredVersion: req.expectedDesiredVersion,
          actualDesiredVersion: authority.version,
        });
      }
      const now = new Date().toISOString();
      const newVersion = desiredVersion();
      const acceptedDesiredState = desiredStateForAcceptedPlan(
        authority,
        plan,
        plan.desiredChange,
        classification,
      );
      if (!acceptedDesiredState.ok) return acceptedDesiredState.error;
      const updatedAuthority: DeploymentAuthority = {
        ...authority,
        desiredState: acceptedDesiredState.desiredState,
        version: newVersion,
        updatedAt: now,
      };
      const acceptedPlan: DeploymentAuthorityPlan = {
        ...plan,
        state: "accepted",
        decisionAt: now,
        decisionBy: decisionBy(caller),
        decisionReason,
      };
      if (deps.deploymentAuthorityStorage.acceptAuthorityPlan) {
        const accepted = await deps.deploymentAuthorityStorage
          .acceptAuthorityPlan(
            updatedAuthority,
            acceptedPlan,
            authority.version,
          );
        if (!accepted) {
          return invalid(
            "/planId",
            "deployment authority plan is no longer pending or desired version changed",
            {
              planId: plan.planId,
              plannedDesiredVersion: planDesiredVersion,
            },
          );
        }
      } else {
        await deps.deploymentAuthorityStorage.put(updatedAuthority);
        await deps.deploymentAuthorityPlanStorage.put(acceptedPlan);
      }
      await deps.capabilityDefinitionStorage?.replaceForDeployment(
        updatedAuthority.deploymentId,
        authorityCapabilityDefinitions(plan),
      );
      try {
        await deps.authorityReconciler.reconcileDeployment(
          updatedAuthority.deploymentId,
          { desiredVersion: newVersion },
        );
      } catch (error) {
        deps.logger.warn?.({
          err: toError(error),
          deploymentId: updatedAuthority.deploymentId,
        }, "Deployment authority reconciliation trigger failed");
      }
      return Result.ok({ authority: updatedAuthority });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority plan rejection RPC handler. */
export function createAuthDeploymentAuthorityRejectHandler(deps: {
  deploymentAuthorityPlanStorage: DeploymentAuthorityPlanStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: { planId: string; reason?: string };
    context: { caller: RpcUser };
  }): Promise<
    Result<{ success: boolean }, AuthError | ValidationError | UnexpectedError>
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.Reject",
      caller,
      planId: req.planId,
    }, "RPC request");

    try {
      const pending = validatePendingPlan(
        await deps.deploymentAuthorityPlanStorage.get(req.planId),
      );
      if (!pending.ok) return Result.err(pending.error);
      const now = new Date().toISOString();
      await deps.deploymentAuthorityPlanStorage.put({
        ...pending.plan,
        state: "rejected",
        decisionAt: now,
        decisionBy: decisionBy(caller),
        decisionReason: req.reason ?? "rejected",
      });
      return Result.ok({ success: true });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority plan list RPC handler. */
export function createAuthDeploymentAuthorityPlansListHandler(deps: {
  deploymentAuthorityPlanStorage: Pick<
    DeploymentAuthorityPlanListStorage,
    "listFilteredPage"
  >;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: BoundedListQuery & {
        deploymentId?: string;
        state?: DeploymentAuthorityPlan["state"];
        classification?: DeploymentAuthorityPlan["classification"];
        kind?: DeploymentAuthority["kind"];
      };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<ListPage<DeploymentAuthorityPlan>, AuthError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.Plans.List",
      caller,
      deploymentId: req.deploymentId,
      state: req.state,
      classification: req.classification,
      kind: req.kind,
    }, "RPC request");

    try {
      return Result.ok(
        await deps.deploymentAuthorityPlanStorage.listFilteredPage({
          deploymentId: req.deploymentId,
          state: req.state,
          classification: req.classification,
          kind: req.kind,
        }, req),
      );
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority plan get RPC handler. */
export function createAuthDeploymentAuthorityPlansGetHandler(deps: {
  deploymentAuthorityPlanStorage: Pick<DeploymentAuthorityPlanStorage, "get">;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: { planId: string };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<
      { plan: DeploymentAuthorityPlan },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.Plans.Get",
      caller,
      planId: req.planId,
    }, "RPC request");

    try {
      const plan = await deps.deploymentAuthorityPlanStorage.get(req.planId);
      if (!plan) {
        return invalid("/planId", "deployment authority plan not found", {
          planId: req.planId,
        });
      }
      return Result.ok({ plan });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority list RPC handler. */
export function createAuthDeploymentAuthorityListHandler(deps: {
  deploymentAuthorityStorage: DeploymentAuthorityStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: BoundedListQuery & {
        kind?: DeploymentAuthority["kind"];
        disabled?: boolean;
      };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<ListPage<DeploymentAuthority>, AuthError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace(
      { rpc: "Auth.DeploymentAuthority.List", caller },
      "RPC request",
    );
    try {
      const filters = { kind: req.kind, disabled: req.disabled };
      return Result.ok(
        await deps.deploymentAuthorityStorage.listFilteredPage(filters, req),
      );
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority get RPC handler. */
export function createAuthDeploymentAuthorityGetHandler(deps: {
  deploymentAuthorityStorage: Pick<DeploymentAuthorityStorage, "get">;
  materializedAuthorityStorage: MaterializedAuthorityStorage;
  deploymentPortalRouteStorage: DeploymentPortalRouteStorage;
  deploymentAuthorityGrantOverrideStorage:
    DeploymentAuthorityGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (
    { input: req, context: { caller } }: {
      input: { deploymentId: string };
      context: { caller: RpcUser };
    },
  ): Promise<
    Result<{
      authority: DeploymentAuthority;
      materializedAuthority: DeploymentAuthorityMaterialization | null;
      portalRoute: DeploymentPortalRoute | null;
      grantOverrides: DeploymentAuthorityGrantOverride[];
    }, AuthError | ValidationError | UnexpectedError>
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace(
      {
        rpc: "Auth.DeploymentAuthority.Get",
        caller,
        deploymentId: req.deploymentId,
      },
      "RPC request",
    );
    try {
      const authority = await deps.deploymentAuthorityStorage.get(
        req.deploymentId,
      );
      if (!authority) {
        return invalid("/deploymentId", "deployment authority not found", {
          deploymentId: req.deploymentId,
        });
      }
      const [materializedAuthority, portalRoute, grantOverrides] = await Promise
        .all([
          deps.materializedAuthorityStorage.get(req.deploymentId),
          deps.deploymentPortalRouteStorage.get(req.deploymentId),
          deps.deploymentAuthorityGrantOverrideStorage.listByDeployment(
            req.deploymentId,
          ),
        ]);
      return Result.ok({
        authority,
        materializedAuthority: materializedAuthority ?? null,
        portalRoute: portalRoute ?? null,
        grantOverrides,
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority grant override list RPC handler. */
export function createAuthDeploymentAuthorityGrantOverridesListHandler(deps: {
  deploymentAuthorityGrantOverrideStorage:
    DeploymentAuthorityGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: BoundedListQuery;
    context: { caller: RpcUser };
  }): Promise<
    Result<
      ListPage<DeploymentAuthorityGrantOverride>,
      AuthError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.GrantOverrides.List",
      caller,
    }, "RPC request");

    try {
      return Result.ok(
        await deps.deploymentAuthorityGrantOverrideStorage.listCountedPage(req),
      );
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority grant override replacement RPC handler. */
export function createAuthDeploymentAuthorityGrantOverridesPutHandler(deps: {
  deploymentAuthorityStorage: Pick<DeploymentAuthorityStorage, "get">;
  deploymentAuthorityGrantOverrideStorage:
    DeploymentAuthorityGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: {
      deploymentId: string;
      overrides: DeploymentAuthorityGrantOverride[];
    };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { grantOverrides: DeploymentAuthorityGrantOverride[] },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.GrantOverrides.Put",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    const invalidOverrides = grantOverrideDeploymentIdError(req);
    if (invalidOverrides) return Result.err(invalidOverrides);

    try {
      const authority = await deps.deploymentAuthorityStorage.get(
        req.deploymentId,
      );
      if (!authority) {
        return invalid("/deploymentId", "deployment authority does not exist", {
          deploymentId: req.deploymentId,
        });
      }
      await deps.deploymentAuthorityGrantOverrideStorage.replaceForDeployment(
        req.deploymentId,
        req.overrides,
      );
      const grantOverrides = await deps.deploymentAuthorityGrantOverrideStorage
        .listByDeployment(req.deploymentId);
      return Result.ok({ grantOverrides });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the deployment authority grant override exact-row removal RPC handler. */
export function createAuthDeploymentAuthorityGrantOverridesRemoveHandler(deps: {
  deploymentAuthorityStorage: Pick<DeploymentAuthorityStorage, "get">;
  deploymentAuthorityGrantOverrideStorage:
    DeploymentAuthorityGrantOverrideStorage;
  logger: Pick<AuthRuntimeDeps["logger"], "trace">;
}) {
  return async (args: {
    input: {
      deploymentId: string;
      overrides: DeploymentAuthorityGrantOverride[];
    };
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { grantOverrides: DeploymentAuthorityGrantOverride[] },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const { input: req, context: { caller } } = args;
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    deps.logger.trace({
      rpc: "Auth.DeploymentAuthority.GrantOverrides.Remove",
      caller,
      deploymentId: req.deploymentId,
    }, "RPC request");

    const invalidOverrides = grantOverrideDeploymentIdError(req);
    if (invalidOverrides) return Result.err(invalidOverrides);

    try {
      const authority = await deps.deploymentAuthorityStorage.get(
        req.deploymentId,
      );
      if (!authority) {
        return invalid("/deploymentId", "deployment authority does not exist", {
          deploymentId: req.deploymentId,
        });
      }
      const removeKeys = new Set(
        req.overrides.map((override) => grantOverrideKey(override)),
      );
      const grantOverrides = (await deps.deploymentAuthorityGrantOverrideStorage
        .listByDeployment(req.deploymentId))
        .filter((override) => !removeKeys.has(grantOverrideKey(override)));
      await deps.deploymentAuthorityGrantOverrideStorage.replaceForDeployment(
        req.deploymentId,
        grantOverrides,
      );
      return Result.ok({ grantOverrides });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}
