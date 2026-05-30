// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
import type { RpcHandlerFn } from "../../../index.ts";
import type { API } from "./api.ts";

export const CONTRACT_ID = "trellis.auth@v1" as const;
export const CONTRACT_DIGEST =
  "gLadyuZkZX2uxa3wnVMUJkDDddoVgRrDEzH8TIdeDyw" as const;

export type AuthCapabilitiesListInput = { limit: number; offset?: number };
export type AuthCapabilitiesListOutput = {
  count: number;
  entries: Array<
    {
      consequence?: string;
      contractDigest?: string;
      contractDisplayName?: string;
      contractId?: string;
      description: string;
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
      needs: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
      needs: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
      needs: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
    grants: Array<{}>;
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
        needs: Array<
          (
            | { contractId: string; kind: "contract"; required: boolean }
            | {
              kind: "surface";
              required: boolean;
              surface: {
                action?:
                  | "call"
                  | "publish"
                  | "subscribe"
                  | "observe"
                  | "cancel";
                contractId: string;
                kind: "rpc" | "operation" | "event" | "feed";
                name: string;
              };
            }
            | { capability: string; kind: "capability"; required: boolean }
            | {
              kind: "resource";
              required: boolean;
              resource: {
                alias: string;
                definition?: {};
                kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
                required: boolean;
              };
            }
          )
        >;
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
      requestedNeeds: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
      requestedNeeds: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
      requestedNeeds: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
      requestedNeeds: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
        requestedNeeds: Array<
          (
            | { contractId: string; kind: "contract"; required: boolean }
            | {
              kind: "surface";
              required: boolean;
              surface: {
                action?:
                  | "call"
                  | "publish"
                  | "subscribe"
                  | "observe"
                  | "cancel";
                contractId: string;
                kind: "rpc" | "operation" | "event" | "feed";
                name: string;
              };
            }
            | { capability: string; kind: "capability"; required: boolean }
            | {
              kind: "resource";
              required: boolean;
              resource: {
                alias: string;
                definition?: {};
                kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
                required: boolean;
              };
            }
          )
        >;
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
        requestedNeeds: Array<
          (
            | { contractId: string; kind: "contract"; required: boolean }
            | {
              kind: "surface";
              required: boolean;
              surface: {
                action?:
                  | "call"
                  | "publish"
                  | "subscribe"
                  | "observe"
                  | "cancel";
                contractId: string;
                kind: "rpc" | "operation" | "event" | "feed";
                name: string;
              };
            }
            | { capability: string; kind: "capability"; required: boolean }
            | {
              kind: "resource";
              required: boolean;
              resource: {
                alias: string;
                definition?: {};
                kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
                required: boolean;
              };
            }
          )
        >;
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
      needs: Array<
        (
          | { contractId: string; kind: "contract"; required: boolean }
          | {
            kind: "surface";
            required: boolean;
            surface: {
              action?: "call" | "publish" | "subscribe" | "observe" | "cancel";
              contractId: string;
              kind: "rpc" | "operation" | "event" | "feed";
              name: string;
            };
          }
          | { capability: string; kind: "capability"; required: boolean }
          | {
            kind: "resource";
            required: boolean;
            resource: {
              alias: string;
              definition?: {};
              kind: "kv" | "store" | "jobs" | "event-consumer" | "transfer";
              required: boolean;
            };
          }
        )
      >;
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
    grants: Array<{}>;
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
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
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
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
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
              logs: boolean;
              maxDeliver: number;
              payload: { schema: string };
              progress: boolean;
              publishPrefix: string;
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
            logs: boolean;
            maxDeliver: number;
            payload: { schema: string };
            progress: boolean;
            publishPrefix: string;
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

export type AuthSessionsLogoutInput = {};
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

export type AuthConnectionsClosedEvent = {
  header: { id: string; time: string };
} & { id: string; origin: string; sessionKey: string; userNkey: string };

export type AuthConnectionsKickedEvent = {
  header: { id: string; time: string };
} & { id: string; kickedBy: string; origin: string; userNkey: string };

export type AuthConnectionsOpenedEvent = {
  header: { id: string; time: string };
} & { id: string; origin: string; sessionKey: string; userNkey: string };

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

export type AuthSessionsRevokedEvent =
  & { header: { id: string; time: string } }
  & { id: string; origin: string; revokedBy: string; sessionKey: string };

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

export type AuthCapabilitiesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Capabilities.List"
>;
export type AuthCapabilityGroupsDeleteHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.CapabilityGroups.Delete"
>;
export type AuthCapabilityGroupsGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.CapabilityGroups.Get"
>;
export type AuthCapabilityGroupsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.CapabilityGroups.List"
>;
export type AuthCapabilityGroupsPutHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.CapabilityGroups.Put"
>;
export type AuthCatalogIssuesResolveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.CatalogIssues.Resolve"
>;
export type AuthConnectionsKickHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Connections.Kick"
>;
export type AuthConnectionsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Connections.List"
>;
export type AuthDeploymentAuthorityAcceptMigrationHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.AcceptMigration"
>;
export type AuthDeploymentAuthorityAcceptUpdateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.AcceptUpdate"
>;
export type AuthDeploymentAuthorityGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.Get"
>;
export type AuthDeploymentAuthorityGrantOverridesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.GrantOverrides.List"
>;
export type AuthDeploymentAuthorityGrantOverridesPutHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.GrantOverrides.Put"
>;
export type AuthDeploymentAuthorityGrantOverridesRemoveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.GrantOverrides.Remove"
>;
export type AuthDeploymentAuthorityListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.List"
>;
export type AuthDeploymentAuthorityPlanHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.Plan"
>;
export type AuthDeploymentAuthorityPlansGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.Plans.Get"
>;
export type AuthDeploymentAuthorityPlansListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.Plans.List"
>;
export type AuthDeploymentAuthorityReconcileHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.Reconcile"
>;
export type AuthDeploymentAuthorityRejectHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeploymentAuthority.Reject"
>;
export type AuthDeploymentsCreateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Deployments.Create"
>;
export type AuthDeploymentsDisableHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Deployments.Disable"
>;
export type AuthDeploymentsEnableHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Deployments.Enable"
>;
export type AuthDeploymentsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Deployments.List"
>;
export type AuthDeploymentsRemoveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Deployments.Remove"
>;
export type AuthDeviceUserAuthoritiesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeviceUserAuthorities.List"
>;
export type AuthDeviceUserAuthoritiesReviewsDecideHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeviceUserAuthorities.Reviews.Decide"
>;
export type AuthDeviceUserAuthoritiesReviewsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeviceUserAuthorities.Reviews.List"
>;
export type AuthDeviceUserAuthoritiesRevokeHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.DeviceUserAuthorities.Revoke"
>;
export type AuthDevicesConnectInfoGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Devices.ConnectInfo.Get"
>;
export type AuthDevicesDisableHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Devices.Disable"
>;
export type AuthDevicesEnableHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Devices.Enable"
>;
export type AuthDevicesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Devices.List"
>;
export type AuthDevicesProvisionHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Devices.Provision"
>;
export type AuthDevicesRemoveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Devices.Remove"
>;
export type AuthHealthHandler = RpcHandlerFn<typeof API.owned, "Auth.Health">;
export type AuthIdentitiesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Identities.List"
>;
export type AuthIdentityGrantsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.IdentityGrants.List"
>;
export type AuthIdentityGrantsRevokeHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.IdentityGrants.Revoke"
>;
export type AuthPortalsGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.Get"
>;
export type AuthPortalsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.List"
>;
export type AuthPortalsLoginSettingsGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.LoginSettings.Get"
>;
export type AuthPortalsLoginSettingsUpdateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.LoginSettings.Update"
>;
export type AuthPortalsPutHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.Put"
>;
export type AuthPortalsRemoveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.Remove"
>;
export type AuthPortalsRoutesPutHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.Routes.Put"
>;
export type AuthPortalsRoutesRemoveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Portals.Routes.Remove"
>;
export type AuthRequestsValidateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Requests.Validate"
>;
export type AuthServiceInstancesDisableHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.ServiceInstances.Disable"
>;
export type AuthServiceInstancesEnableHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.ServiceInstances.Enable"
>;
export type AuthServiceInstancesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.ServiceInstances.List"
>;
export type AuthServiceInstancesProvisionHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.ServiceInstances.Provision"
>;
export type AuthServiceInstancesRemoveHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.ServiceInstances.Remove"
>;
export type AuthSessionsListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Sessions.List"
>;
export type AuthSessionsLogoutHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Sessions.Logout"
>;
export type AuthSessionsMeHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Sessions.Me"
>;
export type AuthSessionsRevokeHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Sessions.Revoke"
>;
export type AuthUserIdentitiesListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.UserIdentities.List"
>;
export type AuthUserIdentitiesUnlinkHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.UserIdentities.Unlink"
>;
export type AuthUsersCreateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.Create"
>;
export type AuthUsersGetHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.Get"
>;
export type AuthUsersIdentityLinkCreateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.IdentityLink.Create"
>;
export type AuthUsersListHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.List"
>;
export type AuthUsersPasswordChangeHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.Password.Change"
>;
export type AuthUsersPasswordResetCreateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.PasswordReset.Create"
>;
export type AuthUsersUpdateHandler = RpcHandlerFn<
  typeof API.owned,
  "Auth.Users.Update"
>;

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
