// Generated from ./generated/contracts/manifests/trellis.auth@v1.json
export const AuthCapabilitiesListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthCapabilitiesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "consequence": { "minLength": 1, "type": "string" },
          "contractDigest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
          "contractDisplayName": { "minLength": 1, "type": "string" },
          "contractId": { "minLength": 1, "type": "string" },
          "deploymentId": { "minLength": 1, "type": "string" },
          "description": { "minLength": 1, "type": "string" },
          "direction": {
            "anyOf": [{ "const": "creates", "type": "string" }, {
              "const": "given",
              "type": "string",
            }],
          },
          "displayName": { "minLength": 1, "type": "string" },
          "key": { "minLength": 1, "type": "string" },
          "source": {
            "anyOf": [{ "const": "contract", "type": "string" }, {
              "const": "platform",
              "type": "string",
            }],
          },
        },
        "required": ["key", "displayName", "description", "source"],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsDeleteRequestSchema = {
  "properties": { "groupKey": { "minLength": 1, "type": "string" } },
  "required": ["groupKey"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsDeleteResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsGetRequestSchema = {
  "properties": { "groupKey": { "minLength": 1, "type": "string" } },
  "required": ["groupKey"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsGetResponseSchema = {
  "properties": {
    "group": {
      "properties": {
        "capabilities": {
          "items": { "minLength": 1, "type": "string" },
          "type": "array",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "description": { "minLength": 1, "type": "string" },
        "displayName": { "minLength": 1, "type": "string" },
        "groupKey": { "minLength": 1, "type": "string" },
        "includedGroups": {
          "items": { "minLength": 1, "type": "string" },
          "type": "array",
        },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "groupKey",
        "displayName",
        "description",
        "capabilities",
        "includedGroups",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": ["group"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "capabilities": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
          "createdAt": { "format": "date-time", "type": "string" },
          "description": { "minLength": 1, "type": "string" },
          "displayName": { "minLength": 1, "type": "string" },
          "groupKey": { "minLength": 1, "type": "string" },
          "includedGroups": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "groupKey",
          "displayName",
          "description",
          "capabilities",
          "includedGroups",
          "createdAt",
          "updatedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsPutRequestSchema = {
  "properties": {
    "capabilities": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "description": { "minLength": 1, "type": "string" },
    "displayName": { "minLength": 1, "type": "string" },
    "groupKey": { "minLength": 1, "type": "string" },
    "includedGroups": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
  },
  "required": ["groupKey", "displayName", "description"],
  "type": "object",
} as const;

export const AuthCapabilityGroupsPutResponseSchema = {
  "properties": {
    "group": {
      "properties": {
        "capabilities": {
          "items": { "minLength": 1, "type": "string" },
          "type": "array",
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "description": { "minLength": 1, "type": "string" },
        "displayName": { "minLength": 1, "type": "string" },
        "groupKey": { "minLength": 1, "type": "string" },
        "includedGroups": {
          "items": { "minLength": 1, "type": "string" },
          "type": "array",
        },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "groupKey",
        "displayName",
        "description",
        "capabilities",
        "includedGroups",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": ["group"],
  "type": "object",
} as const;

export const AuthCatalogIssuesResolveRequestSchema = {
  "properties": {
    "action": {
      "anyOf": [{ "const": "keep-current", "type": "string" }, {
        "const": "force-replace",
        "type": "string",
      }],
    },
    "issueId": { "minLength": 1, "type": "string" },
  },
  "required": ["issueId", "action"],
  "type": "object",
} as const;

export const AuthCatalogIssuesResolveResponseSchema = {
  "properties": {
    "action": {
      "anyOf": [{ "const": "keep-current", "type": "string" }, {
        "const": "force-replace",
        "type": "string",
      }],
    },
    "issueId": { "minLength": 1, "type": "string" },
    "success": { "const": true, "type": "boolean" },
  },
  "required": ["success", "issueId", "action"],
  "type": "object",
} as const;

export const AuthConnectionsClosedEventSchema = {
  "properties": {
    "id": { "type": "string" },
    "origin": { "type": "string" },
    "sessionKey": { "type": "string" },
    "userNkey": { "type": "string" },
  },
  "required": ["origin", "id", "sessionKey", "userNkey"],
  "type": "object",
} as const;

export const AuthConnectionsKickRequestSchema = {
  "properties": { "userNkey": { "type": "string" } },
  "required": ["userNkey"],
  "type": "object",
} as const;

export const AuthConnectionsKickResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthConnectionsKickedEventSchema = {
  "properties": {
    "id": { "type": "string" },
    "kickedBy": { "type": "string" },
    "origin": { "type": "string" },
    "userNkey": { "type": "string" },
  },
  "required": ["origin", "id", "userNkey", "kickedBy"],
  "type": "object",
} as const;

export const AuthConnectionsListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "sessionKey": { "type": "string" },
    "user": { "type": "string" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthConnectionsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "anyOf": [{
          "properties": {
            "clientId": { "type": "number" },
            "connectedAt": { "type": "string" },
            "contractDisplayName": { "type": "string" },
            "contractId": { "type": "string" },
            "key": { "type": "string" },
            "participantKind": { "const": "app", "type": "string" },
            "principal": {
              "properties": {
                "identity": {
                  "properties": {
                    "identityId": { "type": "string" },
                    "provider": { "type": "string" },
                    "subject": { "type": "string" },
                  },
                  "required": ["identityId", "provider", "subject"],
                  "type": "object",
                },
                "name": { "type": "string" },
                "type": { "const": "user", "type": "string" },
                "userId": { "type": "string" },
              },
              "required": ["type", "userId", "identity", "name"],
              "type": "object",
            },
            "serverId": { "type": "string" },
            "sessionKey": { "type": "string" },
            "userNkey": { "type": "string" },
          },
          "required": [
            "key",
            "userNkey",
            "sessionKey",
            "serverId",
            "clientId",
            "connectedAt",
            "participantKind",
            "principal",
            "contractId",
            "contractDisplayName",
          ],
          "type": "object",
        }, {
          "properties": {
            "clientId": { "type": "number" },
            "connectedAt": { "type": "string" },
            "contractDisplayName": { "type": "string" },
            "contractId": { "type": "string" },
            "key": { "type": "string" },
            "participantKind": { "const": "agent", "type": "string" },
            "principal": {
              "properties": {
                "identity": {
                  "properties": {
                    "identityId": { "type": "string" },
                    "provider": { "type": "string" },
                    "subject": { "type": "string" },
                  },
                  "required": ["identityId", "provider", "subject"],
                  "type": "object",
                },
                "name": { "type": "string" },
                "type": { "const": "user", "type": "string" },
                "userId": { "type": "string" },
              },
              "required": ["type", "userId", "identity", "name"],
              "type": "object",
            },
            "serverId": { "type": "string" },
            "sessionKey": { "type": "string" },
            "userNkey": { "type": "string" },
          },
          "required": [
            "key",
            "userNkey",
            "sessionKey",
            "serverId",
            "clientId",
            "connectedAt",
            "participantKind",
            "principal",
            "contractId",
            "contractDisplayName",
          ],
          "type": "object",
        }, {
          "properties": {
            "clientId": { "type": "number" },
            "connectedAt": { "type": "string" },
            "contractDisplayName": { "type": "string" },
            "contractId": { "type": "string" },
            "key": { "type": "string" },
            "participantKind": { "const": "device", "type": "string" },
            "principal": {
              "properties": {
                "deploymentId": { "type": "string" },
                "deviceId": { "type": "string" },
                "deviceType": { "type": "string" },
                "runtimePublicKey": { "type": "string" },
                "type": { "const": "device", "type": "string" },
              },
              "required": [
                "type",
                "deviceId",
                "deviceType",
                "runtimePublicKey",
                "deploymentId",
              ],
              "type": "object",
            },
            "serverId": { "type": "string" },
            "sessionKey": { "type": "string" },
            "userNkey": { "type": "string" },
          },
          "required": [
            "key",
            "userNkey",
            "sessionKey",
            "serverId",
            "clientId",
            "connectedAt",
            "participantKind",
            "principal",
            "contractId",
          ],
          "type": "object",
        }, {
          "properties": {
            "clientId": { "type": "number" },
            "connectedAt": { "type": "string" },
            "key": { "type": "string" },
            "participantKind": { "const": "service", "type": "string" },
            "principal": {
              "properties": {
                "deploymentId": { "type": "string" },
                "id": { "type": "string" },
                "instanceId": { "type": "string" },
                "name": { "type": "string" },
                "type": { "const": "service", "type": "string" },
              },
              "required": ["type", "id", "name", "instanceId", "deploymentId"],
              "type": "object",
            },
            "serverId": { "type": "string" },
            "sessionKey": { "type": "string" },
            "userNkey": { "type": "string" },
          },
          "required": [
            "key",
            "userNkey",
            "sessionKey",
            "serverId",
            "clientId",
            "connectedAt",
            "participantKind",
            "principal",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthConnectionsOpenedEventSchema = {
  "properties": {
    "id": { "type": "string" },
    "origin": { "type": "string" },
    "sessionKey": { "type": "string" },
    "userNkey": { "type": "string" },
  },
  "required": ["origin", "id", "sessionKey", "userNkey"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityAcceptMigrationRequestSchema = {
  "properties": {
    "acknowledgement": { "minLength": 1, "type": "string" },
    "expectedDesiredVersion": { "minLength": 1, "type": "string" },
    "planId": { "minLength": 1, "type": "string" },
  },
  "required": ["planId", "acknowledgement"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityAcceptResponseSchema = {
  "properties": {
    "authority": {
      "properties": {
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "desiredState": {
          "properties": {
            "capabilities": {
              "items": { "minLength": 1, "type": "string" },
              "type": "array",
            },
            "needs": {
              "properties": {
                "capabilities": {
                  "items": {
                    "properties": {
                      "capability": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["capability", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "contracts": {
                  "items": {
                    "properties": {
                      "contractId": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["contractId", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "resources": {
                  "items": {
                    "properties": {
                      "alias": { "minLength": 1, "type": "string" },
                      "definition": { "type": "object" },
                      "kind": {
                        "anyOf": [
                          { "const": "kv", "type": "string" },
                          { "const": "store", "type": "string" },
                          { "const": "jobs", "type": "string" },
                          { "const": "event-consumer", "type": "string" },
                          { "const": "transfer", "type": "string" },
                        ],
                      },
                      "required": { "type": "boolean" },
                    },
                    "required": ["kind", "alias", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "surfaces": {
                  "items": {
                    "properties": {
                      "action": {
                        "anyOf": [
                          { "const": "call", "type": "string" },
                          { "const": "publish", "type": "string" },
                          { "const": "subscribe", "type": "string" },
                          { "const": "observe", "type": "string" },
                          { "const": "cancel", "type": "string" },
                        ],
                      },
                      "contractId": { "minLength": 1, "type": "string" },
                      "kind": {
                        "anyOf": [
                          { "const": "rpc", "type": "string" },
                          { "const": "operation", "type": "string" },
                          { "const": "event", "type": "string" },
                          { "const": "feed", "type": "string" },
                        ],
                      },
                      "name": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["contractId", "kind", "name", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
              },
              "required": [
                "contracts",
                "surfaces",
                "capabilities",
                "resources",
              ],
              "type": "object",
            },
            "resources": {
              "items": {
                "properties": {
                  "alias": { "minLength": 1, "type": "string" },
                  "definition": { "type": "object" },
                  "kind": {
                    "anyOf": [
                      { "const": "kv", "type": "string" },
                      { "const": "store", "type": "string" },
                      { "const": "jobs", "type": "string" },
                      { "const": "event-consumer", "type": "string" },
                      { "const": "transfer", "type": "string" },
                    ],
                  },
                  "required": { "type": "boolean" },
                },
                "required": ["kind", "alias", "required"],
                "type": "object",
              },
              "type": "array",
            },
            "surfaces": {
              "items": {
                "properties": {
                  "action": {
                    "anyOf": [
                      { "const": "call", "type": "string" },
                      { "const": "publish", "type": "string" },
                      { "const": "subscribe", "type": "string" },
                      { "const": "observe", "type": "string" },
                      { "const": "cancel", "type": "string" },
                    ],
                  },
                  "contractId": { "minLength": 1, "type": "string" },
                  "kind": {
                    "anyOf": [
                      { "const": "rpc", "type": "string" },
                      { "const": "operation", "type": "string" },
                      { "const": "event", "type": "string" },
                      { "const": "feed", "type": "string" },
                    ],
                  },
                  "name": { "minLength": 1, "type": "string" },
                },
                "required": ["contractId", "kind", "name"],
                "type": "object",
              },
              "type": "array",
            },
          },
          "required": ["needs", "capabilities", "resources", "surfaces"],
          "type": "object",
        },
        "disabled": { "type": "boolean" },
        "kind": {
          "anyOf": [
            { "const": "service", "type": "string" },
            { "const": "device", "type": "string" },
            { "const": "app", "type": "string" },
            { "const": "cli", "type": "string" },
            { "const": "native", "type": "string" },
            { "const": "device-user", "type": "string" },
          ],
        },
        "updatedAt": { "format": "date-time", "type": "string" },
        "version": { "minLength": 1, "type": "string" },
      },
      "required": [
        "deploymentId",
        "kind",
        "disabled",
        "desiredState",
        "version",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": ["authority"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityAcceptUpdateRequestSchema = {
  "properties": {
    "expectedDesiredVersion": { "minLength": 1, "type": "string" },
    "planId": { "minLength": 1, "type": "string" },
  },
  "required": ["planId"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGetRequestSchema = {
  "properties": { "deploymentId": { "minLength": 1, "type": "string" } },
  "required": ["deploymentId"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGetResponseSchema = {
  "properties": {
    "authority": {
      "properties": {
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "desiredState": {
          "properties": {
            "capabilities": {
              "items": { "minLength": 1, "type": "string" },
              "type": "array",
            },
            "needs": {
              "properties": {
                "capabilities": {
                  "items": {
                    "properties": {
                      "capability": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["capability", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "contracts": {
                  "items": {
                    "properties": {
                      "contractId": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["contractId", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "resources": {
                  "items": {
                    "properties": {
                      "alias": { "minLength": 1, "type": "string" },
                      "definition": { "type": "object" },
                      "kind": {
                        "anyOf": [
                          { "const": "kv", "type": "string" },
                          { "const": "store", "type": "string" },
                          { "const": "jobs", "type": "string" },
                          { "const": "event-consumer", "type": "string" },
                          { "const": "transfer", "type": "string" },
                        ],
                      },
                      "required": { "type": "boolean" },
                    },
                    "required": ["kind", "alias", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "surfaces": {
                  "items": {
                    "properties": {
                      "action": {
                        "anyOf": [
                          { "const": "call", "type": "string" },
                          { "const": "publish", "type": "string" },
                          { "const": "subscribe", "type": "string" },
                          { "const": "observe", "type": "string" },
                          { "const": "cancel", "type": "string" },
                        ],
                      },
                      "contractId": { "minLength": 1, "type": "string" },
                      "kind": {
                        "anyOf": [
                          { "const": "rpc", "type": "string" },
                          { "const": "operation", "type": "string" },
                          { "const": "event", "type": "string" },
                          { "const": "feed", "type": "string" },
                        ],
                      },
                      "name": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["contractId", "kind", "name", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
              },
              "required": [
                "contracts",
                "surfaces",
                "capabilities",
                "resources",
              ],
              "type": "object",
            },
            "resources": {
              "items": {
                "properties": {
                  "alias": { "minLength": 1, "type": "string" },
                  "definition": { "type": "object" },
                  "kind": {
                    "anyOf": [
                      { "const": "kv", "type": "string" },
                      { "const": "store", "type": "string" },
                      { "const": "jobs", "type": "string" },
                      { "const": "event-consumer", "type": "string" },
                      { "const": "transfer", "type": "string" },
                    ],
                  },
                  "required": { "type": "boolean" },
                },
                "required": ["kind", "alias", "required"],
                "type": "object",
              },
              "type": "array",
            },
            "surfaces": {
              "items": {
                "properties": {
                  "action": {
                    "anyOf": [
                      { "const": "call", "type": "string" },
                      { "const": "publish", "type": "string" },
                      { "const": "subscribe", "type": "string" },
                      { "const": "observe", "type": "string" },
                      { "const": "cancel", "type": "string" },
                    ],
                  },
                  "contractId": { "minLength": 1, "type": "string" },
                  "kind": {
                    "anyOf": [
                      { "const": "rpc", "type": "string" },
                      { "const": "operation", "type": "string" },
                      { "const": "event", "type": "string" },
                      { "const": "feed", "type": "string" },
                    ],
                  },
                  "name": { "minLength": 1, "type": "string" },
                },
                "required": ["contractId", "kind", "name"],
                "type": "object",
              },
              "type": "array",
            },
          },
          "required": ["needs", "capabilities", "resources", "surfaces"],
          "type": "object",
        },
        "disabled": { "type": "boolean" },
        "kind": {
          "anyOf": [
            { "const": "service", "type": "string" },
            { "const": "device", "type": "string" },
            { "const": "app", "type": "string" },
            { "const": "cli", "type": "string" },
            { "const": "native", "type": "string" },
            { "const": "device-user", "type": "string" },
          ],
        },
        "updatedAt": { "format": "date-time", "type": "string" },
        "version": { "minLength": 1, "type": "string" },
      },
      "required": [
        "deploymentId",
        "kind",
        "disabled",
        "desiredState",
        "version",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
    "grantOverrides": {
      "items": {
        "anyOf": [{
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
    "materializedAuthority": {
      "anyOf": [{
        "properties": {
          "deploymentId": { "minLength": 1, "type": "string" },
          "desiredVersion": { "minLength": 1, "type": "string" },
          "error": { "minLength": 1, "type": "string" },
          "grants": {
            "properties": {
              "capabilities": {
                "items": {
                  "properties": {
                    "capability": { "minLength": 1, "type": "string" },
                  },
                  "required": ["capability"],
                  "type": "object",
                },
                "type": "array",
              },
              "nats": {
                "items": {
                  "properties": {
                    "direction": {
                      "anyOf": [{ "const": "publish", "type": "string" }, {
                        "const": "subscribe",
                        "type": "string",
                      }],
                    },
                    "grantSource": {
                      "anyOf": [
                        { "const": "owned-surface", "type": "string" },
                        { "const": "used-surface", "type": "string" },
                        { "const": "resource-binding", "type": "string" },
                        { "const": "platform-service", "type": "string" },
                        { "const": "transfer", "type": "string" },
                      ],
                    },
                    "requiredCapabilities": {
                      "items": { "minLength": 1, "type": "string" },
                      "type": "array",
                    },
                    "subject": { "minLength": 1, "type": "string" },
                    "surface": {
                      "properties": {
                        "action": {
                          "anyOf": [
                            { "const": "call", "type": "string" },
                            { "const": "publish", "type": "string" },
                            { "const": "subscribe", "type": "string" },
                            { "const": "observe", "type": "string" },
                            { "const": "cancel", "type": "string" },
                          ],
                        },
                        "contractId": { "minLength": 1, "type": "string" },
                        "kind": {
                          "anyOf": [
                            { "const": "rpc", "type": "string" },
                            { "const": "operation", "type": "string" },
                            { "const": "event", "type": "string" },
                            { "const": "feed", "type": "string" },
                          ],
                        },
                        "name": { "minLength": 1, "type": "string" },
                      },
                      "required": ["contractId", "kind", "name"],
                      "type": "object",
                    },
                  },
                  "required": [
                    "direction",
                    "subject",
                    "requiredCapabilities",
                    "grantSource",
                  ],
                  "type": "object",
                },
                "type": "array",
              },
              "surfaces": {
                "items": {
                  "properties": {
                    "action": {
                      "anyOf": [
                        { "const": "call", "type": "string" },
                        { "const": "publish", "type": "string" },
                        { "const": "subscribe", "type": "string" },
                        { "const": "observe", "type": "string" },
                        { "const": "cancel", "type": "string" },
                      ],
                    },
                    "contractId": { "minLength": 1, "type": "string" },
                    "name": { "minLength": 1, "type": "string" },
                    "surfaceKind": {
                      "anyOf": [
                        { "const": "rpc", "type": "string" },
                        { "const": "operation", "type": "string" },
                        { "const": "event", "type": "string" },
                        { "const": "feed", "type": "string" },
                      ],
                    },
                  },
                  "required": ["contractId", "surfaceKind", "name"],
                  "type": "object",
                },
                "type": "array",
              },
            },
            "required": ["capabilities", "surfaces", "nats"],
            "type": "object",
          },
          "reconciledAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "resourceBindings": {
            "items": {
              "properties": {
                "alias": { "minLength": 1, "type": "string" },
                "binding": {
                  "patternProperties": { "^.*$": {} },
                  "type": "object",
                },
                "createdAt": { "format": "date-time", "type": "string" },
                "deploymentId": { "minLength": 1, "type": "string" },
                "kind": {
                  "anyOf": [
                    { "const": "kv", "type": "string" },
                    { "const": "store", "type": "string" },
                    { "const": "jobs", "type": "string" },
                    { "const": "event-consumer", "type": "string" },
                    { "const": "transfer", "type": "string" },
                  ],
                },
                "limits": {
                  "anyOf": [{
                    "patternProperties": { "^.*$": {} },
                    "type": "object",
                  }, { "type": "null" }],
                },
                "updatedAt": { "format": "date-time", "type": "string" },
              },
              "required": [
                "deploymentId",
                "kind",
                "alias",
                "binding",
                "limits",
                "createdAt",
                "updatedAt",
              ],
              "type": "object",
            },
            "type": "array",
          },
          "status": {
            "anyOf": [{ "const": "current", "type": "string" }, {
              "const": "pending",
              "type": "string",
            }, { "const": "failed", "type": "string" }],
          },
        },
        "required": [
          "deploymentId",
          "desiredVersion",
          "status",
          "resourceBindings",
          "grants",
          "reconciledAt",
        ],
        "type": "object",
      }, { "type": "null" }],
    },
    "portalRoute": {
      "anyOf": [{
        "properties": {
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "entryUrl": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "portalId": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "deploymentId",
          "portalId",
          "entryUrl",
          "disabled",
          "updatedAt",
        ],
        "type": "object",
      }, { "type": "null" }],
    },
  },
  "required": [
    "authority",
    "materializedAuthority",
    "portalRoute",
    "grantOverrides",
  ],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGrantOverridesListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGrantOverridesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "anyOf": [{
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGrantOverridesPutRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "overrides": {
      "items": {
        "anyOf": [{
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
  },
  "required": ["deploymentId", "overrides"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGrantOverridesRemoveRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "overrides": {
      "items": {
        "anyOf": [{
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
  },
  "required": ["deploymentId", "overrides"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityGrantOverridesResponseSchema = {
  "properties": {
    "grantOverrides": {
      "items": {
        "anyOf": [{
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "web", "type": "string" },
            "origin": { "minLength": 1, "type": "string" },
            "sessionPublicKey": { "type": "null" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "minLength": 1, "type": "string" },
            "capabilityGroupKey": { "type": "null" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }, {
          "properties": {
            "capability": { "type": "null" },
            "capabilityGroupKey": { "minLength": 1, "type": "string" },
            "contractId": { "minLength": 1, "type": "string" },
            "deploymentId": { "minLength": 1, "type": "string" },
            "grantKind": { "const": "capability-group", "type": "string" },
            "identityKind": { "const": "session", "type": "string" },
            "origin": { "type": "null" },
            "sessionPublicKey": { "minLength": 1, "type": "string" },
          },
          "required": [
            "deploymentId",
            "identityKind",
            "grantKind",
            "contractId",
            "origin",
            "sessionPublicKey",
            "capability",
            "capabilityGroupKey",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
  },
  "required": ["grantOverrides"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityListRequestSchema = {
  "properties": {
    "disabled": { "type": "boolean" },
    "kind": {
      "anyOf": [
        { "const": "service", "type": "string" },
        { "const": "device", "type": "string" },
        { "const": "app", "type": "string" },
        { "const": "cli", "type": "string" },
        { "const": "native", "type": "string" },
        { "const": "device-user", "type": "string" },
      ],
    },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "createdAt": { "format": "date-time", "type": "string" },
          "deploymentId": { "minLength": 1, "type": "string" },
          "desiredState": {
            "properties": {
              "capabilities": {
                "items": { "minLength": 1, "type": "string" },
                "type": "array",
              },
              "needs": {
                "properties": {
                  "capabilities": {
                    "items": {
                      "properties": {
                        "capability": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["capability", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "contracts": {
                    "items": {
                      "properties": {
                        "contractId": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "resources": {
                    "items": {
                      "properties": {
                        "alias": { "minLength": 1, "type": "string" },
                        "definition": { "type": "object" },
                        "kind": {
                          "anyOf": [
                            { "const": "kv", "type": "string" },
                            { "const": "store", "type": "string" },
                            { "const": "jobs", "type": "string" },
                            { "const": "event-consumer", "type": "string" },
                            { "const": "transfer", "type": "string" },
                          ],
                        },
                        "required": { "type": "boolean" },
                      },
                      "required": ["kind", "alias", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "surfaces": {
                    "items": {
                      "properties": {
                        "action": {
                          "anyOf": [
                            { "const": "call", "type": "string" },
                            { "const": "publish", "type": "string" },
                            { "const": "subscribe", "type": "string" },
                            { "const": "observe", "type": "string" },
                            { "const": "cancel", "type": "string" },
                          ],
                        },
                        "contractId": { "minLength": 1, "type": "string" },
                        "kind": {
                          "anyOf": [
                            { "const": "rpc", "type": "string" },
                            { "const": "operation", "type": "string" },
                            { "const": "event", "type": "string" },
                            { "const": "feed", "type": "string" },
                          ],
                        },
                        "name": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "kind", "name", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                },
                "required": [
                  "contracts",
                  "surfaces",
                  "capabilities",
                  "resources",
                ],
                "type": "object",
              },
              "resources": {
                "items": {
                  "properties": {
                    "alias": { "minLength": 1, "type": "string" },
                    "definition": { "type": "object" },
                    "kind": {
                      "anyOf": [
                        { "const": "kv", "type": "string" },
                        { "const": "store", "type": "string" },
                        { "const": "jobs", "type": "string" },
                        { "const": "event-consumer", "type": "string" },
                        { "const": "transfer", "type": "string" },
                      ],
                    },
                    "required": { "type": "boolean" },
                  },
                  "required": ["kind", "alias", "required"],
                  "type": "object",
                },
                "type": "array",
              },
              "surfaces": {
                "items": {
                  "properties": {
                    "action": {
                      "anyOf": [
                        { "const": "call", "type": "string" },
                        { "const": "publish", "type": "string" },
                        { "const": "subscribe", "type": "string" },
                        { "const": "observe", "type": "string" },
                        { "const": "cancel", "type": "string" },
                      ],
                    },
                    "contractId": { "minLength": 1, "type": "string" },
                    "kind": {
                      "anyOf": [
                        { "const": "rpc", "type": "string" },
                        { "const": "operation", "type": "string" },
                        { "const": "event", "type": "string" },
                        { "const": "feed", "type": "string" },
                      ],
                    },
                    "name": { "minLength": 1, "type": "string" },
                  },
                  "required": ["contractId", "kind", "name"],
                  "type": "object",
                },
                "type": "array",
              },
            },
            "required": ["needs", "capabilities", "resources", "surfaces"],
            "type": "object",
          },
          "disabled": { "type": "boolean" },
          "kind": {
            "anyOf": [
              { "const": "service", "type": "string" },
              { "const": "device", "type": "string" },
              { "const": "app", "type": "string" },
              { "const": "cli", "type": "string" },
              { "const": "native", "type": "string" },
              { "const": "device-user", "type": "string" },
            ],
          },
          "updatedAt": { "format": "date-time", "type": "string" },
          "version": { "minLength": 1, "type": "string" },
        },
        "required": [
          "deploymentId",
          "kind",
          "disabled",
          "desiredState",
          "version",
          "createdAt",
          "updatedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityPlanRequestSchema = {
  "properties": {
    "contract": { "type": "object" },
    "deploymentId": { "minLength": 1, "type": "string" },
    "expectedDigest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
  },
  "required": ["deploymentId", "contract", "expectedDigest"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityPlanResponseSchema = {
  "properties": {
    "plan": {
      "anyOf": [{
        "properties": {
          "classification": { "const": "update", "type": "string" },
          "createdAt": { "format": "date-time", "type": "string" },
          "decisionAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "decisionBy": {
            "anyOf": [
              { "patternProperties": { "^.*$": {} }, "type": "object" },
              { "type": "null" },
            ],
          },
          "decisionReason": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "desiredChange": { "type": "object" },
          "expiresAt": { "format": "date-time", "type": "string" },
          "materializationPreview": { "type": "object" },
          "planId": { "minLength": 1, "type": "string" },
          "proposal": {
            "properties": {
              "contract": { "type": "object" },
              "contractDigest": {
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string",
              },
              "contractId": { "minLength": 1, "type": "string" },
              "deploymentId": { "minLength": 1, "type": "string" },
              "proposalId": { "minLength": 1, "type": "string" },
              "providedSurfaces": {
                "items": {
                  "properties": {
                    "action": {
                      "anyOf": [
                        { "const": "call", "type": "string" },
                        { "const": "publish", "type": "string" },
                        { "const": "subscribe", "type": "string" },
                        { "const": "observe", "type": "string" },
                        { "const": "cancel", "type": "string" },
                      ],
                    },
                    "contractId": { "minLength": 1, "type": "string" },
                    "kind": {
                      "anyOf": [
                        { "const": "rpc", "type": "string" },
                        { "const": "operation", "type": "string" },
                        { "const": "event", "type": "string" },
                        { "const": "feed", "type": "string" },
                      ],
                    },
                    "name": { "minLength": 1, "type": "string" },
                  },
                  "required": ["contractId", "kind", "name"],
                  "type": "object",
                },
                "type": "array",
              },
              "requestedNeeds": {
                "properties": {
                  "capabilities": {
                    "items": {
                      "properties": {
                        "capability": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["capability", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "contracts": {
                    "items": {
                      "properties": {
                        "contractId": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "resources": {
                    "items": {
                      "properties": {
                        "alias": { "minLength": 1, "type": "string" },
                        "definition": { "type": "object" },
                        "kind": {
                          "anyOf": [
                            { "const": "kv", "type": "string" },
                            { "const": "store", "type": "string" },
                            { "const": "jobs", "type": "string" },
                            { "const": "event-consumer", "type": "string" },
                            { "const": "transfer", "type": "string" },
                          ],
                        },
                        "required": { "type": "boolean" },
                      },
                      "required": ["kind", "alias", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "surfaces": {
                    "items": {
                      "properties": {
                        "action": {
                          "anyOf": [
                            { "const": "call", "type": "string" },
                            { "const": "publish", "type": "string" },
                            { "const": "subscribe", "type": "string" },
                            { "const": "observe", "type": "string" },
                            { "const": "cancel", "type": "string" },
                          ],
                        },
                        "contractId": { "minLength": 1, "type": "string" },
                        "kind": {
                          "anyOf": [
                            { "const": "rpc", "type": "string" },
                            { "const": "operation", "type": "string" },
                            { "const": "event", "type": "string" },
                            { "const": "feed", "type": "string" },
                          ],
                        },
                        "name": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "kind", "name", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                },
                "required": [
                  "contracts",
                  "surfaces",
                  "capabilities",
                  "resources",
                ],
                "type": "object",
              },
              "summary": { "type": "object" },
            },
            "required": [
              "deploymentId",
              "contractId",
              "contractDigest",
              "requestedNeeds",
              "providedSurfaces",
            ],
            "type": "object",
          },
          "state": {
            "anyOf": [
              { "const": "pending", "type": "string" },
              { "const": "accepted", "type": "string" },
              { "const": "rejected", "type": "string" },
              { "const": "expired", "type": "string" },
            ],
          },
          "warnings": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": [
          "planId",
          "deploymentId",
          "proposal",
          "desiredChange",
          "materializationPreview",
          "warnings",
          "createdAt",
          "classification",
        ],
        "type": "object",
      }, {
        "properties": {
          "acknowledgementRequired": { "type": "boolean" },
          "classification": { "const": "migration", "type": "string" },
          "createdAt": { "format": "date-time", "type": "string" },
          "decisionAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "decisionBy": {
            "anyOf": [
              { "patternProperties": { "^.*$": {} }, "type": "object" },
              { "type": "null" },
            ],
          },
          "decisionReason": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "desiredChange": { "type": "object" },
          "expiresAt": { "format": "date-time", "type": "string" },
          "materializationPreview": { "type": "object" },
          "planId": { "minLength": 1, "type": "string" },
          "proposal": {
            "properties": {
              "contract": { "type": "object" },
              "contractDigest": {
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string",
              },
              "contractId": { "minLength": 1, "type": "string" },
              "deploymentId": { "minLength": 1, "type": "string" },
              "proposalId": { "minLength": 1, "type": "string" },
              "providedSurfaces": {
                "items": {
                  "properties": {
                    "action": {
                      "anyOf": [
                        { "const": "call", "type": "string" },
                        { "const": "publish", "type": "string" },
                        { "const": "subscribe", "type": "string" },
                        { "const": "observe", "type": "string" },
                        { "const": "cancel", "type": "string" },
                      ],
                    },
                    "contractId": { "minLength": 1, "type": "string" },
                    "kind": {
                      "anyOf": [
                        { "const": "rpc", "type": "string" },
                        { "const": "operation", "type": "string" },
                        { "const": "event", "type": "string" },
                        { "const": "feed", "type": "string" },
                      ],
                    },
                    "name": { "minLength": 1, "type": "string" },
                  },
                  "required": ["contractId", "kind", "name"],
                  "type": "object",
                },
                "type": "array",
              },
              "requestedNeeds": {
                "properties": {
                  "capabilities": {
                    "items": {
                      "properties": {
                        "capability": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["capability", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "contracts": {
                    "items": {
                      "properties": {
                        "contractId": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "resources": {
                    "items": {
                      "properties": {
                        "alias": { "minLength": 1, "type": "string" },
                        "definition": { "type": "object" },
                        "kind": {
                          "anyOf": [
                            { "const": "kv", "type": "string" },
                            { "const": "store", "type": "string" },
                            { "const": "jobs", "type": "string" },
                            { "const": "event-consumer", "type": "string" },
                            { "const": "transfer", "type": "string" },
                          ],
                        },
                        "required": { "type": "boolean" },
                      },
                      "required": ["kind", "alias", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "surfaces": {
                    "items": {
                      "properties": {
                        "action": {
                          "anyOf": [
                            { "const": "call", "type": "string" },
                            { "const": "publish", "type": "string" },
                            { "const": "subscribe", "type": "string" },
                            { "const": "observe", "type": "string" },
                            { "const": "cancel", "type": "string" },
                          ],
                        },
                        "contractId": { "minLength": 1, "type": "string" },
                        "kind": {
                          "anyOf": [
                            { "const": "rpc", "type": "string" },
                            { "const": "operation", "type": "string" },
                            { "const": "event", "type": "string" },
                            { "const": "feed", "type": "string" },
                          ],
                        },
                        "name": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "kind", "name", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                },
                "required": [
                  "contracts",
                  "surfaces",
                  "capabilities",
                  "resources",
                ],
                "type": "object",
              },
              "summary": { "type": "object" },
            },
            "required": [
              "deploymentId",
              "contractId",
              "contractDigest",
              "requestedNeeds",
              "providedSurfaces",
            ],
            "type": "object",
          },
          "state": {
            "anyOf": [
              { "const": "pending", "type": "string" },
              { "const": "accepted", "type": "string" },
              { "const": "rejected", "type": "string" },
              { "const": "expired", "type": "string" },
            ],
          },
          "warnings": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": [
          "planId",
          "deploymentId",
          "proposal",
          "desiredChange",
          "materializationPreview",
          "warnings",
          "createdAt",
          "classification",
          "acknowledgementRequired",
        ],
        "type": "object",
      }],
    },
  },
  "required": ["plan"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityPlansGetRequestSchema = {
  "properties": { "planId": { "minLength": 1, "type": "string" } },
  "required": ["planId"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityPlansGetResponseSchema = {
  "properties": {
    "plan": {
      "anyOf": [{
        "properties": {
          "classification": { "const": "update", "type": "string" },
          "createdAt": { "format": "date-time", "type": "string" },
          "decisionAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "decisionBy": {
            "anyOf": [
              { "patternProperties": { "^.*$": {} }, "type": "object" },
              { "type": "null" },
            ],
          },
          "decisionReason": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "desiredChange": { "type": "object" },
          "expiresAt": { "format": "date-time", "type": "string" },
          "materializationPreview": { "type": "object" },
          "planId": { "minLength": 1, "type": "string" },
          "proposal": {
            "properties": {
              "contract": { "type": "object" },
              "contractDigest": {
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string",
              },
              "contractId": { "minLength": 1, "type": "string" },
              "deploymentId": { "minLength": 1, "type": "string" },
              "proposalId": { "minLength": 1, "type": "string" },
              "providedSurfaces": {
                "items": {
                  "properties": {
                    "action": {
                      "anyOf": [
                        { "const": "call", "type": "string" },
                        { "const": "publish", "type": "string" },
                        { "const": "subscribe", "type": "string" },
                        { "const": "observe", "type": "string" },
                        { "const": "cancel", "type": "string" },
                      ],
                    },
                    "contractId": { "minLength": 1, "type": "string" },
                    "kind": {
                      "anyOf": [
                        { "const": "rpc", "type": "string" },
                        { "const": "operation", "type": "string" },
                        { "const": "event", "type": "string" },
                        { "const": "feed", "type": "string" },
                      ],
                    },
                    "name": { "minLength": 1, "type": "string" },
                  },
                  "required": ["contractId", "kind", "name"],
                  "type": "object",
                },
                "type": "array",
              },
              "requestedNeeds": {
                "properties": {
                  "capabilities": {
                    "items": {
                      "properties": {
                        "capability": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["capability", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "contracts": {
                    "items": {
                      "properties": {
                        "contractId": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "resources": {
                    "items": {
                      "properties": {
                        "alias": { "minLength": 1, "type": "string" },
                        "definition": { "type": "object" },
                        "kind": {
                          "anyOf": [
                            { "const": "kv", "type": "string" },
                            { "const": "store", "type": "string" },
                            { "const": "jobs", "type": "string" },
                            { "const": "event-consumer", "type": "string" },
                            { "const": "transfer", "type": "string" },
                          ],
                        },
                        "required": { "type": "boolean" },
                      },
                      "required": ["kind", "alias", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "surfaces": {
                    "items": {
                      "properties": {
                        "action": {
                          "anyOf": [
                            { "const": "call", "type": "string" },
                            { "const": "publish", "type": "string" },
                            { "const": "subscribe", "type": "string" },
                            { "const": "observe", "type": "string" },
                            { "const": "cancel", "type": "string" },
                          ],
                        },
                        "contractId": { "minLength": 1, "type": "string" },
                        "kind": {
                          "anyOf": [
                            { "const": "rpc", "type": "string" },
                            { "const": "operation", "type": "string" },
                            { "const": "event", "type": "string" },
                            { "const": "feed", "type": "string" },
                          ],
                        },
                        "name": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "kind", "name", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                },
                "required": [
                  "contracts",
                  "surfaces",
                  "capabilities",
                  "resources",
                ],
                "type": "object",
              },
              "summary": { "type": "object" },
            },
            "required": [
              "deploymentId",
              "contractId",
              "contractDigest",
              "requestedNeeds",
              "providedSurfaces",
            ],
            "type": "object",
          },
          "state": {
            "anyOf": [
              { "const": "pending", "type": "string" },
              { "const": "accepted", "type": "string" },
              { "const": "rejected", "type": "string" },
              { "const": "expired", "type": "string" },
            ],
          },
          "warnings": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": [
          "planId",
          "deploymentId",
          "proposal",
          "desiredChange",
          "materializationPreview",
          "warnings",
          "createdAt",
          "classification",
        ],
        "type": "object",
      }, {
        "properties": {
          "acknowledgementRequired": { "type": "boolean" },
          "classification": { "const": "migration", "type": "string" },
          "createdAt": { "format": "date-time", "type": "string" },
          "decisionAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "decisionBy": {
            "anyOf": [
              { "patternProperties": { "^.*$": {} }, "type": "object" },
              { "type": "null" },
            ],
          },
          "decisionReason": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "desiredChange": { "type": "object" },
          "expiresAt": { "format": "date-time", "type": "string" },
          "materializationPreview": { "type": "object" },
          "planId": { "minLength": 1, "type": "string" },
          "proposal": {
            "properties": {
              "contract": { "type": "object" },
              "contractDigest": {
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string",
              },
              "contractId": { "minLength": 1, "type": "string" },
              "deploymentId": { "minLength": 1, "type": "string" },
              "proposalId": { "minLength": 1, "type": "string" },
              "providedSurfaces": {
                "items": {
                  "properties": {
                    "action": {
                      "anyOf": [
                        { "const": "call", "type": "string" },
                        { "const": "publish", "type": "string" },
                        { "const": "subscribe", "type": "string" },
                        { "const": "observe", "type": "string" },
                        { "const": "cancel", "type": "string" },
                      ],
                    },
                    "contractId": { "minLength": 1, "type": "string" },
                    "kind": {
                      "anyOf": [
                        { "const": "rpc", "type": "string" },
                        { "const": "operation", "type": "string" },
                        { "const": "event", "type": "string" },
                        { "const": "feed", "type": "string" },
                      ],
                    },
                    "name": { "minLength": 1, "type": "string" },
                  },
                  "required": ["contractId", "kind", "name"],
                  "type": "object",
                },
                "type": "array",
              },
              "requestedNeeds": {
                "properties": {
                  "capabilities": {
                    "items": {
                      "properties": {
                        "capability": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["capability", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "contracts": {
                    "items": {
                      "properties": {
                        "contractId": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "resources": {
                    "items": {
                      "properties": {
                        "alias": { "minLength": 1, "type": "string" },
                        "definition": { "type": "object" },
                        "kind": {
                          "anyOf": [
                            { "const": "kv", "type": "string" },
                            { "const": "store", "type": "string" },
                            { "const": "jobs", "type": "string" },
                            { "const": "event-consumer", "type": "string" },
                            { "const": "transfer", "type": "string" },
                          ],
                        },
                        "required": { "type": "boolean" },
                      },
                      "required": ["kind", "alias", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                  "surfaces": {
                    "items": {
                      "properties": {
                        "action": {
                          "anyOf": [
                            { "const": "call", "type": "string" },
                            { "const": "publish", "type": "string" },
                            { "const": "subscribe", "type": "string" },
                            { "const": "observe", "type": "string" },
                            { "const": "cancel", "type": "string" },
                          ],
                        },
                        "contractId": { "minLength": 1, "type": "string" },
                        "kind": {
                          "anyOf": [
                            { "const": "rpc", "type": "string" },
                            { "const": "operation", "type": "string" },
                            { "const": "event", "type": "string" },
                            { "const": "feed", "type": "string" },
                          ],
                        },
                        "name": { "minLength": 1, "type": "string" },
                        "required": { "type": "boolean" },
                      },
                      "required": ["contractId", "kind", "name", "required"],
                      "type": "object",
                    },
                    "type": "array",
                  },
                },
                "required": [
                  "contracts",
                  "surfaces",
                  "capabilities",
                  "resources",
                ],
                "type": "object",
              },
              "summary": { "type": "object" },
            },
            "required": [
              "deploymentId",
              "contractId",
              "contractDigest",
              "requestedNeeds",
              "providedSurfaces",
            ],
            "type": "object",
          },
          "state": {
            "anyOf": [
              { "const": "pending", "type": "string" },
              { "const": "accepted", "type": "string" },
              { "const": "rejected", "type": "string" },
              { "const": "expired", "type": "string" },
            ],
          },
          "warnings": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": [
          "planId",
          "deploymentId",
          "proposal",
          "desiredChange",
          "materializationPreview",
          "warnings",
          "createdAt",
          "classification",
          "acknowledgementRequired",
        ],
        "type": "object",
      }],
    },
  },
  "required": ["plan"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityPlansListRequestSchema = {
  "properties": {
    "classification": {
      "anyOf": [{ "const": "update", "type": "string" }, {
        "const": "migration",
        "type": "string",
      }],
    },
    "deploymentId": { "minLength": 1, "type": "string" },
    "kind": {
      "anyOf": [
        { "const": "service", "type": "string" },
        { "const": "device", "type": "string" },
        { "const": "app", "type": "string" },
        { "const": "cli", "type": "string" },
        { "const": "native", "type": "string" },
        { "const": "device-user", "type": "string" },
      ],
    },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "state": {
      "anyOf": [
        { "const": "pending", "type": "string" },
        { "const": "accepted", "type": "string" },
        { "const": "rejected", "type": "string" },
        { "const": "expired", "type": "string" },
      ],
    },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityPlansListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "anyOf": [{
          "properties": {
            "classification": { "const": "update", "type": "string" },
            "createdAt": { "format": "date-time", "type": "string" },
            "decisionAt": {
              "anyOf": [{ "format": "date-time", "type": "string" }, {
                "type": "null",
              }],
            },
            "decisionBy": {
              "anyOf": [{
                "patternProperties": { "^.*$": {} },
                "type": "object",
              }, { "type": "null" }],
            },
            "decisionReason": {
              "anyOf": [{ "minLength": 1, "type": "string" }, {
                "type": "null",
              }],
            },
            "deploymentId": { "minLength": 1, "type": "string" },
            "desiredChange": { "type": "object" },
            "expiresAt": { "format": "date-time", "type": "string" },
            "materializationPreview": { "type": "object" },
            "planId": { "minLength": 1, "type": "string" },
            "proposal": {
              "properties": {
                "contract": { "type": "object" },
                "contractDigest": {
                  "pattern": "^[A-Za-z0-9_-]+$",
                  "type": "string",
                },
                "contractId": { "minLength": 1, "type": "string" },
                "deploymentId": { "minLength": 1, "type": "string" },
                "proposalId": { "minLength": 1, "type": "string" },
                "providedSurfaces": {
                  "items": {
                    "properties": {
                      "action": {
                        "anyOf": [
                          { "const": "call", "type": "string" },
                          { "const": "publish", "type": "string" },
                          { "const": "subscribe", "type": "string" },
                          { "const": "observe", "type": "string" },
                          { "const": "cancel", "type": "string" },
                        ],
                      },
                      "contractId": { "minLength": 1, "type": "string" },
                      "kind": {
                        "anyOf": [
                          { "const": "rpc", "type": "string" },
                          { "const": "operation", "type": "string" },
                          { "const": "event", "type": "string" },
                          { "const": "feed", "type": "string" },
                        ],
                      },
                      "name": { "minLength": 1, "type": "string" },
                    },
                    "required": ["contractId", "kind", "name"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "requestedNeeds": {
                  "properties": {
                    "capabilities": {
                      "items": {
                        "properties": {
                          "capability": { "minLength": 1, "type": "string" },
                          "required": { "type": "boolean" },
                        },
                        "required": ["capability", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "contracts": {
                      "items": {
                        "properties": {
                          "contractId": { "minLength": 1, "type": "string" },
                          "required": { "type": "boolean" },
                        },
                        "required": ["contractId", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "resources": {
                      "items": {
                        "properties": {
                          "alias": { "minLength": 1, "type": "string" },
                          "definition": { "type": "object" },
                          "kind": {
                            "anyOf": [
                              { "const": "kv", "type": "string" },
                              { "const": "store", "type": "string" },
                              { "const": "jobs", "type": "string" },
                              { "const": "event-consumer", "type": "string" },
                              { "const": "transfer", "type": "string" },
                            ],
                          },
                          "required": { "type": "boolean" },
                        },
                        "required": ["kind", "alias", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "surfaces": {
                      "items": {
                        "properties": {
                          "action": {
                            "anyOf": [
                              { "const": "call", "type": "string" },
                              { "const": "publish", "type": "string" },
                              { "const": "subscribe", "type": "string" },
                              { "const": "observe", "type": "string" },
                              { "const": "cancel", "type": "string" },
                            ],
                          },
                          "contractId": { "minLength": 1, "type": "string" },
                          "kind": {
                            "anyOf": [
                              { "const": "rpc", "type": "string" },
                              { "const": "operation", "type": "string" },
                              { "const": "event", "type": "string" },
                              { "const": "feed", "type": "string" },
                            ],
                          },
                          "name": { "minLength": 1, "type": "string" },
                          "required": { "type": "boolean" },
                        },
                        "required": ["contractId", "kind", "name", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                  },
                  "required": [
                    "contracts",
                    "surfaces",
                    "capabilities",
                    "resources",
                  ],
                  "type": "object",
                },
                "summary": { "type": "object" },
              },
              "required": [
                "deploymentId",
                "contractId",
                "contractDigest",
                "requestedNeeds",
                "providedSurfaces",
              ],
              "type": "object",
            },
            "state": {
              "anyOf": [
                { "const": "pending", "type": "string" },
                { "const": "accepted", "type": "string" },
                { "const": "rejected", "type": "string" },
                { "const": "expired", "type": "string" },
              ],
            },
            "warnings": {
              "items": { "minLength": 1, "type": "string" },
              "type": "array",
            },
          },
          "required": [
            "planId",
            "deploymentId",
            "proposal",
            "desiredChange",
            "materializationPreview",
            "warnings",
            "createdAt",
            "classification",
          ],
          "type": "object",
        }, {
          "properties": {
            "acknowledgementRequired": { "type": "boolean" },
            "classification": { "const": "migration", "type": "string" },
            "createdAt": { "format": "date-time", "type": "string" },
            "decisionAt": {
              "anyOf": [{ "format": "date-time", "type": "string" }, {
                "type": "null",
              }],
            },
            "decisionBy": {
              "anyOf": [{
                "patternProperties": { "^.*$": {} },
                "type": "object",
              }, { "type": "null" }],
            },
            "decisionReason": {
              "anyOf": [{ "minLength": 1, "type": "string" }, {
                "type": "null",
              }],
            },
            "deploymentId": { "minLength": 1, "type": "string" },
            "desiredChange": { "type": "object" },
            "expiresAt": { "format": "date-time", "type": "string" },
            "materializationPreview": { "type": "object" },
            "planId": { "minLength": 1, "type": "string" },
            "proposal": {
              "properties": {
                "contract": { "type": "object" },
                "contractDigest": {
                  "pattern": "^[A-Za-z0-9_-]+$",
                  "type": "string",
                },
                "contractId": { "minLength": 1, "type": "string" },
                "deploymentId": { "minLength": 1, "type": "string" },
                "proposalId": { "minLength": 1, "type": "string" },
                "providedSurfaces": {
                  "items": {
                    "properties": {
                      "action": {
                        "anyOf": [
                          { "const": "call", "type": "string" },
                          { "const": "publish", "type": "string" },
                          { "const": "subscribe", "type": "string" },
                          { "const": "observe", "type": "string" },
                          { "const": "cancel", "type": "string" },
                        ],
                      },
                      "contractId": { "minLength": 1, "type": "string" },
                      "kind": {
                        "anyOf": [
                          { "const": "rpc", "type": "string" },
                          { "const": "operation", "type": "string" },
                          { "const": "event", "type": "string" },
                          { "const": "feed", "type": "string" },
                        ],
                      },
                      "name": { "minLength": 1, "type": "string" },
                    },
                    "required": ["contractId", "kind", "name"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "requestedNeeds": {
                  "properties": {
                    "capabilities": {
                      "items": {
                        "properties": {
                          "capability": { "minLength": 1, "type": "string" },
                          "required": { "type": "boolean" },
                        },
                        "required": ["capability", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "contracts": {
                      "items": {
                        "properties": {
                          "contractId": { "minLength": 1, "type": "string" },
                          "required": { "type": "boolean" },
                        },
                        "required": ["contractId", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "resources": {
                      "items": {
                        "properties": {
                          "alias": { "minLength": 1, "type": "string" },
                          "definition": { "type": "object" },
                          "kind": {
                            "anyOf": [
                              { "const": "kv", "type": "string" },
                              { "const": "store", "type": "string" },
                              { "const": "jobs", "type": "string" },
                              { "const": "event-consumer", "type": "string" },
                              { "const": "transfer", "type": "string" },
                            ],
                          },
                          "required": { "type": "boolean" },
                        },
                        "required": ["kind", "alias", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                    "surfaces": {
                      "items": {
                        "properties": {
                          "action": {
                            "anyOf": [
                              { "const": "call", "type": "string" },
                              { "const": "publish", "type": "string" },
                              { "const": "subscribe", "type": "string" },
                              { "const": "observe", "type": "string" },
                              { "const": "cancel", "type": "string" },
                            ],
                          },
                          "contractId": { "minLength": 1, "type": "string" },
                          "kind": {
                            "anyOf": [
                              { "const": "rpc", "type": "string" },
                              { "const": "operation", "type": "string" },
                              { "const": "event", "type": "string" },
                              { "const": "feed", "type": "string" },
                            ],
                          },
                          "name": { "minLength": 1, "type": "string" },
                          "required": { "type": "boolean" },
                        },
                        "required": ["contractId", "kind", "name", "required"],
                        "type": "object",
                      },
                      "type": "array",
                    },
                  },
                  "required": [
                    "contracts",
                    "surfaces",
                    "capabilities",
                    "resources",
                  ],
                  "type": "object",
                },
                "summary": { "type": "object" },
              },
              "required": [
                "deploymentId",
                "contractId",
                "contractDigest",
                "requestedNeeds",
                "providedSurfaces",
              ],
              "type": "object",
            },
            "state": {
              "anyOf": [
                { "const": "pending", "type": "string" },
                { "const": "accepted", "type": "string" },
                { "const": "rejected", "type": "string" },
                { "const": "expired", "type": "string" },
              ],
            },
            "warnings": {
              "items": { "minLength": 1, "type": "string" },
              "type": "array",
            },
          },
          "required": [
            "planId",
            "deploymentId",
            "proposal",
            "desiredChange",
            "materializationPreview",
            "warnings",
            "createdAt",
            "classification",
            "acknowledgementRequired",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityReconcileRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "desiredVersion": { "minLength": 1, "type": "string" },
  },
  "required": ["deploymentId"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityReconcileResponseSchema = {
  "properties": {
    "authority": {
      "properties": {
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "desiredState": {
          "properties": {
            "capabilities": {
              "items": { "minLength": 1, "type": "string" },
              "type": "array",
            },
            "needs": {
              "properties": {
                "capabilities": {
                  "items": {
                    "properties": {
                      "capability": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["capability", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "contracts": {
                  "items": {
                    "properties": {
                      "contractId": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["contractId", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "resources": {
                  "items": {
                    "properties": {
                      "alias": { "minLength": 1, "type": "string" },
                      "definition": { "type": "object" },
                      "kind": {
                        "anyOf": [
                          { "const": "kv", "type": "string" },
                          { "const": "store", "type": "string" },
                          { "const": "jobs", "type": "string" },
                          { "const": "event-consumer", "type": "string" },
                          { "const": "transfer", "type": "string" },
                        ],
                      },
                      "required": { "type": "boolean" },
                    },
                    "required": ["kind", "alias", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
                "surfaces": {
                  "items": {
                    "properties": {
                      "action": {
                        "anyOf": [
                          { "const": "call", "type": "string" },
                          { "const": "publish", "type": "string" },
                          { "const": "subscribe", "type": "string" },
                          { "const": "observe", "type": "string" },
                          { "const": "cancel", "type": "string" },
                        ],
                      },
                      "contractId": { "minLength": 1, "type": "string" },
                      "kind": {
                        "anyOf": [
                          { "const": "rpc", "type": "string" },
                          { "const": "operation", "type": "string" },
                          { "const": "event", "type": "string" },
                          { "const": "feed", "type": "string" },
                        ],
                      },
                      "name": { "minLength": 1, "type": "string" },
                      "required": { "type": "boolean" },
                    },
                    "required": ["contractId", "kind", "name", "required"],
                    "type": "object",
                  },
                  "type": "array",
                },
              },
              "required": [
                "contracts",
                "surfaces",
                "capabilities",
                "resources",
              ],
              "type": "object",
            },
            "resources": {
              "items": {
                "properties": {
                  "alias": { "minLength": 1, "type": "string" },
                  "definition": { "type": "object" },
                  "kind": {
                    "anyOf": [
                      { "const": "kv", "type": "string" },
                      { "const": "store", "type": "string" },
                      { "const": "jobs", "type": "string" },
                      { "const": "event-consumer", "type": "string" },
                      { "const": "transfer", "type": "string" },
                    ],
                  },
                  "required": { "type": "boolean" },
                },
                "required": ["kind", "alias", "required"],
                "type": "object",
              },
              "type": "array",
            },
            "surfaces": {
              "items": {
                "properties": {
                  "action": {
                    "anyOf": [
                      { "const": "call", "type": "string" },
                      { "const": "publish", "type": "string" },
                      { "const": "subscribe", "type": "string" },
                      { "const": "observe", "type": "string" },
                      { "const": "cancel", "type": "string" },
                    ],
                  },
                  "contractId": { "minLength": 1, "type": "string" },
                  "kind": {
                    "anyOf": [
                      { "const": "rpc", "type": "string" },
                      { "const": "operation", "type": "string" },
                      { "const": "event", "type": "string" },
                      { "const": "feed", "type": "string" },
                    ],
                  },
                  "name": { "minLength": 1, "type": "string" },
                },
                "required": ["contractId", "kind", "name"],
                "type": "object",
              },
              "type": "array",
            },
          },
          "required": ["needs", "capabilities", "resources", "surfaces"],
          "type": "object",
        },
        "disabled": { "type": "boolean" },
        "kind": {
          "anyOf": [
            { "const": "service", "type": "string" },
            { "const": "device", "type": "string" },
            { "const": "app", "type": "string" },
            { "const": "cli", "type": "string" },
            { "const": "native", "type": "string" },
            { "const": "device-user", "type": "string" },
          ],
        },
        "updatedAt": { "format": "date-time", "type": "string" },
        "version": { "minLength": 1, "type": "string" },
      },
      "required": [
        "deploymentId",
        "kind",
        "disabled",
        "desiredState",
        "version",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
    "materializedAuthority": {
      "properties": {
        "deploymentId": { "minLength": 1, "type": "string" },
        "desiredVersion": { "minLength": 1, "type": "string" },
        "error": { "minLength": 1, "type": "string" },
        "grants": {
          "properties": {
            "capabilities": {
              "items": {
                "properties": {
                  "capability": { "minLength": 1, "type": "string" },
                },
                "required": ["capability"],
                "type": "object",
              },
              "type": "array",
            },
            "nats": {
              "items": {
                "properties": {
                  "direction": {
                    "anyOf": [{ "const": "publish", "type": "string" }, {
                      "const": "subscribe",
                      "type": "string",
                    }],
                  },
                  "grantSource": {
                    "anyOf": [
                      { "const": "owned-surface", "type": "string" },
                      { "const": "used-surface", "type": "string" },
                      { "const": "resource-binding", "type": "string" },
                      { "const": "platform-service", "type": "string" },
                      { "const": "transfer", "type": "string" },
                    ],
                  },
                  "requiredCapabilities": {
                    "items": { "minLength": 1, "type": "string" },
                    "type": "array",
                  },
                  "subject": { "minLength": 1, "type": "string" },
                  "surface": {
                    "properties": {
                      "action": {
                        "anyOf": [
                          { "const": "call", "type": "string" },
                          { "const": "publish", "type": "string" },
                          { "const": "subscribe", "type": "string" },
                          { "const": "observe", "type": "string" },
                          { "const": "cancel", "type": "string" },
                        ],
                      },
                      "contractId": { "minLength": 1, "type": "string" },
                      "kind": {
                        "anyOf": [
                          { "const": "rpc", "type": "string" },
                          { "const": "operation", "type": "string" },
                          { "const": "event", "type": "string" },
                          { "const": "feed", "type": "string" },
                        ],
                      },
                      "name": { "minLength": 1, "type": "string" },
                    },
                    "required": ["contractId", "kind", "name"],
                    "type": "object",
                  },
                },
                "required": [
                  "direction",
                  "subject",
                  "requiredCapabilities",
                  "grantSource",
                ],
                "type": "object",
              },
              "type": "array",
            },
            "surfaces": {
              "items": {
                "properties": {
                  "action": {
                    "anyOf": [
                      { "const": "call", "type": "string" },
                      { "const": "publish", "type": "string" },
                      { "const": "subscribe", "type": "string" },
                      { "const": "observe", "type": "string" },
                      { "const": "cancel", "type": "string" },
                    ],
                  },
                  "contractId": { "minLength": 1, "type": "string" },
                  "name": { "minLength": 1, "type": "string" },
                  "surfaceKind": {
                    "anyOf": [
                      { "const": "rpc", "type": "string" },
                      { "const": "operation", "type": "string" },
                      { "const": "event", "type": "string" },
                      { "const": "feed", "type": "string" },
                    ],
                  },
                },
                "required": ["contractId", "surfaceKind", "name"],
                "type": "object",
              },
              "type": "array",
            },
          },
          "required": ["capabilities", "surfaces", "nats"],
          "type": "object",
        },
        "reconciledAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "resourceBindings": {
          "items": {
            "properties": {
              "alias": { "minLength": 1, "type": "string" },
              "binding": {
                "patternProperties": { "^.*$": {} },
                "type": "object",
              },
              "createdAt": { "format": "date-time", "type": "string" },
              "deploymentId": { "minLength": 1, "type": "string" },
              "kind": {
                "anyOf": [
                  { "const": "kv", "type": "string" },
                  { "const": "store", "type": "string" },
                  { "const": "jobs", "type": "string" },
                  { "const": "event-consumer", "type": "string" },
                  { "const": "transfer", "type": "string" },
                ],
              },
              "limits": {
                "anyOf": [{
                  "patternProperties": { "^.*$": {} },
                  "type": "object",
                }, { "type": "null" }],
              },
              "updatedAt": { "format": "date-time", "type": "string" },
            },
            "required": [
              "deploymentId",
              "kind",
              "alias",
              "binding",
              "limits",
              "createdAt",
              "updatedAt",
            ],
            "type": "object",
          },
          "type": "array",
        },
        "status": {
          "anyOf": [{ "const": "current", "type": "string" }, {
            "const": "pending",
            "type": "string",
          }, { "const": "failed", "type": "string" }],
        },
      },
      "required": [
        "deploymentId",
        "desiredVersion",
        "status",
        "resourceBindings",
        "grants",
        "reconciledAt",
      ],
      "type": "object",
    },
    "reconciliation": {
      "properties": {
        "deploymentId": { "minLength": 1, "type": "string" },
        "desiredVersion": { "minLength": 1, "type": "string" },
        "finishedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "message": { "minLength": 1, "type": "string" },
        "startedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "state": {
          "anyOf": [
            { "const": "idle", "type": "string" },
            { "const": "running", "type": "string" },
            { "const": "succeeded", "type": "string" },
            { "const": "failed", "type": "string" },
          ],
        },
      },
      "required": [
        "deploymentId",
        "desiredVersion",
        "state",
        "startedAt",
        "finishedAt",
      ],
      "type": "object",
    },
  },
  "required": ["authority", "materializedAuthority"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityRejectRequestSchema = {
  "properties": {
    "planId": { "minLength": 1, "type": "string" },
    "reason": { "minLength": 1, "type": "string" },
  },
  "required": ["planId"],
  "type": "object",
} as const;

export const AuthDeploymentAuthorityRejectResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthDeploymentsCreateRequestSchema = {
  "anyOf": [{
    "properties": {
      "contractCompatibilityMode": {
        "anyOf": [{ "const": "strict", "type": "string" }, {
          "const": "mutable-dev",
          "type": "string",
        }],
      },
      "deploymentId": { "minLength": 1, "type": "string" },
      "kind": { "const": "service", "type": "string" },
      "namespaces": {
        "items": { "minLength": 1, "type": "string" },
        "type": "array",
      },
    },
    "required": ["kind", "deploymentId", "namespaces"],
    "type": "object",
  }, {
    "properties": {
      "deploymentId": { "minLength": 1, "type": "string" },
      "kind": { "const": "device", "type": "string" },
      "reviewMode": {
        "anyOf": [{ "const": "none", "type": "string" }, {
          "const": "required",
          "type": "string",
        }],
      },
    },
    "required": ["kind", "deploymentId"],
    "type": "object",
  }],
} as const;

export const AuthDeploymentsCreateResponseSchema = {
  "properties": {
    "deployment": {
      "anyOf": [{
        "properties": {
          "contractCompatibilityMode": {
            "anyOf": [{ "const": "strict", "type": "string" }, {
              "const": "mutable-dev",
              "type": "string",
            }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "kind": { "const": "service", "type": "string" },
          "namespaces": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": ["kind", "deploymentId", "namespaces", "disabled"],
        "type": "object",
      }, {
        "properties": {
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "kind": { "const": "device", "type": "string" },
          "reviewMode": {
            "anyOf": [{ "const": "none", "type": "string" }, {
              "const": "required",
              "type": "string",
            }],
          },
        },
        "required": ["kind", "deploymentId", "disabled"],
        "type": "object",
      }],
    },
  },
  "required": ["deployment"],
  "type": "object",
} as const;

export const AuthDeploymentsDisableRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "kind": {
      "anyOf": [{ "const": "service", "type": "string" }, {
        "const": "device",
        "type": "string",
      }],
    },
  },
  "required": ["kind", "deploymentId"],
  "type": "object",
} as const;

export const AuthDeploymentsDisableResponseSchema = {
  "properties": {
    "deployment": {
      "anyOf": [{
        "properties": {
          "contractCompatibilityMode": {
            "anyOf": [{ "const": "strict", "type": "string" }, {
              "const": "mutable-dev",
              "type": "string",
            }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "kind": { "const": "service", "type": "string" },
          "namespaces": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": ["kind", "deploymentId", "namespaces", "disabled"],
        "type": "object",
      }, {
        "properties": {
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "kind": { "const": "device", "type": "string" },
          "reviewMode": {
            "anyOf": [{ "const": "none", "type": "string" }, {
              "const": "required",
              "type": "string",
            }],
          },
        },
        "required": ["kind", "deploymentId", "disabled"],
        "type": "object",
      }],
    },
  },
  "required": ["deployment"],
  "type": "object",
} as const;

export const AuthDeploymentsEnableRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "kind": {
      "anyOf": [{ "const": "service", "type": "string" }, {
        "const": "device",
        "type": "string",
      }],
    },
  },
  "required": ["kind", "deploymentId"],
  "type": "object",
} as const;

export const AuthDeploymentsEnableResponseSchema = {
  "properties": {
    "deployment": {
      "anyOf": [{
        "properties": {
          "contractCompatibilityMode": {
            "anyOf": [{ "const": "strict", "type": "string" }, {
              "const": "mutable-dev",
              "type": "string",
            }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "kind": { "const": "service", "type": "string" },
          "namespaces": {
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          },
        },
        "required": ["kind", "deploymentId", "namespaces", "disabled"],
        "type": "object",
      }, {
        "properties": {
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "kind": { "const": "device", "type": "string" },
          "reviewMode": {
            "anyOf": [{ "const": "none", "type": "string" }, {
              "const": "required",
              "type": "string",
            }],
          },
        },
        "required": ["kind", "deploymentId", "disabled"],
        "type": "object",
      }],
    },
  },
  "required": ["deployment"],
  "type": "object",
} as const;

export const AuthDeploymentsListRequestSchema = {
  "properties": {
    "disabled": { "type": "boolean" },
    "kind": {
      "anyOf": [{ "const": "service", "type": "string" }, {
        "const": "device",
        "type": "string",
      }],
    },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDeploymentsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "anyOf": [{
          "properties": {
            "contractCompatibilityMode": {
              "anyOf": [{ "const": "strict", "type": "string" }, {
                "const": "mutable-dev",
                "type": "string",
              }],
            },
            "deploymentId": { "minLength": 1, "type": "string" },
            "disabled": { "type": "boolean" },
            "kind": { "const": "service", "type": "string" },
            "namespaces": {
              "items": { "minLength": 1, "type": "string" },
              "type": "array",
            },
          },
          "required": ["kind", "deploymentId", "namespaces", "disabled"],
          "type": "object",
        }, {
          "properties": {
            "deploymentId": { "minLength": 1, "type": "string" },
            "disabled": { "type": "boolean" },
            "kind": { "const": "device", "type": "string" },
            "reviewMode": {
              "anyOf": [{ "const": "none", "type": "string" }, {
                "const": "required",
                "type": "string",
              }],
            },
          },
          "required": ["kind", "deploymentId", "disabled"],
          "type": "object",
        }],
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDeploymentsRemoveRequestSchema = {
  "properties": {
    "cascade": { "type": "boolean" },
    "deploymentId": { "minLength": 1, "type": "string" },
    "kind": {
      "anyOf": [{ "const": "service", "type": "string" }, {
        "const": "device",
        "type": "string",
      }],
    },
    "purgeUnusedContracts": { "type": "boolean" },
  },
  "required": ["kind", "deploymentId"],
  "type": "object",
} as const;

export const AuthDeploymentsRemoveResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesApprovedEventSchema = {
  "properties": {
    "approvedAt": { "format": "date-time", "type": "string" },
    "approvedBy": {
      "properties": {
        "identity": {
          "properties": {
            "identityId": { "minLength": 1, "type": "string" },
            "provider": { "minLength": 1, "type": "string" },
            "subject": { "minLength": 1, "type": "string" },
          },
          "required": ["identityId", "provider", "subject"],
          "type": "object",
        },
        "participantKind": {
          "anyOf": [{ "const": "app", "type": "string" }, {
            "const": "agent",
            "type": "string",
          }],
        },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": ["participantKind", "userId", "identity"],
      "type": "object",
    },
    "deploymentId": { "minLength": 1, "type": "string" },
    "flowId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "publicIdentityKey": { "minLength": 1, "type": "string" },
    "requestedAt": { "format": "date-time", "type": "string" },
    "requestedBy": {
      "properties": {
        "identity": {
          "properties": {
            "identityId": { "minLength": 1, "type": "string" },
            "provider": { "minLength": 1, "type": "string" },
            "subject": { "minLength": 1, "type": "string" },
          },
          "required": ["identityId", "provider", "subject"],
          "type": "object",
        },
        "participantKind": {
          "anyOf": [{ "const": "app", "type": "string" }, {
            "const": "agent",
            "type": "string",
          }],
        },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": ["participantKind", "userId", "identity"],
      "type": "object",
    },
    "reviewId": { "minLength": 1, "type": "string" },
  },
  "required": [
    "reviewId",
    "flowId",
    "instanceId",
    "publicIdentityKey",
    "deploymentId",
    "requestedAt",
    "approvedAt",
    "requestedBy",
    "approvedBy",
  ],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesListRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "state": {
      "anyOf": [{ "const": "activated", "type": "string" }, {
        "const": "revoked",
        "type": "string",
      }],
    },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "activatedAt": { "format": "date-time", "type": "string" },
          "activatedBy": {
            "properties": {
              "identity": {
                "properties": {
                  "identityId": { "minLength": 1, "type": "string" },
                  "provider": { "minLength": 1, "type": "string" },
                  "subject": { "minLength": 1, "type": "string" },
                },
                "required": ["identityId", "provider", "subject"],
                "type": "object",
              },
              "participantKind": {
                "anyOf": [{ "const": "app", "type": "string" }, {
                  "const": "agent",
                  "type": "string",
                }],
              },
              "userId": { "minLength": 1, "type": "string" },
            },
            "required": ["participantKind", "userId", "identity"],
            "type": "object",
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "instanceId": { "minLength": 1, "type": "string" },
          "publicIdentityKey": { "minLength": 1, "type": "string" },
          "revokedAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "state": {
            "anyOf": [{ "const": "activated", "type": "string" }, {
              "const": "revoked",
              "type": "string",
            }],
          },
        },
        "required": [
          "instanceId",
          "publicIdentityKey",
          "deploymentId",
          "state",
          "activatedAt",
          "revokedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesRequestedEventSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "flowId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "publicIdentityKey": { "minLength": 1, "type": "string" },
    "requestedAt": { "format": "date-time", "type": "string" },
    "requestedBy": {
      "properties": {
        "identity": {
          "properties": {
            "identityId": { "minLength": 1, "type": "string" },
            "provider": { "minLength": 1, "type": "string" },
            "subject": { "minLength": 1, "type": "string" },
          },
          "required": ["identityId", "provider", "subject"],
          "type": "object",
        },
        "participantKind": {
          "anyOf": [{ "const": "app", "type": "string" }, {
            "const": "agent",
            "type": "string",
          }],
        },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": ["participantKind", "userId", "identity"],
      "type": "object",
    },
  },
  "required": [
    "flowId",
    "instanceId",
    "publicIdentityKey",
    "deploymentId",
    "requestedAt",
    "requestedBy",
  ],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesResolvedEventSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "flowId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "publicIdentityKey": { "minLength": 1, "type": "string" },
    "resolvedAt": { "format": "date-time", "type": "string" },
    "resolvedBy": {
      "properties": {
        "identity": {
          "properties": {
            "identityId": { "minLength": 1, "type": "string" },
            "provider": { "minLength": 1, "type": "string" },
            "subject": { "minLength": 1, "type": "string" },
          },
          "required": ["identityId", "provider", "subject"],
          "type": "object",
        },
        "participantKind": {
          "anyOf": [{ "const": "app", "type": "string" }, {
            "const": "agent",
            "type": "string",
          }],
        },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": ["participantKind", "userId", "identity"],
      "type": "object",
    },
    "reviewId": { "minLength": 1, "type": "string" },
  },
  "required": [
    "instanceId",
    "publicIdentityKey",
    "deploymentId",
    "resolvedAt",
    "resolvedBy",
  ],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesReviewRequestedEventSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "flowId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "publicIdentityKey": { "minLength": 1, "type": "string" },
    "requestedAt": { "format": "date-time", "type": "string" },
    "requestedBy": {
      "properties": {
        "identity": {
          "properties": {
            "identityId": { "minLength": 1, "type": "string" },
            "provider": { "minLength": 1, "type": "string" },
            "subject": { "minLength": 1, "type": "string" },
          },
          "required": ["identityId", "provider", "subject"],
          "type": "object",
        },
        "participantKind": {
          "anyOf": [{ "const": "app", "type": "string" }, {
            "const": "agent",
            "type": "string",
          }],
        },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": ["participantKind", "userId", "identity"],
      "type": "object",
    },
    "reviewId": { "minLength": 1, "type": "string" },
  },
  "required": [
    "reviewId",
    "flowId",
    "instanceId",
    "publicIdentityKey",
    "deploymentId",
    "requestedAt",
    "requestedBy",
  ],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesReviewsDecideRequestSchema = {
  "properties": {
    "decision": {
      "anyOf": [{ "const": "approve", "type": "string" }, {
        "const": "reject",
        "type": "string",
      }],
    },
    "reason": { "minLength": 1, "type": "string" },
    "reviewId": { "minLength": 1, "type": "string" },
  },
  "required": ["reviewId", "decision"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesReviewsDecideResponseSchema = {
  "properties": {
    "activation": {
      "properties": {
        "activatedAt": { "format": "date-time", "type": "string" },
        "activatedBy": {
          "properties": {
            "identity": {
              "properties": {
                "identityId": { "minLength": 1, "type": "string" },
                "provider": { "minLength": 1, "type": "string" },
                "subject": { "minLength": 1, "type": "string" },
              },
              "required": ["identityId", "provider", "subject"],
              "type": "object",
            },
            "participantKind": {
              "anyOf": [{ "const": "app", "type": "string" }, {
                "const": "agent",
                "type": "string",
              }],
            },
            "userId": { "minLength": 1, "type": "string" },
          },
          "required": ["participantKind", "userId", "identity"],
          "type": "object",
        },
        "deploymentId": { "minLength": 1, "type": "string" },
        "instanceId": { "minLength": 1, "type": "string" },
        "publicIdentityKey": { "minLength": 1, "type": "string" },
        "revokedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "state": {
          "anyOf": [{ "const": "activated", "type": "string" }, {
            "const": "revoked",
            "type": "string",
          }],
        },
      },
      "required": [
        "instanceId",
        "publicIdentityKey",
        "deploymentId",
        "state",
        "activatedAt",
        "revokedAt",
      ],
      "type": "object",
    },
    "confirmationCode": { "minLength": 1, "type": "string" },
    "review": {
      "properties": {
        "decidedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "deploymentId": { "minLength": 1, "type": "string" },
        "instanceId": { "minLength": 1, "type": "string" },
        "publicIdentityKey": { "minLength": 1, "type": "string" },
        "reason": { "minLength": 1, "type": "string" },
        "requestedAt": { "format": "date-time", "type": "string" },
        "reviewId": { "minLength": 1, "type": "string" },
        "state": {
          "anyOf": [{ "const": "pending", "type": "string" }, {
            "const": "approved",
            "type": "string",
          }, { "const": "rejected", "type": "string" }],
        },
      },
      "required": [
        "reviewId",
        "instanceId",
        "publicIdentityKey",
        "deploymentId",
        "state",
        "requestedAt",
        "decidedAt",
      ],
      "type": "object",
    },
  },
  "required": ["review"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesReviewsListRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "state": {
      "anyOf": [{ "const": "pending", "type": "string" }, {
        "const": "approved",
        "type": "string",
      }, { "const": "rejected", "type": "string" }],
    },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesReviewsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "decidedAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "deploymentId": { "minLength": 1, "type": "string" },
          "instanceId": { "minLength": 1, "type": "string" },
          "publicIdentityKey": { "minLength": 1, "type": "string" },
          "reason": { "minLength": 1, "type": "string" },
          "requestedAt": { "format": "date-time", "type": "string" },
          "reviewId": { "minLength": 1, "type": "string" },
          "state": {
            "anyOf": [{ "const": "pending", "type": "string" }, {
              "const": "approved",
              "type": "string",
            }, { "const": "rejected", "type": "string" }],
          },
        },
        "required": [
          "reviewId",
          "instanceId",
          "publicIdentityKey",
          "deploymentId",
          "state",
          "requestedAt",
          "decidedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesRevokeRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthDeviceUserAuthoritiesRevokeResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthDevicesConnectInfoGetRequestSchema = {
  "properties": {
    "contractDigest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
    "iat": { "type": "number" },
    "publicIdentityKey": { "minLength": 1, "type": "string" },
    "sig": { "minLength": 1, "type": "string" },
  },
  "required": ["publicIdentityKey", "contractDigest", "iat", "sig"],
  "type": "object",
} as const;

export const AuthDevicesConnectInfoGetResponseSchema = {
  "properties": {
    "connectInfo": {
      "properties": {
        "auth": {
          "properties": {
            "authority": {
              "anyOf": [{ "const": "admin_reviewed", "type": "string" }, {
                "const": "user_delegated",
                "type": "string",
              }],
            },
            "iatSkewSeconds": { "type": "number" },
            "mode": { "const": "device_identity", "type": "string" },
          },
          "required": ["mode", "authority", "iatSkewSeconds"],
          "type": "object",
        },
        "contractDigest": { "pattern": "^[A-Za-z0-9_-]+$", "type": "string" },
        "contractId": { "minLength": 1, "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "instanceId": { "minLength": 1, "type": "string" },
        "transport": {
          "properties": {
            "sentinel": {
              "properties": {
                "jwt": { "type": "string" },
                "seed": { "type": "string" },
              },
              "required": ["jwt", "seed"],
              "type": "object",
            },
          },
          "required": ["sentinel"],
          "type": "object",
        },
        "transports": {
          "properties": {
            "native": {
              "properties": {
                "natsServers": {
                  "items": { "minLength": 1, "type": "string" },
                  "minItems": 1,
                  "type": "array",
                },
              },
              "required": ["natsServers"],
              "type": "object",
            },
            "websocket": {
              "properties": {
                "natsServers": {
                  "items": { "minLength": 1, "type": "string" },
                  "minItems": 1,
                  "type": "array",
                },
              },
              "required": ["natsServers"],
              "type": "object",
            },
          },
          "type": "object",
        },
      },
      "required": [
        "instanceId",
        "deploymentId",
        "contractId",
        "contractDigest",
        "transports",
        "transport",
        "auth",
      ],
      "type": "object",
    },
    "status": { "const": "ready", "type": "string" },
  },
  "required": ["status", "connectInfo"],
  "type": "object",
} as const;

export const AuthDevicesDisableRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthDevicesDisableResponseSchema = {
  "properties": {
    "instance": {
      "properties": {
        "activatedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "instanceId": { "minLength": 1, "type": "string" },
        "metadata": {
          "patternProperties": { "^.*$": { "minLength": 1, "type": "string" } },
          "type": "object",
        },
        "publicIdentityKey": { "minLength": 1, "type": "string" },
        "revokedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "state": {
          "anyOf": [
            { "const": "registered", "type": "string" },
            { "const": "activated", "type": "string" },
            { "const": "revoked", "type": "string" },
            { "const": "disabled", "type": "string" },
          ],
        },
      },
      "required": [
        "instanceId",
        "publicIdentityKey",
        "deploymentId",
        "state",
        "createdAt",
        "activatedAt",
        "revokedAt",
      ],
      "type": "object",
    },
  },
  "required": ["instance"],
  "type": "object",
} as const;

export const AuthDevicesEnableRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthDevicesEnableResponseSchema = {
  "properties": {
    "instance": {
      "properties": {
        "activatedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "instanceId": { "minLength": 1, "type": "string" },
        "metadata": {
          "patternProperties": { "^.*$": { "minLength": 1, "type": "string" } },
          "type": "object",
        },
        "publicIdentityKey": { "minLength": 1, "type": "string" },
        "revokedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "state": {
          "anyOf": [
            { "const": "registered", "type": "string" },
            { "const": "activated", "type": "string" },
            { "const": "revoked", "type": "string" },
            { "const": "disabled", "type": "string" },
          ],
        },
      },
      "required": [
        "instanceId",
        "publicIdentityKey",
        "deploymentId",
        "state",
        "createdAt",
        "activatedAt",
        "revokedAt",
      ],
      "type": "object",
    },
  },
  "required": ["instance"],
  "type": "object",
} as const;

export const AuthDevicesListRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "state": {
      "anyOf": [
        { "const": "registered", "type": "string" },
        { "const": "activated", "type": "string" },
        { "const": "revoked", "type": "string" },
        { "const": "disabled", "type": "string" },
      ],
    },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthDevicesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "activatedAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "createdAt": { "format": "date-time", "type": "string" },
          "deploymentId": { "minLength": 1, "type": "string" },
          "instanceId": { "minLength": 1, "type": "string" },
          "metadata": {
            "patternProperties": {
              "^.*$": { "minLength": 1, "type": "string" },
            },
            "type": "object",
          },
          "publicIdentityKey": { "minLength": 1, "type": "string" },
          "revokedAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "state": {
            "anyOf": [
              { "const": "registered", "type": "string" },
              { "const": "activated", "type": "string" },
              { "const": "revoked", "type": "string" },
              { "const": "disabled", "type": "string" },
            ],
          },
        },
        "required": [
          "instanceId",
          "publicIdentityKey",
          "deploymentId",
          "state",
          "createdAt",
          "activatedAt",
          "revokedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthDevicesProvisionRequestSchema = {
  "properties": {
    "activationKey": { "minLength": 1, "type": "string" },
    "deploymentId": { "minLength": 1, "type": "string" },
    "metadata": {
      "patternProperties": { "^.*$": { "minLength": 1, "type": "string" } },
      "type": "object",
    },
    "publicIdentityKey": { "minLength": 1, "type": "string" },
  },
  "required": ["deploymentId", "publicIdentityKey", "activationKey"],
  "type": "object",
} as const;

export const AuthDevicesProvisionResponseSchema = {
  "properties": {
    "instance": {
      "properties": {
        "activatedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "instanceId": { "minLength": 1, "type": "string" },
        "metadata": {
          "patternProperties": { "^.*$": { "minLength": 1, "type": "string" } },
          "type": "object",
        },
        "publicIdentityKey": { "minLength": 1, "type": "string" },
        "revokedAt": {
          "anyOf": [{ "format": "date-time", "type": "string" }, {
            "type": "null",
          }],
        },
        "state": {
          "anyOf": [
            { "const": "registered", "type": "string" },
            { "const": "activated", "type": "string" },
            { "const": "revoked", "type": "string" },
            { "const": "disabled", "type": "string" },
          ],
        },
      },
      "required": [
        "instanceId",
        "publicIdentityKey",
        "deploymentId",
        "state",
        "createdAt",
        "activatedAt",
        "revokedAt",
      ],
      "type": "object",
    },
  },
  "required": ["instance"],
  "type": "object",
} as const;

export const AuthDevicesRemoveRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthDevicesRemoveResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthIdentitiesListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "user": { "minLength": 1, "type": "string" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthIdentitiesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "answer": {
            "anyOf": [{ "const": "approved", "type": "string" }, {
              "const": "denied",
              "type": "string",
            }],
          },
          "answeredAt": { "format": "date-time", "type": "string" },
          "capabilities": {
            "patternProperties": {
              "^.*$": {
                "properties": {
                  "consequence": { "type": "string" },
                  "description": { "type": "string" },
                  "displayName": { "type": "string" },
                },
                "required": ["displayName", "description"],
                "type": "object",
              },
            },
            "type": "object",
          },
          "contractEvidence": {
            "properties": {
              "contractDigest": {
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string",
              },
              "contractId": { "minLength": 1, "type": "string" },
            },
            "required": ["contractDigest", "contractId"],
            "type": "object",
          },
          "description": { "minLength": 1, "type": "string" },
          "displayName": { "minLength": 1, "type": "string" },
          "identityAnchor": {
            "anyOf": [{
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "kind": { "const": "web", "type": "string" },
                "origin": { "minLength": 1, "type": "string" },
              },
              "required": ["kind", "contractId", "origin"],
              "type": "object",
            }, {
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "kind": { "const": "cli", "type": "string" },
                "sessionPublicKey": { "minLength": 1, "type": "string" },
              },
              "required": ["kind", "contractId", "sessionPublicKey"],
              "type": "object",
            }, {
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "kind": { "const": "native", "type": "string" },
                "sessionPublicKey": { "minLength": 1, "type": "string" },
              },
              "required": ["kind", "contractId", "sessionPublicKey"],
              "type": "object",
            }, {
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "devicePublicKey": { "minLength": 1, "type": "string" },
                "kind": { "const": "device-user", "type": "string" },
              },
              "required": ["kind", "contractId", "devicePublicKey"],
              "type": "object",
            }],
          },
          "identityGrantId": { "minLength": 1, "type": "string" },
          "participantKind": {
            "anyOf": [{ "const": "app", "type": "string" }, {
              "const": "agent",
              "type": "string",
            }],
          },
          "updatedAt": { "format": "date-time", "type": "string" },
          "user": { "minLength": 1, "type": "string" },
        },
        "required": [
          "user",
          "answer",
          "answeredAt",
          "updatedAt",
          "identityGrantId",
          "identityAnchor",
          "contractEvidence",
          "displayName",
          "description",
          "capabilities",
          "participantKind",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthIdentityGrantsListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "user": { "minLength": 1, "type": "string" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthIdentityGrantsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "contractEvidence": {
            "properties": {
              "contractDigest": {
                "pattern": "^[A-Za-z0-9_-]+$",
                "type": "string",
              },
              "contractId": { "minLength": 1, "type": "string" },
            },
            "required": ["contractDigest", "contractId"],
            "type": "object",
          },
          "description": { "minLength": 1, "type": "string" },
          "displayName": { "minLength": 1, "type": "string" },
          "grantedAt": { "format": "date-time", "type": "string" },
          "identityAnchor": {
            "anyOf": [{
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "kind": { "const": "web", "type": "string" },
                "origin": { "minLength": 1, "type": "string" },
              },
              "required": ["kind", "contractId", "origin"],
              "type": "object",
            }, {
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "kind": { "const": "cli", "type": "string" },
                "sessionPublicKey": { "minLength": 1, "type": "string" },
              },
              "required": ["kind", "contractId", "sessionPublicKey"],
              "type": "object",
            }, {
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "kind": { "const": "native", "type": "string" },
                "sessionPublicKey": { "minLength": 1, "type": "string" },
              },
              "required": ["kind", "contractId", "sessionPublicKey"],
              "type": "object",
            }, {
              "properties": {
                "contractId": { "minLength": 1, "type": "string" },
                "devicePublicKey": { "minLength": 1, "type": "string" },
                "kind": { "const": "device-user", "type": "string" },
              },
              "required": ["kind", "contractId", "devicePublicKey"],
              "type": "object",
            }],
          },
          "identityGrantId": { "minLength": 1, "type": "string" },
          "participantKind": {
            "anyOf": [{ "const": "app", "type": "string" }, {
              "const": "agent",
              "type": "string",
            }],
          },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "identityGrantId",
          "identityAnchor",
          "contractEvidence",
          "displayName",
          "description",
          "participantKind",
          "capabilities",
          "grantedAt",
          "updatedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthIdentityGrantsRevokeRequestSchema = {
  "properties": {
    "identityGrantId": { "minLength": 1, "type": "string" },
    "user": { "minLength": 1, "type": "string" },
  },
  "required": ["identityGrantId"],
  "type": "object",
} as const;

export const AuthIdentityGrantsRevokeResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthPortalsGetRequestSchema = {
  "properties": { "portalId": { "minLength": 1, "type": "string" } },
  "required": ["portalId"],
  "type": "object",
} as const;

export const AuthPortalsGetResponseSchema = {
  "properties": {
    "defaultCapabilities": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "defaultCapabilityGroups": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "federatedProviders": {
      "items": {
        "properties": {
          "displayName": { "minLength": 1, "type": "string" },
          "id": { "minLength": 1, "type": "string" },
          "type": { "minLength": 1, "type": "string" },
        },
        "required": ["id", "displayName", "type"],
        "type": "object",
      },
      "type": "array",
    },
    "portal": {
      "properties": {
        "builtIn": { "type": "boolean" },
        "createdAt": { "format": "date-time", "type": "string" },
        "disabled": { "type": "boolean" },
        "displayName": { "minLength": 1, "type": "string" },
        "entryUrl": {
          "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
        },
        "portalId": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "portalId",
        "displayName",
        "entryUrl",
        "builtIn",
        "disabled",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
    "routes": {
      "items": {
        "properties": {
          "contractId": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "disabled": { "type": "boolean" },
          "origin": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "portalId": { "minLength": 1, "type": "string" },
          "routeKey": { "minLength": 1, "type": "string" },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "routeKey",
          "portalId",
          "contractId",
          "origin",
          "disabled",
          "updatedAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "settings": {
      "properties": {
        "allowedFederatedProviders": {
          "anyOf": [{
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          }, { "type": "null" }],
        },
        "federatedRegistrationEnabled": { "type": "boolean" },
        "localRegistrationEnabled": { "type": "boolean" },
        "portalId": { "minLength": 1, "type": "string" },
        "selfRegisteredAccountActive": { "type": "boolean" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "portalId",
        "localRegistrationEnabled",
        "federatedRegistrationEnabled",
        "allowedFederatedProviders",
        "selfRegisteredAccountActive",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": [
    "portal",
    "settings",
    "routes",
    "defaultCapabilities",
    "defaultCapabilityGroups",
    "federatedProviders",
  ],
  "type": "object",
} as const;

export const AuthPortalsListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthPortalsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "activeRouteCount": { "minimum": 0, "type": "integer" },
          "builtIn": { "type": "boolean" },
          "createdAt": { "format": "date-time", "type": "string" },
          "disabled": { "type": "boolean" },
          "displayName": { "minLength": 1, "type": "string" },
          "entryUrl": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "portalId": { "minLength": 1, "type": "string" },
          "routeCount": { "minimum": 0, "type": "integer" },
          "updatedAt": { "format": "date-time", "type": "string" },
        },
        "required": [
          "portalId",
          "displayName",
          "entryUrl",
          "builtIn",
          "disabled",
          "createdAt",
          "updatedAt",
          "routeCount",
          "activeRouteCount",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthPortalsLoginSettingsGetRequestSchema = {
  "properties": { "portalId": { "minLength": 1, "type": "string" } },
  "required": ["portalId"],
  "type": "object",
} as const;

export const AuthPortalsLoginSettingsResponseSchema = {
  "properties": {
    "defaultCapabilities": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "defaultCapabilityGroups": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "federatedProviders": {
      "items": {
        "properties": {
          "displayName": { "minLength": 1, "type": "string" },
          "id": { "minLength": 1, "type": "string" },
          "type": { "minLength": 1, "type": "string" },
        },
        "required": ["id", "displayName", "type"],
        "type": "object",
      },
      "type": "array",
    },
    "portal": {
      "properties": {
        "builtIn": { "type": "boolean" },
        "createdAt": { "format": "date-time", "type": "string" },
        "disabled": { "type": "boolean" },
        "displayName": { "minLength": 1, "type": "string" },
        "entryUrl": {
          "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
        },
        "portalId": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "portalId",
        "displayName",
        "entryUrl",
        "builtIn",
        "disabled",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
    "settings": {
      "properties": {
        "allowedFederatedProviders": {
          "anyOf": [{
            "items": { "minLength": 1, "type": "string" },
            "type": "array",
          }, { "type": "null" }],
        },
        "federatedRegistrationEnabled": { "type": "boolean" },
        "localRegistrationEnabled": { "type": "boolean" },
        "portalId": { "minLength": 1, "type": "string" },
        "selfRegisteredAccountActive": { "type": "boolean" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "portalId",
        "localRegistrationEnabled",
        "federatedRegistrationEnabled",
        "allowedFederatedProviders",
        "selfRegisteredAccountActive",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": [
    "portal",
    "settings",
    "defaultCapabilities",
    "defaultCapabilityGroups",
    "federatedProviders",
  ],
  "type": "object",
} as const;

export const AuthPortalsLoginSettingsUpdateRequestSchema = {
  "properties": {
    "allowedFederatedProviders": {
      "anyOf": [{
        "items": { "minLength": 1, "type": "string" },
        "type": "array",
      }, { "type": "null" }],
    },
    "defaultCapabilities": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "defaultCapabilityGroups": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "federatedRegistrationEnabled": { "type": "boolean" },
    "localRegistrationEnabled": { "type": "boolean" },
    "portalId": { "minLength": 1, "type": "string" },
    "selfRegisteredAccountActive": { "type": "boolean" },
  },
  "required": [
    "portalId",
    "localRegistrationEnabled",
    "federatedRegistrationEnabled",
    "allowedFederatedProviders",
    "selfRegisteredAccountActive",
    "defaultCapabilities",
    "defaultCapabilityGroups",
  ],
  "type": "object",
} as const;

export const AuthPortalsPutRequestSchema = {
  "properties": {
    "disabled": { "type": "boolean" },
    "displayName": { "minLength": 1, "type": "string" },
    "entryUrl": { "minLength": 1, "type": "string" },
    "portalId": { "minLength": 1, "type": "string" },
  },
  "required": ["portalId", "displayName", "entryUrl"],
  "type": "object",
} as const;

export const AuthPortalsPutResponseSchema = {
  "properties": {
    "portal": {
      "properties": {
        "builtIn": { "type": "boolean" },
        "createdAt": { "format": "date-time", "type": "string" },
        "disabled": { "type": "boolean" },
        "displayName": { "minLength": 1, "type": "string" },
        "entryUrl": {
          "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
        },
        "portalId": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "portalId",
        "displayName",
        "entryUrl",
        "builtIn",
        "disabled",
        "createdAt",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": ["portal"],
  "type": "object",
} as const;

export const AuthPortalsRemoveRequestSchema = {
  "properties": { "portalId": { "minLength": 1, "type": "string" } },
  "required": ["portalId"],
  "type": "object",
} as const;

export const AuthPortalsRemoveResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthPortalsRoutesPutRequestSchema = {
  "properties": {
    "contractId": {
      "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
    },
    "disabled": { "type": "boolean" },
    "origin": {
      "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
    },
    "portalId": { "minLength": 1, "type": "string" },
  },
  "required": ["portalId"],
  "type": "object",
} as const;

export const AuthPortalsRoutesPutResponseSchema = {
  "properties": {
    "route": {
      "properties": {
        "contractId": {
          "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
        },
        "disabled": { "type": "boolean" },
        "origin": {
          "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
        },
        "portalId": { "minLength": 1, "type": "string" },
        "routeKey": { "minLength": 1, "type": "string" },
        "updatedAt": { "format": "date-time", "type": "string" },
      },
      "required": [
        "routeKey",
        "portalId",
        "contractId",
        "origin",
        "disabled",
        "updatedAt",
      ],
      "type": "object",
    },
  },
  "required": ["route"],
  "type": "object",
} as const;

export const AuthPortalsRoutesRemoveRequestSchema = {
  "properties": {
    "contractId": {
      "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
    },
    "origin": {
      "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
    },
    "portalId": { "minLength": 1, "type": "string" },
  },
  "required": ["portalId"],
  "type": "object",
} as const;

export const AuthPortalsRoutesRemoveResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthRequestsValidateRequestSchema = {
  "properties": {
    "capabilities": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "iat": { "type": "integer" },
    "payloadHash": { "minLength": 1, "type": "string" },
    "proof": { "minLength": 1, "type": "string" },
    "requestId": { "minLength": 1, "type": "string" },
    "sessionKey": { "minLength": 1, "type": "string" },
    "subject": { "minLength": 1, "type": "string" },
  },
  "required": [
    "sessionKey",
    "proof",
    "subject",
    "payloadHash",
    "iat",
    "requestId",
  ],
  "type": "object",
} as const;

export const AuthRequestsValidateResponseSchema = {
  "properties": {
    "allowed": { "type": "boolean" },
    "caller": {
      "anyOf": [{
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "email": { "type": "string" },
          "identity": {
            "properties": {
              "identityId": { "minLength": 1, "type": "string" },
              "provider": { "minLength": 1, "type": "string" },
              "subject": { "minLength": 1, "type": "string" },
            },
            "required": ["identityId", "provider", "subject"],
            "type": "object",
          },
          "image": { "type": "string" },
          "lastAuth": { "format": "date-time", "type": "string" },
          "name": { "type": "string" },
          "participantKind": {
            "anyOf": [{ "const": "app", "type": "string" }, {
              "const": "agent",
              "type": "string",
            }],
          },
          "type": { "const": "user", "type": "string" },
          "userId": { "minLength": 1, "type": "string" },
        },
        "required": [
          "type",
          "participantKind",
          "userId",
          "identity",
          "active",
          "name",
          "email",
          "capabilities",
          "lastAuth",
        ],
        "type": "object",
      }, {
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "id": { "type": "string" },
          "name": { "type": "string" },
          "type": { "const": "service", "type": "string" },
        },
        "required": ["type", "id", "name", "active", "capabilities"],
        "type": "object",
      }, {
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "deploymentId": { "minLength": 1, "type": "string" },
          "deviceId": { "minLength": 1, "type": "string" },
          "deviceType": { "minLength": 1, "type": "string" },
          "runtimePublicKey": { "minLength": 1, "type": "string" },
          "type": { "const": "device", "type": "string" },
        },
        "required": [
          "type",
          "deviceId",
          "deviceType",
          "runtimePublicKey",
          "deploymentId",
          "active",
          "capabilities",
        ],
        "type": "object",
      }],
    },
    "inboxPrefix": { "type": "string" },
  },
  "required": ["allowed", "inboxPrefix", "caller"],
  "type": "object",
} as const;

export const AuthResolveDeviceUserAuthoritiesProgressSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "instanceId": { "minLength": 1, "type": "string" },
    "requestedAt": { "format": "date-time", "type": "string" },
    "reviewId": { "minLength": 1, "type": "string" },
    "status": { "const": "pending_review", "type": "string" },
  },
  "required": [
    "status",
    "reviewId",
    "instanceId",
    "deploymentId",
    "requestedAt",
  ],
  "type": "object",
} as const;

export const AuthResolveDeviceUserAuthoritiesRequestSchema = {
  "properties": { "flowId": { "minLength": 1, "type": "string" } },
  "required": ["flowId"],
  "type": "object",
} as const;

export const AuthResolveDeviceUserAuthoritiesResponseSchema = {
  "anyOf": [{
    "properties": {
      "activatedAt": { "format": "date-time", "type": "string" },
      "confirmationCode": { "minLength": 1, "type": "string" },
      "deploymentId": { "minLength": 1, "type": "string" },
      "instanceId": { "minLength": 1, "type": "string" },
      "status": { "const": "activated", "type": "string" },
    },
    "required": ["status", "instanceId", "deploymentId", "activatedAt"],
    "type": "object",
  }, {
    "properties": {
      "reason": { "minLength": 1, "type": "string" },
      "status": { "const": "rejected", "type": "string" },
    },
    "required": ["status"],
    "type": "object",
  }],
} as const;

export const AuthServiceInstancesDisableRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthServiceInstancesDisableResponseSchema = {
  "properties": {
    "instance": {
      "properties": {
        "capabilities": { "items": { "type": "string" }, "type": "array" },
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "disabled": { "type": "boolean" },
        "instanceId": { "minLength": 1, "type": "string" },
        "instanceKey": { "minLength": 1, "type": "string" },
        "resourceBindings": {
          "properties": {
            "eventConsumers": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "ackWaitMs": { "minimum": 1, "type": "integer" },
                    "backoffMs": {
                      "items": { "minimum": 0, "type": "integer" },
                      "type": "array",
                    },
                    "concurrency": { "minimum": 1, "type": "integer" },
                    "consumerName": { "minLength": 1, "type": "string" },
                    "filterSubjects": {
                      "items": { "minLength": 1, "type": "string" },
                      "type": "array",
                    },
                    "maxDeliver": { "minimum": 1, "type": "integer" },
                    "ordering": { "const": "strict", "type": "string" },
                    "replay": {
                      "anyOf": [{ "const": "new", "type": "string" }, {
                        "const": "all",
                        "type": "string",
                      }],
                    },
                    "stream": { "minLength": 1, "type": "string" },
                  },
                  "required": [
                    "stream",
                    "consumerName",
                    "filterSubjects",
                    "replay",
                    "ordering",
                    "concurrency",
                    "ackWaitMs",
                    "maxDeliver",
                    "backoffMs",
                  ],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "jobs": {
              "properties": {
                "namespace": { "minLength": 1, "type": "string" },
                "queues": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "ackWaitMs": { "minimum": 1, "type": "integer" },
                        "backoffMs": {
                          "items": { "minimum": 0, "type": "integer" },
                          "type": "array",
                        },
                        "concurrency": { "minimum": 1, "type": "integer" },
                        "consumerName": { "minLength": 1, "type": "string" },
                        "defaultDeadlineMs": {
                          "minimum": 1,
                          "type": "integer",
                        },
                        "dlq": { "type": "boolean" },
                        "keyConcurrency": {
                          "properties": {
                            "heartbeatIntervalMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "heartbeatTtlMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "key": {
                              "items": { "minLength": 1, "type": "string" },
                              "minItems": 1,
                              "type": "array",
                            },
                            "maxActive": { "minimum": 1, "type": "integer" },
                            "stalePolicy": {
                              "anyOf": [{
                                "const": "fail-stale",
                                "type": "string",
                              }, { "const": "block", "type": "string" }],
                            },
                          },
                          "required": [
                            "key",
                            "maxActive",
                            "heartbeatIntervalMs",
                            "heartbeatTtlMs",
                            "stalePolicy",
                          ],
                          "type": "object",
                        },
                        "logs": { "type": "boolean" },
                        "maxDeliver": { "minimum": 1, "type": "integer" },
                        "payload": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "progress": { "type": "boolean" },
                        "publishPrefix": { "minLength": 1, "type": "string" },
                        "queue": {
                          "properties": {
                            "maxQueuedPerKey": {
                              "minimum": 0,
                              "type": "integer",
                            },
                            "whenFull": {
                              "anyOf": [
                                { "const": "reject", "type": "string" },
                                { "const": "coalesce", "type": "string" },
                                { "const": "replace-oldest", "type": "string" },
                              ],
                            },
                          },
                          "required": ["maxQueuedPerKey", "whenFull"],
                          "type": "object",
                        },
                        "queueType": { "minLength": 1, "type": "string" },
                        "result": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "workSubject": { "minLength": 1, "type": "string" },
                      },
                      "required": [
                        "queueType",
                        "publishPrefix",
                        "workSubject",
                        "consumerName",
                        "payload",
                        "maxDeliver",
                        "backoffMs",
                        "ackWaitMs",
                        "progress",
                        "logs",
                        "dlq",
                        "concurrency",
                      ],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
                "workStream": { "minLength": 1, "type": "string" },
              },
              "required": ["namespace", "queues"],
              "type": "object",
            },
            "kv": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "bucket": { "minLength": 1, "type": "string" },
                    "history": { "minimum": 1, "type": "integer" },
                    "maxValueBytes": { "minimum": 1, "type": "integer" },
                    "ttlMs": { "minimum": 0, "type": "integer" },
                  },
                  "required": ["bucket", "history", "ttlMs"],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "store": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "maxObjectBytes": { "minimum": 1, "type": "integer" },
                    "maxTotalBytes": { "minimum": 1, "type": "integer" },
                    "name": { "minLength": 1, "type": "string" },
                    "ttlMs": { "minimum": 0, "type": "integer" },
                  },
                  "required": ["name", "ttlMs"],
                  "type": "object",
                },
              },
              "type": "object",
            },
          },
          "type": "object",
        },
      },
      "required": [
        "instanceId",
        "deploymentId",
        "instanceKey",
        "disabled",
        "capabilities",
        "createdAt",
      ],
      "type": "object",
    },
  },
  "required": ["instance"],
  "type": "object",
} as const;

export const AuthServiceInstancesEnableRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthServiceInstancesEnableResponseSchema = {
  "properties": {
    "instance": {
      "properties": {
        "capabilities": { "items": { "type": "string" }, "type": "array" },
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "disabled": { "type": "boolean" },
        "instanceId": { "minLength": 1, "type": "string" },
        "instanceKey": { "minLength": 1, "type": "string" },
        "resourceBindings": {
          "properties": {
            "eventConsumers": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "ackWaitMs": { "minimum": 1, "type": "integer" },
                    "backoffMs": {
                      "items": { "minimum": 0, "type": "integer" },
                      "type": "array",
                    },
                    "concurrency": { "minimum": 1, "type": "integer" },
                    "consumerName": { "minLength": 1, "type": "string" },
                    "filterSubjects": {
                      "items": { "minLength": 1, "type": "string" },
                      "type": "array",
                    },
                    "maxDeliver": { "minimum": 1, "type": "integer" },
                    "ordering": { "const": "strict", "type": "string" },
                    "replay": {
                      "anyOf": [{ "const": "new", "type": "string" }, {
                        "const": "all",
                        "type": "string",
                      }],
                    },
                    "stream": { "minLength": 1, "type": "string" },
                  },
                  "required": [
                    "stream",
                    "consumerName",
                    "filterSubjects",
                    "replay",
                    "ordering",
                    "concurrency",
                    "ackWaitMs",
                    "maxDeliver",
                    "backoffMs",
                  ],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "jobs": {
              "properties": {
                "namespace": { "minLength": 1, "type": "string" },
                "queues": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "ackWaitMs": { "minimum": 1, "type": "integer" },
                        "backoffMs": {
                          "items": { "minimum": 0, "type": "integer" },
                          "type": "array",
                        },
                        "concurrency": { "minimum": 1, "type": "integer" },
                        "consumerName": { "minLength": 1, "type": "string" },
                        "defaultDeadlineMs": {
                          "minimum": 1,
                          "type": "integer",
                        },
                        "dlq": { "type": "boolean" },
                        "keyConcurrency": {
                          "properties": {
                            "heartbeatIntervalMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "heartbeatTtlMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "key": {
                              "items": { "minLength": 1, "type": "string" },
                              "minItems": 1,
                              "type": "array",
                            },
                            "maxActive": { "minimum": 1, "type": "integer" },
                            "stalePolicy": {
                              "anyOf": [{
                                "const": "fail-stale",
                                "type": "string",
                              }, { "const": "block", "type": "string" }],
                            },
                          },
                          "required": [
                            "key",
                            "maxActive",
                            "heartbeatIntervalMs",
                            "heartbeatTtlMs",
                            "stalePolicy",
                          ],
                          "type": "object",
                        },
                        "logs": { "type": "boolean" },
                        "maxDeliver": { "minimum": 1, "type": "integer" },
                        "payload": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "progress": { "type": "boolean" },
                        "publishPrefix": { "minLength": 1, "type": "string" },
                        "queue": {
                          "properties": {
                            "maxQueuedPerKey": {
                              "minimum": 0,
                              "type": "integer",
                            },
                            "whenFull": {
                              "anyOf": [
                                { "const": "reject", "type": "string" },
                                { "const": "coalesce", "type": "string" },
                                { "const": "replace-oldest", "type": "string" },
                              ],
                            },
                          },
                          "required": ["maxQueuedPerKey", "whenFull"],
                          "type": "object",
                        },
                        "queueType": { "minLength": 1, "type": "string" },
                        "result": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "workSubject": { "minLength": 1, "type": "string" },
                      },
                      "required": [
                        "queueType",
                        "publishPrefix",
                        "workSubject",
                        "consumerName",
                        "payload",
                        "maxDeliver",
                        "backoffMs",
                        "ackWaitMs",
                        "progress",
                        "logs",
                        "dlq",
                        "concurrency",
                      ],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
                "workStream": { "minLength": 1, "type": "string" },
              },
              "required": ["namespace", "queues"],
              "type": "object",
            },
            "kv": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "bucket": { "minLength": 1, "type": "string" },
                    "history": { "minimum": 1, "type": "integer" },
                    "maxValueBytes": { "minimum": 1, "type": "integer" },
                    "ttlMs": { "minimum": 0, "type": "integer" },
                  },
                  "required": ["bucket", "history", "ttlMs"],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "store": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "maxObjectBytes": { "minimum": 1, "type": "integer" },
                    "maxTotalBytes": { "minimum": 1, "type": "integer" },
                    "name": { "minLength": 1, "type": "string" },
                    "ttlMs": { "minimum": 0, "type": "integer" },
                  },
                  "required": ["name", "ttlMs"],
                  "type": "object",
                },
              },
              "type": "object",
            },
          },
          "type": "object",
        },
      },
      "required": [
        "instanceId",
        "deploymentId",
        "instanceKey",
        "disabled",
        "capabilities",
        "createdAt",
      ],
      "type": "object",
    },
  },
  "required": ["instance"],
  "type": "object",
} as const;

export const AuthServiceInstancesListRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "disabled": { "type": "boolean" },
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthServiceInstancesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "createdAt": { "format": "date-time", "type": "string" },
          "deploymentId": { "minLength": 1, "type": "string" },
          "disabled": { "type": "boolean" },
          "instanceId": { "minLength": 1, "type": "string" },
          "instanceKey": { "minLength": 1, "type": "string" },
          "resourceBindings": {
            "properties": {
              "eventConsumers": {
                "patternProperties": {
                  "^.*$": {
                    "properties": {
                      "ackWaitMs": { "minimum": 1, "type": "integer" },
                      "backoffMs": {
                        "items": { "minimum": 0, "type": "integer" },
                        "type": "array",
                      },
                      "concurrency": { "minimum": 1, "type": "integer" },
                      "consumerName": { "minLength": 1, "type": "string" },
                      "filterSubjects": {
                        "items": { "minLength": 1, "type": "string" },
                        "type": "array",
                      },
                      "maxDeliver": { "minimum": 1, "type": "integer" },
                      "ordering": { "const": "strict", "type": "string" },
                      "replay": {
                        "anyOf": [{ "const": "new", "type": "string" }, {
                          "const": "all",
                          "type": "string",
                        }],
                      },
                      "stream": { "minLength": 1, "type": "string" },
                    },
                    "required": [
                      "stream",
                      "consumerName",
                      "filterSubjects",
                      "replay",
                      "ordering",
                      "concurrency",
                      "ackWaitMs",
                      "maxDeliver",
                      "backoffMs",
                    ],
                    "type": "object",
                  },
                },
                "type": "object",
              },
              "jobs": {
                "properties": {
                  "namespace": { "minLength": 1, "type": "string" },
                  "queues": {
                    "patternProperties": {
                      "^.*$": {
                        "properties": {
                          "ackWaitMs": { "minimum": 1, "type": "integer" },
                          "backoffMs": {
                            "items": { "minimum": 0, "type": "integer" },
                            "type": "array",
                          },
                          "concurrency": { "minimum": 1, "type": "integer" },
                          "consumerName": { "minLength": 1, "type": "string" },
                          "defaultDeadlineMs": {
                            "minimum": 1,
                            "type": "integer",
                          },
                          "dlq": { "type": "boolean" },
                          "keyConcurrency": {
                            "properties": {
                              "heartbeatIntervalMs": {
                                "minimum": 1,
                                "type": "integer",
                              },
                              "heartbeatTtlMs": {
                                "minimum": 1,
                                "type": "integer",
                              },
                              "key": {
                                "items": { "minLength": 1, "type": "string" },
                                "minItems": 1,
                                "type": "array",
                              },
                              "maxActive": { "minimum": 1, "type": "integer" },
                              "stalePolicy": {
                                "anyOf": [{
                                  "const": "fail-stale",
                                  "type": "string",
                                }, { "const": "block", "type": "string" }],
                              },
                            },
                            "required": [
                              "key",
                              "maxActive",
                              "heartbeatIntervalMs",
                              "heartbeatTtlMs",
                              "stalePolicy",
                            ],
                            "type": "object",
                          },
                          "logs": { "type": "boolean" },
                          "maxDeliver": { "minimum": 1, "type": "integer" },
                          "payload": {
                            "properties": {
                              "schema": { "minLength": 1, "type": "string" },
                            },
                            "required": ["schema"],
                            "type": "object",
                          },
                          "progress": { "type": "boolean" },
                          "publishPrefix": { "minLength": 1, "type": "string" },
                          "queue": {
                            "properties": {
                              "maxQueuedPerKey": {
                                "minimum": 0,
                                "type": "integer",
                              },
                              "whenFull": {
                                "anyOf": [
                                  { "const": "reject", "type": "string" },
                                  { "const": "coalesce", "type": "string" },
                                  {
                                    "const": "replace-oldest",
                                    "type": "string",
                                  },
                                ],
                              },
                            },
                            "required": ["maxQueuedPerKey", "whenFull"],
                            "type": "object",
                          },
                          "queueType": { "minLength": 1, "type": "string" },
                          "result": {
                            "properties": {
                              "schema": { "minLength": 1, "type": "string" },
                            },
                            "required": ["schema"],
                            "type": "object",
                          },
                          "workSubject": { "minLength": 1, "type": "string" },
                        },
                        "required": [
                          "queueType",
                          "publishPrefix",
                          "workSubject",
                          "consumerName",
                          "payload",
                          "maxDeliver",
                          "backoffMs",
                          "ackWaitMs",
                          "progress",
                          "logs",
                          "dlq",
                          "concurrency",
                        ],
                        "type": "object",
                      },
                    },
                    "type": "object",
                  },
                  "workStream": { "minLength": 1, "type": "string" },
                },
                "required": ["namespace", "queues"],
                "type": "object",
              },
              "kv": {
                "patternProperties": {
                  "^.*$": {
                    "properties": {
                      "bucket": { "minLength": 1, "type": "string" },
                      "history": { "minimum": 1, "type": "integer" },
                      "maxValueBytes": { "minimum": 1, "type": "integer" },
                      "ttlMs": { "minimum": 0, "type": "integer" },
                    },
                    "required": ["bucket", "history", "ttlMs"],
                    "type": "object",
                  },
                },
                "type": "object",
              },
              "store": {
                "patternProperties": {
                  "^.*$": {
                    "properties": {
                      "maxObjectBytes": { "minimum": 1, "type": "integer" },
                      "maxTotalBytes": { "minimum": 1, "type": "integer" },
                      "name": { "minLength": 1, "type": "string" },
                      "ttlMs": { "minimum": 0, "type": "integer" },
                    },
                    "required": ["name", "ttlMs"],
                    "type": "object",
                  },
                },
                "type": "object",
              },
            },
            "type": "object",
          },
        },
        "required": [
          "instanceId",
          "deploymentId",
          "instanceKey",
          "disabled",
          "capabilities",
          "createdAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthServiceInstancesProvisionRequestSchema = {
  "properties": {
    "deploymentId": { "minLength": 1, "type": "string" },
    "instanceKey": { "minLength": 1, "type": "string" },
  },
  "required": ["deploymentId", "instanceKey"],
  "type": "object",
} as const;

export const AuthServiceInstancesProvisionResponseSchema = {
  "properties": {
    "instance": {
      "properties": {
        "capabilities": { "items": { "type": "string" }, "type": "array" },
        "createdAt": { "format": "date-time", "type": "string" },
        "deploymentId": { "minLength": 1, "type": "string" },
        "disabled": { "type": "boolean" },
        "instanceId": { "minLength": 1, "type": "string" },
        "instanceKey": { "minLength": 1, "type": "string" },
        "resourceBindings": {
          "properties": {
            "eventConsumers": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "ackWaitMs": { "minimum": 1, "type": "integer" },
                    "backoffMs": {
                      "items": { "minimum": 0, "type": "integer" },
                      "type": "array",
                    },
                    "concurrency": { "minimum": 1, "type": "integer" },
                    "consumerName": { "minLength": 1, "type": "string" },
                    "filterSubjects": {
                      "items": { "minLength": 1, "type": "string" },
                      "type": "array",
                    },
                    "maxDeliver": { "minimum": 1, "type": "integer" },
                    "ordering": { "const": "strict", "type": "string" },
                    "replay": {
                      "anyOf": [{ "const": "new", "type": "string" }, {
                        "const": "all",
                        "type": "string",
                      }],
                    },
                    "stream": { "minLength": 1, "type": "string" },
                  },
                  "required": [
                    "stream",
                    "consumerName",
                    "filterSubjects",
                    "replay",
                    "ordering",
                    "concurrency",
                    "ackWaitMs",
                    "maxDeliver",
                    "backoffMs",
                  ],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "jobs": {
              "properties": {
                "namespace": { "minLength": 1, "type": "string" },
                "queues": {
                  "patternProperties": {
                    "^.*$": {
                      "properties": {
                        "ackWaitMs": { "minimum": 1, "type": "integer" },
                        "backoffMs": {
                          "items": { "minimum": 0, "type": "integer" },
                          "type": "array",
                        },
                        "concurrency": { "minimum": 1, "type": "integer" },
                        "consumerName": { "minLength": 1, "type": "string" },
                        "defaultDeadlineMs": {
                          "minimum": 1,
                          "type": "integer",
                        },
                        "dlq": { "type": "boolean" },
                        "keyConcurrency": {
                          "properties": {
                            "heartbeatIntervalMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "heartbeatTtlMs": {
                              "minimum": 1,
                              "type": "integer",
                            },
                            "key": {
                              "items": { "minLength": 1, "type": "string" },
                              "minItems": 1,
                              "type": "array",
                            },
                            "maxActive": { "minimum": 1, "type": "integer" },
                            "stalePolicy": {
                              "anyOf": [{
                                "const": "fail-stale",
                                "type": "string",
                              }, { "const": "block", "type": "string" }],
                            },
                          },
                          "required": [
                            "key",
                            "maxActive",
                            "heartbeatIntervalMs",
                            "heartbeatTtlMs",
                            "stalePolicy",
                          ],
                          "type": "object",
                        },
                        "logs": { "type": "boolean" },
                        "maxDeliver": { "minimum": 1, "type": "integer" },
                        "payload": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "progress": { "type": "boolean" },
                        "publishPrefix": { "minLength": 1, "type": "string" },
                        "queue": {
                          "properties": {
                            "maxQueuedPerKey": {
                              "minimum": 0,
                              "type": "integer",
                            },
                            "whenFull": {
                              "anyOf": [
                                { "const": "reject", "type": "string" },
                                { "const": "coalesce", "type": "string" },
                                { "const": "replace-oldest", "type": "string" },
                              ],
                            },
                          },
                          "required": ["maxQueuedPerKey", "whenFull"],
                          "type": "object",
                        },
                        "queueType": { "minLength": 1, "type": "string" },
                        "result": {
                          "properties": {
                            "schema": { "minLength": 1, "type": "string" },
                          },
                          "required": ["schema"],
                          "type": "object",
                        },
                        "workSubject": { "minLength": 1, "type": "string" },
                      },
                      "required": [
                        "queueType",
                        "publishPrefix",
                        "workSubject",
                        "consumerName",
                        "payload",
                        "maxDeliver",
                        "backoffMs",
                        "ackWaitMs",
                        "progress",
                        "logs",
                        "dlq",
                        "concurrency",
                      ],
                      "type": "object",
                    },
                  },
                  "type": "object",
                },
                "workStream": { "minLength": 1, "type": "string" },
              },
              "required": ["namespace", "queues"],
              "type": "object",
            },
            "kv": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "bucket": { "minLength": 1, "type": "string" },
                    "history": { "minimum": 1, "type": "integer" },
                    "maxValueBytes": { "minimum": 1, "type": "integer" },
                    "ttlMs": { "minimum": 0, "type": "integer" },
                  },
                  "required": ["bucket", "history", "ttlMs"],
                  "type": "object",
                },
              },
              "type": "object",
            },
            "store": {
              "patternProperties": {
                "^.*$": {
                  "properties": {
                    "maxObjectBytes": { "minimum": 1, "type": "integer" },
                    "maxTotalBytes": { "minimum": 1, "type": "integer" },
                    "name": { "minLength": 1, "type": "string" },
                    "ttlMs": { "minimum": 0, "type": "integer" },
                  },
                  "required": ["name", "ttlMs"],
                  "type": "object",
                },
              },
              "type": "object",
            },
          },
          "type": "object",
        },
      },
      "required": [
        "instanceId",
        "deploymentId",
        "instanceKey",
        "disabled",
        "capabilities",
        "createdAt",
      ],
      "type": "object",
    },
  },
  "required": ["instance"],
  "type": "object",
} as const;

export const AuthServiceInstancesRemoveRequestSchema = {
  "properties": { "instanceId": { "minLength": 1, "type": "string" } },
  "required": ["instanceId"],
  "type": "object",
} as const;

export const AuthServiceInstancesRemoveResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthSessionsListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "user": { "type": "string" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthSessionsListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "anyOf": [{
          "properties": {
            "contractDisplayName": { "type": "string" },
            "contractId": { "type": "string" },
            "createdAt": { "type": "string" },
            "key": { "type": "string" },
            "lastAuth": { "type": "string" },
            "participantKind": { "const": "app", "type": "string" },
            "principal": {
              "properties": {
                "identity": {
                  "properties": {
                    "identityId": { "type": "string" },
                    "provider": { "type": "string" },
                    "subject": { "type": "string" },
                  },
                  "required": ["identityId", "provider", "subject"],
                  "type": "object",
                },
                "name": { "type": "string" },
                "type": { "const": "user", "type": "string" },
                "userId": { "type": "string" },
              },
              "required": ["type", "userId", "identity", "name"],
              "type": "object",
            },
            "sessionKey": { "type": "string" },
          },
          "required": [
            "key",
            "sessionKey",
            "createdAt",
            "lastAuth",
            "participantKind",
            "principal",
            "contractId",
            "contractDisplayName",
          ],
          "type": "object",
        }, {
          "properties": {
            "contractDisplayName": { "type": "string" },
            "contractId": { "type": "string" },
            "createdAt": { "type": "string" },
            "key": { "type": "string" },
            "lastAuth": { "type": "string" },
            "participantKind": { "const": "agent", "type": "string" },
            "principal": {
              "properties": {
                "identity": {
                  "properties": {
                    "identityId": { "type": "string" },
                    "provider": { "type": "string" },
                    "subject": { "type": "string" },
                  },
                  "required": ["identityId", "provider", "subject"],
                  "type": "object",
                },
                "name": { "type": "string" },
                "type": { "const": "user", "type": "string" },
                "userId": { "type": "string" },
              },
              "required": ["type", "userId", "identity", "name"],
              "type": "object",
            },
            "sessionKey": { "type": "string" },
          },
          "required": [
            "key",
            "sessionKey",
            "createdAt",
            "lastAuth",
            "participantKind",
            "principal",
            "contractId",
            "contractDisplayName",
          ],
          "type": "object",
        }, {
          "properties": {
            "contractDisplayName": { "type": "string" },
            "contractId": { "type": "string" },
            "createdAt": { "type": "string" },
            "key": { "type": "string" },
            "lastAuth": { "type": "string" },
            "participantKind": { "const": "device", "type": "string" },
            "principal": {
              "properties": {
                "deploymentId": { "type": "string" },
                "deviceId": { "type": "string" },
                "deviceType": { "type": "string" },
                "runtimePublicKey": { "type": "string" },
                "type": { "const": "device", "type": "string" },
              },
              "required": [
                "type",
                "deviceId",
                "deviceType",
                "runtimePublicKey",
                "deploymentId",
              ],
              "type": "object",
            },
            "sessionKey": { "type": "string" },
          },
          "required": [
            "key",
            "sessionKey",
            "createdAt",
            "lastAuth",
            "participantKind",
            "principal",
            "contractId",
          ],
          "type": "object",
        }, {
          "properties": {
            "createdAt": { "type": "string" },
            "key": { "type": "string" },
            "lastAuth": { "type": "string" },
            "participantKind": { "const": "service", "type": "string" },
            "principal": {
              "properties": {
                "deploymentId": { "type": "string" },
                "id": { "type": "string" },
                "instanceId": { "type": "string" },
                "name": { "type": "string" },
                "type": { "const": "service", "type": "string" },
              },
              "required": ["type", "id", "name", "instanceId", "deploymentId"],
              "type": "object",
            },
            "sessionKey": { "type": "string" },
          },
          "required": [
            "key",
            "sessionKey",
            "createdAt",
            "lastAuth",
            "participantKind",
            "principal",
          ],
          "type": "object",
        }],
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthSessionsLogoutRequestSchema = {
  "additionalProperties": true,
  "properties": {},
  "type": "object",
} as const;

export const AuthSessionsLogoutResponseSchema = {
  "additionalProperties": false,
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthSessionsMeRequestSchema = {
  "properties": {},
  "type": "object",
} as const;

export const AuthSessionsMeResponseSchema = {
  "properties": {
    "device": {
      "anyOf": [{
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "deploymentId": { "minLength": 1, "type": "string" },
          "deviceId": { "minLength": 1, "type": "string" },
          "deviceType": { "minLength": 1, "type": "string" },
          "runtimePublicKey": { "minLength": 1, "type": "string" },
          "type": { "const": "device", "type": "string" },
        },
        "required": [
          "type",
          "deviceId",
          "deviceType",
          "runtimePublicKey",
          "deploymentId",
          "active",
          "capabilities",
        ],
        "type": "object",
      }, { "type": "null" }],
    },
    "participantKind": {
      "anyOf": [
        {
          "anyOf": [{ "const": "app", "type": "string" }, {
            "const": "agent",
            "type": "string",
          }],
        },
        { "const": "device", "type": "string" },
        { "const": "service", "type": "string" },
      ],
    },
    "service": {
      "anyOf": [{
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "id": { "type": "string" },
          "name": { "type": "string" },
          "type": { "const": "service", "type": "string" },
        },
        "required": ["type", "id", "name", "active", "capabilities"],
        "type": "object",
      }, { "type": "null" }],
    },
    "user": {
      "anyOf": [{
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "email": { "type": "string" },
          "identity": {
            "properties": {
              "identityId": { "minLength": 1, "type": "string" },
              "provider": { "minLength": 1, "type": "string" },
              "subject": { "minLength": 1, "type": "string" },
            },
            "required": ["identityId", "provider", "subject"],
            "type": "object",
          },
          "image": { "type": "string" },
          "lastLogin": { "format": "date-time", "type": "string" },
          "name": { "type": "string" },
          "userId": { "minLength": 1, "type": "string" },
        },
        "required": [
          "userId",
          "active",
          "name",
          "email",
          "capabilities",
          "identity",
        ],
        "type": "object",
      }, { "type": "null" }],
    },
  },
  "required": ["participantKind", "user", "device", "service"],
  "type": "object",
} as const;

export const AuthSessionsRevokeRequestSchema = {
  "properties": { "sessionKey": { "type": "string" } },
  "required": ["sessionKey"],
  "type": "object",
} as const;

export const AuthSessionsRevokeResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthSessionsRevokedEventSchema = {
  "properties": {
    "id": { "type": "string" },
    "origin": { "type": "string" },
    "revokedBy": { "type": "string" },
    "sessionKey": { "type": "string" },
  },
  "required": ["origin", "id", "sessionKey", "revokedBy"],
  "type": "object",
} as const;

export const AuthUserIdentitiesListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
    "userId": { "minLength": 1, "type": "string" },
  },
  "required": ["userId", "limit"],
  "type": "object",
} as const;

export const AuthUserIdentitiesListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "displayName": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "email": {
            "anyOf": [{ "minLength": 1, "type": "string" }, { "type": "null" }],
          },
          "emailVerified": { "type": "boolean" },
          "identityId": { "minLength": 1, "type": "string" },
          "lastLoginAt": {
            "anyOf": [{ "format": "date-time", "type": "string" }, {
              "type": "null",
            }],
          },
          "linkedAt": { "format": "date-time", "type": "string" },
          "provider": { "minLength": 1, "type": "string" },
          "subject": { "minLength": 1, "type": "string" },
        },
        "required": [
          "identityId",
          "provider",
          "subject",
          "displayName",
          "email",
          "emailVerified",
          "linkedAt",
          "lastLoginAt",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthUserIdentitiesUnlinkRequestSchema = {
  "properties": {
    "identityId": { "minLength": 1, "type": "string" },
    "userId": { "minLength": 1, "type": "string" },
  },
  "required": ["userId", "identityId"],
  "type": "object",
} as const;

export const AuthUserIdentitiesUnlinkResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthUsersAccountFlowCreateResponseSchema = {
  "properties": {
    "expiresAt": { "format": "date-time", "type": "string" },
    "flowId": { "minLength": 1, "type": "string" },
    "url": { "minLength": 1, "type": "string" },
  },
  "required": ["flowId", "url", "expiresAt"],
  "type": "object",
} as const;

export const AuthUsersCreateRequestSchema = {
  "properties": {
    "active": { "type": "boolean" },
    "capabilities": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "capabilityGroups": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "email": { "minLength": 1, "type": "string" },
    "name": { "minLength": 1, "type": "string" },
    "username": { "minLength": 1, "type": "string" },
  },
  "type": "object",
} as const;

export const AuthUsersCreateResponseSchema = {
  "properties": {
    "user": {
      "properties": {
        "active": { "type": "boolean" },
        "capabilities": { "items": { "type": "string" }, "type": "array" },
        "capabilityGroups": { "items": { "type": "string" }, "type": "array" },
        "email": { "type": "string" },
        "identities": {
          "items": {
            "properties": {
              "displayName": {
                "anyOf": [{ "minLength": 1, "type": "string" }, {
                  "type": "null",
                }],
              },
              "email": {
                "anyOf": [{ "minLength": 1, "type": "string" }, {
                  "type": "null",
                }],
              },
              "emailVerified": { "type": "boolean" },
              "identityId": { "minLength": 1, "type": "string" },
              "lastLoginAt": {
                "anyOf": [{ "format": "date-time", "type": "string" }, {
                  "type": "null",
                }],
              },
              "linkedAt": { "format": "date-time", "type": "string" },
              "provider": { "minLength": 1, "type": "string" },
              "subject": { "minLength": 1, "type": "string" },
            },
            "required": [
              "identityId",
              "provider",
              "subject",
              "displayName",
              "email",
              "emailVerified",
              "linkedAt",
              "lastLoginAt",
            ],
            "type": "object",
          },
          "type": "array",
        },
        "name": { "type": "string" },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": [
        "userId",
        "active",
        "capabilities",
        "capabilityGroups",
        "identities",
      ],
      "type": "object",
    },
  },
  "required": ["user"],
  "type": "object",
} as const;

export const AuthUsersGetRequestSchema = {
  "properties": { "userId": { "minLength": 1, "type": "string" } },
  "required": ["userId"],
  "type": "object",
} as const;

export const AuthUsersGetResponseSchema = {
  "properties": {
    "user": {
      "properties": {
        "active": { "type": "boolean" },
        "capabilities": { "items": { "type": "string" }, "type": "array" },
        "capabilityGroups": { "items": { "type": "string" }, "type": "array" },
        "email": { "type": "string" },
        "identities": {
          "items": {
            "properties": {
              "displayName": {
                "anyOf": [{ "minLength": 1, "type": "string" }, {
                  "type": "null",
                }],
              },
              "email": {
                "anyOf": [{ "minLength": 1, "type": "string" }, {
                  "type": "null",
                }],
              },
              "emailVerified": { "type": "boolean" },
              "identityId": { "minLength": 1, "type": "string" },
              "lastLoginAt": {
                "anyOf": [{ "format": "date-time", "type": "string" }, {
                  "type": "null",
                }],
              },
              "linkedAt": { "format": "date-time", "type": "string" },
              "provider": { "minLength": 1, "type": "string" },
              "subject": { "minLength": 1, "type": "string" },
            },
            "required": [
              "identityId",
              "provider",
              "subject",
              "displayName",
              "email",
              "emailVerified",
              "linkedAt",
              "lastLoginAt",
            ],
            "type": "object",
          },
          "type": "array",
        },
        "name": { "type": "string" },
        "userId": { "minLength": 1, "type": "string" },
      },
      "required": [
        "userId",
        "active",
        "capabilities",
        "capabilityGroups",
        "identities",
      ],
      "type": "object",
    },
  },
  "required": ["user"],
  "type": "object",
} as const;

export const AuthUsersIdentityLinkCreateRequestSchema = {
  "properties": { "returnTo": { "minLength": 1, "type": "string" } },
  "type": "object",
} as const;

export const AuthUsersListRequestSchema = {
  "properties": {
    "limit": { "maximum": 500, "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["limit"],
  "type": "object",
} as const;

export const AuthUsersListResponseSchema = {
  "properties": {
    "count": { "minimum": 0, "type": "integer" },
    "entries": {
      "default": [],
      "items": {
        "properties": {
          "active": { "type": "boolean" },
          "capabilities": { "items": { "type": "string" }, "type": "array" },
          "capabilityGroups": {
            "items": { "type": "string" },
            "type": "array",
          },
          "email": { "type": "string" },
          "identities": {
            "items": {
              "properties": {
                "displayName": {
                  "anyOf": [{ "minLength": 1, "type": "string" }, {
                    "type": "null",
                  }],
                },
                "email": {
                  "anyOf": [{ "minLength": 1, "type": "string" }, {
                    "type": "null",
                  }],
                },
                "emailVerified": { "type": "boolean" },
                "identityId": { "minLength": 1, "type": "string" },
                "lastLoginAt": {
                  "anyOf": [{ "format": "date-time", "type": "string" }, {
                    "type": "null",
                  }],
                },
                "linkedAt": { "format": "date-time", "type": "string" },
                "provider": { "minLength": 1, "type": "string" },
                "subject": { "minLength": 1, "type": "string" },
              },
              "required": [
                "identityId",
                "provider",
                "subject",
                "displayName",
                "email",
                "emailVerified",
                "linkedAt",
                "lastLoginAt",
              ],
              "type": "object",
            },
            "type": "array",
          },
          "name": { "type": "string" },
          "userId": { "minLength": 1, "type": "string" },
        },
        "required": [
          "userId",
          "active",
          "capabilities",
          "capabilityGroups",
          "identities",
        ],
        "type": "object",
      },
      "type": "array",
    },
    "limit": { "minimum": 0, "type": "integer" },
    "nextOffset": { "minimum": 0, "type": "integer" },
    "offset": { "minimum": 0, "type": "integer" },
  },
  "required": ["entries", "count", "offset", "limit"],
  "type": "object",
} as const;

export const AuthUsersPasswordChangeRequestSchema = {
  "properties": {
    "currentPassword": { "minLength": 1, "type": "string" },
    "newPassword": { "minLength": 1, "type": "string" },
  },
  "required": ["currentPassword", "newPassword"],
  "type": "object",
} as const;

export const AuthUsersPasswordChangeResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const AuthUsersPasswordResetCreateRequestSchema = {
  "properties": {
    "expiresInSeconds": {
      "maximum": 2592000,
      "minimum": 60,
      "type": "integer",
    },
    "userId": { "minLength": 1, "type": "string" },
  },
  "required": ["userId"],
  "type": "object",
} as const;

export const AuthUsersUpdateRequestSchema = {
  "properties": {
    "active": { "type": "boolean" },
    "capabilities": { "items": { "type": "string" }, "type": "array" },
    "capabilityGroups": {
      "items": { "minLength": 1, "type": "string" },
      "type": "array",
    },
    "email": { "type": "string" },
    "name": { "type": "string" },
    "userId": { "minLength": 1, "type": "string" },
  },
  "required": ["userId"],
  "type": "object",
} as const;

export const AuthUsersUpdateResponseSchema = {
  "properties": { "success": { "type": "boolean" } },
  "required": ["success"],
  "type": "object",
} as const;

export const HealthRequestSchema = {
  "properties": {},
  "type": "object",
} as const;

export const HealthResponseSchema = {
  "properties": {
    "checks": {
      "items": {
        "properties": {
          "error": { "type": "string" },
          "info": { "patternProperties": { "^.*$": {} }, "type": "object" },
          "latencyMs": { "type": "number" },
          "name": { "type": "string" },
          "status": {
            "anyOf": [{ "const": "ok", "type": "string" }, {
              "const": "failed",
              "type": "string",
            }],
          },
          "summary": { "type": "string" },
        },
        "required": ["name", "status", "latencyMs"],
        "type": "object",
      },
      "type": "array",
    },
    "service": { "type": "string" },
    "status": {
      "anyOf": [{ "const": "healthy", "type": "string" }, {
        "const": "unhealthy",
        "type": "string",
      }, { "const": "degraded", "type": "string" }],
    },
    "timestamp": { "format": "date-time", "type": "string" },
  },
  "required": ["status", "service", "timestamp", "checks"],
  "type": "object",
} as const;
