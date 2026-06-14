import {
  type ClientAuthContinuation,
  type ClientAuthRequiredContext,
  type ConnectedTrellisClient,
  type ContractModule,
  createAuth,
  defineAppContract,
  type TrellisApiLike,
  TrellisClient,
} from "@qlever-llc/trellis";
import {
  fetchPortalFlowState,
  submitPortalApproval,
} from "@qlever-llc/trellis/auth";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { generateSessionSeed } from "./control_plane_config.ts";
import { waitFor } from "./wait.ts";

type RuntimeContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;

const ADMIN_USERNAME = "admin";

const ADMIN_RPC_CALLS = [
  "Auth.DeploymentAuthority.AcceptUpdate",
  "Auth.DeploymentAuthority.Get",
  "Auth.DeploymentAuthority.Plan",
  "Auth.DeploymentAuthority.Reconcile",
  "Auth.Deployments.Create",
  "Auth.ServiceInstances.Provision",
] as const;

const adminContract = defineAppContract(() => ({
  id: "trellis.test.admin@v1",
  displayName: "Trellis Test Admin",
  description:
    "Automates Trellis test runtime administration through Auth RPCs.",
  uses: {
    required: {
      auth: trellisAuth.use({ rpc: { call: ADMIN_RPC_CALLS } }),
    },
  },
}));

type AdminClient = ConnectedTrellisClient<typeof adminContract>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flowIdFromUrl(url: string): string {
  const flowId = new URL(url).searchParams.get("flowId");
  if (!flowId) throw new Error(`Trellis auth URL is missing flowId: ${url}`);
  return flowId;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Trellis HTTP request failed (${response.status}) for ${url}${
        text ? `: ${text}` : ""
      }`,
    );
  }
  const payload: unknown = await response.json();
  return payload;
}

async function performLocalLogin(args: {
  trellisUrl: string;
  flowId: string;
  password: string;
}): Promise<void> {
  await postJson(`${args.trellisUrl}/auth/login/local`, {
    flowId: args.flowId,
    username: ADMIN_USERNAME,
    password: args.password,
  });
}

async function approveLocalFlowIfNeeded(args: {
  trellisUrl: string;
  flowId: string;
}): Promise<void> {
  const config = { authUrl: args.trellisUrl };
  const state = await fetchPortalFlowState(config, args.flowId);
  if (state.status === "redirect") return;
  if (state.status === "approval_required") {
    const approved = await submitPortalApproval(
      config,
      args.flowId,
      "approved",
    );
    if (approved.status === "redirect") return;
    throw new Error(
      `Trellis auth approval did not complete; portal state is '${approved.status}'`,
    );
  }
  if (state.status === "insufficient_capabilities") {
    throw new Error(
      `Trellis admin user cannot approve requested client capabilities: ${
        state.missingCapabilities.join(", ")
      }`,
    );
  }
  throw new Error(
    `Trellis local login did not reach approval; portal state is '${state.status}'`,
  );
}

async function completeLocalAuthFlow(args: {
  trellisUrl: string;
  loginUrl: string;
  password: string;
}): Promise<ClientAuthContinuation> {
  const flowId = flowIdFromUrl(args.loginUrl);
  await performLocalLogin({
    trellisUrl: args.trellisUrl,
    flowId,
    password: args.password,
  });
  await approveLocalFlowIfNeeded({ trellisUrl: args.trellisUrl, flowId });
  return { status: "bound", flowId };
}

function deploymentKey(deployment: string): string {
  return `service:${deployment}`;
}

function contractKey(args: { deployment: string; contract: RuntimeContract }) {
  return `${args.deployment}:${args.contract.CONTRACT.id}:${args.contract.CONTRACT_DIGEST}`;
}

/** Internal public-surface admin automation used by `TrellisTestRuntime`. */
export class TrellisTestAdminAutomation {
  readonly #trellisUrl: string;
  readonly #adminPassword: string;
  readonly #defaultDeployment: string;
  readonly #defaultMutableDev: boolean;
  readonly #reconciliationMs: number;
  readonly #getBootstrapUrl: () => Promise<string>;
  readonly #createdDeployments = new Set<string>();
  readonly #approvedContracts = new Set<string>();
  #bootstrapComplete: Promise<void> | undefined;
  #adminClient: Promise<AdminClient> | undefined;
  #connectedAdminClient: AdminClient | undefined;

  /** Creates admin automation backed by the supplied bootstrap URL provider. */
  constructor(args: {
    trellisUrl: string;
    adminPassword: string;
    defaultDeployment: string;
    defaultMutableDev: boolean;
    reconciliationMs: number;
    getBootstrapUrl: () => Promise<string>;
  }) {
    this.#trellisUrl = args.trellisUrl.replace(/\/$/, "");
    this.#adminPassword = args.adminPassword;
    this.#defaultDeployment = args.defaultDeployment;
    this.#defaultMutableDev = args.defaultMutableDev;
    this.#reconciliationMs = args.reconciliationMs;
    this.#getBootstrapUrl = args.getBootstrapUrl;
  }

  async #completeBootstrap(): Promise<void> {
    this.#bootstrapComplete ??= (async () => {
      const bootstrapUrl = await this.#getBootstrapUrl();
      const flowId = flowIdFromUrl(bootstrapUrl);
      const response = await postJson(
        `${this.#trellisUrl}/auth/account-flow/${
          encodeURIComponent(flowId)
        }/local-password`,
        { username: ADMIN_USERNAME, password: this.#adminPassword },
      );
      if (!isRecord(response) || response.status !== "created") {
        throw new Error(
          "Trellis first-admin bootstrap returned an unexpected response",
        );
      }
    })();
    await this.#bootstrapComplete;
  }

  async #client(): Promise<AdminClient> {
    this.#adminClient ??= (async () => {
      await this.#completeBootstrap();
      const sessionKeySeed = generateSessionSeed();
      const client = await TrellisClient.connect({
        trellisUrl: this.#trellisUrl,
        name: "trellis-test-admin",
        contract: adminContract,
        auth: {
          mode: "session_key",
          sessionKeySeed,
          redirectTo: `${this.#trellisUrl}/_trellis/test/admin-auth`,
        },
        onAuthRequired: (ctx: ClientAuthRequiredContext) =>
          completeLocalAuthFlow({
            trellisUrl: this.#trellisUrl,
            loginUrl: ctx.loginUrl,
            password: this.#adminPassword,
          }),
      }).orThrow();
      this.#connectedAdminClient = client;
      return client;
    })();
    return await this.#adminClient;
  }

  /** Creates a service deployment through `Auth.Deployments.Create`. */
  async createDeployment(args: {
    deployment?: string;
    mutableDev?: boolean;
  } = {}): Promise<void> {
    const deployment = args.deployment ?? this.#defaultDeployment;
    const key = deploymentKey(deployment);
    if (this.#createdDeployments.has(key)) return;
    const client = await this.#client();
    await client.rpc.auth.deploymentsCreate({
      deploymentId: deployment,
      kind: "service",
      namespaces: [],
      contractCompatibilityMode: (args.mutableDev ?? this.#defaultMutableDev)
        ? "mutable-dev"
        : "strict",
    }).orThrow();
    this.#createdDeployments.add(key);
  }

  /** Plans, accepts, reconciles, and waits for a service contract update. */
  async approveContract(args: {
    deployment?: string;
    contract: RuntimeContract;
  }): Promise<void> {
    const deployment = args.deployment ?? this.#defaultDeployment;
    await this.createDeployment({ deployment });
    const key = contractKey({ deployment, contract: args.contract });
    if (this.#approvedContracts.has(key)) return;
    const client = await this.#client();
    const planned = await client.rpc.auth.deploymentAuthorityPlan({
      deploymentId: deployment,
      contract: args.contract.CONTRACT,
      expectedDigest: args.contract.CONTRACT_DIGEST,
    }).orThrow();
    if (planned.plan.classification !== "update") {
      throw new Error(
        `Trellis test runtime only auto-accepts update plans, got '${planned.plan.classification}'`,
      );
    }
    await client.rpc.auth.deploymentAuthorityAcceptUpdate({
      planId: planned.plan.planId,
    }).orThrow();
    await this.reconcile(deployment);
    await this.waitReady(deployment);
    this.#approvedContracts.add(key);
  }

  /** Triggers deployment-authority reconciliation for a service deployment. */
  async reconcile(deployment: string): Promise<void> {
    const client = await this.#client();
    await client.rpc.auth.deploymentAuthorityReconcile({
      deploymentId: deployment,
    }).orThrow();
  }

  /** Waits until materialized deployment authority is current. */
  async waitReady(deployment: string): Promise<void> {
    const client = await this.#client();
    await waitFor(async () => {
      const result = await client.rpc.auth.deploymentAuthorityGet({
        deploymentId: deployment,
      }).orThrow();
      const materialized = result.materializedAuthority;
      if (materialized?.status === "failed") {
        throw new Error(
          `Trellis deployment '${deployment}' reconciliation failed${
            materialized.error ? `: ${materialized.error}` : ""
          }`,
        );
      }
      if (
        materialized?.status === "current" &&
        materialized.desiredVersion === result.authority.version &&
        materialized.reconciledAt !== null
      ) {
        return true;
      }
      return false;
    }, { timeoutMs: this.#reconciliationMs });
  }

  /** Provisions a service instance key through `Auth.ServiceInstances.Provision`. */
  async provisionServiceInstance(args: {
    deployment?: string;
    contract: RuntimeContract;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    const deployment = args.deployment ?? this.#defaultDeployment;
    await this.approveContract({ deployment, contract: args.contract });
    const seed = args.sessionKeySeed ?? generateSessionSeed();
    const auth = await createAuth({ sessionKeySeed: seed });
    const client = await this.#client();
    await client.rpc.auth.serviceInstancesProvision({
      deploymentId: deployment,
      instanceKey: auth.sessionKey,
    }).orThrow();
    return { seed, sessionKey: auth.sessionKey };
  }

  /** Runs the full service registration sequence used by test services. */
  async registerService(args: {
    deployment?: string;
    contract: RuntimeContract;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    const deployment = args.deployment ?? this.#defaultDeployment;
    await this.createDeployment({ deployment });
    await this.approveContract({ deployment, contract: args.contract });
    const key = await this.provisionServiceInstance({
      deployment,
      contract: args.contract,
      sessionKeySeed: args.sessionKeySeed,
    });
    await this.reconcile(deployment);
    await this.waitReady(deployment);
    return key;
  }

  /** Closes the lazily connected admin client, when it exists. */
  async close(): Promise<void> {
    await this.#connectedAdminClient?.connection.close();
  }
}
