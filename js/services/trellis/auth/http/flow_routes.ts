import type { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { recordTrellisDuration } from "@qlever-llc/trellis/telemetry";

import { hashKey, verifyDomainSig } from "../crypto.ts";
import {
  type PendingAuth,
  SessionKeySchema,
  SignatureSchema,
} from "../schemas.ts";
import { buildPortalFlowState } from "./portal_flow.ts";
import type { AuthHttpRouteContext } from "./route_context.ts";
import {
  applyApprovalDecision,
  buildRedirectLocation,
  getApprovalResolutionBlocker,
  type PendingAuthEntry,
} from "./support.ts";

const localLoginProvider = {
  id: "local",
  displayName: "Username and password",
};

const FlowBindRequestSchema = Type.Object({
  sessionKey: SessionKeySchema,
  sig: SignatureSchema,
});

function parseApprovalRequest(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0]?.[0] !== "approved") {
    return undefined;
  }
  const approved = entries[0][1];
  return typeof approved === "boolean" ? approved : undefined;
}

function buildAppMeta(args: {
  contract: Record<string, unknown>;
  context?: Record<string, unknown>;
  instanceName: string;
  contractDigest?: string;
}) {
  const { contract } = args;
  return {
    contractId: typeof contract["id"] === "string" &&
        contract["id"].length > 0
      ? contract["id"]
      : "unknown",
    contractDigest: args.contractDigest ??
      (typeof contract["digest"] === "string" && contract["digest"].length > 0
        ? contract["digest"]
        : "unknown"),
    displayName: typeof contract["displayName"] === "string" &&
        contract["displayName"].length > 0
      ? contract["displayName"]
      : args.instanceName,
    description: typeof contract["description"] === "string" &&
        contract["description"].length > 0
      ? contract["description"]
      : args.instanceName,
    ...(args.context ? { context: args.context } : {}),
  };
}

function buildProvidersList(
  localIdentityEnabled: boolean,
  federatedProviders: ReturnType<
    AuthHttpRouteContext["federatedProvidersForPortal"]
  >,
) {
  return localIdentityEnabled
    ? [localLoginProvider, ...federatedProviders]
    : federatedProviders;
}

/** Registers browser auth flow state, approval, and bind endpoints. */
export function registerFlowRoutes(
  app: Hono,
  context: AuthHttpRouteContext,
): void {
  const { config, opts } = context;
  const { pendingAuthKV } = opts.runtimeDeps;

  app.get("/auth/flow/:flowId", async (c) => {
    const totalStartedAt = performance.now();
    const flowId = c.req.param("flowId");
    const loadStartedAt = performance.now();
    const flow = await context.loadBrowserFlow(flowId);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - loadStartedAt,
      { phase: "approval_fetch" },
    );
    if (!flow) {
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - totalStartedAt,
        { phase: "approval_fetch" },
      );
      return c.json({ status: "expired" });
    }

    const contract = flow.contract ?? {};
    const portalStartedAt = performance.now();
    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - portalStartedAt,
      { phase: "approval_fetch" },
    );
    const federatedProviders = context.federatedProvidersForPortal(
      selectedPortal,
    );
    const providersList = buildProvidersList(
      config.auth.localIdentity.enabled,
      federatedProviders,
    );
    context.requireSelectedPortalOrigin(
      selectedPortal,
      c.req.header("origin"),
    );
    const registration = context.registrationAvailability(selectedPortal);
    let resolution = null;
    let redirectLocation = undefined;
    let returnLocation = flow.redirectTo;
    if (flow.authToken) {
      const pendingStartedAt = performance.now();
      const pendingEntry = await pendingAuthKV.get(
        await hashKey(flow.authToken),
      ).take();
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - pendingStartedAt,
        { phase: "approval_fetch" },
      );
      if (!isErr(pendingEntry)) {
        const pending = pendingEntry.value as PendingAuth;
        const resolutionStartedAt = performance.now();
        resolution = await context.requireApprovalResolution(pending);
        recordTrellisDuration(
          "trellis.auth.flow.duration",
          performance.now() - resolutionStartedAt,
          { phase: "approval_fetch" },
        );
        returnLocation = buildRedirectLocation(pending.redirectTo, { flowId });
        if (
          resolution.effectiveApproval.answer === "approved" &&
          resolution.missingCapabilities.length === 0 &&
          !getApprovalResolutionBlocker(resolution)
        ) {
          redirectLocation = buildRedirectLocation(pending.redirectTo, {
            flowId,
          });
        }
      }
    }

    const appMeta = buildAppMeta({
      contract,
      ...(resolution ? { contractDigest: resolution.plan.digest } : {}),
      instanceName: config.instanceName,
      ...(flow.context ? { context: flow.context } : {}),
    });

    const buildStateStartedAt = performance.now();
    const state = await buildPortalFlowState({
      flowId,
      flow,
      app: appMeta,
      providers: providersList,
      portal: selectedPortal.portal,
      registration,
      resolution,
      redirectLocation,
      returnLocation,
    });
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - buildStateStartedAt,
      { phase: "approval_fetch" },
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - totalStartedAt,
      { phase: "approval_fetch" },
    );
    return c.json(state);
  });

  app.post("/auth/flow/:flowId/approval", async (c) => {
    const totalStartedAt = performance.now();
    const flowId = c.req.param("flowId");
    const loadStartedAt = performance.now();
    const flow = await context.loadBrowserFlow(flowId);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - loadStartedAt,
      { phase: "approval_submit" },
    );
    if (!flow || !flow.authToken) {
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - totalStartedAt,
        { phase: "approval_submit" },
      );
      return c.json({ status: "expired" });
    }
    const portalStartedAt = performance.now();
    const selectedPortal = await context.resolveSelectedLoginPortal(flow);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - portalStartedAt,
      { phase: "approval_submit" },
    );
    context.requireSelectedPortalOrigin(
      selectedPortal,
      c.req.header("origin"),
    );

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const approved = parseApprovalRequest(bodyResult.take());
    if (approved === undefined) {
      return c.json({ error: "Invalid approval request" }, 400);
    }

    const authTokenHash = await hashKey(flow.authToken);
    const pendingStartedAt = performance.now();
    const pendingEntry = await pendingAuthKV.get(authTokenHash).take();
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - pendingStartedAt,
      { phase: "approval_submit" },
    );
    if (isErr(pendingEntry)) {
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - totalStartedAt,
        { phase: "approval_submit" },
      );
      return c.json({ status: "expired" });
    }
    const pendingRecord = pendingEntry as PendingAuthEntry;
    const pending = pendingRecord.value as PendingAuth;
    const resolutionStartedAt = performance.now();
    const resolution = await context.requireApprovalResolution(pending);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - resolutionStartedAt,
      { phase: "approval_submit" },
    );
    const registration = context.registrationAvailability(selectedPortal);
    const providersList = buildProvidersList(
      config.auth.localIdentity.enabled,
      registration.federatedIdentity.providers,
    );
    const contract = flow.contract ?? {};
    const appMeta = buildAppMeta({
      contract,
      contractDigest: resolution.plan.digest,
      instanceName: config.instanceName,
      ...(flow.context ? { context: flow.context } : {}),
    });
    const returnLocation = buildRedirectLocation(pending.redirectTo, {
      flowId,
    });

    if (resolution.missingCapabilities.length > 0) {
      const buildStateStartedAt = performance.now();
      const state = await buildPortalFlowState({
        flowId,
        flow,
        app: appMeta,
        providers: providersList,
        portal: selectedPortal.portal,
        registration,
        resolution,
        returnLocation,
      });
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - buildStateStartedAt,
        { phase: "approval_submit" },
      );
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - totalStartedAt,
        { phase: "approval_submit" },
      );
      return c.json(state);
    }

    if (!approved) {
      await pendingRecord.delete(true);
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          portal: selectedPortal.portal,
          registration,
          resolution,
          redirectLocation: buildRedirectLocation(pending.redirectTo, {
            authError: "approval_denied",
          }),
        }),
      );
    }

    const now = new Date();
    const updatedResolution = applyApprovalDecision({
      resolution,
      approved,
      answeredAt: now,
    });
    const approvalPutStartedAt = performance.now();
    await opts.contractApprovalStorage.put(updatedResolution.storedApproval);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - approvalPutStartedAt,
      { phase: "approval_submit" },
    );

    const buildStateStartedAt = performance.now();
    const state = await buildPortalFlowState({
      flowId,
      flow,
      app: appMeta,
      providers: providersList,
      portal: selectedPortal.portal,
      registration,
      resolution: updatedResolution,
      redirectLocation: buildRedirectLocation(pending.redirectTo, { flowId }),
    });
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - buildStateStartedAt,
      { phase: "approval_submit" },
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - totalStartedAt,
      { phase: "approval_submit" },
    );
    return c.json(state);
  });

  app.post("/auth/flow/:flowId/bind", async (c) => {
    const totalStartedAt = performance.now();
    const flowId = c.req.param("flowId");
    const loadStartedAt = performance.now();
    const flow = await context.loadBrowserFlow(flowId);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - loadStartedAt,
      { phase: "bind" },
    );
    if (!flow || !flow.authToken) {
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - totalStartedAt,
        { phase: "bind" },
      );
      return c.json({ status: "expired" });
    }

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const body = bodyResult.take();
    if (!Value.Check(FlowBindRequestSchema, body)) {
      return c.json({ error: "Invalid bind request" }, 400);
    }

    const { sessionKey, sig } = Value.Parse(FlowBindRequestSchema, body);
    const pendingStartedAt = performance.now();
    const pendingEntry = await pendingAuthKV.get(await hashKey(flow.authToken))
      .take();
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - pendingStartedAt,
      { phase: "bind" },
    );
    if (isErr(pendingEntry)) {
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - totalStartedAt,
        { phase: "bind" },
      );
      return c.json({ status: "expired" });
    }
    const pending = pendingEntry as PendingAuthEntry;
    const pendingValue = pending.value as PendingAuth;

    if (pendingValue.sessionKey !== sessionKey) {
      throw new HTTPException(400, { message: "Session key mismatch" });
    }
    if (!(await verifyDomainSig(sessionKey, "bind-flow", flowId, sig))) {
      throw new HTTPException(400, { message: "Invalid signature" });
    }

    const completeStartedAt = performance.now();
    const result = await context.completePendingBind({
      pending,
      pendingValue,
      sessionKey,
    });
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - completeStartedAt,
      { phase: "bind" },
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - totalStartedAt,
      { phase: "bind" },
    );
    return c.json(result);
  });
}
