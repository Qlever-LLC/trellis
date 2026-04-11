import { assert, assertEquals } from "@std/assert";
import { TRELLIS_AUTH_RPC } from "../../contracts/trellis_auth.ts";

import {
  normalizeDigestList,
  validateLoginPortalSelectionRequest,
  validatePortalRequest,
  validatePortalDefaultRequest,
  validateWorkloadProvisionRequest,
  validateWorkloadPortalSelectionRequest,
  validateWorkloadProfileRequest,
} from "./shared.ts";

Deno.test("normalizeDigestList preserves order and removes duplicates", () => {
  assertEquals(normalizeDigestList(["b", "a", "b", "c", "a"]), ["b", "a", "c"]);
});

Deno.test("auth contract exposes only portal selection and workload admin RPCs", () => {
  const methods = Object.keys(TRELLIS_AUTH_RPC);
  assert(methods.includes("Auth.CreatePortal"));
  assert(methods.includes("Auth.ListPortals"));
  assert(methods.includes("Auth.DisablePortal"));
  assert(methods.includes("Auth.GetLoginPortalDefault"));
  assert(methods.includes("Auth.SetLoginPortalDefault"));
  assert(methods.includes("Auth.ListLoginPortalSelections"));
  assert(methods.includes("Auth.SetLoginPortalSelection"));
  assert(methods.includes("Auth.ClearLoginPortalSelection"));
  assert(methods.includes("Auth.GetWorkloadPortalDefault"));
  assert(methods.includes("Auth.SetWorkloadPortalDefault"));
  assert(methods.includes("Auth.ListWorkloadPortalSelections"));
  assert(methods.includes("Auth.SetWorkloadPortalSelection"));
  assert(methods.includes("Auth.ClearWorkloadPortalSelection"));
  assert(methods.includes("Auth.CreateWorkloadProfile"));
  assert(methods.includes("Auth.ListWorkloadProfiles"));
  assert(methods.includes("Auth.DisableWorkloadProfile"));
  assert(methods.includes("Auth.ProvisionWorkloadInstance"));
  assert(methods.includes("Auth.ListWorkloadInstances"));
  assert(methods.includes("Auth.DisableWorkloadInstance"));
  assert(methods.includes("Auth.ActivateWorkload"));
  assert(methods.includes("Auth.GetWorkloadActivationStatus"));
  assert(methods.includes("Auth.ListWorkloadActivations"));
  assert(methods.includes("Auth.RevokeWorkloadActivation"));
  assert(methods.includes("Auth.ListWorkloadActivationReviews"));
  assert(methods.includes("Auth.DecideWorkloadActivationReview"));
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

Deno.test("validateWorkloadPortalSelectionRequest requires profile identity", () => {
  const valid = validateWorkloadPortalSelectionRequest({
    profileId: "reader.default",
    portalId: "main",
  });
  assert(!valid.isErr());
  assertEquals((valid.take() as { selection: Record<string, unknown> }).selection, {
    profileId: "reader.default",
    portalId: "main",
  });

  assert(validateWorkloadPortalSelectionRequest({ profileId: "", portalId: null }).isErr());
});

Deno.test("validateWorkloadProfileRequest dedupes digests and omits preferred digest", () => {
  const valid = validateWorkloadProfileRequest({
    profileId: "reader.default",
    contractId: "acme.reader@v1",
    allowedDigests: ["abc", "abc", "def"],
    reviewMode: "none",
  });
  if (valid.isErr()) throw new Error("expected valid workload profile request");
  const { profile } = valid.take() as { profile: { allowedDigests: string[] } };
  assertEquals(profile.allowedDigests, ["abc", "def"]);
});

Deno.test("validateWorkloadProvisionRequest builds a preregistered instance", () => {
  const valid = validateWorkloadProvisionRequest({
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
