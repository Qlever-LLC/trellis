type Profile =
  | {
    active?: boolean;
    capabilities?: readonly string[];
    email?: string | null;
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
  "/admin/sessions": "Sessions",
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
  "/admin/events": "Events",
  "/admin/jobs": "Jobs",
  "/admin/grants": "Grants",
  "/admin/capability-groups": "Capability Groups",
  "/admin/capability-groups/edit": "Edit Capability Group",
  "/admin/capability-groups/new": "New Capability Group",
  "/admin/portals": "Portals",
  "/admin/portals/login": "Portal Policy",
  "/admin/portals/login/default": "Built-In Login Portal",
  "/admin/portals/login/selection": "Portal Routes",
  "/admin/portals/devices": "Device Portal Policy",
  "/admin/portals/devices/default": "Default Device Portal",
  "/admin/portals/devices/selection": "Device Portal Selection",
} as const;

type AppPathname = keyof typeof routeTitles;

export type NavItem = {
  href: AppPathname;
  label: string;
  icon: string;
  capabilities?: readonly string[];
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

const CAPABILITIES = {
  authorityRead: "trellis.auth::authorities.read",
  capabilityRead: "trellis.auth::capabilities.read",
  admin: "trellis.auth::admin",
  devicesRead: "trellis.auth::devices.read",
  eventlogRead: "trellis.eventlog::read",
  healthRead: "trellis.health::read",
  jobsRead: "trellis.jobs::read",
  portalsRead: "trellis.auth::portals.read",
  servicesRead: "trellis.auth::services.read",
  sessionsRead: "trellis.auth::sessions.read",
  usersRead: "trellis.auth::users.read",
} as const;

const overviewCapabilities = [
  CAPABILITIES.usersRead,
  CAPABILITIES.healthRead,
  CAPABILITIES.sessionsRead,
  CAPABILITIES.eventlogRead,
  CAPABILITIES.jobsRead,
] as const;

const navSections: NavSection[] = [
  {
    title: "Account",
    items: [{ href: "/profile", label: "Account", icon: "settings" }],
  },
  {
    title: "Operate",
    items: [
      {
        href: "/admin",
        label: "Overview",
        icon: "users",
        capabilities: overviewCapabilities,
      },
      {
        href: "/admin/health-events",
        label: "Health Events",
        icon: "alert",
        capabilities: [CAPABILITIES.healthRead],
      },
      {
        href: "/admin/sessions",
        label: "Sessions",
        icon: "activity",
        capabilities: [CAPABILITIES.sessionsRead],
      },
      {
        href: "/admin/events",
        label: "Events",
        icon: "activity",
        capabilities: [CAPABILITIES.eventlogRead],
      },
      {
        href: "/admin/jobs",
        label: "Jobs",
        icon: "clipboard",
        capabilities: [CAPABILITIES.jobsRead],
      },
      {
        href: "/admin/grants",
        label: "Grants",
        icon: "key",
        capabilities: [CAPABILITIES.authorityRead],
      },
      {
        href: "/admin/authority/plans",
        label: "Authority Plans",
        icon: "clipboard",
        capabilities: [CAPABILITIES.authorityRead],
      },
      {
        href: "/admin/capability-groups",
        label: "Capability Groups",
        icon: "key",
        capabilities: [CAPABILITIES.capabilityRead],
      },
      {
        href: "/admin/portals",
        label: "Portals",
        icon: "database",
        capabilities: [CAPABILITIES.portalsRead],
      },
    ],
  },
  {
    title: "Manage",
    items: [
      {
        href: "/admin/services",
        label: "Services",
        icon: "server",
        capabilities: [CAPABILITIES.servicesRead],
      },
      {
        href: "/admin/devices",
        label: "Devices",
        icon: "phone",
        capabilities: [CAPABILITIES.devicesRead],
      },
      {
        href: "/admin/users",
        label: "Users",
        icon: "users",
        capabilities: [CAPABILITIES.usersRead],
      },
    ],
  },
];

function hasCapabilities(
  profile: Profile,
  capabilities: readonly string[],
): boolean {
  const granted = new Set(profile?.capabilities ?? []);
  return capabilities.every((capability) => granted.has(capability));
}

export function canAccessRoute(pathname: string, profile: Profile): boolean {
  if (!pathname.startsWith("/admin")) return true;
  const item = navSections.flatMap((section) => section.items)
    .filter((candidate) =>
      pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)
    )
    .sort((left, right) => right.href.length - left.href.length)[0];
  return item !== undefined &&
    hasCapabilities(profile, item.capabilities ?? []);
}

export function requiresCapabilityRoute(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function getVisibleNavSections(profile: Profile): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        hasCapabilities(profile, item.capabilities ?? [])
      ),
    }))
    .filter((section) => section.items.length > 0);
}

function hasRouteTitle(pathname: string): pathname is keyof typeof routeTitles {
  return Object.hasOwn(routeTitles, pathname);
}

export function getPageTitle(pathname: string): string {
  return hasRouteTitle(pathname) ? routeTitles[pathname] : "Trellis";
}

export function getRoleLabel(profile: Profile): string {
  if (profile?.capabilities?.includes(CAPABILITIES.admin)) {
    return "Administrator";
  }
  if (
    profile?.capabilities?.some((capability) =>
      capability.startsWith("trellis.")
    )
  ) return "Operator";
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
