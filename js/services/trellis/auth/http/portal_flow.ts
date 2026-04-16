import type {
  PortalFlowApp,
  PortalFlowApproval,
  PortalFlowProvider,
  PortalFlowState,
} from "@qlever-llc/trellis/auth";

import type { AuthBrowserFlow } from "../../state/schemas.ts";
import { type ApprovalResolution as PortalFlowResolution } from "./support.ts";

export async function buildPortalFlowState(args: {
  flowId: string;
  flow: AuthBrowserFlow | null;
  app: PortalFlowApp;
  providers: PortalFlowProvider[];
  resolution?: PortalFlowResolution | null;
  redirectLocation?: string;
  returnLocation?: string;
  now?: Date;
}): Promise<PortalFlowState> {
  const now = args.now ?? new Date();
  if (!args.flow || args.flow.expiresAt < now) {
    return { status: "expired" };
  }

  if (args.redirectLocation) {
    return { status: "redirect", location: args.redirectLocation };
  }

  if (!args.flow.authToken) {
    return {
      status: "choose_provider",
      flowId: args.flowId,
      providers: args.providers,
      app: args.app,
    };
  }

  if (!args.resolution) {
    return { status: "expired" };
  }

  const approval = args.resolution.plan.approval;
  const approvalView: PortalFlowApproval = {
    contractId: approval.contractId,
    contractDigest: args.resolution.plan.digest,
    displayName: approval.displayName,
    description: approval.description,
    capabilities: approval.capabilities,
  };

  if (args.resolution.storedApproval?.answer === "denied") {
    return {
      status: "approval_denied",
      flowId: args.flowId,
      approval: approvalView,
      ...(args.returnLocation ? { returnLocation: args.returnLocation } : {}),
    };
  }

  if (args.resolution.missingCapabilities.length > 0) {
    return {
      status: "insufficient_capabilities",
      flowId: args.flowId,
      user: {
        origin: args.resolution.userOrigin,
        id: args.resolution.userId,
        ...(args.resolution.userName ? { name: args.resolution.userName } : {}),
      },
      approval: approvalView,
      missingCapabilities: args.resolution.missingCapabilities,
      userCapabilities: args.resolution.existingCapabilities,
      ...(args.returnLocation ? { returnLocation: args.returnLocation } : {}),
    };
  }

  return {
    status: "approval_required",
    flowId: args.flowId,
    user: {
      origin: args.resolution.userOrigin,
      id: args.resolution.userId,
      ...(args.resolution.userName ? { name: args.resolution.userName } : {}),
      ...(args.resolution.userEmail ? { email: args.resolution.userEmail } : {}),
    },
    approval: approvalView,
  };
}
