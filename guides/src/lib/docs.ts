export interface DocEntry {
  title: string;
  description: string;
  href: string;
  section: string;
  showPageHeader?: boolean;
  sidebarGroup?: string;
  sidebarLabel?: string;
}

export interface SidebarDocEntry {
  kind: "doc";
  doc: DocEntry;
}

export interface SidebarGroupEntry {
  kind: "group";
  label: string;
  docs: DocEntry[];
}

export type SidebarItem = SidebarDocEntry | SidebarGroupEntry;

export interface GuideSidebarSection {
  section: string;
  items: SidebarItem[];
}

const designModules = import.meta.glob("$design/**/*.md");
const designRawModules = import.meta.glob("$design/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export interface DesignGroup {
  slug: string;
  title: string;
  section: string;
  description: string;
  href: string;
}

const designGroupOrder = [
  "Design Overview",
  "Design: Core",
  "Design: Auth",
  "Design: Contracts",
  "Design: Operations",
  "Design: Jobs",
  "Design: Tooling",
  "Design",
] as const;

const designGroups: DesignGroup[] = [
  {
    slug: "core",
    title: "Core Design",
    section: "Design: Core",
    description:
      "Cross-cutting Trellis architecture, storage, typing, service, and observability patterns.",
    href: "/design/core",
  },
  {
    slug: "auth",
    title: "Auth Design",
    section: "Design: Auth",
    description:
      "Identity, approvals, auth protocol, public APIs, and auth operations guidance.",
    href: "/design/auth",
  },
  {
    slug: "contracts",
    title: "Contracts Design",
    section: "Design: Contracts",
    description:
      "Canonical contract model plus TypeScript and Rust contract/runtime surfaces.",
    href: "/design/contracts",
  },
  {
    slug: "operations",
    title: "Operations Design",
    section: "Design: Operations",
    description:
      "Caller-visible async workflows and their TypeScript and Rust API surfaces.",
    href: "/design/operations",
  },
  {
    slug: "jobs",
    title: "Jobs Design",
    section: "Design: Jobs",
    description:
      "Service-private background execution and the TypeScript and Rust jobs APIs.",
    href: "/design/jobs",
  },
  {
    slug: "tooling",
    title: "Tooling Design",
    section: "Design: Tooling",
    description:
      "Trellis tooling surfaces, currently centered on the CLI design.",
    href: "/design/tooling",
  },
];

function designSectionOrderIndex(section: string) {
  return designGroupOrder.indexOf(section as (typeof designGroupOrder)[number]);
}

const acronymWords = new Map([
  ["api", "API"],
  ["auth", "Auth"],
  ["cli", "CLI"],
  ["kv", "KV"],
  ["nats", "NATS"],
  ["rust", "Rust"],
  ["svelte", "Svelte"],
  ["trellis", "Trellis"],
  ["typescript", "TypeScript"],
]);

function normalizeDesignPath(path: string) {
  return path
    .replace(/^\$design\//, "")
    .replace(/^.*\/design\//, "")
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");
}

function designRelativePathFromPath(path: string) {
  return normalizeDesignPath(path);
}

function designSlugFromPath(path: string) {
  return designRelativePathFromPath(path).replace(/(?:^|\/)README$/i, "");
}

function designFlatSlugFromPath(path: string) {
  const relativePath = designRelativePathFromPath(path);
  const basename = relativePath.split("/").filter(Boolean).pop() ??
    relativePath;
  return basename.replace(/(?:^|\/)README$/i, "");
}

function designSectionFromPath(path: string) {
  const relativePath = designRelativePathFromPath(path);
  const [group] = relativePath.split("/");

  if (relativePath === "README") {
    return "Design Overview";
  }

  switch (group) {
    case "core":
      return "Design: Core";
    case "auth":
      return "Design: Auth";
    case "contracts":
      return "Design: Contracts";
    case "jobs":
      return "Design: Jobs";
    case "operations":
      return "Design: Operations";
    case "tooling":
      return "Design: Tooling";
    default:
      return "Design";
  }
}

function parseFrontmatter(raw: string) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n*/);
  if (!match) {
    return { body: raw, fields: new Map<string, string>() };
  }

  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!parts) {
      continue;
    }
    fields.set(parts[1].toLowerCase(), parts[2].trim().replace(/^"|"$/g, ""));
  }

  return {
    body: raw.slice(match[0].length),
    fields,
  };
}

function markdownOrderFromRaw(raw: string) {
  const { fields } = parseFrontmatter(raw);
  const value = fields.get("order");
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const order = Number(value);
  return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
}

function markdownTitleFromRaw(raw: string, fallbackSlug: string) {
  const { body, fields } = parseFrontmatter(raw);
  const explicitTitle = fields.get("title");
  if (explicitTitle) {
    return explicitTitle;
  }

  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (!headingMatch) {
    return designTitleFromSlug(fallbackSlug);
  }

  return headingMatch[1]
    .replace(/^Design:\s*/i, "")
    .replace(/^Trellis\s+/i, (value) => value)
    .trim();
}

function markdownDescriptionFromRaw(raw: string, fallbackSlug: string) {
  const { body, fields } = parseFrontmatter(raw);
  const explicitDescription = fields.get("description");
  if (explicitDescription) {
    return explicitDescription;
  }

  const bodyWithoutFirstHeading = body.replace(/^#\s+.+$\n*/m, "").trim();
  const paragraphMatch = bodyWithoutFirstHeading.match(
    /^([^#\-*`|>\n].*(?:\n(?!\n|#|-|\*|`|\||>).+)*)/m,
  );
  if (!paragraphMatch) {
    return designDescriptionFromSlug(fallbackSlug);
  }

  return paragraphMatch[1].replace(/\s+/g, " ").trim();
}

function designTitleFromSlug(slug: string) {
  const titleSource = slug.split("/").filter(Boolean).pop() ?? slug;

  if (!titleSource) {
    return "Trellis Design Index";
  }

  return slug
    .split("/")
    .filter(Boolean)
    .pop()
    ?.split("-")
    .map((part) => {
      const lower = part.toLowerCase();
      if (acronymWords.has(lower)) {
        return acronymWords.get(lower);
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ") ?? titleSource;
}

function designDescriptionFromSlug(slug: string) {
  if (!slug) {
    return "How the Trellis design docs are organized and which ones to read for a given task.";
  }

  const title = designTitleFromSlug(slug);
  if (slug.startsWith("trellis-")) {
    return `${title} system design.`;
  }

  return `${title} design reference.`;
}

const designDocs: DocEntry[] = Object.keys(designModules)
  .map((path) => ({
    slug: designSlugFromPath(path),
    flatSlug: designFlatSlugFromPath(path),
    section: designSectionFromPath(path),
    raw: designRawModules[path] ?? "",
  }))
  .sort((a, b) => {
    const sectionDiff = designSectionOrderIndex(a.section) -
      designSectionOrderIndex(b.section);
    if (sectionDiff !== 0) return sectionDiff;
    const orderDiff = markdownOrderFromRaw(a.raw) - markdownOrderFromRaw(b.raw);
    if (orderDiff !== 0) return orderDiff;
    if (!a.slug) return -1;
    if (!b.slug) return 1;
    if (!a.flatSlug) return -1;
    if (!b.flatSlug) return 1;
    if (
      a.flatSlug.startsWith("trellis-") && !b.flatSlug.startsWith("trellis-")
    ) return -1;
    if (
      !a.flatSlug.startsWith("trellis-") && b.flatSlug.startsWith("trellis-")
    ) return 1;
    return designTitleFromSlug(a.flatSlug).localeCompare(
      designTitleFromSlug(b.flatSlug),
    );
  })
  .filter(({ slug }) => slug.length > 0)
  .map(({ slug, flatSlug, section, raw }) => ({
    title: markdownTitleFromRaw(raw, flatSlug),
    description: markdownDescriptionFromRaw(raw, flatSlug),
    href: `/design/${slug}`,
    section,
    showPageHeader: false,
  }));

const designOverviewDoc: DocEntry = {
  title: "Trellis Design Index",
  description:
    "How the Trellis design docs are organized and which ones to read for a given task.",
  href: "/design",
  section: "Design Overview",
  showPageHeader: false,
};

const designGroupDocs: DocEntry[] = designGroups.map((group) => ({
  title: group.title,
  description: group.description,
  href: group.href,
  section: group.section,
  showPageHeader: false,
}));

export const apiReferenceOverviewDoc: DocEntry = {
  title: "API Reference",
  description:
    "Generated TypeScript API docs and Rustdoc links for public Trellis crates.",
  href: "/api",
  section: "API Reference",
  showPageHeader: false,
};

export const apiReferenceDocs: DocEntry[] = [
  {
    title: "TypeScript API Reference",
    description:
      "Generated TypeScript API documentation from public JSDoc comments.",
    href: "/api/typescript/index.html",
    section: "API Reference",
  },
  {
    title: "trellis-client",
    description: "Rust SDK client API on docs.rs.",
    href: "https://docs.rs/trellis-client/latest/trellis_client/",
    section: "Rustdoc",
  },
  {
    title: "trellis-server",
    description: "Rust server runtime API on docs.rs.",
    href: "https://docs.rs/trellis-server/latest/trellis_server/",
    section: "Rustdoc",
  },
  {
    title: "trellis-contracts",
    description: "Rust contract types and helpers on docs.rs.",
    href: "https://docs.rs/trellis-contracts/latest/trellis_contracts/",
    section: "Rustdoc",
  },
  {
    title: "trellis-auth",
    description: "Rust authentication API on docs.rs.",
    href: "https://docs.rs/trellis-auth/latest/trellis_auth/",
    section: "Rustdoc",
  },
  {
    title: "trellis-codegen-rust",
    description: "Rust code generation API on docs.rs.",
    href: "https://docs.rs/trellis-codegen-rust/latest/trellis_codegen_rust/",
    section: "Rustdoc",
  },
  {
    title: "trellis-codegen-ts",
    description: "TypeScript code generation API on docs.rs.",
    href: "https://docs.rs/trellis-codegen-ts/latest/trellis_codegen_ts/",
    section: "Rustdoc",
  },
  {
    title: "trellis-cli",
    description: "Rust CLI crate API on docs.rs.",
    href: "https://docs.rs/trellis-cli/latest/trellis_cli/",
    section: "Rustdoc",
  },
];

export const pendingRustdocCrates = [
  "trellis-auth-adapters",
  "trellis-jobs",
  "trellis-service-jobs",
  "trellis-core-bootstrap",
] as const;

export const guideDocs: DocEntry[] = [
  {
    title: "Trellis Concepts",
    description:
      "The core ideas behind Trellis, including contract-driven authorization and why Trellis capabilities are different from OAuth scopes.",
    href: "/guides/concepts",
    section: "Introduction",
  },
  {
    title: "Install the Trellis CLI",
    description:
      "Install the trellis command-line tool from a GitHub release or build it with Cargo.",
    href: "/guides/install-trellis-cli",
    section: "Server Setup",
  },
  {
    title: "Prepare NATS",
    description:
      "A running NATS server with the accounts, credentials, and signing keys that Trellis expects.",
    href: "/guides/prepare-nats",
    section: "Server Setup",
  },
  {
    title: "Starting Trellis",
    description:
      "A running Trellis instance with an admin account ready for development.",
    href: "/guides/starting-trellis",
    section: "Server Setup",
  },
  {
    title: "Tutorial: Write a TypeScript service",
    description:
      "A step-by-step tutorial building a working backend service that connects to Trellis, handles RPCs, and stores data.",
    href: "/guides/tutorial-writing-ts-services",
    section: "Getting started",
  },
  {
    title: "Reference: Write a TypeScript service",
    description:
      "A dense, comprehensive reference covering all aspects of writing a TypeScript service.",
    href: "/guides/writing-ts-services",
    section: "Getting started",
  },
  {
    title: "Write a Rust service",
    description:
      "A working Rust backend service that connects to Trellis, handles RPCs, and subscribes to events.",
    href: "/guides/writing-rust-services",
    section: "Getting started",
  },
  {
    title: "Jobs: TypeScript",
    description:
      "Add background job processing to a TypeScript service with retry, progress tracking, and dead-letter handling.",
    href: "/guides/using-jobs-ts",
    section: "Features",
    sidebarGroup: "Jobs",
    sidebarLabel: "TS",
  },
  {
    title: "Jobs: Rust",
    description:
      "Add background job processing to a Rust service with retry, progress tracking, and dead-letter handling.",
    href: "/guides/using-jobs-rust",
    section: "Features",
    sidebarGroup: "Jobs",
    sidebarLabel: "Rust",
  },
  {
    title: "Operations: TypeScript",
    description:
      "Expose caller-visible async workflows from a TypeScript service with typed progress and cancellation.",
    href: "/guides/using-operations-ts",
    section: "Features",
    sidebarGroup: "Operations",
    sidebarLabel: "TS",
  },
  {
    title: "Operations: Rust",
    description:
      "Expose caller-visible async workflows from a Rust service with typed progress and cancellation.",
    href: "/guides/using-operations-rust",
    section: "Features",
    sidebarGroup: "Operations",
    sidebarLabel: "Rust",
  },
  {
    title: "Store resources: TypeScript",
    description:
      "Declare and use service-owned `resources.store` from a TypeScript service for large unstructured blobs.",
    href: "/guides/using-store-resources-ts",
    section: "Features",
    sidebarGroup: "Resources",
    sidebarLabel: "Store",
  },
  {
    title: "State: TypeScript",
    description:
      "Use Trellis-managed `State.*` RPCs from TypeScript apps and devices for semi-durable cloud-backed app memory with contract-lineage storage and state-version migrations.",
    href: "/guides/using-state-ts",
    section: "Features",
    sidebarGroup: "Resources",
    sidebarLabel: "State",
  },
  {
    title: "Write a SvelteKit app",
    description:
      "A working browser app that authenticates with Trellis and calls RPCs.",
    href: "/guides/writing-sveltekit-apps",
    section: "Getting started",
  },
  {
    title: "Create a custom portal",
    description:
      "Build and register a custom SvelteKit portal app for provider selection and contract approval.",
    href: "/guides/creating-custom-portal",
    section: "Advanced",
  },
  {
    title: "Devices",
    description:
      "Build a Trellis device that displays a QR activation URL and completes the device activation flow.",
    href: "/guides/devices",
    section: "Advanced",
  },
  {
    title: "Install a service from an image",
    description:
      "Deploy a published service from an OCI image into a running Trellis environment.",
    href: "/guides/install-service-from-image",
    section: "Administration",
  },
  {
    title: "Install a service from source",
    description:
      "Install and run a service from its source tree during development.",
    href: "/guides/install-service-from-source",
    section: "Administration",
  },
  {
    title: "Administer Jobs",
    description:
      "Query, cancel, replay, and monitor jobs across all services using trellis-service-jobs.",
    href: "/guides/administering-jobs",
    section: "Administration",
  },
  {
    title: "In-repo development",
    description:
      "Run the Trellis server, console, and NATS from the source tree for local development.",
    href: "/guides/in-repo-development",
    section: "Contributing",
  },
  {
    title: "Releasing Trellis",
    description:
      "Cut a Trellis release from the repo, including changelog prep, local verification, version bumps, tagging, and publish flow.",
    href: "/guides/releasing-trellis",
    section: "Contributing",
  },
];

export const designNavigationDocs: DocEntry[] = [
  designOverviewDoc,
  ...designGroupDocs,
  ...designDocs,
];

export function getGuideDoc(pathname: string): DocEntry | null {
  return guideDocs.find((doc) => doc.href === pathname) ?? null;
}

export function getGuidePrevNext(pathname: string): {
  prev: DocEntry | null;
  next: DocEntry | null;
} {
  const index = guideDocs.findIndex((doc) => doc.href === pathname);
  if (index === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: guideDocs[index - 1] ?? null,
    next: guideDocs[index + 1] ?? null,
  };
}

export function guideDocsBySection(): { section: string; docs: DocEntry[] }[] {
  const orderedSections = Array.from(
    new Set(guideDocs.map((doc) => doc.section)),
  );

  return orderedSections.map((section) => ({
    section,
    docs: guideDocs.filter((doc) => doc.section === section),
  }));
}

function guideSidebarItemsForSection(docs: DocEntry[]): SidebarItem[] {
  const items: SidebarItem[] = [];
  const groupIndexes = new Map<string, number>();

  for (const doc of docs) {
    if (!doc.sidebarGroup) {
      items.push({ kind: "doc", doc });
      continue;
    }

    const existingIndex = groupIndexes.get(doc.sidebarGroup);
    if (existingIndex === undefined) {
      groupIndexes.set(doc.sidebarGroup, items.length);
      items.push({ kind: "group", label: doc.sidebarGroup, docs: [doc] });
      continue;
    }

    const entry = items[existingIndex];
    if (entry.kind === "group") {
      entry.docs.push(doc);
    }
  }

  return items;
}

export function guideSidebarBySection(): GuideSidebarSection[] {
  const orderedSections = Array.from(
    new Set(guideDocs.map((doc) => doc.section)),
  );

  return orderedSections.map((section) => ({
    section,
    items: guideSidebarItemsForSection(
      guideDocs.filter((doc) => doc.section === section),
    ),
  }));
}

export function getDesignDoc(pathname: string): DocEntry | null {
  return designNavigationDocs.find((doc) => doc.href === pathname) ?? null;
}

export function getDesignPrevNext(pathname: string): {
  prev: DocEntry | null;
  next: DocEntry | null;
} {
  const index = designNavigationDocs.findIndex((doc) => doc.href === pathname);
  if (index === -1) {
    return { prev: null, next: null };
  }

  return {
    prev: designNavigationDocs[index - 1] ?? null,
    next: designNavigationDocs[index + 1] ?? null,
  };
}

export function designDocsBySection(): { section: string; docs: DocEntry[] }[] {
  return designGroupOrder
    .filter((section) =>
      designNavigationDocs.some((doc) => doc.section === section)
    )
    .map((section) => ({
      section,
      docs: designNavigationDocs.filter((doc) => doc.section === section),
    }));
}

export function overviewDocsBySection(): {
  section: string;
  docs: DocEntry[];
}[] {
  return [
    ...guideDocsBySection(),
    {
      section: "API Reference",
      docs: [apiReferenceOverviewDoc],
    },
    {
      section: "Design",
      docs: designGroupDocs,
    },
  ].filter((group) => group.docs.length > 0);
}

export function allPrimaryNavDocs(): DocEntry[] {
  return [
    ...guideDocs,
    apiReferenceOverviewDoc,
    designOverviewDoc,
    ...designGroupDocs,
  ];
}

export function allDocsByHref(pathname: string): DocEntry | null {
  return [
    ...guideDocs,
    apiReferenceOverviewDoc,
    ...apiReferenceDocs,
    ...designNavigationDocs,
  ].find((doc) => doc.href === pathname) ?? null;
}

export function docsForSection(section: string): DocEntry[] {
  return [
    ...guideDocs,
    apiReferenceOverviewDoc,
    ...apiReferenceDocs,
    ...designNavigationDocs,
  ].filter((doc) => doc.section === section);
}

export function docsBySection(): { section: string; docs: DocEntry[] }[] {
  const orderedSections = [
    ...guideDocsBySection(),
    {
      section: "API Reference",
      docs: [apiReferenceOverviewDoc, ...apiReferenceDocs],
    },
    ...designDocsBySection(),
  ];

  return orderedSections.map(({ section, docs }) => ({
    section,
    docs,
  }));
}

export function getDesignGroup(slug: string): DesignGroup | null {
  return designGroups.find((group) => group.slug === slug) ?? null;
}

export function getDocsForDesignGroup(slug: string): DocEntry[] {
  const group = getDesignGroup(slug);
  if (!group) {
    return [];
  }

  return designDocs.filter((doc) => doc.section === group.section);
}
