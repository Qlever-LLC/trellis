import {
  createAuthPortalsListHandler,
  createAuthPortalsLoginRoutesListHandler,
  createAuthPortalsLoginRoutesPutHandler,
  createAuthPortalsLoginRoutesRemoveHandler,
  createAuthPortalsLoginSettingsGetHandler,
  createAuthPortalsLoginSettingsUpdateHandler,
  createAuthPortalsPutHandler,
  createAuthPortalsRemoveHandler,
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
  await deps.trellis.mount(
    "Auth.Portals.List",
    createAuthPortalsListHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.Put",
    createAuthPortalsPutHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.Remove",
    createAuthPortalsRemoveHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginSettings.Get",
    createAuthPortalsLoginSettingsGetHandler(
      deps.loginPortalStorage,
      federatedProviders,
    ),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginSettings.Update",
    createAuthPortalsLoginSettingsUpdateHandler(
      deps.loginPortalStorage,
      federatedProviders,
    ),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginRoutes.List",
    createAuthPortalsLoginRoutesListHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginRoutes.Put",
    createAuthPortalsLoginRoutesPutHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginRoutes.Remove",
    createAuthPortalsLoginRoutesRemoveHandler(deps.loginPortalStorage),
  );
}
