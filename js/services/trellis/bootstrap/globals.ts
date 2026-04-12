import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import { createAuth, isErr, TypedKV } from "@qlever-llc/trellis";
import { TrellisService } from "../../../packages/server/service.ts";
import { pino } from "pino";
import { Value } from "typebox/value";
import { getConfig } from "../config.ts";
import { trellisControlPlaneApi } from "./control_plane_api.ts";
import {
  AuthBrowserFlowSchema,
  BindingTokenRecordSchema,
  ConnectionSchema,
  ContractApprovalRecordSchema,
  ContractRecordSchema,
  LoginPortalDefaultSchema,
  LoginPortalSelectionSchema,
  OAuthStateSchema,
  PortalSchema,
  PendingAuthSchema,
  type SentinelCreds,
  SentinelCredsSchema,
  ServiceRegistrySchema,
  SessionSchema,
  UserProjectionSchema,
  WorkloadPortalSelectionSchema,
  WorkloadActivationHandoffSchema,
  WorkloadActivationRecordSchema,
  WorkloadActivationReviewRecordSchema,
  WorkloadProfileSchema,
  WorkloadProvisioningSecretSchema,
  WorkloadSchema,
} from "../state/schemas.ts";

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

const portalsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_portals",
  PortalSchema,
  { history: 1, ttl: 0 },
);
const portalsKVValue = portalsKVResult.take();
if (isErr(portalsKVValue)) {
  throw new Error(`Failed to open portals KV: ${portalsKVValue.error.message}`);
}
export const portalsKV = portalsKVValue;

const portalDefaultsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_portal_defaults",
  LoginPortalDefaultSchema,
  { history: 1, ttl: 0 },
);
const portalDefaultsKVValue = portalDefaultsKVResult.take();
if (isErr(portalDefaultsKVValue)) {
  throw new Error(
    `Failed to open portal defaults KV: ${portalDefaultsKVValue.error.message}`,
  );
}
export const portalDefaultsKV = portalDefaultsKVValue;

const loginPortalSelectionsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_portal_login_selections",
  LoginPortalSelectionSchema,
  { history: 1, ttl: 0 },
);
const loginPortalSelectionsKVValue = loginPortalSelectionsKVResult.take();
if (isErr(loginPortalSelectionsKVValue)) {
  throw new Error(
    `Failed to open login portal selections KV: ${loginPortalSelectionsKVValue.error.message}`,
  );
}
export const loginPortalSelectionsKV = loginPortalSelectionsKVValue;

const workloadPortalSelectionsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_portal_workload_selections",
  WorkloadPortalSelectionSchema,
  { history: 1, ttl: 0 },
);
const workloadPortalSelectionsKVValue = workloadPortalSelectionsKVResult.take();
if (isErr(workloadPortalSelectionsKVValue)) {
  throw new Error(
    `Failed to open workload portal selections KV: ${workloadPortalSelectionsKVValue.error.message}`,
  );
}
export const workloadPortalSelectionsKV = workloadPortalSelectionsKVValue;

const browserFlowsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_browser_flows",
  AuthBrowserFlowSchema,
  { history: 1, ttl: config.ttlMs.oauth },
);
const browserFlowsKVValue = browserFlowsKVResult.take();
if (isErr(browserFlowsKVValue)) {
  throw new Error(
    `Failed to open browser flows KV: ${browserFlowsKVValue.error.message}`,
  );
}
export const browserFlowsKV = browserFlowsKVValue;

const workloadProfilesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_workload_profiles",
  WorkloadProfileSchema,
  { history: 1, ttl: 0 },
);
const workloadProfilesKVValue = workloadProfilesKVResult.take();
if (isErr(workloadProfilesKVValue)) {
  throw new Error(
    `Failed to open workload profiles KV: ${workloadProfilesKVValue.error.message}`,
  );
}
export const workloadProfilesKV = workloadProfilesKVValue;

const workloadInstancesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_workload_instances",
  WorkloadSchema,
  { history: 1, ttl: 0 },
);
const workloadInstancesKVValue = workloadInstancesKVResult.take();
if (isErr(workloadInstancesKVValue)) {
  throw new Error(
    `Failed to open workload instances KV: ${workloadInstancesKVValue.error.message}`,
  );
}
export const workloadInstancesKV = workloadInstancesKVValue;

const workloadActivationHandoffsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_workload_activation_handoffs",
  WorkloadActivationHandoffSchema,
  { history: 1, ttl: config.ttlMs.workloadHandoff },
);
const workloadActivationHandoffsKVValue = workloadActivationHandoffsKVResult.take();
if (isErr(workloadActivationHandoffsKVValue)) {
  throw new Error(
    `Failed to open workload activation handoffs KV: ${workloadActivationHandoffsKVValue.error.message}`,
  );
}
export const workloadActivationHandoffsKV = workloadActivationHandoffsKVValue;

const workloadProvisioningSecretsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_workload_provisioning_secrets",
  WorkloadProvisioningSecretSchema,
  { history: 1, ttl: 0 },
);
const workloadProvisioningSecretsKVValue = workloadProvisioningSecretsKVResult.take();
if (isErr(workloadProvisioningSecretsKVValue)) {
  throw new Error(
    `Failed to open workload provisioning secrets KV: ${workloadProvisioningSecretsKVValue.error.message}`,
  );
}
export const workloadProvisioningSecretsKV = workloadProvisioningSecretsKVValue;

const workloadActivationsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_workload_activations",
  WorkloadActivationRecordSchema,
  { history: 1, ttl: 0 },
);
const workloadActivationsKVValue = workloadActivationsKVResult.take();
if (isErr(workloadActivationsKVValue)) {
  throw new Error(
    `Failed to open workload activations KV: ${workloadActivationsKVValue.error.message}`,
  );
}
export const workloadActivationsKV = workloadActivationsKVValue;

const workloadActivationReviewsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_workload_activation_reviews",
  WorkloadActivationReviewRecordSchema,
  { history: 1, ttl: 0 },
);
const workloadActivationReviewsKVValue = workloadActivationReviewsKVResult.take();
if (isErr(workloadActivationReviewsKVValue)) {
  throw new Error(
    `Failed to open workload activation reviews KV: ${workloadActivationReviewsKVValue.error.message}`,
  );
}
export const workloadActivationReviewsKV = workloadActivationReviewsKVValue;

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

// Bootstrap the Trellis control-plane directly instead of using the normal
// TrellisService.connect(...) bootstrap flow. The control-plane is the component
// that serves bootstrap state and mounts the RPCs that normal services depend on
// during startup.
export const trellisService = await TrellisService.connectInternal(
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
