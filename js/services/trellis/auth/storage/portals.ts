import { and, count, eq, isNull } from "drizzle-orm";
import Value from "typebox/value";

import type { TrellisStorageDb } from "../../storage/db.ts";
import {
  authLoginPortalDefaultCapabilities,
  authLoginPortalDefaultCapabilityGroups,
  authLoginPortalRoutes,
  authLoginPortalSettings,
  authPortals,
  localCredentials,
  userIdentities,
  users,
} from "../../storage/schema.ts";
import { identityIdForProviderSubject } from "../identity.ts";
import {
  createLocalCredentialPassword,
  type LocalCredentialPasswordHashingProfile,
} from "../local_credentials/passwords.ts";
import {
  type LocalCredential,
  type LoginPortalRecord,
  LoginPortalRecordSchema,
  type LoginPortalRoute,
  LoginPortalRouteSchema,
  type LoginPortalSettings,
  LoginPortalSettingsSchema,
  type LoginPortalSummary,
  type UserAccount,
  type UserIdentity,
} from "../schemas.ts";
import {
  type BoundedListQuery,
  boundedListQuery,
  decodeStringArrayField,
  type ListPage,
  listPage,
  parseJsonField,
} from "./shared.ts";

export const BUILTIN_LOGIN_PORTAL_ID = "trellis.builtin.login";

type PortalRow = typeof authPortals.$inferSelect;
type PortalInsert = typeof authPortals.$inferInsert;
type SettingsRow = typeof authLoginPortalSettings.$inferSelect;
type SettingsInsert = typeof authLoginPortalSettings.$inferInsert;
type RouteRow = typeof authLoginPortalRoutes.$inferSelect;
type RouteInsert = typeof authLoginPortalRoutes.$inferInsert;

export type SelectedLoginPortal = {
  portal: LoginPortalRecord;
  settings: LoginPortalSettings;
  defaultCapabilities: string[];
  defaultCapabilityGroups: string[];
};

export type SelfRegistrationResult =
  | { ok: true; account: UserAccount; identity: UserIdentity }
  | { ok: false; error: "identity_conflict" | "account_conflict" };

function builtinPortal(now = new Date()): LoginPortalRecord {
  const timestamp = now.toISOString();
  return {
    portalId: BUILTIN_LOGIN_PORTAL_ID,
    displayName: "Trellis Login",
    entryUrl: null,
    builtIn: true,
    disabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function defaultSettings(
  portalId: string,
  now = new Date(),
): LoginPortalSettings {
  return {
    portalId,
    localRegistrationEnabled: true,
    federatedRegistrationEnabled: true,
    allowedFederatedProviders: null,
    selfRegisteredAccountActive: true,
    updatedAt: now.toISOString(),
  };
}

function decodeAllowedFederatedProviders(
  value: string | null,
): string[] | null {
  if (value === null) return null;
  const decoded = parseJsonField(
    "login portal allowed federated providers",
    value,
  );
  if (decoded === null) return null;
  if (!Array.isArray(decoded)) {
    throw new Error(
      "Invalid JSON array stored for auth login portal allowed federated providers",
    );
  }
  return decodeStringArrayField(
    "login portal allowed federated providers",
    value,
  );
}

function decodePortalRow(row: PortalRow): LoginPortalRecord {
  return Value.Decode(LoginPortalRecordSchema, {
    portalId: row.portalId,
    displayName: row.displayName,
    entryUrl: row.entryUrl,
    builtIn: row.builtIn,
    disabled: row.disabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function encodePortal(record: LoginPortalRecord): PortalInsert {
  return {
    portalId: record.portalId,
    displayName: record.displayName,
    entryUrl: record.entryUrl,
    builtIn: record.builtIn,
    disabled: record.disabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function decodeSettingsRow(row: SettingsRow): LoginPortalSettings {
  return Value.Decode(LoginPortalSettingsSchema, {
    portalId: row.portalId,
    localRegistrationEnabled: row.localRegistrationEnabled,
    federatedRegistrationEnabled: row.federatedRegistrationEnabled,
    allowedFederatedProviders: decodeAllowedFederatedProviders(
      row.allowedFederatedProviders,
    ),
    selfRegisteredAccountActive: row.selfRegisteredAccountActive,
    updatedAt: row.updatedAt,
  });
}

function encodeSettings(record: LoginPortalSettings): SettingsInsert {
  return {
    portalId: record.portalId,
    localRegistrationEnabled: record.localRegistrationEnabled,
    federatedRegistrationEnabled: record.federatedRegistrationEnabled,
    allowedFederatedProviders: record.allowedFederatedProviders === null
      ? null
      : JSON.stringify(record.allowedFederatedProviders),
    selfRegisteredAccountActive: record.selfRegisteredAccountActive,
    updatedAt: record.updatedAt,
  };
}

function decodeRouteRow(row: RouteRow): LoginPortalRoute {
  return Value.Decode(LoginPortalRouteSchema, {
    routeKey: row.routeId,
    portalId: row.portalId,
    contractId: row.contractId,
    origin: row.origin,
    disabled: row.disabled,
    updatedAt: row.updatedAt,
  });
}

function encodeRoute(record: LoginPortalRoute): RouteInsert {
  return {
    routeId: record.routeKey,
    portalId: record.portalId,
    contractId: record.contractId,
    origin: record.origin,
    disabled: record.disabled,
    updatedAt: record.updatedAt,
  };
}

function encodeUserAccount(record: UserAccount): typeof users.$inferInsert {
  return {
    userId: record.userId,
    name: record.name,
    email: record.email,
    active: record.active,
    capabilities: JSON.stringify(record.capabilities),
    capabilityGroups: JSON.stringify(record.capabilityGroups),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function encodeUserIdentity(
  record: UserIdentity,
): typeof userIdentities.$inferInsert {
  return {
    identityId: record.identityId,
    userId: record.userId,
    provider: record.provider,
    subject: record.subject,
    displayName: record.displayName,
    email: record.email,
    emailVerified: record.emailVerified,
    linkedAt: record.linkedAt,
    lastLoginAt: record.lastLoginAt,
  };
}

function encodeLocalCredential(
  record: LocalCredential,
): typeof localCredentials.$inferInsert {
  return {
    identityId: record.identityId,
    passwordHash: record.passwordHash,
    passwordAlgorithm: record.passwordAlgorithm,
    passwordParams: JSON.stringify(record.passwordParams),
    passwordSetAt: record.passwordSetAt,
    mustChangePassword: record.mustChangePassword,
    failedLoginCount: record.failedLoginCount,
    lockedUntil: record.lockedUntil,
    updatedAt: record.updatedAt,
  };
}

function buildSelfRegisteredAccount(args: {
  userId: string;
  name: string;
  email: string | null;
  active: boolean;
  capabilities: string[];
  capabilityGroups: string[];
  now: Date;
}): UserAccount {
  const timestamp = args.now.toISOString();
  return {
    userId: args.userId,
    name: args.name,
    email: args.email,
    active: args.active,
    capabilities: args.capabilities,
    capabilityGroups: args.capabilityGroups,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Stores projected login portal registry, policy, routes, and self-registration. */
export class SqlLoginPortalRepository {
  readonly #db: TrellisStorageDb;

  /** Creates a login portal repository backed by a Trellis storage DB. */
  constructor(db: TrellisStorageDb) {
    this.#db = db;
  }

  /** Upserts a portal registry record. */
  async putPortal(record: LoginPortalRecord): Promise<void> {
    const row = encodePortal(record);
    await this.#db.insert(authPortals).values(row).onConflictDoUpdate({
      target: authPortals.portalId,
      set: {
        displayName: row.displayName,
        entryUrl: row.entryUrl,
        builtIn: row.builtIn,
        disabled: row.disabled,
        updatedAt: row.updatedAt,
      },
    });
  }

  /** Returns one login portal by id. */
  async getPortal(portalId: string): Promise<LoginPortalRecord | undefined> {
    const rows = await this.#db.select().from(authPortals).where(
      eq(authPortals.portalId, portalId),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodePortalRow(row);
  }

  /** Lists visible login portals, including the built-in default portal. */
  async listPortals(): Promise<LoginPortalRecord[]> {
    await this.ensureBuiltinPortal();
    const rows = await this.#db.select().from(authPortals).orderBy(
      authPortals.portalId,
    );
    return rows.map(decodePortalRow);
  }

  /** Returns a counted page of visible login portals. */
  async listPortalsPage(
    query: BoundedListQuery,
  ): Promise<ListPage<LoginPortalRecord>> {
    await this.ensureBuiltinPortal();
    const { offset, limit } = boundedListQuery(query);
    const [countRow] = await this.#db.select({ count: count() }).from(
      authPortals,
    );
    const rows = await this.#db.select().from(authPortals).orderBy(
      authPortals.portalId,
    ).limit(limit).offset(offset);
    return listPage(rows.map(decodePortalRow), countRow?.count ?? 0, query);
  }

  /** Returns a counted page of visible login portals with route totals. */
  async listPortalSummariesPage(
    query: BoundedListQuery,
  ): Promise<ListPage<LoginPortalSummary>> {
    const page = await this.listPortalsPage(query);
    const routes = await this.listRoutes();
    return {
      ...page,
      entries: page.entries.map((portal) => ({
        ...portal,
        routeCount: routes.filter((route) => route.portalId === portal.portalId)
          .length,
        activeRouteCount:
          routes.filter((route) =>
            route.portalId === portal.portalId && !route.disabled
          ).length,
      })),
    };
  }

  /** Deletes a non-built-in portal. */
  async deletePortal(portalId: string): Promise<boolean> {
    if (portalId === BUILTIN_LOGIN_PORTAL_ID) return false;
    const rows = await this.#db.transaction(async (tx) => {
      await tx.delete(authLoginPortalSettings).where(
        eq(authLoginPortalSettings.portalId, portalId),
      );
      await tx.delete(authLoginPortalDefaultCapabilities).where(
        eq(authLoginPortalDefaultCapabilities.portalId, portalId),
      );
      await tx.delete(authLoginPortalDefaultCapabilityGroups).where(
        eq(authLoginPortalDefaultCapabilityGroups.portalId, portalId),
      );
      return await tx.delete(authPortals).where(
        eq(authPortals.portalId, portalId),
      ).returning({ portalId: authPortals.portalId });
    });
    return rows.length > 0;
  }

  /** Upserts portal registration settings. */
  async putSettings(record: LoginPortalSettings): Promise<void> {
    const row = encodeSettings(record);
    await this.#db.insert(authLoginPortalSettings).values(row)
      .onConflictDoUpdate({
        target: authLoginPortalSettings.portalId,
        set: {
          localRegistrationEnabled: row.localRegistrationEnabled,
          federatedRegistrationEnabled: row.federatedRegistrationEnabled,
          allowedFederatedProviders: row.allowedFederatedProviders,
          selfRegisteredAccountActive: row.selfRegisteredAccountActive,
          updatedAt: row.updatedAt,
        },
      });
  }

  /** Updates projected portal settings and default grants. */
  async updateSelectedLoginPortal(args: {
    portalId: string;
    settings: LoginPortalSettings;
    defaultCapabilities: string[];
    defaultCapabilityGroups: string[];
  }): Promise<SelectedLoginPortal | undefined> {
    const portal = await this.getPortal(args.portalId);
    if (!portal) return undefined;
    await this.#db.transaction(async (tx) => {
      await tx.insert(authLoginPortalSettings).values(
        encodeSettings(args.settings),
      ).onConflictDoUpdate({
        target: authLoginPortalSettings.portalId,
        set: {
          localRegistrationEnabled: args.settings.localRegistrationEnabled,
          federatedRegistrationEnabled:
            args.settings.federatedRegistrationEnabled,
          allowedFederatedProviders: args.settings.allowedFederatedProviders ===
              null
            ? null
            : JSON.stringify(args.settings.allowedFederatedProviders),
          selfRegisteredAccountActive:
            args.settings.selfRegisteredAccountActive,
          updatedAt: args.settings.updatedAt,
        },
      });
      await tx.delete(authLoginPortalDefaultCapabilities).where(
        eq(authLoginPortalDefaultCapabilities.portalId, args.portalId),
      );
      if (args.defaultCapabilities.length > 0) {
        await tx.insert(authLoginPortalDefaultCapabilities).values(
          args.defaultCapabilities.map((capability) => ({
            portalId: args.portalId,
            capability,
          })),
        );
      }
      await tx.delete(authLoginPortalDefaultCapabilityGroups).where(
        eq(authLoginPortalDefaultCapabilityGroups.portalId, args.portalId),
      );
      if (args.defaultCapabilityGroups.length > 0) {
        await tx.insert(authLoginPortalDefaultCapabilityGroups).values(
          args.defaultCapabilityGroups.map((groupKey) => ({
            portalId: args.portalId,
            groupKey,
          })),
        );
      }
    });
    return await this.getSelectedByPortalId(args.portalId);
  }

  /** Upserts a portal route. */
  async putRoute(record: LoginPortalRoute): Promise<void> {
    const row = encodeRoute(record);
    await this.#db.insert(authLoginPortalRoutes).values(row)
      .onConflictDoUpdate({
        target: authLoginPortalRoutes.routeId,
        set: {
          portalId: row.portalId,
          contractId: row.contractId,
          origin: row.origin,
          disabled: row.disabled,
          updatedAt: row.updatedAt,
        },
      });
  }

  /** Lists login portal route selections. */
  async listRoutes(): Promise<LoginPortalRoute[]> {
    const rows = await this.#db.select().from(authLoginPortalRoutes).orderBy(
      authLoginPortalRoutes.routeId,
    );
    return rows.map(decodeRouteRow);
  }

  /** Lists login portal route selections for one portal. */
  async listRoutesByPortal(portalId: string): Promise<LoginPortalRoute[]> {
    const rows = await this.#db.select().from(authLoginPortalRoutes).where(
      eq(authLoginPortalRoutes.portalId, portalId),
    ).orderBy(authLoginPortalRoutes.routeId);
    return rows.map(decodeRouteRow);
  }

  /** Returns one login portal route by selector. */
  async getRouteBySelector(args: {
    contractId: string | null;
    origin: string | null;
  }): Promise<LoginPortalRoute | undefined> {
    const rows = await this.#db.select().from(authLoginPortalRoutes).where(
      and(
        args.contractId === null
          ? isNull(authLoginPortalRoutes.contractId)
          : eq(authLoginPortalRoutes.contractId, args.contractId),
        args.origin === null
          ? isNull(authLoginPortalRoutes.origin)
          : eq(authLoginPortalRoutes.origin, args.origin),
      ),
    ).limit(1);
    const row = rows[0];
    return row === undefined ? undefined : decodeRouteRow(row);
  }

  /** Deletes one login portal route by portal and selector. */
  async deleteRouteBySelector(args: {
    portalId: string;
    contractId: string | null;
    origin: string | null;
  }): Promise<boolean> {
    const rows = await this.#db.delete(authLoginPortalRoutes).where(
      and(
        eq(authLoginPortalRoutes.portalId, args.portalId),
        args.contractId === null
          ? isNull(authLoginPortalRoutes.contractId)
          : eq(authLoginPortalRoutes.contractId, args.contractId),
        args.origin === null
          ? isNull(authLoginPortalRoutes.origin)
          : eq(authLoginPortalRoutes.origin, args.origin),
      ),
    ).returning({ routeId: authLoginPortalRoutes.routeId });
    return rows.length > 0;
  }

  /** Ensures the built-in login portal projection exists. */
  async ensureBuiltinPortal(now = new Date()): Promise<SelectedLoginPortal> {
    const existing = await this.getPortal(BUILTIN_LOGIN_PORTAL_ID);
    if (!existing) await this.putPortal(builtinPortal(now));
    const settingsRows = await this.#db.select().from(authLoginPortalSettings)
      .where(eq(authLoginPortalSettings.portalId, BUILTIN_LOGIN_PORTAL_ID))
      .limit(1);
    if (!settingsRows[0]) {
      await this.putSettings(defaultSettings(BUILTIN_LOGIN_PORTAL_ID, now));
    }
    return await this.getSelectedByPortalId(BUILTIN_LOGIN_PORTAL_ID) ?? {
      portal: builtinPortal(now),
      settings: defaultSettings(BUILTIN_LOGIN_PORTAL_ID, now),
      defaultCapabilities: [],
      defaultCapabilityGroups: [],
    };
  }

  /** Resolves the most specific active login portal for an app identity. */
  async resolveForApp(args: {
    contractId?: string;
    origin?: string;
  }): Promise<SelectedLoginPortal> {
    await this.ensureBuiltinPortal();

    const candidates: Array<
      { contractId: string | null; origin: string | null }
    > = [];
    if (args.contractId && args.origin) {
      candidates.push({ contractId: args.contractId, origin: args.origin });
    }
    if (args.contractId) {
      candidates.push({ contractId: args.contractId, origin: null });
    }
    if (args.origin) candidates.push({ contractId: null, origin: args.origin });
    candidates.push({ contractId: null, origin: null });

    for (const candidate of candidates) {
      const rows = await this.#db.select().from(authLoginPortalRoutes).where(
        and(
          candidate.contractId === null
            ? isNull(authLoginPortalRoutes.contractId)
            : eq(authLoginPortalRoutes.contractId, candidate.contractId),
          candidate.origin === null
            ? isNull(authLoginPortalRoutes.origin)
            : eq(authLoginPortalRoutes.origin, candidate.origin),
          eq(authLoginPortalRoutes.disabled, false),
        ),
      ).limit(1);
      const route = rows[0] === undefined ? undefined : decodeRouteRow(rows[0]);
      if (!route) continue;
      const selected = await this.getSelectedByPortalId(route.portalId);
      if (selected && !selected.portal.disabled) return selected;
    }

    return await this.ensureBuiltinPortal();
  }

  async getSelectedByPortalId(
    portalId: string,
  ): Promise<SelectedLoginPortal | undefined> {
    const portal = await this.getPortal(portalId);
    if (!portal) return undefined;
    const [settingsRows, capabilityRows, groupRows] = await Promise.all([
      this.#db.select().from(authLoginPortalSettings).where(
        eq(authLoginPortalSettings.portalId, portalId),
      ).limit(1),
      this.#db.select().from(authLoginPortalDefaultCapabilities).where(
        eq(authLoginPortalDefaultCapabilities.portalId, portalId),
      ),
      this.#db.select().from(authLoginPortalDefaultCapabilityGroups).where(
        eq(authLoginPortalDefaultCapabilityGroups.portalId, portalId),
      ),
    ]);
    return {
      portal,
      settings: settingsRows[0] === undefined
        ? defaultSettings(portalId)
        : decodeSettingsRow(settingsRows[0]),
      defaultCapabilities: capabilityRows.map((row) => row.capability),
      defaultCapabilityGroups: groupRows.map((row) => row.groupKey),
    };
  }

  /** Atomically self-registers a local username/password identity. */
  async registerLocalIdentity(args: {
    username: string;
    password: string;
    name: string;
    email: string;
    active: boolean;
    capabilities: string[];
    capabilityGroups: string[];
    userId: string;
    now?: Date;
    passwordMinLength?: number;
    passwordHashingProfile?: LocalCredentialPasswordHashingProfile;
  }): Promise<SelfRegistrationResult> {
    const now = args.now ?? new Date();
    const identity: UserIdentity = {
      identityId: identityIdForProviderSubject("local", args.username),
      userId: args.userId,
      provider: "local",
      subject: args.username,
      displayName: args.name,
      email: args.email,
      emailVerified: false,
      linkedAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    };
    const account = buildSelfRegisteredAccount({ ...args, now });
    const credential = await createLocalCredentialPassword({
      identityId: identity.identityId,
      password: args.password,
      now,
      minLength: args.passwordMinLength,
      hashingProfile: args.passwordHashingProfile,
    });

    return await this.#db.transaction(async (tx) => {
      const identityRows = await tx.select().from(userIdentities).where(and(
        eq(userIdentities.provider, "local"),
        eq(userIdentities.subject, args.username),
      )).limit(1);
      if (identityRows.length > 0) {
        return { ok: false, error: "identity_conflict" };
      }
      const accountRows = await tx.select().from(users).where(
        eq(users.userId, args.userId),
      ).limit(1);
      if (accountRows.length > 0) {
        return { ok: false, error: "account_conflict" };
      }
      await tx.insert(users).values(encodeUserAccount(account));
      await tx.insert(userIdentities).values(encodeUserIdentity(identity));
      await tx.insert(localCredentials).values(
        encodeLocalCredential(credential),
      );
      return { ok: true, account, identity };
    });
  }

  /** Atomically self-registers an OAuth/OIDC identity. */
  async registerFederatedIdentity(args: {
    provider: string;
    user: {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
    };
    active: boolean;
    capabilities: string[];
    capabilityGroups: string[];
    userId: string;
    now?: Date;
  }): Promise<SelfRegistrationResult> {
    const now = args.now ?? new Date();
    const name = args.user.name;
    const email = args.user.email;
    const account = buildSelfRegisteredAccount({
      userId: args.userId,
      name,
      email,
      active: args.active,
      capabilities: args.capabilities,
      capabilityGroups: args.capabilityGroups,
      now,
    });
    const identity: UserIdentity = {
      identityId: identityIdForProviderSubject(args.provider, args.user.id),
      userId: account.userId,
      provider: args.provider,
      subject: args.user.id,
      displayName: args.user.name,
      email: args.user.email,
      emailVerified: false,
      linkedAt: now.toISOString(),
      lastLoginAt: now.toISOString(),
    };

    return await this.#db.transaction(async (tx) => {
      const identityRows = await tx.select().from(userIdentities).where(and(
        eq(userIdentities.provider, args.provider),
        eq(userIdentities.subject, args.user.id),
      )).limit(1);
      if (identityRows.length > 0) {
        return { ok: false, error: "identity_conflict" };
      }
      const accountRows = await tx.select().from(users).where(
        eq(users.userId, args.userId),
      ).limit(1);
      if (accountRows.length > 0) {
        return { ok: false, error: "account_conflict" };
      }
      await tx.insert(users).values(encodeUserAccount(account));
      await tx.insert(userIdentities).values(encodeUserIdentity(identity));
      return { ok: true, account, identity };
    });
  }
}
