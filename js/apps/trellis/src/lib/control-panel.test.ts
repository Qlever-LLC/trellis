import type { AuthMeOutput } from "@qlever-llc/trellis-sdk-auth";
import { assertEquals } from "@std/assert";

import { getPageTitle, getVisibleNavSections } from "./control-panel.ts";

Deno.test("admin navigation includes the jobs screen", () => {
  const profile: AuthMeOutput["user"] = {
    id: "admin",
    origin: "trellis",
    active: true,
    name: "Admin User",
    email: "admin@example.com",
    capabilities: ["admin"],
  };
  const sections = getVisibleNavSections(profile);
  const operations = sections.find((section) => section.title === "Operations");

  assertEquals(operations?.items.some((item) => item.href === "/admin/jobs"), true);
  assertEquals(getPageTitle("/admin/jobs"), "Jobs");
});
