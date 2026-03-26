export interface DocEntry {
  title: string;
  description: string;
  href: string;
  section: string;
}

export const sections = [
  "Introduction",
  "Server Setup",
  "Development",
  "Administration",
  "Contributing",
] as const;

export type Section = (typeof sections)[number];

export const docs: DocEntry[] = [
  {
    title: "Trellis Concepts",
    description:
      "The core ideas behind Trellis — contracts, communication, auth, resources, and packages.",
    href: "/docs/concepts",
    section: "Introduction",
  },
  {
    title: "Install the Trellis CLI",
    description:
      "Install the trellis command-line tool from a GitHub release or build it with Cargo.",
    href: "/docs/install-cli",
    section: "Server Setup",
  },
  {
    title: "Prepare NATS",
    description:
      "A running NATS server with the accounts, credentials, and signing keys that Trellis expects.",
    href: "/docs/nats",
    section: "Server Setup",
  },
  {
    title: "Starting Trellis",
    description:
      "A running Trellis instance with an admin account ready for development.",
    href: "/docs/startup",
    section: "Server Setup",
  },
  {
    title: "Write a TypeScript service",
    description:
      "A working backend service that connects to Trellis, handles RPCs, and subscribes to events.",
    href: "/docs/writing-ts-services",
    section: "Development",
  },
  {
    title: "Write a SvelteKit app",
    description:
      "A working browser app that authenticates with Trellis and calls RPCs.",
    href: "/docs/writing-sveltekit-apps",
    section: "Development",
  },
  {
    title: "Install a service from an image",
    description:
      "Deploy a published service from an OCI image into a running Trellis environment.",
    href: "/docs/installing-services-image",
    section: "Administration",
  },
  {
    title: "Install a service from source",
    description:
      "Install and run a service from its source tree during development.",
    href: "/docs/installing-services",
    section: "Administration",
  },
  {
    title: "In-repo development",
    description:
      "Run the Trellis server, console, and NATS from the source tree for local development.",
    href: "/docs/in-repo-development",
    section: "Contributing",
  },
];

export function getDoc(pathname: string): DocEntry | null {
  return docs.find((doc) => doc.href === pathname) ?? null;
}

export function getPrevNext(pathname: string): {
  prev: DocEntry | null;
  next: DocEntry | null;
} {
  const index = docs.findIndex((doc) => doc.href === pathname);
  if (index === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: docs[index - 1] ?? null,
    next: docs[index + 1] ?? null,
  };
}

export function docsBySection(): { section: Section; docs: DocEntry[] }[] {
  return sections
    .map((section) => ({
      section,
      docs: docs.filter((doc) => doc.section === section),
    }))
    .filter((group) => group.docs.length > 0);
}
