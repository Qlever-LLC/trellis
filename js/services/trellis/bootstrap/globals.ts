import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import { createAuth, isErr, TypedKV } from "@qlever-llc/trellis";
import { connectTrellisServiceInternal } from "../../../packages/trellis/server/internal_connect.ts";
import { pino } from "pino";
import { Value } from "typebox/value";
import type { Config } from "../config.ts";
import { trellisControlPlaneApi } from "./control_plane_api.ts";
import { createStorage } from "./storage.ts";
import {
  AuthBrowserFlowSchema,
  ConnectionSchema,
  OAuthStateSchema,
  PendingAuthSchema,
  type SentinelCreds,
  SentinelCredsSchema,
} from "../state/schemas.ts";
import { StoredStateEntrySchema } from "../state/model.ts";

function parseSentinelCreds(credsContent: string): SentinelCreds {
  const jwtMatch = credsContent.match(
    /-----BEGIN NATS USER JWT-----\s*([^\s]+)\s*------END NATS USER JWT------/,
  );
  const seedMatch = credsContent.match(
    /-----BEGIN USER NKEY SEED-----\s*([^\s]+)\s*------END USER NKEY SEED------/,
  );
  if (!jwtMatch || !seedMatch) {
    throw new Error("Invalid sentinel credentials file format");
  }

  return Value.Parse(SentinelCredsSchema, {
    jwt: jwtMatch[1],
    seed: seedMatch[1],
  }) as SentinelCreds;
}

/** Creates Trellis runtime dependencies in explicit startup order. */
export async function createRuntimeGlobals(config: Config) {
  const sentinelCreds = parseSentinelCreds(
    Deno.readTextFileSync(config.nats.sentinelCredsPath),
  );

  const logger = pino({
    level: config.logLevel,
    base: { service: "trellis" },
  });

  const storageBootstrap = await createStorage(config);
  const auth = await createAuth({ sessionKeySeed: config.sessionKeySeed });

  const natsAuth = await connect({
    servers: config.nats.servers,
    authenticator: credsAuthenticator(
      Deno.readFileSync(config.nats.auth.credsPath),
    ),
  });

  const natsTrellis = await connect({
    servers: config.nats.servers,
    authenticator: credsAuthenticator(
      Deno.readFileSync(config.nats.trellis.credsPath),
    ),
    inboxPrefix: `_INBOX.${auth.sessionKey.slice(0, 16)}`,
  });

  const oauthStateKVResult = await TypedKV.open(
    natsAuth,
    "trellis_oauth_states",
    OAuthStateSchema,
    { history: 1, ttl: config.ttlMs.oauth },
  );
  const oauthStateKV = oauthStateKVResult.take();
  if (isErr(oauthStateKV)) {
    throw new Error(
      `Failed to open oauth state KV: ${oauthStateKV.error.message}`,
    );
  }

  const pendingAuthKVResult = await TypedKV.open(
    natsAuth,
    "trellis_pending_auth",
    PendingAuthSchema,
    { history: 1, ttl: config.ttlMs.pendingAuth },
  );
  const pendingAuthKV = pendingAuthKVResult.take();
  if (isErr(pendingAuthKV)) {
    throw new Error(
      `Failed to open pending auth KV: ${pendingAuthKV.error.message}`,
    );
  }

  const browserFlowsKVResult = await TypedKV.open(
    natsAuth,
    "trellis_browser_flows",
    AuthBrowserFlowSchema,
    { history: 1, ttl: Math.max(config.ttlMs.oauth, config.ttlMs.deviceFlow) },
  );
  const browserFlowsKV = browserFlowsKVResult.take();
  if (isErr(browserFlowsKV)) {
    throw new Error(
      `Failed to open browser flows KV: ${browserFlowsKV.error.message}`,
    );
  }

  const connectionsKVResult = await TypedKV.open(
    natsAuth,
    "trellis_connections",
    ConnectionSchema,
    { history: 1, ttl: config.ttlMs.connections },
  );
  const connectionsKV = connectionsKVResult.take();
  if (isErr(connectionsKV)) {
    throw new Error(
      `Failed to open connections KV: ${connectionsKV.error.message}`,
    );
  }

  const stateKVResult = await TypedKV.open(
    natsAuth,
    "trellis_state",
    StoredStateEntrySchema,
    { history: 1, ttl: 0 },
  );
  const stateKV = stateKVResult.take();
  if (isErr(stateKV)) {
    throw new Error(`Failed to open state KV: ${stateKV.error.message}`);
  }

  // Bootstrap the Trellis control-plane directly instead of using the normal
  // TrellisService.connect(...) bootstrap flow. The control-plane is the component
  // that serves bootstrap state and mounts the RPCs that normal services depend on
  // during startup.
  const trellisService = await connectTrellisServiceInternal(
    "trellis",
    {
      auth,
      nats: {
        servers: config.nats.servers,
        authenticator: credsAuthenticator(
          Deno.readFileSync(config.nats.trellis.credsPath),
        ),
      },
      server: {
        log: logger,
        api: trellisControlPlaneApi.owned,
        trellisApi: trellisControlPlaneApi.trellis,
      },
    },
    {
      connect: async () => natsTrellis,
    },
  );
  trellisService.health.setInfo({
    info: {
      role: "control-plane",
    },
  });

  const trellis = {
    mount: trellisService.trellis.mount.bind(trellisService.trellis),
    publish: trellisService.trellis.publish.bind(trellisService.trellis),
    operation: trellisService.operation.bind(trellisService),
  };

  return {
    ...storageBootstrap,
    sentinelCreds,
    logger,
    natsAuth,
    natsTrellis,
    oauthStateKV,
    pendingAuthKV,
    browserFlowsKV,
    connectionsKV,
    stateKV,
    trellisService,
    trellis,
    async shutdownGlobals(): Promise<void> {
      await trellisService.stop();
      if (!natsAuth.isClosed()) {
        await natsAuth.close();
      }
      storageBootstrap.storage.client.close();
    },
  };
}

export type RuntimeGlobals = Awaited<ReturnType<typeof createRuntimeGlobals>>;
