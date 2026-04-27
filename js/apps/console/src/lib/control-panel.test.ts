import { deepEqual, ok } from "node:assert/strict";

import { getPageTitle, getVisibleNavSections } from "./control-panel.ts";

declare const Deno: {
  test(name: string, fn: () => void | Promise<void>): void;
};

Deno.test("control panel keeps admin navigation focused on active sections", () => {
  const sections = getVisibleNavSections({
    active: true,
    capabilities: ["admin"],
    email: "ada@example.com",
    id: "user-1",
    name: "Ada",
    origin: "github",
  });
  const labels = sections.flatMap((section) =>
    section.items.map((item) => item.label)
  );

  ok(labels.includes("Jobs"));
});

Deno.test("control panel titles cover new admin routes", () => {
  deepEqual(getPageTitle("/admin/jobs"), "Jobs");
});
