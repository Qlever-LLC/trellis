import { assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";

import { trellisAuth } from "./trellis_auth.ts";

const app = defineAppContract(
  () => ({
    id: "test.portal@v1",
    displayName: "Test Portal",
    description: "Exercise auth defaults in contract authoring.",
    uses: {
      auth: trellisAuth.use({
        rpc: {
          call: ["Auth.Identities.List", "Auth.Sessions.Logout", "Auth.Sessions.Me"],
        },
      }),
    },
  }),
);

Deno.test("trellisAuth.use records explicit auth rpc uses", () => {
  const uses = app.CONTRACT.uses as { auth?: unknown } | undefined;
  assertEquals(uses?.auth, {
    contract: "trellis.auth@v1",
    rpc: {
      call: [
        "Auth.Identities.List",
        "Auth.Sessions.Logout",
        "Auth.Sessions.Me",
      ],
    },
  });
});

Deno.test("trellisAuth.use exposes explicit rpc api surface", () => {
  assertEquals(app.API.used.rpc["Auth.Sessions.Me"].subject, "rpc.v1.Auth.Sessions.Me");
  assertEquals(app.API.used.rpc["Auth.Sessions.Logout"].subject, "rpc.v1.Auth.Sessions.Logout");
  assertEquals(
    app.API.used.rpc["Auth.Identities.List"].subject,
    "rpc.v1.Auth.Identities.List",
  );
});
