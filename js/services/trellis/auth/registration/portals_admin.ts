import {
  createAuthPortalsGetHandler,
  createAuthPortalsListHandler,
  createAuthPortalsLoginSettingsGetHandler,
  createAuthPortalsLoginSettingsUpdateHandler,
  createAuthPortalsPutHandler,
  createAuthPortalsRemoveHandler,
  createAuthPortalsRoutesPutHandler,
  createAuthPortalsRoutesRemoveHandler,
  type FederatedProviderView,
} from "../admin/portals_rpc.ts";
import type { Config } from "../../config.ts";
import type { SqlLoginPortalRepository } from "../storage.ts";
import type { RpcRegistrar } from "./types.ts";

function federatedProviderViews(config: Config): FederatedProviderView[] {
  return Object.entries(config.oauth.providers)
    .map(([id, provider]) => ({
      id,
      displayName: provider.displayName,
      type: provider.type,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function registerPortalAdminRpcs(deps: {
  trellis: RpcRegistrar;
  config: Config;
  loginPortalStorage: SqlLoginPortalRepository;
}): Promise<void> {
  const federatedProviders = federatedProviderViews(deps.config);
  await deps.trellis.handle.rpc.auth.portalsList(
    createAuthPortalsListHandler(deps.loginPortalStorage),
  );
  await deps.trellis.handle.rpc.auth.portalsGet(
    createAuthPortalsGetHandler(deps.loginPortalStorage, federatedProviders),
  );
  await deps.trellis.handle.rpc.auth.portalsPut(
    createAuthPortalsPutHandler(deps.loginPortalStorage),
  );
  await deps.trellis.handle.rpc.auth.portalsRemove(
    createAuthPortalsRemoveHandler(deps.loginPortalStorage),
  );
  await deps.trellis.handle.rpc.auth.portalsLoginSettingsGet(
    createAuthPortalsLoginSettingsGetHandler(
      deps.loginPortalStorage,
      federatedProviders,
    ),
  );
  await deps.trellis.handle.rpc.auth.portalsLoginSettingsUpdate(
    createAuthPortalsLoginSettingsUpdateHandler(
      deps.loginPortalStorage,
      federatedProviders,
    ),
  );
  await deps.trellis.handle.rpc.auth.portalsRoutesPut(
    createAuthPortalsRoutesPutHandler(deps.loginPortalStorage),
  );
  await deps.trellis.handle.rpc.auth.portalsRoutesRemove(
    createAuthPortalsRoutesRemoveHandler(deps.loginPortalStorage),
  );
}
