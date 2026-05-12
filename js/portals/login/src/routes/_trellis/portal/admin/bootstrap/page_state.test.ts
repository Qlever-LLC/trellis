import { assertEquals } from "@std/assert";

import {
  adminBootstrapFlowId,
  formatAdminBootstrapError,
} from "./page_state.ts";

Deno.test("adminBootstrapFlowId reads a non-empty flow id", () => {
  assertEquals(
    adminBootstrapFlowId(
      new URL(
        "https://auth.example.com/_trellis/portal/admin/bootstrap?flowId=flow-1",
      ),
    ),
    "flow-1",
  );
});

Deno.test("adminBootstrapFlowId treats missing and blank values as absent", () => {
  assertEquals(
    adminBootstrapFlowId(
      new URL("https://auth.example.com/_trellis/portal/admin/bootstrap"),
    ),
    null,
  );
  assertEquals(
    adminBootstrapFlowId(
      new URL(
        "https://auth.example.com/_trellis/portal/admin/bootstrap?flowId=%20",
      ),
    ),
    null,
  );
});

Deno.test("formatAdminBootstrapError maps known backend errors", () => {
  assertEquals(
    formatAdminBootstrapError({ status: 410, error: "flow_expired" }),
    "This bootstrap request has expired. Start bootstrap again.",
  );
  assertEquals(
    formatAdminBootstrapError({ status: 409, error: "local_identity_exists" }),
    "That username is already in use. Choose a different username.",
  );
});

Deno.test("formatAdminBootstrapError keeps raw fallback for unknown errors", () => {
  assertEquals(
    formatAdminBootstrapError({ status: 418, error: "teapot" }),
    "Bootstrap failed (418): teapot",
  );
});

Deno.test("formatAdminBootstrapError keeps status fallback when error body is absent", () => {
  assertEquals(
    formatAdminBootstrapError({ status: 500, error: null }),
    "Bootstrap failed with status 500.",
  );
});
