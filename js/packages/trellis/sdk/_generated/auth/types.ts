// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import type {
  BaseError,
  EventListenerContext,
  HandlerTrellis,
  MaybeAsync,
  OperationRuntimeHandle,
  Result,
  RpcHandlerContext,
  SessionCaller,
  TrellisErrorInstance,
  TrellisEventMessage,
} from "../../../index.ts";

import type { Api } from "./api.ts";

type WithDeps<TDeps> = [TDeps] extends [undefined] ? {} : { deps: TDeps };
export type HandlerClient = HandlerTrellis<Api>;

export const CONTRACT_ID = "trellis.auth@v1" as const;
export const CONTRACT_DIGEST =
  "9lVBR9oyfFwuD9gvT9xR6GPK56QGUjwlvVqmVAkB7ZA" as const;

export type AuthCapabilitiesListInput = { limit: number; offset?: number };
export type AuthCapabilitiesListOutput = {
  count: number;
  entries: Array<
    {
      consequence?: string;
      contractDigest?: string;
      contractDisplayName?: string;
      contractId?: string;
      deploymentId?: string;
      description: string;
      direction?: "creates" | "given";
      displayName: string;
      key: string;
      source: "contract" | "platform";
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthCapabilityGroupsDeleteInput = { groupKey: string };
export type AuthCapabilityGroupsDeleteOutput = { success: boolean };

export type AuthCapabilityGroupsGetInput = { groupKey: string };
export type AuthCapabilityGroupsGetOutput = {
  group: {
    capabilities: Array<string>;
    createdAt: string;
    description: string;
    displayName: string;
    groupKey: string;
    includedGroups: Array<string>;
    updatedAt: string;
  };
};

export type AuthCapabilityGroupsListInput = { limit: number; offset?: number };
export type AuthCapabilityGroupsListOutput = {
  count: number;
  entries: Array<
    {
      capabilities: Array<string>;
      createdAt: string;
      description: string;
      displayName: string;
      groupKey: string;
      includedGroups: Array<string>;
      updatedAt: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthCapabilityGroupsPutInput = {
  capabilities?: Array<string>;
  description: string;
  displayName: string;
  groupKey: string;
  includedGroups?: Array<string>;
};
export type AuthCapabilityGroupsPutOutput = {
  group: {
    capabilities: Array<string>;
    createdAt: string;
    description: string;
    displayName: string;
    groupKey: string;
    includedGroups: Array<string>;
    updatedAt: string;
  };
};

export type AuthCatalogIssuesResolveInput = {
  action: "keep-current" | "force-replace";
  issueId: string;
};
export type AuthCatalogIssuesResolveOutput = {
  action: "keep-current" | "force-replace";
  issueId: string;
  success: true;
};

export type AuthConnectionsKickInput = { userNkey: string };
export type AuthConnectionsKickOutput = { success: boolean };

export type AuthConnectionsListInput = {
  limit: number;
  offset?: number;
  sessionKey?: string;
  user?: string;
};
export type AuthConnectionsListOutput = {
  count: number;
  entries: Array<
    ({
      clientId: number;
      connectedAt: string;
      contractDisplayName: string;
      contractId: string;
      key: string;
      participantKind: "app";
      principal: {
        identity: { identityId: string; provider: string; subject: string };
        name: string;
        type: "user";
        userId: string;
      };
      serverId: string;
      sessionKey: string;
      userNkey: string;
    } | {
      clientId: number;
      connectedAt: string;
      contractDisplayName: string;
      contractId: string;
      key: string;
      participantKind: "agent";
      principal: {
        identity: { identityId: string; provider: string; subject: string };
        name: string;
        type: "user";
        userId: string;
      };
      serverId: string;
      sessionKey: string;
      userNkey: string;
    } | {
      clientId: number;
      connectedAt: string;
      contractDisplayName?: string;
      contractId: string;
      key: string;
      participantKind: "device";
      principal: {
        deploymentId: string;
        deviceId: string;
        deviceType: string;
        runtimePublicKey: string;
        type: "device";
      };
      serverId: string;
      sessionKey: string;
      userNkey: string;
    } | {
      clientId: number;
      connectedAt: string;
      key: string;
      participantKind: "service";
      principal: {
        deploymentId: string;
        id: string;
        instanceId: string;
        name: string;
        type: "service";
      };
      serverId: string;
      sessionKey: string;
      userNkey: string;
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeploymentAuthorityAcceptMigrationInput = {
  acknowledgement: string;
  expectedDesiredVersion?: string;
  planId: string;
};
export type AuthDeploymentAuthorityAcceptMigrationOutput = {
  authority: {
    createdAt: string;
    deploymentId: string;
    desiredState: {
      capabilities: Array<string>;
      needs: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      resources: Array<
        {
          alias: string;
          definition?: {};
          kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
          required: boolean;
        }
      >;
      surfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
    };
    disabled: boolean;
    kind: "service" | "device" | "app" | "cli" | "native" | "device-user";
    updatedAt: string;
    version: string;
  };
};

export type AuthDeploymentAuthorityAcceptUpdateInput = {
  expectedDesiredVersion?: string;
  planId: string;
};
export type AuthDeploymentAuthorityAcceptUpdateOutput = {
  authority: {
    createdAt: string;
    deploymentId: string;
    desiredState: {
      capabilities: Array<string>;
      needs: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      resources: Array<
        {
          alias: string;
          definition?: {};
          kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
          required: boolean;
        }
      >;
      surfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
    };
    disabled: boolean;
    kind: "service" | "device" | "app" | "cli" | "native" | "device-user";
    updatedAt: string;
    version: string;
  };
};

export type AuthDeploymentAuthorityGetInput = { deploymentId: string };
export type AuthDeploymentAuthorityGetOutput = {
  authority: {
    createdAt: string;
    deploymentId: string;
    desiredState: {
      capabilities: Array<string>;
      needs: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      resources: Array<
        {
          alias: string;
          definition?: {};
          kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
          required: boolean;
        }
      >;
      surfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
    };
    disabled: boolean;
    kind: "service" | "device" | "app" | "cli" | "native" | "device-user";
    updatedAt: string;
    version: string;
  };
  grantOverrides: Array<
    ({
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    })
  >;
  materializedAuthority: {
    deploymentId: string;
    desiredVersion: string;
    error?: string;
    grants: {
      capabilities: Array<{ capability: string }>;
      nats: Array<
        {
          direction: "publish" | "subscribe";
          grantSource:
            | "owned-surface"
            | "used-surface"
            | "resource-binding"
            | "platform-service"
            | "transfer";
          requiredCapabilities: Array<string>;
          subject: string;
          surface?: {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
          };
        }
      >;
      surfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          name: string;
          surfaceKind: "rpc" | "operation" | "event" | "feed";
        }
      >;
    };
    reconciledAt: string | null;
    resourceBindings: Array<
      {
        alias: string;
        binding: { [k: string]: unknown };
        createdAt: string;
        deploymentId: string;
        kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
        limits: { [k: string]: unknown } | null;
        updatedAt: string;
      }
    >;
    status: "current" | "pending" | "failed";
  } | null;
  portalRoute: {
    deploymentId: string;
    disabled: boolean;
    entryUrl: string | null;
    portalId: string | null;
    updatedAt: string;
  } | null;
};

export type AuthDeploymentAuthorityGrantOverridesListInput = {
  limit: number;
  offset?: number;
};
export type AuthDeploymentAuthorityGrantOverridesListOutput = {
  count: number;
  entries: Array<
    ({
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeploymentAuthorityGrantOverridesPutInput = {
  deploymentId: string;
  overrides: Array<
    ({
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    })
  >;
};
export type AuthDeploymentAuthorityGrantOverridesPutOutput = {
  grantOverrides: Array<
    ({
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    })
  >;
};

export type AuthDeploymentAuthorityGrantOverridesRemoveInput = {
  deploymentId: string;
  overrides: Array<
    ({
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    })
  >;
};
export type AuthDeploymentAuthorityGrantOverridesRemoveOutput = {
  grantOverrides: Array<
    ({
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "web";
      origin: string;
      sessionPublicKey: null;
    } | {
      capability: string;
      capabilityGroupKey: null;
      contractId: string;
      deploymentId: string;
      grantKind: "capability";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    } | {
      capability: null;
      capabilityGroupKey: string;
      contractId: string;
      deploymentId: string;
      grantKind: "capability-group";
      identityKind: "session";
      origin: null;
      sessionPublicKey: string;
    })
  >;
};

export type AuthDeploymentAuthorityListInput = {
  disabled?: boolean;
  kind?: "service" | "device" | "app" | "cli" | "native" | "device-user";
  limit: number;
  offset?: number;
};
export type AuthDeploymentAuthorityListOutput = {
  count: number;
  entries: Array<
    {
      createdAt: string;
      deploymentId: string;
      desiredState: {
        capabilities: Array<string>;
        needs: {
          capabilities: Array<{ capability: string; required: boolean }>;
          contracts: Array<{ contractId: string; required: boolean }>;
          resources: Array<
            {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            }
          >;
          surfaces: Array<
            {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
              required: boolean;
            }
          >;
        };
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
          }
        >;
      };
      disabled: boolean;
      kind: "service" | "device" | "app" | "cli" | "native" | "device-user";
      updatedAt: string;
      version: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeploymentAuthorityPlanInput = {
  contract: {};
  deploymentId: string;
  expectedDigest: string;
};
export type AuthDeploymentAuthorityPlanOutput = {
  plan: {
    classification: "update";
    createdAt: string;
    decisionAt?: string | null;
    decisionBy?: { [k: string]: unknown } | null;
    decisionReason?: string | null;
    deploymentId: string;
    desiredChange: {};
    expiresAt?: string;
    materializationPreview: {};
    planId: string;
    proposal: {
      contract?: {};
      contractDigest: string;
      contractId: string;
      deploymentId: string;
      proposalId?: string;
      providedSurfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
      requestedNeeds: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      summary?: {};
    };
    state?: "pending" | "accepted" | "rejected" | "expired";
    warnings: Array<string>;
  } | {
    acknowledgementRequired: boolean;
    classification: "migration";
    createdAt: string;
    decisionAt?: string | null;
    decisionBy?: { [k: string]: unknown } | null;
    decisionReason?: string | null;
    deploymentId: string;
    desiredChange: {};
    expiresAt?: string;
    materializationPreview: {};
    planId: string;
    proposal: {
      contract?: {};
      contractDigest: string;
      contractId: string;
      deploymentId: string;
      proposalId?: string;
      providedSurfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
      requestedNeeds: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      summary?: {};
    };
    state?: "pending" | "accepted" | "rejected" | "expired";
    warnings: Array<string>;
  };
};

export type AuthDeploymentAuthorityPlansGetInput = { planId: string };
export type AuthDeploymentAuthorityPlansGetOutput = {
  plan: {
    classification: "update";
    createdAt: string;
    decisionAt?: string | null;
    decisionBy?: { [k: string]: unknown } | null;
    decisionReason?: string | null;
    deploymentId: string;
    desiredChange: {};
    expiresAt?: string;
    materializationPreview: {};
    planId: string;
    proposal: {
      contract?: {};
      contractDigest: string;
      contractId: string;
      deploymentId: string;
      proposalId?: string;
      providedSurfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
      requestedNeeds: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      summary?: {};
    };
    state?: "pending" | "accepted" | "rejected" | "expired";
    warnings: Array<string>;
  } | {
    acknowledgementRequired: boolean;
    classification: "migration";
    createdAt: string;
    decisionAt?: string | null;
    decisionBy?: { [k: string]: unknown } | null;
    decisionReason?: string | null;
    deploymentId: string;
    desiredChange: {};
    expiresAt?: string;
    materializationPreview: {};
    planId: string;
    proposal: {
      contract?: {};
      contractDigest: string;
      contractId: string;
      deploymentId: string;
      proposalId?: string;
      providedSurfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
      requestedNeeds: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      summary?: {};
    };
    state?: "pending" | "accepted" | "rejected" | "expired";
    warnings: Array<string>;
  };
};

export type AuthDeploymentAuthorityPlansListInput = {
  classification?: "update" | "migration";
  deploymentId?: string;
  kind?: "service" | "device" | "app" | "cli" | "native" | "device-user";
  limit: number;
  offset?: number;
  state?: "pending" | "accepted" | "rejected" | "expired";
};
export type AuthDeploymentAuthorityPlansListOutput = {
  count: number;
  entries: Array<
    ({
      classification: "update";
      createdAt: string;
      decisionAt?: string | null;
      decisionBy?: { [k: string]: unknown } | null;
      decisionReason?: string | null;
      deploymentId: string;
      desiredChange: {};
      expiresAt?: string;
      materializationPreview: {};
      planId: string;
      proposal: {
        contract?: {};
        contractDigest: string;
        contractId: string;
        deploymentId: string;
        proposalId?: string;
        providedSurfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
          }
        >;
        requestedNeeds: {
          capabilities: Array<{ capability: string; required: boolean }>;
          contracts: Array<{ contractId: string; required: boolean }>;
          resources: Array<
            {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            }
          >;
          surfaces: Array<
            {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
              required: boolean;
            }
          >;
        };
        summary?: {};
      };
      state?: "pending" | "accepted" | "rejected" | "expired";
      warnings: Array<string>;
    } | {
      acknowledgementRequired: boolean;
      classification: "migration";
      createdAt: string;
      decisionAt?: string | null;
      decisionBy?: { [k: string]: unknown } | null;
      decisionReason?: string | null;
      deploymentId: string;
      desiredChange: {};
      expiresAt?: string;
      materializationPreview: {};
      planId: string;
      proposal: {
        contract?: {};
        contractDigest: string;
        contractId: string;
        deploymentId: string;
        proposalId?: string;
        providedSurfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
          }
        >;
        requestedNeeds: {
          capabilities: Array<{ capability: string; required: boolean }>;
          contracts: Array<{ contractId: string; required: boolean }>;
          resources: Array<
            {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            }
          >;
          surfaces: Array<
            {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
              required: boolean;
            }
          >;
        };
        summary?: {};
      };
      state?: "pending" | "accepted" | "rejected" | "expired";
      warnings: Array<string>;
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeploymentAuthorityReconcileInput = {
  deploymentId: string;
  desiredVersion?: string;
};
export type AuthDeploymentAuthorityReconcileOutput = {
  authority: {
    createdAt: string;
    deploymentId: string;
    desiredState: {
      capabilities: Array<string>;
      needs: {
        capabilities: Array<{ capability: string; required: boolean }>;
        contracts: Array<{ contractId: string; required: boolean }>;
        resources: Array<
          {
            alias: string;
            definition?: {};
            kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
            required: boolean;
          }
        >;
        surfaces: Array<
          {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
            required: boolean;
          }
        >;
      };
      resources: Array<
        {
          alias: string;
          definition?: {};
          kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
          required: boolean;
        }
      >;
      surfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          kind: "rpc" | "operation" | "event" | "feed";
          name: string;
        }
      >;
    };
    disabled: boolean;
    kind: "service" | "device" | "app" | "cli" | "native" | "device-user";
    updatedAt: string;
    version: string;
  };
  materializedAuthority: {
    deploymentId: string;
    desiredVersion: string;
    error?: string;
    grants: {
      capabilities: Array<{ capability: string }>;
      nats: Array<
        {
          direction: "publish" | "subscribe";
          grantSource:
            | "owned-surface"
            | "used-surface"
            | "resource-binding"
            | "platform-service"
            | "transfer";
          requiredCapabilities: Array<string>;
          subject: string;
          surface?: {
            action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
            contractId: string;
            kind: "rpc" | "operation" | "event" | "feed";
            name: string;
          };
        }
      >;
      surfaces: Array<
        {
          action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
          contractId: string;
          name: string;
          surfaceKind: "rpc" | "operation" | "event" | "feed";
        }
      >;
    };
    reconciledAt: string | null;
    resourceBindings: Array<
      {
        alias: string;
        binding: { [k: string]: unknown };
        createdAt: string;
        deploymentId: string;
        kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
        limits: { [k: string]: unknown } | null;
        updatedAt: string;
      }
    >;
    status: "current" | "pending" | "failed";
  };
  reconciliation?: {
    deploymentId: string;
    desiredVersion: string;
    finishedAt: string | null;
    message?: string;
    startedAt: string | null;
    state: "idle" | "running" | "succeeded" | "failed";
  };
};

export type AuthDeploymentAuthorityRejectInput = {
  planId: string;
  reason?: string;
};
export type AuthDeploymentAuthorityRejectOutput = { success: boolean };

export type AuthDeploymentsCreateInput = {
  contractCompatibilityMode?: "strict" | "mutable-dev";
  deploymentId: string;
  kind: "service";
  namespaces: Array<string>;
} | { deploymentId: string; kind: "device"; reviewMode?: "none" | "required" };
export type AuthDeploymentsCreateOutput = {
  deployment: {
    contractCompatibilityMode?: "strict" | "mutable-dev";
    deploymentId: string;
    disabled: boolean;
    kind: "service";
    namespaces: Array<string>;
  } | {
    deploymentId: string;
    disabled: boolean;
    kind: "device";
    reviewMode?: "none" | "required";
  };
};

export type AuthDeploymentsDisableInput = {
  deploymentId: string;
  kind: "service" | "device";
};
export type AuthDeploymentsDisableOutput = {
  deployment: {
    contractCompatibilityMode?: "strict" | "mutable-dev";
    deploymentId: string;
    disabled: boolean;
    kind: "service";
    namespaces: Array<string>;
  } | {
    deploymentId: string;
    disabled: boolean;
    kind: "device";
    reviewMode?: "none" | "required";
  };
};

export type AuthDeploymentsEnableInput = {
  deploymentId: string;
  kind: "service" | "device";
};
export type AuthDeploymentsEnableOutput = {
  deployment: {
    contractCompatibilityMode?: "strict" | "mutable-dev";
    deploymentId: string;
    disabled: boolean;
    kind: "service";
    namespaces: Array<string>;
  } | {
    deploymentId: string;
    disabled: boolean;
    kind: "device";
    reviewMode?: "none" | "required";
  };
};

export type AuthDeploymentsListInput = {
  disabled?: boolean;
  kind?: "service" | "device";
  limit: number;
  offset?: number;
};
export type AuthDeploymentsListOutput = {
  count: number;
  entries: Array<
    ({
      contractCompatibilityMode?: "strict" | "mutable-dev";
      deploymentId: string;
      disabled: boolean;
      kind: "service";
      namespaces: Array<string>;
    } | {
      deploymentId: string;
      disabled: boolean;
      kind: "device";
      reviewMode?: "none" | "required";
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeploymentsRemoveInput = {
  cascade?: boolean;
  deploymentId: string;
  kind: "service" | "device";
  purgeUnusedContracts?: boolean;
};
export type AuthDeploymentsRemoveOutput = { success: boolean };

export type AuthDeviceUserAuthoritiesListInput = {
  deploymentId?: string;
  instanceId?: string;
  limit: number;
  offset?: number;
  state?: "activated" | "revoked";
};
export type AuthDeviceUserAuthoritiesListOutput = {
  count: number;
  entries: Array<
    {
      activatedAt: string;
      activatedBy?: {
        identity: { identityId: string; provider: string; subject: string };
        participantKind: "app" | "agent";
        userId: string;
      };
      deploymentId: string;
      instanceId: string;
      publicIdentityKey: string;
      revokedAt: string | null;
      state: "activated" | "revoked";
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeviceUserAuthoritiesReviewsDecideInput = {
  decision: "approve" | "reject";
  reason?: string;
  reviewId: string;
};
export type AuthDeviceUserAuthoritiesReviewsDecideOutput = {
  activation?: {
    activatedAt: string;
    activatedBy?: {
      identity: { identityId: string; provider: string; subject: string };
      participantKind: "app" | "agent";
      userId: string;
    };
    deploymentId: string;
    instanceId: string;
    publicIdentityKey: string;
    revokedAt: string | null;
    state: "activated" | "revoked";
  };
  confirmationCode?: string;
  review: {
    decidedAt: string | null;
    deploymentId: string;
    instanceId: string;
    publicIdentityKey: string;
    reason?: string;
    requestedAt: string;
    reviewId: string;
    state: "pending" | "approved" | "rejected";
  };
};

export type AuthDeviceUserAuthoritiesReviewsListInput = {
  deploymentId?: string;
  instanceId?: string;
  limit: number;
  offset?: number;
  state?: "pending" | "approved" | "rejected";
};
export type AuthDeviceUserAuthoritiesReviewsListOutput = {
  count: number;
  entries: Array<
    {
      decidedAt: string | null;
      deploymentId: string;
      instanceId: string;
      publicIdentityKey: string;
      reason?: string;
      requestedAt: string;
      reviewId: string;
      state: "pending" | "approved" | "rejected";
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDeviceUserAuthoritiesRevokeInput = { instanceId: string };
export type AuthDeviceUserAuthoritiesRevokeOutput = { success: boolean };

export type AuthDevicesConnectInfoGetInput = {
  contractDigest: string;
  iat: number;
  publicIdentityKey: string;
  sig: string;
};
export type AuthDevicesConnectInfoGetOutput = {
  connectInfo: {
    auth: {
      authority: "admin_reviewed" | "user_delegated";
      iatSkewSeconds: number;
      mode: "device_identity";
    };
    contractDigest: string;
    contractId: string;
    deploymentId: string;
    instanceId: string;
    transport: { sentinel: { jwt: string; seed: string } };
    transports: {
      native?: { natsServers: Array<string> };
      websocket?: { natsServers: Array<string> };
    };
  };
  status: "ready";
};

export type AuthDevicesDisableInput = { instanceId: string };
export type AuthDevicesDisableOutput = {
  instance: {
    activatedAt: string | null;
    createdAt: string;
    deploymentId: string;
    instanceId: string;
    metadata?: { [k: string]: string };
    publicIdentityKey: string;
    revokedAt: string | null;
    state: "registered" | "activated" | "revoked" | "disabled";
  };
};

export type AuthDevicesEnableInput = { instanceId: string };
export type AuthDevicesEnableOutput = {
  instance: {
    activatedAt: string | null;
    createdAt: string;
    deploymentId: string;
    instanceId: string;
    metadata?: { [k: string]: string };
    publicIdentityKey: string;
    revokedAt: string | null;
    state: "registered" | "activated" | "revoked" | "disabled";
  };
};

export type AuthDevicesListInput = {
  deploymentId?: string;
  limit: number;
  offset?: number;
  state?: "registered" | "activated" | "revoked" | "disabled";
};
export type AuthDevicesListOutput = {
  count: number;
  entries: Array<
    {
      activatedAt: string | null;
      createdAt: string;
      deploymentId: string;
      instanceId: string;
      metadata?: { [k: string]: string };
      publicIdentityKey: string;
      revokedAt: string | null;
      state: "registered" | "activated" | "revoked" | "disabled";
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthDevicesProvisionInput = {
  activationKey: string;
  deploymentId: string;
  metadata?: { [k: string]: string };
  publicIdentityKey: string;
};
export type AuthDevicesProvisionOutput = {
  instance: {
    activatedAt: string | null;
    createdAt: string;
    deploymentId: string;
    instanceId: string;
    metadata?: { [k: string]: string };
    publicIdentityKey: string;
    revokedAt: string | null;
    state: "registered" | "activated" | "revoked" | "disabled";
  };
};

export type AuthDevicesRemoveInput = { instanceId: string };
export type AuthDevicesRemoveOutput = { success: boolean };

export type AuthHealthInput = {};
export type AuthHealthOutput = {
  checks: Array<
    {
      error?: string;
      info?: { [k: string]: unknown };
      latencyMs: number;
      name: string;
      status: "ok" | "failed";
      summary?: string;
    }
  >;
  service: string;
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
};

export type AuthIdentitiesListInput = {
  limit: number;
  offset?: number;
  user?: string;
};
export type AuthIdentitiesListOutput = {
  count: number;
  entries: Array<
    {
      answer: "approved" | "denied";
      answeredAt: string;
      capabilities: {
        [k: string]: {
          consequence?: string;
          description: string;
          displayName: string;
        };
      };
      contractEvidence: { contractDigest: string; contractId: string };
      description: string;
      displayName: string;
      identityAnchor:
        | { contractId: string; kind: "web"; origin: string }
        | { contractId: string; kind: "cli"; sessionPublicKey: string }
        | { contractId: string; kind: "native"; sessionPublicKey: string }
        | { contractId: string; devicePublicKey: string; kind: "device-user" };
      identityGrantId: string;
      participantKind: "app" | "agent";
      updatedAt: string;
      user: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthIdentityGrantsListInput = {
  limit: number;
  offset?: number;
  user?: string;
};
export type AuthIdentityGrantsListOutput = {
  count: number;
  entries: Array<
    {
      capabilities: Array<string>;
      contractEvidence: { contractDigest: string; contractId: string };
      description: string;
      displayName: string;
      grantedAt: string;
      identityAnchor:
        | { contractId: string; kind: "web"; origin: string }
        | { contractId: string; kind: "cli"; sessionPublicKey: string }
        | { contractId: string; kind: "native"; sessionPublicKey: string }
        | { contractId: string; devicePublicKey: string; kind: "device-user" };
      identityGrantId: string;
      participantKind: "app" | "agent";
      updatedAt: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthIdentityGrantsRevokeInput = {
  identityGrantId: string;
  user?: string;
};
export type AuthIdentityGrantsRevokeOutput = { success: boolean };

export type AuthPortalsGetInput = { portalId: string };
export type AuthPortalsGetOutput = {
  defaultCapabilities: Array<string>;
  defaultCapabilityGroups: Array<string>;
  federatedProviders: Array<{ displayName: string; id: string; type: string }>;
  portal: {
    builtIn: boolean;
    createdAt: string;
    disabled: boolean;
    displayName: string;
    entryUrl: string | null;
    portalId: string;
    updatedAt: string;
  };
  routes: Array<
    {
      contractId: string | null;
      disabled: boolean;
      origin: string | null;
      portalId: string;
      routeKey: string;
      updatedAt: string;
    }
  >;
  settings: {
    allowedFederatedProviders: Array<string> | null;
    federatedRegistrationEnabled: boolean;
    localRegistrationEnabled: boolean;
    portalId: string;
    selfRegisteredAccountActive: boolean;
    updatedAt: string;
  };
};

export type AuthPortalsListInput = { limit: number; offset?: number };
export type AuthPortalsListOutput = {
  count: number;
  entries: Array<
    {
      activeRouteCount: number;
      builtIn: boolean;
      createdAt: string;
      disabled: boolean;
      displayName: string;
      entryUrl: string | null;
      portalId: string;
      routeCount: number;
      updatedAt: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthPortalsLoginSettingsGetInput = { portalId: string };
export type AuthPortalsLoginSettingsGetOutput = {
  defaultCapabilities: Array<string>;
  defaultCapabilityGroups: Array<string>;
  federatedProviders: Array<{ displayName: string; id: string; type: string }>;
  portal: {
    builtIn: boolean;
    createdAt: string;
    disabled: boolean;
    displayName: string;
    entryUrl: string | null;
    portalId: string;
    updatedAt: string;
  };
  settings: {
    allowedFederatedProviders: Array<string> | null;
    federatedRegistrationEnabled: boolean;
    localRegistrationEnabled: boolean;
    portalId: string;
    selfRegisteredAccountActive: boolean;
    updatedAt: string;
  };
};

export type AuthPortalsLoginSettingsUpdateInput = {
  allowedFederatedProviders: Array<string> | null;
  defaultCapabilities: Array<string>;
  defaultCapabilityGroups: Array<string>;
  federatedRegistrationEnabled: boolean;
  localRegistrationEnabled: boolean;
  portalId: string;
  selfRegisteredAccountActive: boolean;
};
export type AuthPortalsLoginSettingsUpdateOutput = {
  defaultCapabilities: Array<string>;
  defaultCapabilityGroups: Array<string>;
  federatedProviders: Array<{ displayName: string; id: string; type: string }>;
  portal: {
    builtIn: boolean;
    createdAt: string;
    disabled: boolean;
    displayName: string;
    entryUrl: string | null;
    portalId: string;
    updatedAt: string;
  };
  settings: {
    allowedFederatedProviders: Array<string> | null;
    federatedRegistrationEnabled: boolean;
    localRegistrationEnabled: boolean;
    portalId: string;
    selfRegisteredAccountActive: boolean;
    updatedAt: string;
  };
};

export type AuthPortalsPutInput = {
  disabled?: boolean;
  displayName: string;
  entryUrl: string;
  portalId: string;
};
export type AuthPortalsPutOutput = {
  portal: {
    builtIn: boolean;
    createdAt: string;
    disabled: boolean;
    displayName: string;
    entryUrl: string | null;
    portalId: string;
    updatedAt: string;
  };
};

export type AuthPortalsRemoveInput = { portalId: string };
export type AuthPortalsRemoveOutput = { success: boolean };

export type AuthPortalsRoutesPutInput = {
  contractId?: string | null;
  disabled?: boolean;
  origin?: string | null;
  portalId: string;
};
export type AuthPortalsRoutesPutOutput = {
  route: {
    contractId: string | null;
    disabled: boolean;
    origin: string | null;
    portalId: string;
    routeKey: string;
    updatedAt: string;
  };
};

export type AuthPortalsRoutesRemoveInput = {
  contractId?: string | null;
  origin?: string | null;
  portalId: string;
};
export type AuthPortalsRoutesRemoveOutput = { success: boolean };

export type AuthRequestsValidateInput = {
  capabilities?: Array<string>;
  iat: number;
  payloadHash: string;
  proof: string;
  requestId: string;
  sessionKey: string;
  subject: string;
};
export type AuthRequestsValidateOutput = {
  allowed: boolean;
  caller: {
    active: boolean;
    capabilities: Array<string>;
    email: string;
    identity: { identityId: string; provider: string; subject: string };
    image?: string;
    lastAuth: string;
    name: string;
    participantKind: "app" | "agent";
    type: "user";
    userId: string;
  } | {
    active: boolean;
    capabilities: Array<string>;
    id: string;
    name: string;
    type: "service";
  } | {
    active: boolean;
    capabilities: Array<string>;
    deploymentId: string;
    deviceId: string;
    deviceType: string;
    runtimePublicKey: string;
    type: "device";
  };
  inboxPrefix: string;
};

export type AuthServiceInstancesDisableInput = { instanceId: string };
export type AuthServiceInstancesDisableOutput = {
  instance: {
    capabilities: Array<string>;
    createdAt: string;
    deploymentId: string;
    disabled: boolean;
    instanceId: string;
    instanceKey: string;
    resourceBindings?: {
      eventConsumers?: {
        [k: string]: {
          ackWaitMs: number;
          backoffMs: Array<number>;
          concurrency: number;
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict";
          replay: "new" | "all";
          stream: string;
        };
      };
      jobs?: {
        namespace: string;
        queues: {
          [k: string]: {
            ackWaitMs: number;
            backoffMs: Array<number>;
            concurrency: number;
            consumerName: string;
            defaultDeadlineMs?: number;
            dlq: boolean;
            keyConcurrency?: {
              heartbeatIntervalMs: number;
              heartbeatTtlMs: number;
              key: Array<string>;
              maxActive: number;
              stalePolicy: "fail-stale" | "block";
            };
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
            queue?: {
              maxQueuedPerKey: number;
              whenFull: "reject" | "coalesce" | "replace-oldest";
            };
            queueType: string;
            result?: { schema: string };
            workSubject: string;
          };
        };
        workStream?: string;
      };
      kv?: {
        [k: string]: {
          bucket: string;
          history: number;
          maxValueBytes?: number;
          ttlMs: number;
        };
      };
      store?: {
        [k: string]: {
          maxObjectBytes?: number;
          maxTotalBytes?: number;
          name: string;
          ttlMs: number;
        };
      };
    };
  };
};

export type AuthServiceInstancesEnableInput = { instanceId: string };
export type AuthServiceInstancesEnableOutput = {
  instance: {
    capabilities: Array<string>;
    createdAt: string;
    deploymentId: string;
    disabled: boolean;
    instanceId: string;
    instanceKey: string;
    resourceBindings?: {
      eventConsumers?: {
        [k: string]: {
          ackWaitMs: number;
          backoffMs: Array<number>;
          concurrency: number;
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict";
          replay: "new" | "all";
          stream: string;
        };
      };
      jobs?: {
        namespace: string;
        queues: {
          [k: string]: {
            ackWaitMs: number;
            backoffMs: Array<number>;
            concurrency: number;
            consumerName: string;
            defaultDeadlineMs?: number;
            dlq: boolean;
            keyConcurrency?: {
              heartbeatIntervalMs: number;
              heartbeatTtlMs: number;
              key: Array<string>;
              maxActive: number;
              stalePolicy: "fail-stale" | "block";
            };
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
            queue?: {
              maxQueuedPerKey: number;
              whenFull: "reject" | "coalesce" | "replace-oldest";
            };
            queueType: string;
            result?: { schema: string };
            workSubject: string;
          };
        };
        workStream?: string;
      };
      kv?: {
        [k: string]: {
          bucket: string;
          history: number;
          maxValueBytes?: number;
          ttlMs: number;
        };
      };
      store?: {
        [k: string]: {
          maxObjectBytes?: number;
          maxTotalBytes?: number;
          name: string;
          ttlMs: number;
        };
      };
    };
  };
};

export type AuthServiceInstancesListInput = {
  deploymentId?: string;
  disabled?: boolean;
  limit: number;
  offset?: number;
};
export type AuthServiceInstancesListOutput = {
  count: number;
  entries: Array<
    {
      capabilities: Array<string>;
      createdAt: string;
      deploymentId: string;
      disabled: boolean;
      instanceId: string;
      instanceKey: string;
      resourceBindings?: {
        eventConsumers?: {
          [k: string]: {
            ackWaitMs: number;
            backoffMs: Array<number>;
            concurrency: number;
            consumerName: string;
            filterSubjects: Array<string>;
            maxDeliver: number;
            ordering: "strict";
            replay: "new" | "all";
            stream: string;
          };
        };
        jobs?: {
          namespace: string;
          queues: {
            [k: string]: {
              ackWaitMs: number;
              backoffMs: Array<number>;
              concurrency: number;
              consumerName: string;
              defaultDeadlineMs?: number;
              dlq: boolean;
              keyConcurrency?: {
                heartbeatIntervalMs: number;
                heartbeatTtlMs: number;
                key: Array<string>;
                maxActive: number;
                stalePolicy: "fail-stale" | "block";
              };
              logs: boolean;
              maxDeliver: number;
              payload: { schema: string };
              progress: boolean;
              publishPrefix: string;
              queue?: {
                maxQueuedPerKey: number;
                whenFull: "reject" | "coalesce" | "replace-oldest";
              };
              queueType: string;
              result?: { schema: string };
              workSubject: string;
            };
          };
          workStream?: string;
        };
        kv?: {
          [k: string]: {
            bucket: string;
            history: number;
            maxValueBytes?: number;
            ttlMs: number;
          };
        };
        store?: {
          [k: string]: {
            maxObjectBytes?: number;
            maxTotalBytes?: number;
            name: string;
            ttlMs: number;
          };
        };
      };
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthServiceInstancesProvisionInput = {
  deploymentId: string;
  instanceKey: string;
};
export type AuthServiceInstancesProvisionOutput = {
  instance: {
    capabilities: Array<string>;
    createdAt: string;
    deploymentId: string;
    disabled: boolean;
    instanceId: string;
    instanceKey: string;
    resourceBindings?: {
      eventConsumers?: {
        [k: string]: {
          ackWaitMs: number;
          backoffMs: Array<number>;
          concurrency: number;
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict";
          replay: "new" | "all";
          stream: string;
        };
      };
      jobs?: {
        namespace: string;
        queues: {
          [k: string]: {
            ackWaitMs: number;
            backoffMs: Array<number>;
            concurrency: number;
            consumerName: string;
            defaultDeadlineMs?: number;
            dlq: boolean;
            keyConcurrency?: {
              heartbeatIntervalMs: number;
              heartbeatTtlMs: number;
              key: Array<string>;
              maxActive: number;
              stalePolicy: "fail-stale" | "block";
            };
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
            queue?: {
              maxQueuedPerKey: number;
              whenFull: "reject" | "coalesce" | "replace-oldest";
            };
            queueType: string;
            result?: { schema: string };
            workSubject: string;
          };
        };
        workStream?: string;
      };
      kv?: {
        [k: string]: {
          bucket: string;
          history: number;
          maxValueBytes?: number;
          ttlMs: number;
        };
      };
      store?: {
        [k: string]: {
          maxObjectBytes?: number;
          maxTotalBytes?: number;
          name: string;
          ttlMs: number;
        };
      };
    };
  };
};

export type AuthServiceInstancesRemoveInput = { instanceId: string };
export type AuthServiceInstancesRemoveOutput = { success: boolean };

export type AuthSessionsListInput = {
  limit: number;
  offset?: number;
  user?: string;
};
export type AuthSessionsListOutput = {
  count: number;
  entries: Array<
    ({
      contractDisplayName: string;
      contractId: string;
      createdAt: string;
      key: string;
      lastAuth: string;
      participantKind: "app";
      principal: {
        identity: { identityId: string; provider: string; subject: string };
        name: string;
        type: "user";
        userId: string;
      };
      sessionKey: string;
    } | {
      contractDisplayName: string;
      contractId: string;
      createdAt: string;
      key: string;
      lastAuth: string;
      participantKind: "agent";
      principal: {
        identity: { identityId: string; provider: string; subject: string };
        name: string;
        type: "user";
        userId: string;
      };
      sessionKey: string;
    } | {
      contractDisplayName?: string;
      contractId: string;
      createdAt: string;
      key: string;
      lastAuth: string;
      participantKind: "device";
      principal: {
        deploymentId: string;
        deviceId: string;
        deviceType: string;
        runtimePublicKey: string;
        type: "device";
      };
      sessionKey: string;
    } | {
      createdAt: string;
      key: string;
      lastAuth: string;
      participantKind: "service";
      principal: {
        deploymentId: string;
        id: string;
        instanceId: string;
        name: string;
        type: "service";
      };
      sessionKey: string;
    })
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthSessionsLogoutInput = { [k: string]: unknown };
export type AuthSessionsLogoutOutput = { success: boolean };

export type AuthSessionsMeInput = {};
export type AuthSessionsMeOutput = {
  device: {
    active: boolean;
    capabilities: Array<string>;
    deploymentId: string;
    deviceId: string;
    deviceType: string;
    runtimePublicKey: string;
    type: "device";
  } | null;
  participantKind: ("app" | "agent") | "device" | "service";
  service: {
    active: boolean;
    capabilities: Array<string>;
    id: string;
    name: string;
    type: "service";
  } | null;
  user: {
    active: boolean;
    capabilities: Array<string>;
    email: string;
    identity: { identityId: string; provider: string; subject: string };
    image?: string;
    lastLogin?: string;
    name: string;
    userId: string;
  } | null;
};

export type AuthSessionsRevokeInput = { sessionKey: string };
export type AuthSessionsRevokeOutput = { success: boolean };

export type AuthUserIdentitiesListInput = {
  limit: number;
  offset?: number;
  userId: string;
};
export type AuthUserIdentitiesListOutput = {
  count: number;
  entries: Array<
    {
      displayName: string | null;
      email: string | null;
      emailVerified: boolean;
      identityId: string;
      lastLoginAt: string | null;
      linkedAt: string;
      provider: string;
      subject: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthUserIdentitiesUnlinkInput = {
  identityId: string;
  userId: string;
};
export type AuthUserIdentitiesUnlinkOutput = { success: boolean };

export type AuthUsersCreateInput = {
  active?: boolean;
  capabilities?: Array<string>;
  capabilityGroups?: Array<string>;
  email?: string;
  name?: string;
  username?: string;
};
export type AuthUsersCreateOutput = {
  user: {
    active: boolean;
    capabilities: Array<string>;
    capabilityGroups: Array<string>;
    email?: string;
    identities: Array<
      {
        displayName: string | null;
        email: string | null;
        emailVerified: boolean;
        identityId: string;
        lastLoginAt: string | null;
        linkedAt: string;
        provider: string;
        subject: string;
      }
    >;
    name?: string;
    userId: string;
  };
};

export type AuthUsersGetInput = { userId: string };
export type AuthUsersGetOutput = {
  user: {
    active: boolean;
    capabilities: Array<string>;
    capabilityGroups: Array<string>;
    email?: string;
    identities: Array<
      {
        displayName: string | null;
        email: string | null;
        emailVerified: boolean;
        identityId: string;
        lastLoginAt: string | null;
        linkedAt: string;
        provider: string;
        subject: string;
      }
    >;
    name?: string;
    userId: string;
  };
};

export type AuthUsersIdentityLinkCreateInput = { returnTo?: string };
export type AuthUsersIdentityLinkCreateOutput = {
  expiresAt: string;
  flowId: string;
  url: string;
};

export type AuthUsersListInput = { limit: number; offset?: number };
export type AuthUsersListOutput = {
  count: number;
  entries: Array<
    {
      active: boolean;
      capabilities: Array<string>;
      capabilityGroups: Array<string>;
      email?: string;
      identities: Array<
        {
          displayName: string | null;
          email: string | null;
          emailVerified: boolean;
          identityId: string;
          lastLoginAt: string | null;
          linkedAt: string;
          provider: string;
          subject: string;
        }
      >;
      name?: string;
      userId: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthUsersPasswordChangeInput = {
  currentPassword: string;
  newPassword: string;
};
export type AuthUsersPasswordChangeOutput = { success: boolean };

export type AuthUsersPasswordResetCreateInput = {
  expiresInSeconds?: number;
  userId: string;
};
export type AuthUsersPasswordResetCreateOutput = {
  expiresAt: string;
  flowId: string;
  url: string;
};

export type AuthUsersUpdateInput = {
  active?: boolean;
  capabilities?: Array<string>;
  capabilityGroups?: Array<string>;
  email?: string;
  name?: string;
  userId: string;
};
export type AuthUsersUpdateOutput = { success: boolean };

export type AuthDeviceUserAuthoritiesResolveInput = { flowId: string };
export type AuthDeviceUserAuthoritiesResolveProgress = {
  deploymentId: string;
  instanceId: string;
  requestedAt: string;
  reviewId: string;
  status: "pending_review";
};
export type AuthDeviceUserAuthoritiesResolveOutput = {
  activatedAt: string;
  confirmationCode?: string;
  deploymentId: string;
  instanceId: string;
  status: "activated";
} | { reason?: string; status: "rejected" };

export type AuthDeviceUserAuthoritiesResolveOperationHandler<
  TDeps = undefined,
> = (
  args: {
    input: AuthDeviceUserAuthoritiesResolveInput;
    op: OperationRuntimeHandle<
      AuthDeviceUserAuthoritiesResolveProgress,
      AuthDeviceUserAuthoritiesResolveOutput
    >;
    caller: SessionCaller;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => unknown | Promise<unknown>;

export type AuthConnectionsClosedEvent = {
  id: string;
  origin: string;
  sessionKey: string;
  userNkey: string;
};
export type AuthConnectionsClosedEventMessage = TrellisEventMessage<
  AuthConnectionsClosedEvent
>;
export type AuthConnectionsClosedEventHandler<TDeps = undefined> = (
  args: {
    event: AuthConnectionsClosedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export type AuthConnectionsKickedEvent = {
  id: string;
  kickedBy: string;
  origin: string;
  userNkey: string;
};
export type AuthConnectionsKickedEventMessage = TrellisEventMessage<
  AuthConnectionsKickedEvent
>;
export type AuthConnectionsKickedEventHandler<TDeps = undefined> = (
  args: {
    event: AuthConnectionsKickedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export type AuthConnectionsOpenedEvent = {
  id: string;
  origin: string;
  sessionKey: string;
  userNkey: string;
};
export type AuthConnectionsOpenedEventMessage = TrellisEventMessage<
  AuthConnectionsOpenedEvent
>;
export type AuthConnectionsOpenedEventHandler<TDeps = undefined> = (
  args: {
    event: AuthConnectionsOpenedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export type AuthDeviceUserAuthoritiesApprovedEvent = {
  approvedAt: string;
  approvedBy: {
    identity: { identityId: string; provider: string; subject: string };
    participantKind: "app" | "agent";
    userId: string;
  };
  deploymentId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  requestedAt: string;
  requestedBy: {
    identity: { identityId: string; provider: string; subject: string };
    participantKind: "app" | "agent";
    userId: string;
  };
  reviewId: string;
};
export type AuthDeviceUserAuthoritiesApprovedEventMessage = TrellisEventMessage<
  AuthDeviceUserAuthoritiesApprovedEvent
>;
export type AuthDeviceUserAuthoritiesApprovedEventHandler<TDeps = undefined> = (
  args: {
    event: AuthDeviceUserAuthoritiesApprovedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export type AuthDeviceUserAuthoritiesRequestedEvent = {
  deploymentId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  requestedAt: string;
  requestedBy: {
    identity: { identityId: string; provider: string; subject: string };
    participantKind: "app" | "agent";
    userId: string;
  };
};
export type AuthDeviceUserAuthoritiesRequestedEventMessage =
  TrellisEventMessage<AuthDeviceUserAuthoritiesRequestedEvent>;
export type AuthDeviceUserAuthoritiesRequestedEventHandler<TDeps = undefined> =
  (
    args: {
      event: AuthDeviceUserAuthoritiesRequestedEvent;
      context: EventListenerContext;
      client: HandlerClient;
    } & WithDeps<TDeps>,
  ) => MaybeAsync<void, BaseError>;

export type AuthDeviceUserAuthoritiesResolvedEvent = {
  deploymentId: string;
  flowId?: string;
  instanceId: string;
  publicIdentityKey: string;
  resolvedAt: string;
  resolvedBy: {
    identity: { identityId: string; provider: string; subject: string };
    participantKind: "app" | "agent";
    userId: string;
  };
  reviewId?: string;
};
export type AuthDeviceUserAuthoritiesResolvedEventMessage = TrellisEventMessage<
  AuthDeviceUserAuthoritiesResolvedEvent
>;
export type AuthDeviceUserAuthoritiesResolvedEventHandler<TDeps = undefined> = (
  args: {
    event: AuthDeviceUserAuthoritiesResolvedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export type AuthDeviceUserAuthoritiesReviewRequestedEvent = {
  deploymentId: string;
  flowId: string;
  instanceId: string;
  publicIdentityKey: string;
  requestedAt: string;
  requestedBy: {
    identity: { identityId: string; provider: string; subject: string };
    participantKind: "app" | "agent";
    userId: string;
  };
  reviewId: string;
};
export type AuthDeviceUserAuthoritiesReviewRequestedEventMessage =
  TrellisEventMessage<AuthDeviceUserAuthoritiesReviewRequestedEvent>;
export type AuthDeviceUserAuthoritiesReviewRequestedEventHandler<
  TDeps = undefined,
> = (
  args: {
    event: AuthDeviceUserAuthoritiesReviewRequestedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export type AuthSessionsRevokedEvent = {
  id: string;
  origin: string;
  revokedBy: string;
  sessionKey: string;
};
export type AuthSessionsRevokedEventMessage = TrellisEventMessage<
  AuthSessionsRevokedEvent
>;
export type AuthSessionsRevokedEventHandler<TDeps = undefined> = (
  args: {
    event: AuthSessionsRevokedEvent;
    context: EventListenerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => MaybeAsync<void, BaseError>;

export interface RpcMap {
  "Auth.Capabilities.List": {
    input: AuthCapabilitiesListInput;
    output: AuthCapabilitiesListOutput;
  };
  "Auth.CapabilityGroups.Delete": {
    input: AuthCapabilityGroupsDeleteInput;
    output: AuthCapabilityGroupsDeleteOutput;
  };
  "Auth.CapabilityGroups.Get": {
    input: AuthCapabilityGroupsGetInput;
    output: AuthCapabilityGroupsGetOutput;
  };
  "Auth.CapabilityGroups.List": {
    input: AuthCapabilityGroupsListInput;
    output: AuthCapabilityGroupsListOutput;
  };
  "Auth.CapabilityGroups.Put": {
    input: AuthCapabilityGroupsPutInput;
    output: AuthCapabilityGroupsPutOutput;
  };
  "Auth.CatalogIssues.Resolve": {
    input: AuthCatalogIssuesResolveInput;
    output: AuthCatalogIssuesResolveOutput;
  };
  "Auth.Connections.Kick": {
    input: AuthConnectionsKickInput;
    output: AuthConnectionsKickOutput;
  };
  "Auth.Connections.List": {
    input: AuthConnectionsListInput;
    output: AuthConnectionsListOutput;
  };
  "Auth.DeploymentAuthority.AcceptMigration": {
    input: AuthDeploymentAuthorityAcceptMigrationInput;
    output: AuthDeploymentAuthorityAcceptMigrationOutput;
  };
  "Auth.DeploymentAuthority.AcceptUpdate": {
    input: AuthDeploymentAuthorityAcceptUpdateInput;
    output: AuthDeploymentAuthorityAcceptUpdateOutput;
  };
  "Auth.DeploymentAuthority.Get": {
    input: AuthDeploymentAuthorityGetInput;
    output: AuthDeploymentAuthorityGetOutput;
  };
  "Auth.DeploymentAuthority.GrantOverrides.List": {
    input: AuthDeploymentAuthorityGrantOverridesListInput;
    output: AuthDeploymentAuthorityGrantOverridesListOutput;
  };
  "Auth.DeploymentAuthority.GrantOverrides.Put": {
    input: AuthDeploymentAuthorityGrantOverridesPutInput;
    output: AuthDeploymentAuthorityGrantOverridesPutOutput;
  };
  "Auth.DeploymentAuthority.GrantOverrides.Remove": {
    input: AuthDeploymentAuthorityGrantOverridesRemoveInput;
    output: AuthDeploymentAuthorityGrantOverridesRemoveOutput;
  };
  "Auth.DeploymentAuthority.List": {
    input: AuthDeploymentAuthorityListInput;
    output: AuthDeploymentAuthorityListOutput;
  };
  "Auth.DeploymentAuthority.Plan": {
    input: AuthDeploymentAuthorityPlanInput;
    output: AuthDeploymentAuthorityPlanOutput;
  };
  "Auth.DeploymentAuthority.Plans.Get": {
    input: AuthDeploymentAuthorityPlansGetInput;
    output: AuthDeploymentAuthorityPlansGetOutput;
  };
  "Auth.DeploymentAuthority.Plans.List": {
    input: AuthDeploymentAuthorityPlansListInput;
    output: AuthDeploymentAuthorityPlansListOutput;
  };
  "Auth.DeploymentAuthority.Reconcile": {
    input: AuthDeploymentAuthorityReconcileInput;
    output: AuthDeploymentAuthorityReconcileOutput;
  };
  "Auth.DeploymentAuthority.Reject": {
    input: AuthDeploymentAuthorityRejectInput;
    output: AuthDeploymentAuthorityRejectOutput;
  };
  "Auth.Deployments.Create": {
    input: AuthDeploymentsCreateInput;
    output: AuthDeploymentsCreateOutput;
  };
  "Auth.Deployments.Disable": {
    input: AuthDeploymentsDisableInput;
    output: AuthDeploymentsDisableOutput;
  };
  "Auth.Deployments.Enable": {
    input: AuthDeploymentsEnableInput;
    output: AuthDeploymentsEnableOutput;
  };
  "Auth.Deployments.List": {
    input: AuthDeploymentsListInput;
    output: AuthDeploymentsListOutput;
  };
  "Auth.Deployments.Remove": {
    input: AuthDeploymentsRemoveInput;
    output: AuthDeploymentsRemoveOutput;
  };
  "Auth.DeviceUserAuthorities.List": {
    input: AuthDeviceUserAuthoritiesListInput;
    output: AuthDeviceUserAuthoritiesListOutput;
  };
  "Auth.DeviceUserAuthorities.Reviews.Decide": {
    input: AuthDeviceUserAuthoritiesReviewsDecideInput;
    output: AuthDeviceUserAuthoritiesReviewsDecideOutput;
  };
  "Auth.DeviceUserAuthorities.Reviews.List": {
    input: AuthDeviceUserAuthoritiesReviewsListInput;
    output: AuthDeviceUserAuthoritiesReviewsListOutput;
  };
  "Auth.DeviceUserAuthorities.Revoke": {
    input: AuthDeviceUserAuthoritiesRevokeInput;
    output: AuthDeviceUserAuthoritiesRevokeOutput;
  };
  "Auth.Devices.ConnectInfo.Get": {
    input: AuthDevicesConnectInfoGetInput;
    output: AuthDevicesConnectInfoGetOutput;
  };
  "Auth.Devices.Disable": {
    input: AuthDevicesDisableInput;
    output: AuthDevicesDisableOutput;
  };
  "Auth.Devices.Enable": {
    input: AuthDevicesEnableInput;
    output: AuthDevicesEnableOutput;
  };
  "Auth.Devices.List": {
    input: AuthDevicesListInput;
    output: AuthDevicesListOutput;
  };
  "Auth.Devices.Provision": {
    input: AuthDevicesProvisionInput;
    output: AuthDevicesProvisionOutput;
  };
  "Auth.Devices.Remove": {
    input: AuthDevicesRemoveInput;
    output: AuthDevicesRemoveOutput;
  };
  "Auth.Health": { input: AuthHealthInput; output: AuthHealthOutput };
  "Auth.Identities.List": {
    input: AuthIdentitiesListInput;
    output: AuthIdentitiesListOutput;
  };
  "Auth.IdentityGrants.List": {
    input: AuthIdentityGrantsListInput;
    output: AuthIdentityGrantsListOutput;
  };
  "Auth.IdentityGrants.Revoke": {
    input: AuthIdentityGrantsRevokeInput;
    output: AuthIdentityGrantsRevokeOutput;
  };
  "Auth.Portals.Get": {
    input: AuthPortalsGetInput;
    output: AuthPortalsGetOutput;
  };
  "Auth.Portals.List": {
    input: AuthPortalsListInput;
    output: AuthPortalsListOutput;
  };
  "Auth.Portals.LoginSettings.Get": {
    input: AuthPortalsLoginSettingsGetInput;
    output: AuthPortalsLoginSettingsGetOutput;
  };
  "Auth.Portals.LoginSettings.Update": {
    input: AuthPortalsLoginSettingsUpdateInput;
    output: AuthPortalsLoginSettingsUpdateOutput;
  };
  "Auth.Portals.Put": {
    input: AuthPortalsPutInput;
    output: AuthPortalsPutOutput;
  };
  "Auth.Portals.Remove": {
    input: AuthPortalsRemoveInput;
    output: AuthPortalsRemoveOutput;
  };
  "Auth.Portals.Routes.Put": {
    input: AuthPortalsRoutesPutInput;
    output: AuthPortalsRoutesPutOutput;
  };
  "Auth.Portals.Routes.Remove": {
    input: AuthPortalsRoutesRemoveInput;
    output: AuthPortalsRoutesRemoveOutput;
  };
  "Auth.Requests.Validate": {
    input: AuthRequestsValidateInput;
    output: AuthRequestsValidateOutput;
  };
  "Auth.ServiceInstances.Disable": {
    input: AuthServiceInstancesDisableInput;
    output: AuthServiceInstancesDisableOutput;
  };
  "Auth.ServiceInstances.Enable": {
    input: AuthServiceInstancesEnableInput;
    output: AuthServiceInstancesEnableOutput;
  };
  "Auth.ServiceInstances.List": {
    input: AuthServiceInstancesListInput;
    output: AuthServiceInstancesListOutput;
  };
  "Auth.ServiceInstances.Provision": {
    input: AuthServiceInstancesProvisionInput;
    output: AuthServiceInstancesProvisionOutput;
  };
  "Auth.ServiceInstances.Remove": {
    input: AuthServiceInstancesRemoveInput;
    output: AuthServiceInstancesRemoveOutput;
  };
  "Auth.Sessions.List": {
    input: AuthSessionsListInput;
    output: AuthSessionsListOutput;
  };
  "Auth.Sessions.Logout": {
    input: AuthSessionsLogoutInput;
    output: AuthSessionsLogoutOutput;
  };
  "Auth.Sessions.Me": {
    input: AuthSessionsMeInput;
    output: AuthSessionsMeOutput;
  };
  "Auth.Sessions.Revoke": {
    input: AuthSessionsRevokeInput;
    output: AuthSessionsRevokeOutput;
  };
  "Auth.UserIdentities.List": {
    input: AuthUserIdentitiesListInput;
    output: AuthUserIdentitiesListOutput;
  };
  "Auth.UserIdentities.Unlink": {
    input: AuthUserIdentitiesUnlinkInput;
    output: AuthUserIdentitiesUnlinkOutput;
  };
  "Auth.Users.Create": {
    input: AuthUsersCreateInput;
    output: AuthUsersCreateOutput;
  };
  "Auth.Users.Get": { input: AuthUsersGetInput; output: AuthUsersGetOutput };
  "Auth.Users.IdentityLink.Create": {
    input: AuthUsersIdentityLinkCreateInput;
    output: AuthUsersIdentityLinkCreateOutput;
  };
  "Auth.Users.List": { input: AuthUsersListInput; output: AuthUsersListOutput };
  "Auth.Users.Password.Change": {
    input: AuthUsersPasswordChangeInput;
    output: AuthUsersPasswordChangeOutput;
  };
  "Auth.Users.PasswordReset.Create": {
    input: AuthUsersPasswordResetCreateInput;
    output: AuthUsersPasswordResetCreateOutput;
  };
  "Auth.Users.Update": {
    input: AuthUsersUpdateInput;
    output: AuthUsersUpdateOutput;
  };
}

export type AuthCapabilitiesListHandlerError = TrellisErrorInstance;
export type AuthCapabilitiesListHandlerResult = Result<
  AuthCapabilitiesListOutput,
  AuthCapabilitiesListHandlerError
>;
export type AuthCapabilitiesListHandler<TDeps = undefined> = (
  args: {
    input: AuthCapabilitiesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthCapabilitiesListHandlerResult
  | Promise<AuthCapabilitiesListHandlerResult>;
export type AuthCapabilityGroupsDeleteHandlerError = TrellisErrorInstance;
export type AuthCapabilityGroupsDeleteHandlerResult = Result<
  AuthCapabilityGroupsDeleteOutput,
  AuthCapabilityGroupsDeleteHandlerError
>;
export type AuthCapabilityGroupsDeleteHandler<TDeps = undefined> = (
  args: {
    input: AuthCapabilityGroupsDeleteInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthCapabilityGroupsDeleteHandlerResult
  | Promise<AuthCapabilityGroupsDeleteHandlerResult>;
export type AuthCapabilityGroupsGetHandlerError = TrellisErrorInstance;
export type AuthCapabilityGroupsGetHandlerResult = Result<
  AuthCapabilityGroupsGetOutput,
  AuthCapabilityGroupsGetHandlerError
>;
export type AuthCapabilityGroupsGetHandler<TDeps = undefined> = (
  args: {
    input: AuthCapabilityGroupsGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthCapabilityGroupsGetHandlerResult
  | Promise<AuthCapabilityGroupsGetHandlerResult>;
export type AuthCapabilityGroupsListHandlerError = TrellisErrorInstance;
export type AuthCapabilityGroupsListHandlerResult = Result<
  AuthCapabilityGroupsListOutput,
  AuthCapabilityGroupsListHandlerError
>;
export type AuthCapabilityGroupsListHandler<TDeps = undefined> = (
  args: {
    input: AuthCapabilityGroupsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthCapabilityGroupsListHandlerResult
  | Promise<AuthCapabilityGroupsListHandlerResult>;
export type AuthCapabilityGroupsPutHandlerError = TrellisErrorInstance;
export type AuthCapabilityGroupsPutHandlerResult = Result<
  AuthCapabilityGroupsPutOutput,
  AuthCapabilityGroupsPutHandlerError
>;
export type AuthCapabilityGroupsPutHandler<TDeps = undefined> = (
  args: {
    input: AuthCapabilityGroupsPutInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthCapabilityGroupsPutHandlerResult
  | Promise<AuthCapabilityGroupsPutHandlerResult>;
export type AuthCatalogIssuesResolveHandlerError = TrellisErrorInstance;
export type AuthCatalogIssuesResolveHandlerResult = Result<
  AuthCatalogIssuesResolveOutput,
  AuthCatalogIssuesResolveHandlerError
>;
export type AuthCatalogIssuesResolveHandler<TDeps = undefined> = (
  args: {
    input: AuthCatalogIssuesResolveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthCatalogIssuesResolveHandlerResult
  | Promise<AuthCatalogIssuesResolveHandlerResult>;
export type AuthConnectionsKickHandlerError = TrellisErrorInstance;
export type AuthConnectionsKickHandlerResult = Result<
  AuthConnectionsKickOutput,
  AuthConnectionsKickHandlerError
>;
export type AuthConnectionsKickHandler<TDeps = undefined> = (
  args: {
    input: AuthConnectionsKickInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthConnectionsKickHandlerResult
  | Promise<AuthConnectionsKickHandlerResult>;
export type AuthConnectionsListHandlerError = TrellisErrorInstance;
export type AuthConnectionsListHandlerResult = Result<
  AuthConnectionsListOutput,
  AuthConnectionsListHandlerError
>;
export type AuthConnectionsListHandler<TDeps = undefined> = (
  args: {
    input: AuthConnectionsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthConnectionsListHandlerResult
  | Promise<AuthConnectionsListHandlerResult>;
export type AuthDeploymentAuthorityAcceptMigrationHandlerError =
  TrellisErrorInstance;
export type AuthDeploymentAuthorityAcceptMigrationHandlerResult = Result<
  AuthDeploymentAuthorityAcceptMigrationOutput,
  AuthDeploymentAuthorityAcceptMigrationHandlerError
>;
export type AuthDeploymentAuthorityAcceptMigrationHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityAcceptMigrationInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityAcceptMigrationHandlerResult
  | Promise<AuthDeploymentAuthorityAcceptMigrationHandlerResult>;
export type AuthDeploymentAuthorityAcceptUpdateHandlerError =
  TrellisErrorInstance;
export type AuthDeploymentAuthorityAcceptUpdateHandlerResult = Result<
  AuthDeploymentAuthorityAcceptUpdateOutput,
  AuthDeploymentAuthorityAcceptUpdateHandlerError
>;
export type AuthDeploymentAuthorityAcceptUpdateHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityAcceptUpdateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityAcceptUpdateHandlerResult
  | Promise<AuthDeploymentAuthorityAcceptUpdateHandlerResult>;
export type AuthDeploymentAuthorityGetHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityGetHandlerResult = Result<
  AuthDeploymentAuthorityGetOutput,
  AuthDeploymentAuthorityGetHandlerError
>;
export type AuthDeploymentAuthorityGetHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityGetHandlerResult
  | Promise<AuthDeploymentAuthorityGetHandlerResult>;
export type AuthDeploymentAuthorityGrantOverridesListHandlerError =
  TrellisErrorInstance;
export type AuthDeploymentAuthorityGrantOverridesListHandlerResult = Result<
  AuthDeploymentAuthorityGrantOverridesListOutput,
  AuthDeploymentAuthorityGrantOverridesListHandlerError
>;
export type AuthDeploymentAuthorityGrantOverridesListHandler<
  TDeps = undefined,
> = (
  args: {
    input: AuthDeploymentAuthorityGrantOverridesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityGrantOverridesListHandlerResult
  | Promise<AuthDeploymentAuthorityGrantOverridesListHandlerResult>;
export type AuthDeploymentAuthorityGrantOverridesPutHandlerError =
  TrellisErrorInstance;
export type AuthDeploymentAuthorityGrantOverridesPutHandlerResult = Result<
  AuthDeploymentAuthorityGrantOverridesPutOutput,
  AuthDeploymentAuthorityGrantOverridesPutHandlerError
>;
export type AuthDeploymentAuthorityGrantOverridesPutHandler<TDeps = undefined> =
  (
    args: {
      input: AuthDeploymentAuthorityGrantOverridesPutInput;
      context: RpcHandlerContext;
      client: HandlerClient;
    } & WithDeps<TDeps>,
  ) =>
    | AuthDeploymentAuthorityGrantOverridesPutHandlerResult
    | Promise<AuthDeploymentAuthorityGrantOverridesPutHandlerResult>;
export type AuthDeploymentAuthorityGrantOverridesRemoveHandlerError =
  TrellisErrorInstance;
export type AuthDeploymentAuthorityGrantOverridesRemoveHandlerResult = Result<
  AuthDeploymentAuthorityGrantOverridesRemoveOutput,
  AuthDeploymentAuthorityGrantOverridesRemoveHandlerError
>;
export type AuthDeploymentAuthorityGrantOverridesRemoveHandler<
  TDeps = undefined,
> = (
  args: {
    input: AuthDeploymentAuthorityGrantOverridesRemoveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityGrantOverridesRemoveHandlerResult
  | Promise<AuthDeploymentAuthorityGrantOverridesRemoveHandlerResult>;
export type AuthDeploymentAuthorityListHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityListHandlerResult = Result<
  AuthDeploymentAuthorityListOutput,
  AuthDeploymentAuthorityListHandlerError
>;
export type AuthDeploymentAuthorityListHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityListHandlerResult
  | Promise<AuthDeploymentAuthorityListHandlerResult>;
export type AuthDeploymentAuthorityPlanHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityPlanHandlerResult = Result<
  AuthDeploymentAuthorityPlanOutput,
  AuthDeploymentAuthorityPlanHandlerError
>;
export type AuthDeploymentAuthorityPlanHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityPlanInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityPlanHandlerResult
  | Promise<AuthDeploymentAuthorityPlanHandlerResult>;
export type AuthDeploymentAuthorityPlansGetHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityPlansGetHandlerResult = Result<
  AuthDeploymentAuthorityPlansGetOutput,
  AuthDeploymentAuthorityPlansGetHandlerError
>;
export type AuthDeploymentAuthorityPlansGetHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityPlansGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityPlansGetHandlerResult
  | Promise<AuthDeploymentAuthorityPlansGetHandlerResult>;
export type AuthDeploymentAuthorityPlansListHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityPlansListHandlerResult = Result<
  AuthDeploymentAuthorityPlansListOutput,
  AuthDeploymentAuthorityPlansListHandlerError
>;
export type AuthDeploymentAuthorityPlansListHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityPlansListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityPlansListHandlerResult
  | Promise<AuthDeploymentAuthorityPlansListHandlerResult>;
export type AuthDeploymentAuthorityReconcileHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityReconcileHandlerResult = Result<
  AuthDeploymentAuthorityReconcileOutput,
  AuthDeploymentAuthorityReconcileHandlerError
>;
export type AuthDeploymentAuthorityReconcileHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityReconcileInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityReconcileHandlerResult
  | Promise<AuthDeploymentAuthorityReconcileHandlerResult>;
export type AuthDeploymentAuthorityRejectHandlerError = TrellisErrorInstance;
export type AuthDeploymentAuthorityRejectHandlerResult = Result<
  AuthDeploymentAuthorityRejectOutput,
  AuthDeploymentAuthorityRejectHandlerError
>;
export type AuthDeploymentAuthorityRejectHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentAuthorityRejectInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentAuthorityRejectHandlerResult
  | Promise<AuthDeploymentAuthorityRejectHandlerResult>;
export type AuthDeploymentsCreateHandlerError = TrellisErrorInstance;
export type AuthDeploymentsCreateHandlerResult = Result<
  AuthDeploymentsCreateOutput,
  AuthDeploymentsCreateHandlerError
>;
export type AuthDeploymentsCreateHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentsCreateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentsCreateHandlerResult
  | Promise<AuthDeploymentsCreateHandlerResult>;
export type AuthDeploymentsDisableHandlerError = TrellisErrorInstance;
export type AuthDeploymentsDisableHandlerResult = Result<
  AuthDeploymentsDisableOutput,
  AuthDeploymentsDisableHandlerError
>;
export type AuthDeploymentsDisableHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentsDisableInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentsDisableHandlerResult
  | Promise<AuthDeploymentsDisableHandlerResult>;
export type AuthDeploymentsEnableHandlerError = TrellisErrorInstance;
export type AuthDeploymentsEnableHandlerResult = Result<
  AuthDeploymentsEnableOutput,
  AuthDeploymentsEnableHandlerError
>;
export type AuthDeploymentsEnableHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentsEnableInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentsEnableHandlerResult
  | Promise<AuthDeploymentsEnableHandlerResult>;
export type AuthDeploymentsListHandlerError = TrellisErrorInstance;
export type AuthDeploymentsListHandlerResult = Result<
  AuthDeploymentsListOutput,
  AuthDeploymentsListHandlerError
>;
export type AuthDeploymentsListHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentsListHandlerResult
  | Promise<AuthDeploymentsListHandlerResult>;
export type AuthDeploymentsRemoveHandlerError = TrellisErrorInstance;
export type AuthDeploymentsRemoveHandlerResult = Result<
  AuthDeploymentsRemoveOutput,
  AuthDeploymentsRemoveHandlerError
>;
export type AuthDeploymentsRemoveHandler<TDeps = undefined> = (
  args: {
    input: AuthDeploymentsRemoveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeploymentsRemoveHandlerResult
  | Promise<AuthDeploymentsRemoveHandlerResult>;
export type AuthDeviceUserAuthoritiesListHandlerError = TrellisErrorInstance;
export type AuthDeviceUserAuthoritiesListHandlerResult = Result<
  AuthDeviceUserAuthoritiesListOutput,
  AuthDeviceUserAuthoritiesListHandlerError
>;
export type AuthDeviceUserAuthoritiesListHandler<TDeps = undefined> = (
  args: {
    input: AuthDeviceUserAuthoritiesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeviceUserAuthoritiesListHandlerResult
  | Promise<AuthDeviceUserAuthoritiesListHandlerResult>;
export type AuthDeviceUserAuthoritiesReviewsDecideHandlerError =
  TrellisErrorInstance;
export type AuthDeviceUserAuthoritiesReviewsDecideHandlerResult = Result<
  AuthDeviceUserAuthoritiesReviewsDecideOutput,
  AuthDeviceUserAuthoritiesReviewsDecideHandlerError
>;
export type AuthDeviceUserAuthoritiesReviewsDecideHandler<TDeps = undefined> = (
  args: {
    input: AuthDeviceUserAuthoritiesReviewsDecideInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeviceUserAuthoritiesReviewsDecideHandlerResult
  | Promise<AuthDeviceUserAuthoritiesReviewsDecideHandlerResult>;
export type AuthDeviceUserAuthoritiesReviewsListHandlerError =
  TrellisErrorInstance;
export type AuthDeviceUserAuthoritiesReviewsListHandlerResult = Result<
  AuthDeviceUserAuthoritiesReviewsListOutput,
  AuthDeviceUserAuthoritiesReviewsListHandlerError
>;
export type AuthDeviceUserAuthoritiesReviewsListHandler<TDeps = undefined> = (
  args: {
    input: AuthDeviceUserAuthoritiesReviewsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeviceUserAuthoritiesReviewsListHandlerResult
  | Promise<AuthDeviceUserAuthoritiesReviewsListHandlerResult>;
export type AuthDeviceUserAuthoritiesRevokeHandlerError = TrellisErrorInstance;
export type AuthDeviceUserAuthoritiesRevokeHandlerResult = Result<
  AuthDeviceUserAuthoritiesRevokeOutput,
  AuthDeviceUserAuthoritiesRevokeHandlerError
>;
export type AuthDeviceUserAuthoritiesRevokeHandler<TDeps = undefined> = (
  args: {
    input: AuthDeviceUserAuthoritiesRevokeInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDeviceUserAuthoritiesRevokeHandlerResult
  | Promise<AuthDeviceUserAuthoritiesRevokeHandlerResult>;
export type AuthDevicesConnectInfoGetHandlerError = TrellisErrorInstance;
export type AuthDevicesConnectInfoGetHandlerResult = Result<
  AuthDevicesConnectInfoGetOutput,
  AuthDevicesConnectInfoGetHandlerError
>;
export type AuthDevicesConnectInfoGetHandler<TDeps = undefined> = (
  args: {
    input: AuthDevicesConnectInfoGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDevicesConnectInfoGetHandlerResult
  | Promise<AuthDevicesConnectInfoGetHandlerResult>;
export type AuthDevicesDisableHandlerError = TrellisErrorInstance;
export type AuthDevicesDisableHandlerResult = Result<
  AuthDevicesDisableOutput,
  AuthDevicesDisableHandlerError
>;
export type AuthDevicesDisableHandler<TDeps = undefined> = (
  args: {
    input: AuthDevicesDisableInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthDevicesDisableHandlerResult | Promise<AuthDevicesDisableHandlerResult>;
export type AuthDevicesEnableHandlerError = TrellisErrorInstance;
export type AuthDevicesEnableHandlerResult = Result<
  AuthDevicesEnableOutput,
  AuthDevicesEnableHandlerError
>;
export type AuthDevicesEnableHandler<TDeps = undefined> = (
  args: {
    input: AuthDevicesEnableInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthDevicesEnableHandlerResult | Promise<AuthDevicesEnableHandlerResult>;
export type AuthDevicesListHandlerError = TrellisErrorInstance;
export type AuthDevicesListHandlerResult = Result<
  AuthDevicesListOutput,
  AuthDevicesListHandlerError
>;
export type AuthDevicesListHandler<TDeps = undefined> = (
  args: {
    input: AuthDevicesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthDevicesListHandlerResult | Promise<AuthDevicesListHandlerResult>;
export type AuthDevicesProvisionHandlerError = TrellisErrorInstance;
export type AuthDevicesProvisionHandlerResult = Result<
  AuthDevicesProvisionOutput,
  AuthDevicesProvisionHandlerError
>;
export type AuthDevicesProvisionHandler<TDeps = undefined> = (
  args: {
    input: AuthDevicesProvisionInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthDevicesProvisionHandlerResult
  | Promise<AuthDevicesProvisionHandlerResult>;
export type AuthDevicesRemoveHandlerError = TrellisErrorInstance;
export type AuthDevicesRemoveHandlerResult = Result<
  AuthDevicesRemoveOutput,
  AuthDevicesRemoveHandlerError
>;
export type AuthDevicesRemoveHandler<TDeps = undefined> = (
  args: {
    input: AuthDevicesRemoveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthDevicesRemoveHandlerResult | Promise<AuthDevicesRemoveHandlerResult>;
export type AuthHealthHandlerError = TrellisErrorInstance;
export type AuthHealthHandlerResult = Result<
  AuthHealthOutput,
  AuthHealthHandlerError
>;
export type AuthHealthHandler<TDeps = undefined> = (
  args: {
    input: AuthHealthInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthHealthHandlerResult | Promise<AuthHealthHandlerResult>;
export type AuthIdentitiesListHandlerError = TrellisErrorInstance;
export type AuthIdentitiesListHandlerResult = Result<
  AuthIdentitiesListOutput,
  AuthIdentitiesListHandlerError
>;
export type AuthIdentitiesListHandler<TDeps = undefined> = (
  args: {
    input: AuthIdentitiesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthIdentitiesListHandlerResult | Promise<AuthIdentitiesListHandlerResult>;
export type AuthIdentityGrantsListHandlerError = TrellisErrorInstance;
export type AuthIdentityGrantsListHandlerResult = Result<
  AuthIdentityGrantsListOutput,
  AuthIdentityGrantsListHandlerError
>;
export type AuthIdentityGrantsListHandler<TDeps = undefined> = (
  args: {
    input: AuthIdentityGrantsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthIdentityGrantsListHandlerResult
  | Promise<AuthIdentityGrantsListHandlerResult>;
export type AuthIdentityGrantsRevokeHandlerError = TrellisErrorInstance;
export type AuthIdentityGrantsRevokeHandlerResult = Result<
  AuthIdentityGrantsRevokeOutput,
  AuthIdentityGrantsRevokeHandlerError
>;
export type AuthIdentityGrantsRevokeHandler<TDeps = undefined> = (
  args: {
    input: AuthIdentityGrantsRevokeInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthIdentityGrantsRevokeHandlerResult
  | Promise<AuthIdentityGrantsRevokeHandlerResult>;
export type AuthPortalsGetHandlerError = TrellisErrorInstance;
export type AuthPortalsGetHandlerResult = Result<
  AuthPortalsGetOutput,
  AuthPortalsGetHandlerError
>;
export type AuthPortalsGetHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthPortalsGetHandlerResult | Promise<AuthPortalsGetHandlerResult>;
export type AuthPortalsListHandlerError = TrellisErrorInstance;
export type AuthPortalsListHandlerResult = Result<
  AuthPortalsListOutput,
  AuthPortalsListHandlerError
>;
export type AuthPortalsListHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthPortalsListHandlerResult | Promise<AuthPortalsListHandlerResult>;
export type AuthPortalsLoginSettingsGetHandlerError = TrellisErrorInstance;
export type AuthPortalsLoginSettingsGetHandlerResult = Result<
  AuthPortalsLoginSettingsGetOutput,
  AuthPortalsLoginSettingsGetHandlerError
>;
export type AuthPortalsLoginSettingsGetHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsLoginSettingsGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthPortalsLoginSettingsGetHandlerResult
  | Promise<AuthPortalsLoginSettingsGetHandlerResult>;
export type AuthPortalsLoginSettingsUpdateHandlerError = TrellisErrorInstance;
export type AuthPortalsLoginSettingsUpdateHandlerResult = Result<
  AuthPortalsLoginSettingsUpdateOutput,
  AuthPortalsLoginSettingsUpdateHandlerError
>;
export type AuthPortalsLoginSettingsUpdateHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsLoginSettingsUpdateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthPortalsLoginSettingsUpdateHandlerResult
  | Promise<AuthPortalsLoginSettingsUpdateHandlerResult>;
export type AuthPortalsPutHandlerError = TrellisErrorInstance;
export type AuthPortalsPutHandlerResult = Result<
  AuthPortalsPutOutput,
  AuthPortalsPutHandlerError
>;
export type AuthPortalsPutHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsPutInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthPortalsPutHandlerResult | Promise<AuthPortalsPutHandlerResult>;
export type AuthPortalsRemoveHandlerError = TrellisErrorInstance;
export type AuthPortalsRemoveHandlerResult = Result<
  AuthPortalsRemoveOutput,
  AuthPortalsRemoveHandlerError
>;
export type AuthPortalsRemoveHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsRemoveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthPortalsRemoveHandlerResult | Promise<AuthPortalsRemoveHandlerResult>;
export type AuthPortalsRoutesPutHandlerError = TrellisErrorInstance;
export type AuthPortalsRoutesPutHandlerResult = Result<
  AuthPortalsRoutesPutOutput,
  AuthPortalsRoutesPutHandlerError
>;
export type AuthPortalsRoutesPutHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsRoutesPutInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthPortalsRoutesPutHandlerResult
  | Promise<AuthPortalsRoutesPutHandlerResult>;
export type AuthPortalsRoutesRemoveHandlerError = TrellisErrorInstance;
export type AuthPortalsRoutesRemoveHandlerResult = Result<
  AuthPortalsRoutesRemoveOutput,
  AuthPortalsRoutesRemoveHandlerError
>;
export type AuthPortalsRoutesRemoveHandler<TDeps = undefined> = (
  args: {
    input: AuthPortalsRoutesRemoveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthPortalsRoutesRemoveHandlerResult
  | Promise<AuthPortalsRoutesRemoveHandlerResult>;
export type AuthRequestsValidateHandlerError = TrellisErrorInstance;
export type AuthRequestsValidateHandlerResult = Result<
  AuthRequestsValidateOutput,
  AuthRequestsValidateHandlerError
>;
export type AuthRequestsValidateHandler<TDeps = undefined> = (
  args: {
    input: AuthRequestsValidateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthRequestsValidateHandlerResult
  | Promise<AuthRequestsValidateHandlerResult>;
export type AuthServiceInstancesDisableHandlerError = TrellisErrorInstance;
export type AuthServiceInstancesDisableHandlerResult = Result<
  AuthServiceInstancesDisableOutput,
  AuthServiceInstancesDisableHandlerError
>;
export type AuthServiceInstancesDisableHandler<TDeps = undefined> = (
  args: {
    input: AuthServiceInstancesDisableInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthServiceInstancesDisableHandlerResult
  | Promise<AuthServiceInstancesDisableHandlerResult>;
export type AuthServiceInstancesEnableHandlerError = TrellisErrorInstance;
export type AuthServiceInstancesEnableHandlerResult = Result<
  AuthServiceInstancesEnableOutput,
  AuthServiceInstancesEnableHandlerError
>;
export type AuthServiceInstancesEnableHandler<TDeps = undefined> = (
  args: {
    input: AuthServiceInstancesEnableInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthServiceInstancesEnableHandlerResult
  | Promise<AuthServiceInstancesEnableHandlerResult>;
export type AuthServiceInstancesListHandlerError = TrellisErrorInstance;
export type AuthServiceInstancesListHandlerResult = Result<
  AuthServiceInstancesListOutput,
  AuthServiceInstancesListHandlerError
>;
export type AuthServiceInstancesListHandler<TDeps = undefined> = (
  args: {
    input: AuthServiceInstancesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthServiceInstancesListHandlerResult
  | Promise<AuthServiceInstancesListHandlerResult>;
export type AuthServiceInstancesProvisionHandlerError = TrellisErrorInstance;
export type AuthServiceInstancesProvisionHandlerResult = Result<
  AuthServiceInstancesProvisionOutput,
  AuthServiceInstancesProvisionHandlerError
>;
export type AuthServiceInstancesProvisionHandler<TDeps = undefined> = (
  args: {
    input: AuthServiceInstancesProvisionInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthServiceInstancesProvisionHandlerResult
  | Promise<AuthServiceInstancesProvisionHandlerResult>;
export type AuthServiceInstancesRemoveHandlerError = TrellisErrorInstance;
export type AuthServiceInstancesRemoveHandlerResult = Result<
  AuthServiceInstancesRemoveOutput,
  AuthServiceInstancesRemoveHandlerError
>;
export type AuthServiceInstancesRemoveHandler<TDeps = undefined> = (
  args: {
    input: AuthServiceInstancesRemoveInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthServiceInstancesRemoveHandlerResult
  | Promise<AuthServiceInstancesRemoveHandlerResult>;
export type AuthSessionsListHandlerError = TrellisErrorInstance;
export type AuthSessionsListHandlerResult = Result<
  AuthSessionsListOutput,
  AuthSessionsListHandlerError
>;
export type AuthSessionsListHandler<TDeps = undefined> = (
  args: {
    input: AuthSessionsListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthSessionsListHandlerResult | Promise<AuthSessionsListHandlerResult>;
export type AuthSessionsLogoutHandlerError = TrellisErrorInstance;
export type AuthSessionsLogoutHandlerResult = Result<
  AuthSessionsLogoutOutput,
  AuthSessionsLogoutHandlerError
>;
export type AuthSessionsLogoutHandler<TDeps = undefined> = (
  args: {
    input: AuthSessionsLogoutInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthSessionsLogoutHandlerResult | Promise<AuthSessionsLogoutHandlerResult>;
export type AuthSessionsMeHandlerError = TrellisErrorInstance;
export type AuthSessionsMeHandlerResult = Result<
  AuthSessionsMeOutput,
  AuthSessionsMeHandlerError
>;
export type AuthSessionsMeHandler<TDeps = undefined> = (
  args: {
    input: AuthSessionsMeInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthSessionsMeHandlerResult | Promise<AuthSessionsMeHandlerResult>;
export type AuthSessionsRevokeHandlerError = TrellisErrorInstance;
export type AuthSessionsRevokeHandlerResult = Result<
  AuthSessionsRevokeOutput,
  AuthSessionsRevokeHandlerError
>;
export type AuthSessionsRevokeHandler<TDeps = undefined> = (
  args: {
    input: AuthSessionsRevokeInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthSessionsRevokeHandlerResult | Promise<AuthSessionsRevokeHandlerResult>;
export type AuthUserIdentitiesListHandlerError = TrellisErrorInstance;
export type AuthUserIdentitiesListHandlerResult = Result<
  AuthUserIdentitiesListOutput,
  AuthUserIdentitiesListHandlerError
>;
export type AuthUserIdentitiesListHandler<TDeps = undefined> = (
  args: {
    input: AuthUserIdentitiesListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthUserIdentitiesListHandlerResult
  | Promise<AuthUserIdentitiesListHandlerResult>;
export type AuthUserIdentitiesUnlinkHandlerError = TrellisErrorInstance;
export type AuthUserIdentitiesUnlinkHandlerResult = Result<
  AuthUserIdentitiesUnlinkOutput,
  AuthUserIdentitiesUnlinkHandlerError
>;
export type AuthUserIdentitiesUnlinkHandler<TDeps = undefined> = (
  args: {
    input: AuthUserIdentitiesUnlinkInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthUserIdentitiesUnlinkHandlerResult
  | Promise<AuthUserIdentitiesUnlinkHandlerResult>;
export type AuthUsersCreateHandlerError = TrellisErrorInstance;
export type AuthUsersCreateHandlerResult = Result<
  AuthUsersCreateOutput,
  AuthUsersCreateHandlerError
>;
export type AuthUsersCreateHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersCreateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthUsersCreateHandlerResult | Promise<AuthUsersCreateHandlerResult>;
export type AuthUsersGetHandlerError = TrellisErrorInstance;
export type AuthUsersGetHandlerResult = Result<
  AuthUsersGetOutput,
  AuthUsersGetHandlerError
>;
export type AuthUsersGetHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersGetInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthUsersGetHandlerResult | Promise<AuthUsersGetHandlerResult>;
export type AuthUsersIdentityLinkCreateHandlerError = TrellisErrorInstance;
export type AuthUsersIdentityLinkCreateHandlerResult = Result<
  AuthUsersIdentityLinkCreateOutput,
  AuthUsersIdentityLinkCreateHandlerError
>;
export type AuthUsersIdentityLinkCreateHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersIdentityLinkCreateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthUsersIdentityLinkCreateHandlerResult
  | Promise<AuthUsersIdentityLinkCreateHandlerResult>;
export type AuthUsersListHandlerError = TrellisErrorInstance;
export type AuthUsersListHandlerResult = Result<
  AuthUsersListOutput,
  AuthUsersListHandlerError
>;
export type AuthUsersListHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersListInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthUsersListHandlerResult | Promise<AuthUsersListHandlerResult>;
export type AuthUsersPasswordChangeHandlerError = TrellisErrorInstance;
export type AuthUsersPasswordChangeHandlerResult = Result<
  AuthUsersPasswordChangeOutput,
  AuthUsersPasswordChangeHandlerError
>;
export type AuthUsersPasswordChangeHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersPasswordChangeInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthUsersPasswordChangeHandlerResult
  | Promise<AuthUsersPasswordChangeHandlerResult>;
export type AuthUsersPasswordResetCreateHandlerError = TrellisErrorInstance;
export type AuthUsersPasswordResetCreateHandlerResult = Result<
  AuthUsersPasswordResetCreateOutput,
  AuthUsersPasswordResetCreateHandlerError
>;
export type AuthUsersPasswordResetCreateHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersPasswordResetCreateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) =>
  | AuthUsersPasswordResetCreateHandlerResult
  | Promise<AuthUsersPasswordResetCreateHandlerResult>;
export type AuthUsersUpdateHandlerError = TrellisErrorInstance;
export type AuthUsersUpdateHandlerResult = Result<
  AuthUsersUpdateOutput,
  AuthUsersUpdateHandlerError
>;
export type AuthUsersUpdateHandler<TDeps = undefined> = (
  args: {
    input: AuthUsersUpdateInput;
    context: RpcHandlerContext;
    client: HandlerClient;
  } & WithDeps<TDeps>,
) => AuthUsersUpdateHandlerResult | Promise<AuthUsersUpdateHandlerResult>;

export interface EventMap {
  "Auth.Connections.Closed": { event: AuthConnectionsClosedEvent };
  "Auth.Connections.Kicked": { event: AuthConnectionsKickedEvent };
  "Auth.Connections.Opened": { event: AuthConnectionsOpenedEvent };
  "Auth.DeviceUserAuthorities.Approved": {
    event: AuthDeviceUserAuthoritiesApprovedEvent;
  };
  "Auth.DeviceUserAuthorities.Requested": {
    event: AuthDeviceUserAuthoritiesRequestedEvent;
  };
  "Auth.DeviceUserAuthorities.Resolved": {
    event: AuthDeviceUserAuthoritiesResolvedEvent;
  };
  "Auth.DeviceUserAuthorities.ReviewRequested": {
    event: AuthDeviceUserAuthoritiesReviewRequestedEvent;
  };
  "Auth.Sessions.Revoked": { event: AuthSessionsRevokedEvent };
}

export interface FeedMap {
}

export interface SubjectMap {
}
