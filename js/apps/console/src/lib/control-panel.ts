type Profile =
  | {
    active?: boolean;
    capabilities?: readonly string[];
    email?: string;
    id?: string;
    name?: string | null;
    origin?: string;
  }
  | null
  | undefined;

export const routeTitles = {
  "/profile": "Account",
  "/admin": "Overview",
  "/admin/users": "Users",
  "/admin/users/edit": "Edit User",
  "/admin/capability-groups": "Capability Groups",
  "/admin/sessions": "Sessions",
  "/admin/grants": "Grants",
  "/admin/authority/plans": "Authority Plans",
  "/admin/services": "Services",
  "/admin/devices": "Devices",
  "/admin/sessions/revoke": "Revoke Session",
  "/admin/sessions/kick": "Kick Connection",
  "/admin/services/new": "Create Service Deployment",
  "/admin/devices/profiles/new": "Create Device Deployment",
  "/admin/devices/profiles/disable": "Disable Device Deployment",
  "/admin/devices/instances/provision": "Provision Device Instance",
  "/admin/devices/instances/disable": "Disable Device Instance",
  "/admin/devices/activations/revoke": "Revoke Device Activation",
  "/admin/devices/reviews/decide": "Decide Device Review",
  "/admin/health-events": "Health",
  "/admin/apps": "Apps",
  "/admin/apps/revoke": "Revoke App Approval",
  "/admin/jobs": "Jobs",
  "/admin/portals": "Portals",
  "/admin/portals/login": "Portal Policy",
  "/admin/portals/login/default": "Built-In Login Portal",
  "/admin/portals/login/selection": "Portal Routes",
  "/admin/portals/devices": "Device Portal Policy",
  "/admin/portals/devices/default": "Default Device Portal",
  "/admin/portals/devices/selection": "Device Portal Selection",
  "/profile/grants/revoke": "Revoke Account Access",
} as const;

type AppPathname = keyof typeof routeTitles;

export type NavItem = {
  href: AppPathname;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
  adminOnly?: boolean;
};

const navSections: NavSection[] = [
  {
    title: "Account",
    items: [{ href: "/profile", label: "Account", icon: "settings" }],
  },
  {
    title: "Operate",
    adminOnly: true,
    items: [
      { href: "/admin", label: "Overview", icon: "users" },
      { href: "/admin/health-events", label: "Health Events", icon: "alert" },
      { href: "/admin/sessions", label: "Sessions", icon: "activity" },
      { href: "/admin/jobs", label: "Jobs", icon: "clipboard" },
      { href: "/admin/grants", label: "Grants", icon: "key" },
      {
        href: "/admin/authority/plans",
        label: "Authority Plans",
        icon: "clipboard",
      },
      {
        href: "/admin/capability-groups",
        label: "Capability Groups",
        icon: "shield",
      },
      { href: "/admin/portals", label: "Portals", icon: "database" },
    ],
  },
  {
    title: "Manage",
    adminOnly: true,
    items: [
      {
        href: "/admin/services",
        label: "Services",
        icon: "server",
      },
      { href: "/admin/devices", label: "Devices", icon: "phone" },
      { href: "/admin/users", label: "Users", icon: "users" },
    ],
  },
];

export function requiresAdminRoute(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isAdmin(profile: Profile): boolean {
  return profile?.capabilities?.includes("admin") ?? false;
}

export function getVisibleNavSections(profile: Profile): NavSection[] {
  const admin = isAdmin(profile);
  return navSections
    .filter((section) => !section.adminOnly || admin)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly || admin),
    }));
}

function hasRouteTitle(pathname: string): pathname is keyof typeof routeTitles {
  return Object.hasOwn(routeTitles, pathname);
}

export function getPageTitle(pathname: string): string {
  return hasRouteTitle(pathname) ? routeTitles[pathname] : "Trellis";
}

export function getRoleLabel(profile: Profile): string {
  if (isAdmin(profile)) return "Administrator";
  if (profile?.capabilities?.includes("service")) return "Service principal";
  return "Member";
}

export function getInitials(profile: Profile): string {
  const name = profile?.name?.trim();
  if (!name) return "TR";

  const parts = name.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part: string) =>
    part[0]?.toUpperCase() ?? ""
  ).join("");
  return initials || name.slice(0, 2).toUpperCase();
}
