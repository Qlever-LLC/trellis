import { assertEquals } from "@std/assert";
import {
  type GroupMappingConfig,
  mapProviderGroups,
} from "./group_mappings.ts";

const config = {
  auth: {
    groupMappings: {
      providers: {
        okta: {
          "trellis-admins": ["admin"],
          "trellis-users": ["users"],
        },
      },
    },
  },
} satisfies GroupMappingConfig;

Deno.test("provider group mappings normalize and deduplicate groups", () => {
  assertEquals(
    mapProviderGroups(config, "okta", [
      " TRELLIS-ADMINS ",
      "TRELLIS-ADMINS",
      "unknown",
    ]),
    {
      capabilityGroups: ["admin"],
      unmappedGroups: ["unknown"],
    },
  );
});
