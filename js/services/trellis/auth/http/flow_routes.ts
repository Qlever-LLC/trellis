import type { Hono } from "@hono/hono";
import { HTTPException } from "@hono/hono/http-exception";
import { AsyncResult, isErr } from "@qlever-llc/result";
import { Type } from "typebox";
import { Value } from "typebox/value";

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

/** Registers browser auth flow state, approval, and bind endpoints. */
export function registerFlowRoutes(
  app: Hono,
  context: AuthHttpRouteContext,
): void {
  const { config, providers, opts } = context;
  const { pendingAuthKV } = opts.runtimeDeps;

  app.get("/auth/flow/:flowId", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await context.loadBrowserFlow(flowId);
    if (!flow) {
      return c.json({ status: "expired" });
    }

    const providersList = Object.entries(providers).map(([id, provider]) => ({
      id,
      displayName: provider.displayName,
    }));
    const contract = flow.contract ?? {};
    let resolution = null;
    let redirectLocation = undefined;
    let returnLocation = undefined;
    if (flow.authToken) {
      const pendingEntry = await pendingAuthKV.get(
        await hashKey(flow.authToken),
      ).take();
      if (!isErr(pendingEntry)) {
        const pending = pendingEntry.value as PendingAuth;
        resolution = await context.requireApprovalResolution(pending);
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

    return c.json(
      await buildPortalFlowState({
        flowId,
        flow,
        app: appMeta,
        providers: providersList,
        resolution,
        redirectLocation,
        returnLocation,
      }),
    );
  });

  app.post("/auth/flow/:flowId/approval", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await context.loadBrowserFlow(flowId);
    if (!flow || !flow.authToken) {
      return c.json({ status: "expired" });
    }

    const bodyResult = await AsyncResult.try(() => c.req.json());
    if (bodyResult.isErr()) {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const approved = parseApprovalRequest(bodyResult.take());
    if (approved === undefined) {
      return c.json({ error: "Invalid approval request" }, 400);
    }

    const authTokenHash = await hashKey(flow.authToken);
    const pendingEntry = await pendingAuthKV.get(authTokenHash).take();
    if (isErr(pendingEntry)) {
      return c.json({ status: "expired" });
    }
    const pending = pendingEntry.value as PendingAuth;
    const resolution = await context.requireApprovalResolution(pending);
    const providersList = Object.entries(providers).map(([id, provider]) => ({
      id,
      displayName: provider.displayName,
    }));
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

    if (
      resolution.effectiveApproval.kind === "admin_policy" ||
      resolution.effectiveApproval.kind === "portal_profile"
    ) {
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          resolution,
          ...(resolution.missingCapabilities.length === 0 &&
              !getApprovalResolutionBlocker(resolution)
            ? {
              redirectLocation: buildRedirectLocation(pending.redirectTo, {
                flowId,
              }),
            }
            : { returnLocation }),
        }),
      );
    }

    if (resolution.missingCapabilities.length > 0) {
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          resolution,
          returnLocation,
        }),
      );
    }

    const now = new Date();
    const updatedResolution = applyApprovalDecision({
      resolution,
      approved,
      answeredAt: now,
    });
    await opts.contractApprovalStorage.put(updatedResolution.storedApproval);

    if (!approved) {
      return c.json(
        await buildPortalFlowState({
          flowId,
          flow,
          app: appMeta,
          providers: providersList,
          resolution: updatedResolution,
          returnLocation,
        }),
      );
    }

    return c.json(
      await buildPortalFlowState({
        flowId,
        flow,
        app: appMeta,
        providers: providersList,
        resolution: updatedResolution,
        redirectLocation: buildRedirectLocation(pending.redirectTo, { flowId }),
      }),
    );
  });

  app.post("/auth/flow/:flowId/bind", async (c) => {
    const flowId = c.req.param("flowId");
    const flow = await context.loadBrowserFlow(flowId);
    if (!flow || !flow.authToken) {
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
    const pendingEntry = await pendingAuthKV.get(await hashKey(flow.authToken))
      .take();
    if (isErr(pendingEntry)) {
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

    return c.json(
      await context.completePendingBind({ pending, pendingValue, sessionKey }),
    );
  });
}
