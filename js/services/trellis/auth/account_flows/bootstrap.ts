import type { AuthLogger } from "../runtime_deps.ts";
import type { AccountFlow, UserAccount } from "../schemas.ts";
import { hashKey, randomToken } from "../crypto.ts";
import type { CapabilityGroupLoader } from "../capability_groups.ts";
import { resolvesActiveAdmin } from "../capability_groups.ts";

const ADMIN_BOOTSTRAP_PATH = "/_trellis/portal/admin/bootstrap";
const ADMIN_BOOTSTRAP_TTL_MS = 24 * 60 * 60_000;
const ACCOUNT_PAGE_LIMIT = 100;

type AccountReader = {
  listPage(query: { offset?: number; limit?: number }): Promise<UserAccount[]>;
};

type AccountFlowWriter = {
  put(record: AccountFlow): Promise<void>;
};

/** Builds the built-in admin bootstrap portal URL for a durable account flow. */
export function buildAdminBootstrapPortalUrl(args: {
  baseUrl: string;
  flowId: string;
}): string {
  const url = new URL(ADMIN_BOOTSTRAP_PATH, args.baseUrl);
  url.searchParams.set("flowId", args.flowId);
  return url.toString();
}

async function hasActiveAdminAccount(
  accounts: AccountReader,
  capabilityGroupStorage?: CapabilityGroupLoader,
): Promise<boolean> {
  for (let offset = 0;; offset += ACCOUNT_PAGE_LIMIT) {
    const page = await accounts.listPage({ offset, limit: ACCOUNT_PAGE_LIMIT });
    if (
      (await Promise.all(
        page.map((account) =>
          resolvesActiveAdmin(account, capabilityGroupStorage)
        ),
      )).some((isAdmin) => isAdmin)
    ) {
      return true;
    }
    if (page.length < ACCOUNT_PAGE_LIMIT) return false;
  }
}

/** Creates and logs a fresh admin bootstrap flow when no active admin exists. */
export async function ensureAdminBootstrapFlow(args: {
  accountStorage: AccountReader;
  capabilityGroupStorage?: CapabilityGroupLoader;
  accountFlowStorage: AccountFlowWriter;
  portalBaseUrl: string;
  logger: Pick<AuthLogger, "info">;
  now?: Date;
}): Promise<{ url: string; flowId: string } | null> {
  if (
    await hasActiveAdminAccount(
      args.accountStorage,
      args.capabilityGroupStorage,
    )
  ) return null;

  const now = args.now ?? new Date();
  const flowId = randomToken(32);
  const expiresAt = new Date(now.getTime() + ADMIN_BOOTSTRAP_TTL_MS);
  const flow: AccountFlow = {
    flowIdHash: await hashKey(flowId),
    kind: "admin_bootstrap",
    targetUserId: null,
    createdByUserId: null,
    allowedProviders: null,
    capabilities: ["admin"],
    profileHint: null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consumedAt: null,
  };

  await args.accountFlowStorage.put(flow);
  const url = buildAdminBootstrapPortalUrl({
    baseUrl: args.portalBaseUrl,
    flowId,
  });
  args.logger.info(
    {
      bootstrapUrl: url,
      flowIdHash: flow.flowIdHash,
      expiresAt: flow.expiresAt,
    },
    "No active admin account exists; admin bootstrap URL is available",
  );
  return { url, flowId };
}
