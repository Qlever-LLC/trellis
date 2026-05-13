import {
  createAuthPortalsListHandler,
  createAuthPortalsLoginRoutesListHandler,
  createAuthPortalsLoginRoutesPutHandler,
  createAuthPortalsLoginRoutesRemoveHandler,
  createAuthPortalsLoginSettingsGetHandler,
  createAuthPortalsLoginSettingsUpdateHandler,
} from "../admin/portals_rpc.ts";
import type { SqlLoginPortalRepository } from "../storage.ts";
import type { RpcRegistrar } from "./types.ts";

export async function registerPortalAdminRpcs(deps: {
  trellis: RpcRegistrar;
  loginPortalStorage: SqlLoginPortalRepository;
}): Promise<void> {
  await deps.trellis.mount(
    "Auth.Portals.List",
    createAuthPortalsListHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginSettings.Get",
    createAuthPortalsLoginSettingsGetHandler(deps.loginPortalStorage),
  );
  await deps.trellis.mount(
    "Auth.Portals.LoginSettings.Update",
    createAuthPortalsLoginSettingsUpdateHandler(deps.loginPortalStorage),
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
