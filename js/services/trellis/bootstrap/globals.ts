import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import { createAuth, isErr, TypedKV } from "@qlever-llc/trellis";
import { connectTrellisServiceInternal } from "../../../packages/trellis/server/internal_connect.ts";
import { pino } from "pino";
import { Value } from "typebox/value";
import { getConfig } from "../config.ts";
import { trellisControlPlaneApi } from "./control_plane_api.ts";
import {
  AuthBrowserFlowSchema,
  ConnectionSchema,
  OAuthStateSchema,
  PendingAuthSchema,
  type SentinelCreds,
  SentinelCredsSchema,
} from "../state/schemas.ts";
import { StoredStateEntrySchema } from "../state/model.ts";

const config = getConfig();

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

export const sentinelCreds = parseSentinelCreds(
  Deno.readTextFileSync(config.nats.sentinelCredsPath),
);

export const logger = pino({
  level: config.logLevel,
  base: { service: "trellis" },
});

const storageBootstrap = await import("./storage.ts");
export const storage = storageBootstrap.storage;
export const contractStorage = storageBootstrap.contractStorage;
export const userStorage = storageBootstrap.userStorage;
export const contractApprovalStorage = storageBootstrap.contractApprovalStorage;
export const portalStorage = storageBootstrap.portalStorage;
export const portalProfileStorage = storageBootstrap.portalProfileStorage;
export const portalDefaultStorage = storageBootstrap.portalDefaultStorage;
export const loginPortalSelectionStorage = storageBootstrap
  .loginPortalSelectionStorage;
export const devicePortalSelectionStorage = storageBootstrap
  .devicePortalSelectionStorage;
export const instanceGrantPolicyStorage = storageBootstrap
  .instanceGrantPolicyStorage;
export const serviceDeploymentStorage =
  storageBootstrap.serviceDeploymentStorage;
export const serviceInstanceStorage = storageBootstrap.serviceInstanceStorage;
export const deviceDeploymentStorage = storageBootstrap.deviceDeploymentStorage;
export const deviceInstanceStorage = storageBootstrap.deviceInstanceStorage;
export const deviceProvisioningSecretStorage = storageBootstrap
  .deviceProvisioningSecretStorage;
export const deviceActivationStorage = storageBootstrap.deviceActivationStorage;
export const deviceActivationReviewStorage = storageBootstrap
  .deviceActivationReviewStorage;
export const sessionStorage = storageBootstrap.sessionStorage;

const auth = await createAuth({ sessionKeySeed: config.sessionKeySeed });

export const natsAuth = await connect({
  servers: config.nats.servers,
  authenticator: credsAuthenticator(
    Deno.readFileSync(config.nats.auth.credsPath),
  ),
});

export const natsTrellis = await connect({
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
const oauthStateKVValue = oauthStateKVResult.take();
if (isErr(oauthStateKVValue)) {
  throw new Error(
    `Failed to open oauth state KV: ${oauthStateKVValue.error.message}`,
  );
}
export const oauthStateKV = oauthStateKVValue;

const pendingAuthKVResult = await TypedKV.open(
  natsAuth,
  "trellis_pending_auth",
  PendingAuthSchema,
  { history: 1, ttl: config.ttlMs.pendingAuth },
);
const pendingAuthKVValue = pendingAuthKVResult.take();
if (isErr(pendingAuthKVValue)) {
  throw new Error(
    `Failed to open pending auth KV: ${pendingAuthKVValue.error.message}`,
  );
}
export const pendingAuthKV = pendingAuthKVValue;

const browserFlowsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_browser_flows",
  AuthBrowserFlowSchema,
  { history: 1, ttl: Math.max(config.ttlMs.oauth, config.ttlMs.deviceFlow) },
);
const browserFlowsKVValue = browserFlowsKVResult.take();
if (isErr(browserFlowsKVValue)) {
  throw new Error(
    `Failed to open browser flows KV: ${browserFlowsKVValue.error.message}`,
  );
}
export const browserFlowsKV = browserFlowsKVValue;

const connectionsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_connections",
  ConnectionSchema,
  { history: 1, ttl: config.ttlMs.connections },
);
const connectionsKVValue = connectionsKVResult.take();
if (isErr(connectionsKVValue)) {
  throw new Error(
    `Failed to open connections KV: ${connectionsKVValue.error.message}`,
  );
}
export const connectionsKV = connectionsKVValue;

const stateKVResult = await TypedKV.open(
  natsAuth,
  "trellis_state",
  StoredStateEntrySchema,
  { history: 1, ttl: 0 },
);
const stateKVValue = stateKVResult.take();
if (isErr(stateKVValue)) {
  throw new Error(`Failed to open state KV: ${stateKVValue.error.message}`);
}
export const stateKV = stateKVValue;

// Bootstrap the Trellis control-plane directly instead of using the normal
// TrellisService.connect(...) bootstrap flow. The control-plane is the component
// that serves bootstrap state and mounts the RPCs that normal services depend on
// during startup.
export const trellisService = await connectTrellisServiceInternal(
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

export const trellis = {
  mount: trellisService.trellis.mount.bind(trellisService.trellis),
  publish: trellisService.trellis.publish.bind(trellisService.trellis),
  operation: trellisService.operation.bind(trellisService),
};

export async function shutdownGlobals(): Promise<void> {
  await trellisService.stop();
  if (!natsAuth.isClosed()) {
    await natsAuth.close();
  }
  storage.client.close();
}
