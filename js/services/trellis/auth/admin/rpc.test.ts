import { assert, assertEquals } from "@std/assert";
import { TRELLIS_AUTH_RPC } from "../../contracts/trellis_auth.ts";

import {
  normalizeDigestList,
  validateLoginPortalSelectionRequest,
  validatePortalRequest,
  validatePortalDefaultRequest,
  validateDeviceProvisionRequest,
  validateDevicePortalSelectionRequest,
  validateDeviceProfileRequest,
} from "./shared.ts";

Deno.test("normalizeDigestList preserves order and removes duplicates", () => {
  assertEquals(normalizeDigestList(["b", "a", "b", "c", "a"]), ["b", "a", "c"]);
});

Deno.test("auth contract exposes only portal selection and device admin RPCs", () => {
  const methods = Object.keys(TRELLIS_AUTH_RPC);
  assert(methods.includes("Auth.CreatePortal"));
  assert(methods.includes("Auth.ListPortals"));
  assert(methods.includes("Auth.DisablePortal"));
  assert(methods.includes("Auth.GetLoginPortalDefault"));
  assert(methods.includes("Auth.SetLoginPortalDefault"));
  assert(methods.includes("Auth.ListLoginPortalSelections"));
  assert(methods.includes("Auth.SetLoginPortalSelection"));
  assert(methods.includes("Auth.ClearLoginPortalSelection"));
  assert(methods.includes("Auth.GetDevicePortalDefault"));
  assert(methods.includes("Auth.SetDevicePortalDefault"));
  assert(methods.includes("Auth.ListDevicePortalSelections"));
  assert(methods.includes("Auth.SetDevicePortalSelection"));
  assert(methods.includes("Auth.ClearDevicePortalSelection"));
  assert(methods.includes("Auth.CreateDeviceProfile"));
  assert(methods.includes("Auth.ListDeviceProfiles"));
  assert(methods.includes("Auth.DisableDeviceProfile"));
  assert(methods.includes("Auth.ProvisionDeviceInstance"));
  assert(methods.includes("Auth.ListDeviceInstances"));
  assert(methods.includes("Auth.DisableDeviceInstance"));
  assert(methods.includes("Auth.ActivateDevice"));
  assert(methods.includes("Auth.GetDeviceActivationStatus"));
  assert(methods.includes("Auth.ListDeviceActivations"));
  assert(methods.includes("Auth.RevokeDeviceActivation"));
  assert(methods.includes("Auth.ListDeviceActivationReviews"));
  assert(methods.includes("Auth.DecideDeviceActivationReview"));
  assert(!methods.includes("Auth.CreatePortalRoute"));
  assert(!methods.includes("Auth.ListPortalRoutes"));
  assert(!methods.includes("Auth.DisablePortalRoute"));
});

Deno.test("validatePortalRequest requires portal identity and URL", () => {
  const valid = validatePortalRequest({
    portalId: "main",
    appContractId: "trellis.portal@v1",
    entryUrl: "https://portal.example.com/auth",
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { portal: Record<string, unknown> }).portal, {
    portalId: "main",
    appContractId: "trellis.portal@v1",
    entryUrl: "https://portal.example.com/auth",
    disabled: false,
  });
});

Deno.test("validatePortalDefaultRequest accepts builtin and custom selections", () => {
  const builtin = validatePortalDefaultRequest({ portalId: null });
  assert(!builtin.isErr());
  assertEquals((builtin.take() as { defaultPortal: Record<string, unknown> }).defaultPortal, {
    portalId: null,
  });

  const custom = validatePortalDefaultRequest({ portalId: "main" });
  assert(!custom.isErr());
  assertEquals((custom.take() as { defaultPortal: Record<string, unknown> }).defaultPortal, {
    portalId: "main",
  });
});

Deno.test("validateLoginPortalSelectionRequest requires contract identity", () => {
  const valid = validateLoginPortalSelectionRequest({
    contractId: "trellis.console@v1",
    portalId: null,
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { selection: Record<string, unknown> }).selection, {
    contractId: "trellis.console@v1",
    portalId: null,
  });

  assert(validateLoginPortalSelectionRequest({ contractId: "", portalId: null }).isErr());
});

Deno.test("validateDevicePortalSelectionRequest requires profile identity", () => {
  const valid = validateDevicePortalSelectionRequest({
    profileId: "reader.default",
    portalId: "main",
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { selection: Record<string, unknown> }).selection, {
    profileId: "reader.default",
    portalId: "main",
  });

  assert(validateDevicePortalSelectionRequest({ profileId: "", portalId: null }).isErr());
});

Deno.test("validateDeviceProfileRequest dedupes digests and omits preferred digest", () => {
  const valid = validateDeviceProfileRequest({
    profileId: "reader.default",
    contractId: "acme.reader@v1",
    allowedDigests: ["abc", "abc", "def"],
    reviewMode: "none",
  });
  if (valid.isErr()) throw new Error("expected valid device profile request");
  const { profile } = valid.take() as { profile: { allowedDigests: string[] } };
  assertEquals(profile.allowedDigests, ["abc", "def"]);
});

Deno.test("validateDeviceProvisionRequest builds a preregistered instance", () => {
  const valid = validateDeviceProvisionRequest({
    profileId: "reader.default",
    publicIdentityKey: "A".repeat(43),
    activationKey: "B".repeat(43),
  });
  assert(!valid.isErr());
  const value = valid.take() as { instance: Record<string, unknown> };
  assertEquals(value.instance.profileId, "reader.default");
  assertEquals(value.instance.publicIdentityKey, "A".repeat(43));
  assertEquals(value.instance.state, "registered");
});
