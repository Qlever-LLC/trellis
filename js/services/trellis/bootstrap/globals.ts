import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import { createAuth, isErr, TypedKV } from "@qlever-llc/trellis";
import { TrellisService } from "@qlever-llc/trellis/host/deno";
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
  SessionSchema,
  UserProjectionSchema,
  DevicePortalSelectionSchema,
  DeviceActivationHandoffSchema,
  DeviceActivationRecordSchema,
  DeviceActivationReviewRecordSchema,
  DeviceProfileSchema,
  DeviceProvisioningSecretSchema,
  DeviceSchema,
  InstanceGrantPolicySchema,
  ServiceInstanceSchema,
  ServiceProfileSchema,
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

const instanceGrantPoliciesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_instance_grant_policies",
  InstanceGrantPolicySchema,
  { history: 1, ttl: 0 },
);
const instanceGrantPoliciesKVValue = instanceGrantPoliciesKVResult.take();
if (isErr(instanceGrantPoliciesKVValue)) {
  throw new Error(
    `Failed to open instance grant policies KV: ${instanceGrantPoliciesKVValue.error.message}`,
  );
}
export const instanceGrantPoliciesKV = instanceGrantPoliciesKVValue;

const devicePortalSelectionsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_portal_device_selections",
  DevicePortalSelectionSchema,
  { history: 1, ttl: 0 },
);
const devicePortalSelectionsKVValue = devicePortalSelectionsKVResult.take();
if (isErr(devicePortalSelectionsKVValue)) {
  throw new Error(
    `Failed to open device portal selections KV: ${devicePortalSelectionsKVValue.error.message}`,
  );
}
export const devicePortalSelectionsKV = devicePortalSelectionsKVValue;

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

const deviceProfilesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_device_profiles_v2",
  DeviceProfileSchema,
  { history: 1, ttl: 0 },
);
const deviceProfilesKVValue = deviceProfilesKVResult.take();
if (isErr(deviceProfilesKVValue)) {
  throw new Error(
    `Failed to open device profiles KV: ${deviceProfilesKVValue.error.message}`,
  );
}
export const deviceProfilesKV = deviceProfilesKVValue;

const deviceInstancesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_device_instances_v2",
  DeviceSchema,
  { history: 1, ttl: 0 },
);
const deviceInstancesKVValue = deviceInstancesKVResult.take();
if (isErr(deviceInstancesKVValue)) {
  throw new Error(
    `Failed to open device instances KV: ${deviceInstancesKVValue.error.message}`,
  );
}
export const deviceInstancesKV = deviceInstancesKVValue;

const deviceActivationHandoffsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_device_activation_handoffs_v2",
  DeviceActivationHandoffSchema,
  { history: 1, ttl: config.ttlMs.deviceHandoff },
);
const deviceActivationHandoffsKVValue = deviceActivationHandoffsKVResult.take();
if (isErr(deviceActivationHandoffsKVValue)) {
  throw new Error(
    `Failed to open device activation handoffs KV: ${deviceActivationHandoffsKVValue.error.message}`,
  );
}
export const deviceActivationHandoffsKV = deviceActivationHandoffsKVValue;

const deviceProvisioningSecretsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_device_provisioning_secrets_v2",
  DeviceProvisioningSecretSchema,
  { history: 1, ttl: 0 },
);
const deviceProvisioningSecretsKVValue = deviceProvisioningSecretsKVResult.take();
if (isErr(deviceProvisioningSecretsKVValue)) {
  throw new Error(
    `Failed to open device provisioning secrets KV: ${deviceProvisioningSecretsKVValue.error.message}`,
  );
}
export const deviceProvisioningSecretsKV = deviceProvisioningSecretsKVValue;

const deviceActivationsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_device_activations_v2",
  DeviceActivationRecordSchema,
  { history: 1, ttl: 0 },
);
const deviceActivationsKVValue = deviceActivationsKVResult.take();
if (isErr(deviceActivationsKVValue)) {
  throw new Error(
    `Failed to open device activations KV: ${deviceActivationsKVValue.error.message}`,
  );
}
export const deviceActivationsKV = deviceActivationsKVValue;

const deviceActivationReviewsKVResult = await TypedKV.open(
  natsAuth,
  "trellis_device_activation_reviews_v2",
  DeviceActivationReviewRecordSchema,
  { history: 1, ttl: 0 },
);
const deviceActivationReviewsKVValue = deviceActivationReviewsKVResult.take();
if (isErr(deviceActivationReviewsKVValue)) {
  throw new Error(
    `Failed to open device activation reviews KV: ${deviceActivationReviewsKVValue.error.message}`,
  );
}
export const deviceActivationReviewsKV = deviceActivationReviewsKVValue;

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

const serviceProfilesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_service_profiles",
  ServiceProfileSchema,
  {
    history: 1,
    ttl: 0,
  },
);
const serviceProfilesKVValue = serviceProfilesKVResult.take();
if (isErr(serviceProfilesKVValue)) {
  throw new Error(
    `Failed to open service profiles KV: ${serviceProfilesKVValue.error.message}`,
  );
}
export const serviceProfilesKV = serviceProfilesKVValue;

const serviceInstancesKVResult = await TypedKV.open(
  natsAuth,
  "trellis_service_instances",
  ServiceInstanceSchema,
  {
    history: 1,
    ttl: 0,
  },
);
const serviceInstancesKVValue = serviceInstancesKVResult.take();
if (isErr(serviceInstancesKVValue)) {
  throw new Error(
    `Failed to open service instances KV: ${serviceInstancesKVValue.error.message}`,
  );
}
export const serviceInstancesKV = serviceInstancesKVValue;

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
trellisService.health.setInfo({
  info: {
    role: "control-plane",
  },
});

export const trellis = trellisService.server;

export async function shutdownGlobals(): Promise<void> {
  await trellisService.stop();
  if (!natsAuth.isClosed()) {
    await natsAuth.close();
  }
}
