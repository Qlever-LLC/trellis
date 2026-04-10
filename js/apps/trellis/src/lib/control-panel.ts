import type { AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";

type Profile = AuthMeOutput["user"] | null | undefined;

export type NavItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
  adminOnly?: boolean;
};

const navSections: NavSection[] = [
  {
    title: "Personal",
    items: [{ href: "/profile", label: "Profile" }]
  },
  {
    title: "Operations",
    adminOnly: true,
    items: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/users", label: "Users" },
      { href: "/admin/sessions", label: "Sessions" },
      { href: "/admin/services", label: "Services" },
      { href: "/admin/contracts", label: "Contracts" },
      { href: "/admin/apps", label: "Approved Apps" },
      { href: "/admin/jobs", label: "Jobs" }
    ]
  },
];

const routeTitles: Record<string, string> = {
  "/profile": "Profile",
  "/admin": "Overview",
  "/admin/users": "Users",
  "/admin/sessions": "Sessions",
  "/admin/services": "Services",
  "/admin/services/new": "Install Service",
  "/admin/contracts": "Contracts",
  "/admin/apps": "Approved Apps",
  "/admin/jobs": "Jobs"
};

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
      items: section.items.filter((item) => !item.adminOnly || admin)
    }));
}

export function getPageTitle(pathname: string): string {
  return routeTitles[pathname] ?? "Trellis";
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
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || name.slice(0, 2).toUpperCase();
}
