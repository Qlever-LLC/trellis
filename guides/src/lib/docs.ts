export const docs = [
  {
    title: "Prepare NATS",
    description:
      "A running NATS server with the accounts, credentials, and signing keys that Trellis expects.",
    href: "/docs/nats",
    eyebrow: "Setup",
  },
  {
    title: "Starting Trellis",
    description:
      "A running Trellis instance with an admin account ready for development.",
    href: "/docs/startup",
    eyebrow: "Setup",
  },
  {
    title: "Trellis Concepts",
    description:
      "The core ideas behind Trellis — contracts, communication, auth, resources, and packages.",
    href: "/docs/concepts",
    eyebrow: "Reference",
  },
  {
    title: "Write a TypeScript service",
    description:
      "A working backend service that connects to Trellis, handles RPCs, and subscribes to events.",
    href: "/docs/writing-ts-services",
    eyebrow: "Development",
  },
  {
    title: "Write a SvelteKit app",
    description:
      "A working browser app that authenticates with Trellis and calls RPCs.",
    href: "/docs/writing-sveltekit-apps",
    eyebrow: "Development",
  },
  {
    title: "Install and run a service",
    description:
      "A deployed service running against a live Trellis environment.",
    href: "/docs/installing-services",
    eyebrow: "Operations",
  },
] as const;

export type DocEntry = (typeof docs)[number];

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
