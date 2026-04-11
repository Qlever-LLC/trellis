import { assertEquals } from "@std/assert";
import { defineContract } from "@qlever-llc/trellis";

import { trellisAuth } from "./trellis_auth.ts";

const portal = defineContract({
  id: "test.portal@v1",
  displayName: "Test Portal",
  description: "Exercise auth defaults in contract authoring.",
  kind: "portal",
  uses: {
    auth: trellisAuth.useDefaults({
      rpc: {
        call: ["Auth.Me", "Auth.ListApprovals"],
      },
    }),
  },
});

Deno.test("trellisAuth.useDefaults adds baseline auth rpc uses once", () => {
  assertEquals(portal.CONTRACT.uses?.auth, {
    contract: "trellis.auth@v1",
    rpc: {
      call: [
        "Auth.Me",
        "Auth.Logout",
        "Auth.RenewBindingToken",
        "Auth.ListApprovals",
      ],
    },
  });
});

Deno.test("trellisAuth.useDefaults exposes baseline rpc api surface", () => {
  assertEquals(portal.API.used.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(portal.API.used.rpc["Auth.Logout"].subject, "rpc.v1.Auth.Logout");
  assertEquals(
    portal.API.used.rpc["Auth.RenewBindingToken"].subject,
    "rpc.v1.Auth.RenewBindingToken",
  );
  assertEquals(
    portal.API.used.rpc["Auth.ListApprovals"].subject,
    "rpc.v1.Auth.ListApprovals",
  );
});
