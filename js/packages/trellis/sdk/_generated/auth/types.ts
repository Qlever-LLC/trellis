// Generated from ./generated/contracts/manifests/trellis.auth@v1.json

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
    breakingChanges: Array<
      {
        kind:
          | "schema-required-removed"
          | "schema-property-removed"
          | "schema-property-type-changed"
          | "schema-enum-value-removed"
          | "schema-closed-shape-violation"
          | "surface-removed"
          | "surface-subject-changed"
          | "surface-required-capability-added"
          | "resource-shape-changed"
          | "resource-removed"
          | "capability-removed"
          | "capability-required-changed"
          | "digest-incompatible"
          | "unresolved-ref";
        path?: string;
        reason: string;
        target:
          | { contractId: string; kind: "schema"; schemaName: string }
          | {
            contractId: string;
            kind: "surface";
            surfaceKind: "rpc" | "operation" | "event" | "feed" | "job";
            surfaceName: string;
          }
          | { contractId: string; kind: "resource"; resourceAlias: string }
          | { capability: string; contractId: string; kind: "capability" }
          | { contractId: string; kind: "contract" }
          | { contractDigest: string; contractId: string; kind: "digest" };
      }
    >;
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
    state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  } | {
    acknowledgementRequired: boolean;
    breakingChanges: Array<
      {
        kind:
          | "schema-required-removed"
          | "schema-property-removed"
          | "schema-property-type-changed"
          | "schema-enum-value-removed"
          | "schema-closed-shape-violation"
          | "surface-removed"
          | "surface-subject-changed"
          | "surface-required-capability-added"
          | "resource-shape-changed"
          | "resource-removed"
          | "capability-removed"
          | "capability-required-changed"
          | "digest-incompatible"
          | "unresolved-ref";
        path?: string;
        reason: string;
        target:
          | { contractId: string; kind: "schema"; schemaName: string }
          | {
            contractId: string;
            kind: "surface";
            surfaceKind: "rpc" | "operation" | "event" | "feed" | "job";
            surfaceName: string;
          }
          | { contractId: string; kind: "resource"; resourceAlias: string }
          | { capability: string; contractId: string; kind: "capability" }
          | { contractId: string; kind: "contract" }
          | { contractDigest: string; contractId: string; kind: "digest" };
      }
    >;
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
    state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  };
};

export type AuthDeploymentAuthorityPlansGetInput = { planId: string };
export type AuthDeploymentAuthorityPlansGetOutput = {
  plan: {
    breakingChanges: Array<
      {
        kind:
          | "schema-required-removed"
          | "schema-property-removed"
          | "schema-property-type-changed"
          | "schema-enum-value-removed"
          | "schema-closed-shape-violation"
          | "surface-removed"
          | "surface-subject-changed"
          | "surface-required-capability-added"
          | "resource-shape-changed"
          | "resource-removed"
          | "capability-removed"
          | "capability-required-changed"
          | "digest-incompatible"
          | "unresolved-ref";
        path?: string;
        reason: string;
        target:
          | { contractId: string; kind: "schema"; schemaName: string }
          | {
            contractId: string;
            kind: "surface";
            surfaceKind: "rpc" | "operation" | "event" | "feed" | "job";
            surfaceName: string;
          }
          | { contractId: string; kind: "resource"; resourceAlias: string }
          | { capability: string; contractId: string; kind: "capability" }
          | { contractId: string; kind: "contract" }
          | { contractDigest: string; contractId: string; kind: "digest" };
      }
    >;
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
    state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  } | {
    acknowledgementRequired: boolean;
    breakingChanges: Array<
      {
        kind:
          | "schema-required-removed"
          | "schema-property-removed"
          | "schema-property-type-changed"
          | "schema-enum-value-removed"
          | "schema-closed-shape-violation"
          | "surface-removed"
          | "surface-subject-changed"
          | "surface-required-capability-added"
          | "resource-shape-changed"
          | "resource-removed"
          | "capability-removed"
          | "capability-required-changed"
          | "digest-incompatible"
          | "unresolved-ref";
        path?: string;
        reason: string;
        target:
          | { contractId: string; kind: "schema"; schemaName: string }
          | {
            contractId: string;
            kind: "surface";
            surfaceKind: "rpc" | "operation" | "event" | "feed" | "job";
            surfaceName: string;
          }
          | { contractId: string; kind: "resource"; resourceAlias: string }
          | { capability: string; contractId: string; kind: "capability" }
          | { contractId: string; kind: "contract" }
          | { contractDigest: string; contractId: string; kind: "digest" };
      }
    >;
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
    state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
  };
};

export type AuthDeploymentAuthorityPlansListInput = {
  classification?: "update" | "migration";
  deploymentId?: string;
  kind?: "service" | "device" | "app" | "cli" | "native" | "device-user";
  limit: number;
  offset?: number;
  state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
};
export type AuthDeploymentAuthorityPlansListOutput = {
  count: number;
  entries: Array<
    ({
      breakingChanges: Array<
        {
          kind:
            | "schema-required-removed"
            | "schema-property-removed"
            | "schema-property-type-changed"
            | "schema-enum-value-removed"
            | "schema-closed-shape-violation"
            | "surface-removed"
            | "surface-subject-changed"
            | "surface-required-capability-added"
            | "resource-shape-changed"
            | "resource-removed"
            | "capability-removed"
            | "capability-required-changed"
            | "digest-incompatible"
            | "unresolved-ref";
          path?: string;
          reason: string;
          target:
            | { contractId: string; kind: "schema"; schemaName: string }
            | {
              contractId: string;
              kind: "surface";
              surfaceKind: "rpc" | "operation" | "event" | "feed" | "job";
              surfaceName: string;
            }
            | { contractId: string; kind: "resource"; resourceAlias: string }
            | { capability: string; contractId: string; kind: "capability" }
            | { contractId: string; kind: "contract" }
            | { contractDigest: string; contractId: string; kind: "digest" };
        }
      >;
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
      state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
    } | {
      acknowledgementRequired: boolean;
      breakingChanges: Array<
        {
          kind:
            | "schema-required-removed"
            | "schema-property-removed"
            | "schema-property-type-changed"
            | "schema-enum-value-removed"
            | "schema-closed-shape-violation"
            | "surface-removed"
            | "surface-subject-changed"
            | "surface-required-capability-added"
            | "resource-shape-changed"
            | "resource-removed"
            | "capability-removed"
            | "capability-required-changed"
            | "digest-incompatible"
            | "unresolved-ref";
          path?: string;
          reason: string;
          target:
            | { contractId: string; kind: "schema"; schemaName: string }
            | {
              contractId: string;
              kind: "surface";
              surfaceKind: "rpc" | "operation" | "event" | "feed" | "job";
              surfaceName: string;
            }
            | { contractId: string; kind: "resource"; resourceAlias: string }
            | { capability: string; contractId: string; kind: "capability" }
            | { contractId: string; kind: "contract" }
            | { contractDigest: string; contractId: string; kind: "digest" };
        }
      >;
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
      state?: "pending" | "accepted" | "rejected" | "expired" | "superseded";
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

export type AuthEventConsumersListInput = {
  deploymentId?: string;
  limit: number;
  offset?: number;
};
export type AuthEventConsumersListOutput = {
  count: number;
  entries: Array<
    {
      ackWaitMs: number;
      backoffMs: Array<number>;
      consumerName: string;
      deploymentId: string;
      filterSubjects: Array<string>;
      group: string;
      maxDeliver: number;
      ordering: string;
      replay: string;
      stream: string;
    }
  >;
  limit: number;
  nextOffset?: number;
  offset: number;
};

export type AuthEventsValidateInput = {
  eventId: string;
  eventTime: string;
  payloadHash: string;
  proof: string;
  sessionKey: string;
  subject: string;
};
export type AuthEventsValidateOutput = {
  allowed: boolean;
  caller?: {
    active: boolean;
    capabilities: Array<string>;
    email: string;
    emailVerified: boolean;
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
  publisher?: {
    contractDigest?: string;
    contractId?: string;
    deploymentId?: string;
    instanceId?: string;
    kind: "service" | "device" | "user";
    sessionStatus: "active" | "ended" | "revoked" | "expired";
  };
  status:
    | "verified"
    | "missing-session"
    | "invalid-signature"
    | "subject-denied"
    | "outside-session-window";
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
    emailVerified: boolean;
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
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict" | "parallel";
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
            update?: { schema: string };
            updatesPrefix?: string;
            workSubject: string;
          };
        };
        serviceName: string;
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
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict" | "parallel";
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
            update?: { schema: string };
            updatesPrefix?: string;
            workSubject: string;
          };
        };
        serviceName: string;
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
            consumerName: string;
            filterSubjects: Array<string>;
            maxDeliver: number;
            ordering: "strict" | "parallel";
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
              update?: { schema: string };
              updatesPrefix?: string;
              workSubject: string;
            };
          };
          serviceName: string;
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
          consumerName: string;
          filterSubjects: Array<string>;
          maxDeliver: number;
          ordering: "strict" | "parallel";
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
            update?: { schema: string };
            updatesPrefix?: string;
            workSubject: string;
          };
        };
        serviceName: string;
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

export type AuthUserLifecycleDeactivateInput = {
  provider: string;
  subject: string;
  userId: string;
};
export type AuthUserLifecycleDeactivateOutput = {
  deactivated: boolean;
  revokedSessions: number;
};

export type AuthUserLifecycleInspectInput = {
  provider: string;
  subject: string;
};
export type AuthUserLifecycleInspectOutput = {
  active: boolean | null;
  email: string | null;
  found: boolean;
  identityId: string | null;
  provider: string | null;
  subject: string | null;
  userId: string | null;
};

export type AuthUserLifecycleUnlinkInput = {
  provider: string;
  subject: string;
  userId: string;
};
export type AuthUserLifecycleUnlinkOutput = { unlinked: boolean };

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

export type AuthUsersResolveInput = { userIds: Array<string> };
export type AuthUsersResolveOutput = {
  missing?: Array<string>;
  users: Array<{ displayName?: string; email?: string; userId: string }>;
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
  id: string;
  origin: string;
  sessionKey: string;
  userNkey: string;
};

export type AuthConnectionsKickedEvent = {
  id: string;
  kickedBy: string;
  origin: string;
  userNkey: string;
};

export type AuthConnectionsOpenedEvent = {
  id: string;
  origin: string;
  sessionKey: string;
  userNkey: string;
};

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

export type AuthSessionsRevokedEvent = {
  id: string;
  origin: string;
  revokedBy: string;
  sessionKey: string;
};
