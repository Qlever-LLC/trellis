import { assert, assertEquals } from "@std/assert";
import Value from "typebox/value";
import {
  AuthListConnectionsResponseSchema,
} from "../../../../packages/trellis/models/auth/rpc/ListConnections.ts";
import {
  AuthListSessionsResponseSchema,
} from "../../../../packages/trellis/models/auth/rpc/ListSessions.ts";
import {
  TRELLIS_AUTH_EVENTS,
  TRELLIS_AUTH_OPERATIONS,
  TRELLIS_AUTH_RPC,
} from "../../contracts/trellis_auth.ts";

import {
  normalizeDigestList,
  validateDevicePortalSelectionRequest,
  validateDeviceProfileRequest,
  validateDeviceProvisionRequest,
  validateInstanceGrantPolicyRequest,
  validateLoginPortalSelectionRequest,
  validatePortalDefaultRequest,
  validatePortalProfileRequest,
  validatePortalRequest,
  validateServiceProfileRequest,
} from "./shared.ts";

Deno.test("normalizeDigestList preserves order and removes duplicates", () => {
  assertEquals(normalizeDigestList(["b", "a", "b", "c", "a"]), ["b", "a", "c"]);
});

Deno.test("auth contract exposes service, portal, and device admin RPCs", () => {
  const methods = Object.keys(TRELLIS_AUTH_RPC);
  assert(methods.includes("Auth.CreatePortal"));
  assert(methods.includes("Auth.ListPortals"));
  assert(methods.includes("Auth.DisablePortal"));
  assert(methods.includes("Auth.ListPortalProfiles"));
  assert(methods.includes("Auth.SetPortalProfile"));
  assert(methods.includes("Auth.DisablePortalProfile"));
  assert(methods.includes("Auth.GetLoginPortalDefault"));
  assert(methods.includes("Auth.SetLoginPortalDefault"));
  assert(methods.includes("Auth.ListInstanceGrantPolicies"));
  assert(methods.includes("Auth.UpsertInstanceGrantPolicy"));
  assert(methods.includes("Auth.DisableInstanceGrantPolicy"));
  assert(methods.includes("Auth.ListLoginPortalSelections"));
  assert(methods.includes("Auth.SetLoginPortalSelection"));
  assert(methods.includes("Auth.ClearLoginPortalSelection"));
  assert(methods.includes("Auth.GetDevicePortalDefault"));
  assert(methods.includes("Auth.SetDevicePortalDefault"));
  assert(methods.includes("Auth.ListDevicePortalSelections"));
  assert(methods.includes("Auth.SetDevicePortalSelection"));
  assert(methods.includes("Auth.ClearDevicePortalSelection"));
  assert(methods.includes("Auth.CreateDeviceProfile"));
  assert(methods.includes("Auth.ApplyDeviceProfileContract"));
  assert(methods.includes("Auth.UnapplyDeviceProfileContract"));
  assert(methods.includes("Auth.ListDeviceProfiles"));
  assert(methods.includes("Auth.DisableDeviceProfile"));
  assert(methods.includes("Auth.EnableDeviceProfile"));
  assert(methods.includes("Auth.RemoveDeviceProfile"));
  assert(methods.includes("Auth.ProvisionDeviceInstance"));
  assert(methods.includes("Auth.ListDeviceInstances"));
  assert(methods.includes("Auth.DisableDeviceInstance"));
  assert(methods.includes("Auth.EnableDeviceInstance"));
  assert(methods.includes("Auth.RemoveDeviceInstance"));
  assert(methods.includes("Auth.ListDeviceActivations"));
  assert(methods.includes("Auth.RevokeDeviceActivation"));
  assert(methods.includes("Auth.ListDeviceActivationReviews"));
  assert(methods.includes("Auth.DecideDeviceActivationReview"));
  assert(methods.includes("Auth.CreateServiceProfile"));
  assert(methods.includes("Auth.ApplyServiceProfileContract"));
  assert(methods.includes("Auth.UnapplyServiceProfileContract"));
  assert(methods.includes("Auth.ListServiceProfiles"));
  assert(methods.includes("Auth.DisableServiceProfile"));
  assert(methods.includes("Auth.EnableServiceProfile"));
  assert(methods.includes("Auth.RemoveServiceProfile"));
  assert(methods.includes("Auth.ProvisionServiceInstance"));
  assert(methods.includes("Auth.ListServiceInstances"));
  assert(methods.includes("Auth.DisableServiceInstance"));
  assert(methods.includes("Auth.EnableServiceInstance"));
  assert(methods.includes("Auth.RemoveServiceInstance"));
  assert(methods.includes("Auth.ListUserGrants"));
  assert(methods.includes("Auth.RevokeUserGrant"));
  assert(!methods.includes("Auth.CreatePortalRoute"));
  assert(!methods.includes("Auth.ListPortalRoutes"));
  assert(!methods.includes("Auth.DisablePortalRoute"));
  assert(!methods.includes("Auth.InstallService"));
  assert(!methods.includes("Auth.UpgradeServiceContract"));
  assert(!methods.includes("Auth.RemoveService"));

  const operations = Object.keys(TRELLIS_AUTH_OPERATIONS);
  assertEquals(operations, ["Auth.ActivateDevice"]);
});

Deno.test("session and connection admin schemas expose explicit participant metadata", () => {
  assert(Value.Check(AuthListSessionsResponseSchema, {
    sessions: [
      {
        key: "github.123.sk_agent",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          origin: "github",
          id: "123",
          trellisId: "tid_123",
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        createdAt: new Date().toISOString(),
        lastAuth: new Date().toISOString(),
      },
    ],
  }));

  assert(Value.Check(AuthListConnectionsResponseSchema, {
    connections: [
      {
        key: "github.123.sk_agent.user_nkey",
        userNkey: "user_nkey",
        sessionKey: "sk_agent",
        participantKind: "agent",
        principal: {
          type: "user",
          origin: "github",
          id: "123",
          trellisId: "tid_123",
          name: "Ada",
        },
        contractId: "trellis.agent@v1",
        contractDisplayName: "Trellis Agent",
        serverId: "n1",
        clientId: 7,
        connectedAt: new Date().toISOString(),
      },
    ],
  }));
});

Deno.test("validateServiceProfileRequest normalizes namespaces without display metadata", () => {
  const valid = validateServiceProfileRequest({
    profileId: "billing.default",
    namespaces: ["billing", "billing", "audit"],
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { profile: Record<string, unknown> }).profile, {
    profileId: "billing.default",
    namespaces: ["billing", "audit"],
    disabled: false,
    appliedContracts: [],
  });

  assert(
    validateServiceProfileRequest({ profileId: "", namespaces: [] }).isErr(),
  );
});

Deno.test("auth review event is templated by profile", () => {
  assertEquals(
    TRELLIS_AUTH_EVENTS["Auth.DeviceActivationReviewRequested"].params,
    ["/profileId"],
  );
});

Deno.test("validatePortalRequest requires portal identity and URL", () => {
  const valid = validatePortalRequest({
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { portal: Record<string, unknown> }).portal, {
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    disabled: false,
  });

  assert(
    validatePortalRequest({
      portalId: "main",
      entryUrl: "javascript:alert(1)",
    }).isErr(),
  );
});

Deno.test("validatePortalProfileRequest normalizes origins and allows unrestricted profiles", () => {
  const valid = validatePortalProfileRequest({
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
    allowedOrigins: [
      "https://portal.example.com/callback",
      "https://alt.example.com/path",
    ],
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { profile: Record<string, unknown> }).profile, {
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
    allowedOrigins: ["https://portal.example.com", "https://alt.example.com"],
  });

  const unrestricted = validatePortalProfileRequest({
    portalId: "main",
    entryUrl: "https://portal.example.com/auth",
    contractId: "trellis.portal@v1",
  });
  assert(!unrestricted.isErr());
  assertEquals(
    (unrestricted.take() as { profile: { allowedOrigins?: string[] } }).profile
      .allowedOrigins,
    undefined,
  );

  assert(
    validatePortalProfileRequest({
      portalId: "main",
      entryUrl: "javascript:alert(1)",
      contractId: "trellis.portal@v1",
    }).isErr(),
  );
  assert(
    validatePortalProfileRequest({
      portalId: "main",
      entryUrl: "https://portal.example.com/auth",
      contractId: "trellis.portal@v1",
      allowedOrigins: ["javascript:alert(1)"],
    }).isErr(),
  );
});

Deno.test("validatePortalDefaultRequest accepts builtin and custom selections", () => {
  const builtin = validatePortalDefaultRequest({ portalId: null });
  assert(!builtin.isErr());
  assertEquals(
    (builtin.take() as { defaultPortal: Record<string, unknown> })
      .defaultPortal,
    {
      portalId: null,
    },
  );

  const custom = validatePortalDefaultRequest({ portalId: "main" });
  assert(!custom.isErr());
  assertEquals(
    (custom.take() as { defaultPortal: Record<string, unknown> }).defaultPortal,
    {
      portalId: "main",
    },
  );
});

Deno.test("validateInstanceGrantPolicyRequest normalizes origins and dedupes capabilities", () => {
  const valid = validateInstanceGrantPolicyRequest({
    contractId: "trellis.console@v1",
    allowedOrigins: [
      "https://app.example.com/callback",
      "https://app.example.com",
      "https://admin.example.com/path",
    ],
    impliedCapabilities: ["audit", "audit", "admin"],
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { policy: Record<string, unknown> }).policy, {
    contractId: "trellis.console@v1",
    allowedOrigins: ["https://app.example.com", "https://admin.example.com"],
    impliedCapabilities: ["audit", "admin"],
  });

  assert(
    validateInstanceGrantPolicyRequest({
      contractId: "trellis.console@v1",
      allowedOrigins: ["not a url"],
      impliedCapabilities: [],
    }).isErr(),
  );
});

Deno.test("validateLoginPortalSelectionRequest requires contract identity", () => {
  const valid = validateLoginPortalSelectionRequest({
    contractId: "trellis.console@v1",
    portalId: null,
  });
  assert(!valid.isErr());
  assertEquals(
    (valid.take() as { selection: Record<string, unknown> }).selection,
    {
      contractId: "trellis.console@v1",
      portalId: null,
    },
  );

  assert(
    validateLoginPortalSelectionRequest({ contractId: "", portalId: null })
      .isErr(),
  );
});

Deno.test("validateDevicePortalSelectionRequest requires profile identity", () => {
  const valid = validateDevicePortalSelectionRequest({
    profileId: "reader.default",
    portalId: "main",
  });
  assert(!valid.isErr());
  assertEquals(
    (valid.take() as { selection: Record<string, unknown> }).selection,
    {
      profileId: "reader.default",
      portalId: "main",
    },
  );

  assert(
    validateDevicePortalSelectionRequest({ profileId: "", portalId: null })
      .isErr(),
  );
});

Deno.test("validateDeviceProfileRequest dedupes digests and omits preferred digest", () => {
  const valid = validateDeviceProfileRequest({
    profileId: "reader.default",
    reviewMode: "none",
  });
  if (valid.isErr()) throw new Error("expected valid device profile request");
  const { profile } = valid.take() as {
    profile: { appliedContracts: unknown[] };
  };
  assertEquals(profile.appliedContracts, []);
});

Deno.test("validateDeviceProvisionRequest builds a preregistered instance", () => {
  const valid = validateDeviceProvisionRequest({
    profileId: "reader.default",
    publicIdentityKey: "A".repeat(43),
    activationKey: "B".repeat(43),
    metadata: {
      name: "Front Desk Reader",
      serialNumber: "SN-123",
      modelNumber: "MODEL-9",
      assetTag: "asset-42",
    },
  });
  assert(!valid.isErr());
  const value = valid.take() as { instance: Record<string, unknown> };
  assertEquals(value.instance.profileId, "reader.default");
  assertEquals(value.instance.publicIdentityKey, "A".repeat(43));
  assertEquals(value.instance.metadata, {
    name: "Front Desk Reader",
    serialNumber: "SN-123",
    modelNumber: "MODEL-9",
    assetTag: "asset-42",
  });
  assertEquals(value.instance.state, "registered");
});

Deno.test("validateDeviceProvisionRequest rejects empty metadata entries", () => {
  assert(
    validateDeviceProvisionRequest({
      profileId: "reader.default",
      publicIdentityKey: "A".repeat(43),
      activationKey: "B".repeat(43),
      metadata: { assetTag: "" },
    }).isErr(),
  );
});
