import {
  AuthError,
  UnexpectedError,
  ValidationError,
} from "@qlever-llc/trellis";
import { Result } from "@qlever-llc/result";

import type {
  LoginPortalRecord,
  LoginPortalRoute,
  LoginPortalSettings,
} from "../schemas.ts";
import type {
  SelectedLoginPortal,
  SqlLoginPortalRepository,
} from "../storage.ts";

type RpcUser = { capabilities?: string[] };

type LoginSettingsUpdateInput = {
  portalId: string;
  localRegistrationEnabled: boolean;
  federatedRegistrationEnabled: boolean;
  selfRegisteredAccountActive: boolean;
  defaultCapabilities: string[];
  defaultCapabilityGroups: string[];
};

type LoginRoutePutInput = {
  routeId?: string;
  portalId: string;
  contractId?: string | null;
  origin?: string | null;
  disabled?: boolean;
};

function isAdmin(user: RpcUser): boolean {
  return user.capabilities?.includes("admin") ?? false;
}

function insufficientPermissions() {
  return Result.err(new AuthError({ reason: "insufficient_permissions" }));
}

function invalid(
  path: string,
  message: string,
  context?: Record<string, unknown>,
) {
  return Result.err(
    new ValidationError({
      errors: [{ path, message }],
      ...(context ? { context } : {}),
    }),
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function responseForSelected(selected: SelectedLoginPortal) {
  return {
    portal: selected.portal,
    settings: selected.settings,
    defaultCapabilities: selected.defaultCapabilities,
    defaultCapabilityGroups: selected.defaultCapabilityGroups,
  };
}

function routeIdFor(input: LoginRoutePutInput): string {
  if (input.routeId) return input.routeId;
  const contract = input.contractId?.trim() || "any-contract";
  const origin = input.origin?.trim() || "any-origin";
  return `${input.portalId}:${contract}:${origin}`;
}

/** Creates the admin login portal list RPC handler. */
export function createAuthPortalsListHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({ context: { caller } }: { context: { caller: RpcUser } }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    try {
      const portals = await storage.listPortals();
      return Result.ok({ portals });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin default login settings read RPC handler. */
export function createAuthPortalsLoginSettingsGetHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    try {
      const selected = await storage.getSelectedByPortalId(input.portalId);
      if (!selected) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      return Result.ok(responseForSelected(selected));
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin default login settings update RPC handler. */
export function createAuthPortalsLoginSettingsUpdateHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: LoginSettingsUpdateInput;
    context: { caller: RpcUser };
  }): Promise<
    Result<
      {
        portal: LoginPortalRecord;
        settings: LoginPortalSettings;
        defaultCapabilities: string[];
        defaultCapabilityGroups: string[];
      },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    if (!isAdmin(caller)) return insufficientPermissions();
    try {
      const selected = await storage.updateSelectedLoginPortal({
        portalId: input.portalId,
        settings: {
          portalId: input.portalId,
          localRegistrationEnabled: input.localRegistrationEnabled,
          federatedRegistrationEnabled: input.federatedRegistrationEnabled,
          selfRegisteredAccountActive: input.selfRegisteredAccountActive,
          updatedAt: new Date().toISOString(),
        },
        defaultCapabilities: input.defaultCapabilities,
        defaultCapabilityGroups: input.defaultCapabilityGroups,
      });
      if (!selected) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      return Result.ok(responseForSelected(selected));
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login route list RPC handler. */
export function createAuthPortalsLoginRoutesListHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({ context: { caller } }: { context: { caller: RpcUser } }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    try {
      const routes = await storage.listRoutes();
      return Result.ok({ routes });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login route upsert RPC handler. */
export function createAuthPortalsLoginRoutesPutHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: LoginRoutePutInput;
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { route: LoginPortalRoute },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    if (!isAdmin(caller)) return insufficientPermissions();
    try {
      const portal = await storage.getPortal(input.portalId);
      if (!portal) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      const route: LoginPortalRoute = {
        routeId: routeIdFor(input),
        portalId: input.portalId,
        contractId: input.contractId?.trim() || null,
        origin: input.origin?.trim() || null,
        disabled: input.disabled ?? false,
        updatedAt: new Date().toISOString(),
      };
      await storage.putRoute(route);
      return Result.ok({ route });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login route removal RPC handler. */
export function createAuthPortalsLoginRoutesRemoveHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: { routeId: string };
    context: { caller: RpcUser };
  }) => {
    if (!isAdmin(caller)) return insufficientPermissions();
    try {
      const success = await storage.deleteRoute(input.routeId);
      return Result.ok({ success });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}
