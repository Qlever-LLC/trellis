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
  const hrefs = sections.flatMap((section) =>
    section.items.map((item) => item.href)
  );
  const manageSection = sections.find((section) => section.title === "Manage");

  deepEqual(manageSection?.items[0], {
    href: "/admin/deployments",
    label: "Deployments",
    icon: "server",
  });
  ok(labels.includes("Jobs"));
  ok(labels.includes("Profile"));
  ok(!labels.includes("Settings"));
  ok(!labels.includes("Service Deployments"));
  ok(!labels.includes("Device Deployments"));
  ok(hrefs.includes("/admin/services/instances"));
  ok(hrefs.includes("/admin/devices/activations"));
  ok(hrefs.includes("/admin/devices/instances"));
  ok(hrefs.includes("/admin/devices/reviews"));
});

Deno.test("control panel titles cover new admin routes", () => {
  deepEqual(getPageTitle("/admin/deployments"), "Deployments");
  deepEqual(getPageTitle("/admin/services"), "Service Deployments");
  deepEqual(getPageTitle("/admin/devices/profiles"), "Device Deployments");
  deepEqual(getPageTitle("/admin/jobs"), "Jobs");
});
