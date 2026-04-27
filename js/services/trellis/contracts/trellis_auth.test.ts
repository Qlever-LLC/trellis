import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";

import { trellisAuth } from "./trellis_auth.ts";

const app = defineAppContract(
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
  assertEquals(app.CONTRACT.uses?.auth, {
    contract: "trellis.auth@v1",
    rpc: {
      call: [
        "Auth.ListApprovals",
        "Auth.Logout",
        "Auth.Me",
      ],
    },
  });
});

Deno.test("trellisAuth.useDefaults exposes baseline rpc api surface", () => {
  assertEquals(app.API.used.rpc["Auth.Me"].subject, "rpc.v1.Auth.Me");
  assertEquals(app.API.used.rpc["Auth.Logout"].subject, "rpc.v1.Auth.Logout");
  assertEquals(
    app.API.used.rpc["Auth.ListApprovals"].subject,
    "rpc.v1.Auth.ListApprovals",
  );
});
