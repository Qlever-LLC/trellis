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
  BoundedListQuery,
  SelectedLoginPortal,
  SqlLoginPortalRepository,
} from "../storage.ts";
import { type AdminCaller, requireAdmin } from "./shared.ts";

type RpcUser = AdminCaller;

type LoginSettingsUpdateInput = {
  portalId: string;
  localRegistrationEnabled: boolean;
  federatedRegistrationEnabled: boolean;
  allowedFederatedProviders: string[] | null;
  selfRegisteredAccountActive: boolean;
  defaultCapabilities: string[];
  defaultCapabilityGroups: string[];
};

type PortalPutInput = {
  portalId: string;
  displayName: string;
  entryUrl: string;
  disabled?: boolean;
};

export type FederatedProviderView = {
  id: string;
  displayName: string;
  type: string;
};

type LoginRoutePutInput = {
  portalId: string;
  contractId?: string | null;
  origin?: string | null;
  disabled?: boolean;
};

type LoginRouteSelectorInput = {
  portalId: string;
  contractId?: string | null;
  origin?: string | null;
};

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

function responseForSelected(
  selected: SelectedLoginPortal,
  federatedProviders: FederatedProviderView[],
) {
  return {
    portal: selected.portal,
    settings: selected.settings,
    defaultCapabilities: selected.defaultCapabilities,
    defaultCapabilityGroups: selected.defaultCapabilityGroups,
    federatedProviders,
  };
}

function normalizeSelector(input: LoginRouteSelectorInput) {
  return {
    contractId: input.contractId?.trim() || null,
    origin: input.origin?.trim() || null,
  };
}

function routeKeyFor(
  input: { contractId: string | null; origin: string | null },
) {
  const contract = input.contractId || "any-contract";
  const origin = input.origin || "any-origin";
  return `${contract}:${origin}`;
}

/** Creates the admin login portal list RPC handler. */
export function createAuthPortalsListHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({ input, context: { caller } }: {
    input: BoundedListQuery;
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      return Result.ok(await storage.listPortalSummariesPage(input));
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login portal detail RPC handler. */
export function createAuthPortalsGetHandler(
  storage: SqlLoginPortalRepository,
  federatedProviders: FederatedProviderView[] = [],
) {
  return async ({ input, context: { caller } }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const selected = await storage.getSelectedByPortalId(input.portalId);
      if (!selected) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      return Result.ok({
        ...responseForSelected(selected, federatedProviders),
        routes: await storage.listRoutesByPortal(input.portalId),
      });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login portal upsert RPC handler. */
export function createAuthPortalsPutHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: PortalPutInput;
    context: { caller: RpcUser };
  }): Promise<
    Result<
      { portal: LoginPortalRecord },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const existing = await storage.getPortal(input.portalId);
      if (existing?.builtIn) {
        return invalid("/portalId", "built-in login portal cannot be updated", {
          portalId: input.portalId,
        });
      }
      const timestamp = new Date().toISOString();
      const portal: LoginPortalRecord = {
        portalId: input.portalId.trim(),
        displayName: input.displayName.trim(),
        entryUrl: input.entryUrl.trim(),
        builtIn: false,
        disabled: input.disabled ?? false,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (!portal.portalId) {
        return invalid("/portalId", "portal id is required");
      }
      if (!portal.displayName) {
        return invalid("/displayName", "display name is required");
      }
      if (!portal.entryUrl) {
        return invalid("/entryUrl", "entry URL is required");
      }
      await storage.putPortal(portal);
      return Result.ok({ portal });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login portal removal RPC handler. */
export function createAuthPortalsRemoveHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const portal = await storage.getPortal(input.portalId);
      if (!portal) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      if (portal.builtIn) {
        return invalid("/portalId", "built-in login portal cannot be removed", {
          portalId: input.portalId,
        });
      }
      const routes = await storage.listRoutes();
      if (routes.some((route) => route.portalId === input.portalId)) {
        return invalid(
          "/portalId",
          "login portal is still targeted by routes",
          {
            portalId: input.portalId,
          },
        );
      }
      const success = await storage.deletePortal(input.portalId);
      return Result.ok({ success });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin default login settings read RPC handler. */
export function createAuthPortalsLoginSettingsGetHandler(
  storage: SqlLoginPortalRepository,
  federatedProviders: FederatedProviderView[] = [],
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: { portalId: string };
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const selected = await storage.getSelectedByPortalId(input.portalId);
      if (!selected) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      return Result.ok(responseForSelected(selected, federatedProviders));
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin default login settings update RPC handler. */
export function createAuthPortalsLoginSettingsUpdateHandler(
  storage: SqlLoginPortalRepository,
  federatedProviders: FederatedProviderView[] = [],
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
        federatedProviders: FederatedProviderView[];
      },
      AuthError | ValidationError | UnexpectedError
    >
  > => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const selected = await storage.updateSelectedLoginPortal({
        portalId: input.portalId,
        settings: {
          portalId: input.portalId,
          localRegistrationEnabled: input.localRegistrationEnabled,
          federatedRegistrationEnabled: input.federatedRegistrationEnabled,
          allowedFederatedProviders: input.allowedFederatedProviders,
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
      return Result.ok(responseForSelected(selected, federatedProviders));
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}

/** Creates the admin login route upsert RPC handler. */
export function createAuthPortalsRoutesPutHandler(
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
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const portal = await storage.getPortal(input.portalId);
      if (!portal) {
        return invalid("/portalId", "login portal not found", {
          portalId: input.portalId,
        });
      }
      const selector = normalizeSelector(input);
      const existing = await storage.getRouteBySelector(selector);
      if (existing && existing.portalId !== input.portalId) {
        return invalid(
          "/selector",
          "login route selector targets another portal",
          {
            contractId: selector.contractId,
            origin: selector.origin,
            portalId: input.portalId,
            existingPortalId: existing.portalId,
          },
        );
      }
      const route: LoginPortalRoute = {
        routeKey: routeKeyFor(selector),
        portalId: input.portalId,
        contractId: selector.contractId,
        origin: selector.origin,
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
export function createAuthPortalsRoutesRemoveHandler(
  storage: SqlLoginPortalRepository,
) {
  return async ({
    input,
    context: { caller },
  }: {
    input: LoginRouteSelectorInput;
    context: { caller: RpcUser };
  }) => {
    const authorized = requireAdmin(caller);
    if (authorized.isErr()) return authorized;
    try {
      const success = await storage.deleteRouteBySelector({
        portalId: input.portalId,
        ...normalizeSelector(input),
      });
      return Result.ok({ success });
    } catch (error) {
      return Result.err(new UnexpectedError({ cause: toError(error) }));
    }
  };
}
