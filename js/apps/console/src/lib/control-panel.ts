type Profile = {
  active?: boolean;
  capabilities?: readonly string[];
  email?: string;
  id?: string;
  name?: string | null;
  origin?: string;
} | null | undefined;

export const routeTitles = {
  "/profile": "Profile",
  "/admin": "Overview",
  "/admin/users": "Users",
  "/admin/users/edit": "Edit User",
  "/admin/app-grants": "App Grants",
  "/admin/app-grants/edit": "Edit App Grant",
  "/admin/app-grants/disable": "Disable App Grant",
  "/admin/sessions": "Sessions",
  "/admin/deployments": "Deployments",
  "/admin/services": "Service Deployments",
  "/admin/sessions/revoke": "Revoke Session",
  "/admin/sessions/kick": "Kick Connection",
  "/admin/services/new": "Create Service Deployment",
  "/admin/services/contracts": "Service Contracts",
  "/admin/services/instances": "Service Instances",
  "/admin/health-events": "Health",
  "/admin/contracts": "Contracts",
  "/admin/apps": "Apps",
  "/admin/apps/revoke": "Revoke App Approval",
  "/admin/jobs": "Jobs",
  "/admin/portals": "Registry",
  "/admin/portals/profiles/edit": "Edit Portal Profile",
  "/admin/portals/profiles/disable": "Disable Portal Profile",
  "/admin/portals/login": "Login Portal Policy",
  "/admin/portals/login/default": "Default Login Portal",
  "/admin/portals/login/selection": "Login Portal Selection",
  "/admin/portals/devices": "Device Portal Policy",
  "/admin/devices/profiles": "Device Deployments",
  "/admin/portals/devices/default": "Default Device Portal",
  "/admin/portals/devices/selection": "Device Portal Selection",
  "/admin/devices/profiles/new": "Create Device Deployment",
  "/admin/devices/profiles/disable": "Disable Device Deployment",
  "/admin/devices/instances": "Device Instances",
  "/admin/devices/instances/provision": "Provision Device Instance",
  "/admin/devices/instances/disable": "Disable Device Instance",
  "/admin/devices/activations": "Device Activations",
  "/admin/devices/activations/revoke": "Revoke Device Activation",
  "/admin/devices/reviews": "Device Reviews",
  "/admin/devices/reviews/decide": "Decide Device Review",
  "/profile/grants/revoke": "Revoke Profile Grant",
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
    title: "Operate",
    adminOnly: true,
    items: [
      { href: "/admin", label: "Overview", icon: "users" },
      { href: "/admin/health-events", label: "Health Events", icon: "alert" },
      { href: "/admin/sessions", label: "Sessions", icon: "activity" },
      { href: "/admin/jobs", label: "Jobs", icon: "clipboard" },
      { href: "/admin/contracts", label: "Contracts", icon: "shield" },
    ],
  },
  {
    title: "Manage",
    adminOnly: true,
    items: [
      { href: "/admin/deployments", label: "Deployments", icon: "server" },
      {
        href: "/admin/services/instances",
        label: "Service Instances",
        icon: "box",
      },
      { href: "/admin/devices/instances", label: "Devices", icon: "phone" },
      {
        href: "/admin/devices/activations",
        label: "Device Activations",
        icon: "activity",
      },
      {
        href: "/admin/devices/reviews",
        label: "Device Reviews",
        icon: "clipboard",
      },
      { href: "/admin/users", label: "Users", icon: "users" },
      { href: "/admin/app-grants", label: "Access", icon: "key" },
      { href: "/admin/portals", label: "Registry", icon: "database" },
      { href: "/profile", label: "Profile", icon: "settings" },
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
