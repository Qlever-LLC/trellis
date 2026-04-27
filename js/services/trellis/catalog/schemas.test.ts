import { assert, assertFalse } from "@std/assert";
import Value from "typebox/value";

import { ServiceRegistrySchema } from "./schemas.ts";

Deno.test("ServiceRegistrySchema validates createdAt field", () => {
  const service = {
    displayName: "test-service",
    active: true,
    capabilities: ["service"],
    description: "Test service",
    createdAt: new Date().toISOString(),
  };

  assert(Value.Check(ServiceRegistrySchema, service));
});

Deno.test("ServiceRegistrySchema requires createdAt", () => {
  const service = {
    displayName: "test-service",
    active: true,
    capabilities: ["service"],
    description: "Test service",
  };

  assertFalse(Value.Check(ServiceRegistrySchema, service));
});
