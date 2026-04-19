export interface InspectionLink {
  href: string;
  label: string;
  detail: string;
}

export const inspectionLinks: readonly InspectionLink[] = [
  {
    href: "/rpc",
    label: "RPC",
    detail: "Inspect a device record through a direct request.",
  },
  {
    href: "/operation",
    label: "Operation",
    detail: "Run a guided inspection workflow with tracked progress.",
  },
  {
    href: "/transfer",
    label: "Transfer",
    detail: "Review photos and attachments captured in the field.",
  },
  {
    href: "/kv",
    label: "KV",
    detail: "Browse cached checklists and quick lookup values.",
  },
  {
    href: "/jobs",
    label: "Jobs",
    detail: "Watch background processing for uploaded inspection data.",
  },
  {
    href: "/state",
    label: "State",
    detail: "See shared app state for the current inspection session.",
  },
] as const;
