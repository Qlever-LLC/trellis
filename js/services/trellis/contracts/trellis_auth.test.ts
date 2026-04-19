import { assertEquals } from "@std/assert";
import { definePortalContract } from "@qlever-llc/trellis";

import { trellisAuth } from "./trellis_auth.ts";

const portal = definePortalContract(
  () => ({
    id: "test.portal@v1",
    displayName: "Test Portal",
    description: "Exercise auth defaults in contract authoring.",
    uses: {
      auth: trellisAuth.useDefaults({
        rpc: {
          call: ["Auth.Me", "Auth.ListApprovals"],
        },
      }),
    },
  }),
);

Deno.test("trellisAuth.useDefaults adds baseline auth rpc uses once", () => {
  assertEquals(portal.CONTRACT.uses?.auth, {
    contract: "trellis.auth@v1",
    rpc: {
      call: [
        "Auth.Me",
        "Auth.Logout",
        "Auth.ListApprovals",
      ],
    },
  });
});

Deno.test("trellisAuth.useDefaults exposes baseline rpc api surface", () => {
  assertEquals(portal.API.used.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(portal.API.used.rpc["Auth.Logout"].subject, "rpc.v1.Auth.Logout");
  assertEquals(
    portal.API.used.rpc["Auth.ListApprovals"].subject,
    "rpc.v1.Auth.ListApprovals",
  );
});
