import { assert, assertEquals } from "@std/assert";
import { defineAppContract } from "@qlever-llc/trellis";

import { trellisAuth } from "./trellis_auth.ts";

const app = defineAppContract(
  () => ({
    id: "test.portal@v1",
    displayName: "Test Portal",
    description: "Exercise auth defaults in contract authoring.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: {
            call: [
              "Auth.Identities.List",
              "Auth.Sessions.Logout",
              "Auth.Sessions.Me",
            ],
          },
        }),
      },
    },
  }),
);

Deno.test("trellisAuth.use records explicit auth rpc uses", () => {
  const uses = app.CONTRACT.uses as
    | { required?: { auth?: unknown } }
    | undefined;
  assertEquals(uses?.required?.auth, {
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
  assertEquals(
    app.API.used.rpc["Auth.Sessions.Me"].subject,
    "rpc.v1.Auth.Sessions.Me",
  );
  assertEquals(
    app.API.used.rpc["Auth.Sessions.Logout"].subject,
    "rpc.v1.Auth.Sessions.Logout",
  );
  assertEquals(
    app.API.used.rpc["Auth.Identities.List"].subject,
    "rpc.v1.Auth.Identities.List",
  );
});

Deno.test("trellis auth contract exposes portal-scoped routes only", () => {
  assert("Auth.Portals.Get" in trellisAuth.API.owned.rpc);
  assert("Auth.Portals.Routes.Put" in trellisAuth.API.owned.rpc);
  assert("Auth.Portals.Routes.Remove" in trellisAuth.API.owned.rpc);
  assert(!("Auth.Portals.LoginRoutes.List" in trellisAuth.API.owned.rpc));
  assert(!("Auth.Portals.LoginRoutes.Put" in trellisAuth.API.owned.rpc));
  assert(!("Auth.Portals.LoginRoutes.Remove" in trellisAuth.API.owned.rpc));
});
