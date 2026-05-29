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
  const operateSection = sections.find((section) =>
    section.title === "Operate"
  );
  const manageSection = sections.find((section) => section.title === "Manage");

  deepEqual(operateSection?.items.map((item) => item.label), [
    "Overview",
    "Health Events",
    "Sessions",
    "Jobs",
    "Grants",
    "Capability Groups",
    "Portals",
  ]);

  deepEqual(manageSection?.items[0], {
    href: "/admin/services",
    label: "Services",
    icon: "server",
  });
  deepEqual(manageSection?.items[1], {
    href: "/admin/devices",
    label: "Devices",
    icon: "phone",
  });
  deepEqual(manageSection?.items[2], {
    href: "/admin/users",
    label: "Users",
    icon: "users",
  });
  ok(labels.includes("Jobs"));
  ok(!labels.includes("API Catalog"));
  ok(labels.includes("Account"));
  ok(!labels.includes("Settings"));
  ok(labels.includes("Grants"));
  ok(!labels.includes("Deployments"));
  ok(labels.includes("Devices"));
  ok(!labels.includes("Authority"));
  ok(hrefs.includes("/admin/services"));
  ok(hrefs.includes("/admin/devices"));
  ok(!hrefs.map(String).includes("/admin/authority"));
  ok(!hrefs.map(String).includes("/admin/deployments"));
  ok(hrefs.includes("/admin/grants"));
  ok(!hrefs.map(String).includes("/admin/app-grants"));
  ok(!hrefs.map(String).includes("/admin/services/instances"));
  ok(!hrefs.map(String).includes("/admin/apis"));
  ok(!hrefs.map(String).includes("/admin/devices/activations"));
  ok(!hrefs.map(String).includes("/admin/devices/instances"));
  ok(!hrefs.map(String).includes("/admin/devices/reviews"));
  ok(hrefs.includes("/admin/portals"));
});

Deno.test("control panel titles cover new admin routes", () => {
  deepEqual(getPageTitle("/admin/services"), "Services");
  deepEqual(getPageTitle("/admin/devices"), "Devices");
  deepEqual(getPageTitle("/admin/jobs"), "Jobs");
  deepEqual(getPageTitle("/admin/grants"), "Grants");
});
