import type { Config } from "../config.ts";

const TRELLIS_TEST_HOOK_NAMES = [
  "auth.admin.serviceDeployments.validateActiveCatalog",
  "auth.admin.serviceDeployments.refreshActiveContracts",
  "auth.admin.serviceDeployments.kickRuntimeAccess",
  "auth.admin.serviceDeployments.deleteCascadeRecord",
  "auth.admin.serviceDeployments.createAuthority",
  "auth.admin.serviceInstances.validateActiveCatalog",
  "auth.admin.serviceInstances.refreshActiveContracts",
  "auth.admin.serviceInstances.kickRuntimeAccess",
  "auth.admin.deviceDeployments.validateActiveCatalog",
  "auth.admin.deviceDeployments.refreshActiveContracts",
  "auth.admin.deviceDeployments.kickRuntimeAccess",
  "auth.admin.deviceDeployments.deleteCascadeRecord",
  "auth.admin.deviceDeployments.createAuthority",
  "auth.admin.deviceInstances.validateActiveCatalog",
  "auth.admin.deviceInstances.refreshActiveContracts",
  "auth.admin.deviceInstances.kickRuntimeAccess",
] as const;

export type TrellisTestHookName = typeof TRELLIS_TEST_HOOK_NAMES[number];

const TRELLIS_TEST_HOOK_NAME_SET: ReadonlySet<string> = new Set(
  TRELLIS_TEST_HOOK_NAMES,
);

function isTrellisTestHookName(name: string): name is TrellisTestHookName {
  return TRELLIS_TEST_HOOK_NAME_SET.has(name);
}

export type TrellisTestHooks = {
  failOnce(name: TrellisTestHookName): void;
};

/** Builds fail-once hooks for isolated trellis-test control-plane runs. */
export function createTrellisTestHooks(config: Config): TrellisTestHooks {
  const remaining = new Set<TrellisTestHookName>();
  for (const name of config.trellisTest?.failOnce ?? []) {
    if (!isTrellisTestHookName(name)) {
      throw new Error(`Unknown trellis-test failOnce hook: ${name}`);
    }
    remaining.add(name);
  }
  return {
    failOnce(name) {
      if (!remaining.delete(name)) return;
      throw new Error(`trellis-test hook failed: ${name}`);
    },
  };
}

export function withTrellisTestHook<T extends unknown[]>(
  hooks: TrellisTestHooks | undefined,
  name: TrellisTestHookName,
  fn: (...args: T) => Promise<unknown>,
): (...args: T) => Promise<void> {
  return async (...args) => {
    hooks?.failOnce(name);
    await fn(...args);
  };
}
