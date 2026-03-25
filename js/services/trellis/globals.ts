import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import { createAuth } from "@trellis/auth";
import { isErr } from "@trellis/result";
import { TrellisService } from "@trellis/server";
import { TypedKV } from "@trellis/trellis";
import { pino } from "pino";
import { Value } from "typebox/value";
import { getConfig } from "./config.ts";
import { trellisControlPlaneApi } from "./control_plane_api.ts";
import {
  BindingTokenRecordSchema,
  ConnectionSchema,
  ContractApprovalRecordSchema,
  ContractRecordSchema,
  OAuthStateSchema,
  PendingAuthSchema,
  type SentinelCreds,
  SentinelCredsSchema,
  ServiceRegistrySchema,
  SessionSchema,
  UserProjectionSchema,
} from "./schemas.ts";

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
  base: { service: config.serviceName },
});

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

const sessionKVResult = await TypedKV.open(natsAuth, "trellis_sessions", SessionSchema, {
  history: 1,
  ttl: config.ttlMs.sessions,
});
const sessionKVValue = sessionKVResult.take();
if (isErr(sessionKVValue)) {
  throw new Error(`Failed to open session KV: ${sessionKVValue.error.message}`);
}
export const sessionKV = sessionKVValue;

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

const contractApprovalsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_contract_approvals",
  ContractApprovalRecordSchema,
  { history: 1, ttl: 0 },
);
const contractApprovalsKVValue = contractApprovalsKVResult.take();
if (isErr(contractApprovalsKVValue)) {
  throw new Error(
    `Failed to open contract approvals KV: ${contractApprovalsKVValue.error.message}`,
  );
}
export const contractApprovalsKV = contractApprovalsKVValue;

const bindingTokenKVResult = await TypedKV.open(
  natsAuth,
  "trellis_binding_tokens",
  BindingTokenRecordSchema,
  { history: 1, ttl: config.ttlMs.bindingTokens.bucket },
);
const bindingTokenKVValue = bindingTokenKVResult.take();
if (isErr(bindingTokenKVValue)) {
  throw new Error(
    `Failed to open binding token KV: ${bindingTokenKVValue.error.message}`,
  );
}
export const bindingTokenKV = bindingTokenKVValue;

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

const servicesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_services",
  ServiceRegistrySchema,
  {
    history: 1,
    ttl: 0,
  },
);
const servicesKVValue = servicesKVResult.take();
if (isErr(servicesKVValue)) {
  throw new Error(
    `Failed to open services KV: ${servicesKVValue.error.message}`,
  );
}
export const servicesKV = servicesKVValue;

const contractsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_contracts",
  ContractRecordSchema,
  {
    history: 1,
    ttl: 0,
  },
);
const contractsKVValue = contractsKVResult.take();
if (isErr(contractsKVValue)) {
  throw new Error(
    `Failed to open contracts KV: ${contractsKVValue.error.message}`,
  );
}
export const contractsKV = contractsKVValue;

const usersKVResult = await TypedKV.open(
  natsAuth,
  "trellis_users",
  UserProjectionSchema,
  { history: 1, ttl: 0 },
);
const usersKVValue = usersKVResult.take();
if (isErr(usersKVValue)) {
  throw new Error(`Failed to open users KV: ${usersKVValue.error.message}`);
}
export const usersKV = usersKVValue;

// Bootstrap the Trellis control-plane directly instead of using connectService().
// connectService() eagerly calls Trellis.Catalog and Trellis.Bindings.Get to
// validate an already-installed contract, but this service is the component that
// mounts those RPCs during startup.
export const trellisService = await TrellisService.connect(
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

export const trellis = trellisService.server;

export async function shutdownGlobals(): Promise<void> {
  await trellisService.stop();
  if (!natsAuth.isClosed()) {
    await natsAuth.close();
  }
}
