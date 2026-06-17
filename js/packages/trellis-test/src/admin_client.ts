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
  type PortalFlowInsufficientCapabilitiesState,
  submitPortalApproval,
} from "@qlever-llc/trellis/auth";
import { recordTrellisDuration } from "@qlever-llc/trellis/telemetry";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import { generateSessionSeed } from "./control_plane_config.ts";
import { waitFor } from "./wait.ts";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestContractApproval,
  TrellisTestContractLike,
  TrellisTestServiceKey,
} from "./types.ts";

type RuntimeContract = ContractModule<
  string,
  TrellisApiLike,
  TrellisApiLike,
  TrellisApiLike
>;

const ADMIN_USERNAME = "admin";

const ADMIN_RPC_CALLS = [
  "Auth.DeploymentAuthority.AcceptMigration",
  "Auth.DeploymentAuthority.AcceptUpdate",
  "Auth.DeploymentAuthority.Get",
  "Auth.DeploymentAuthority.Plan",
  "Auth.DeploymentAuthority.Reconcile",
  "Auth.Deployments.Create",
  "Auth.Sessions.Me",
  "Auth.ServiceInstances.Provision",
  "Auth.Users.Update",
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
  const startedAt = performance.now();
  try {
    await postJson(`${args.trellisUrl}/auth/login/local`, {
      flowId: args.flowId,
      username: ADMIN_USERNAME,
      password: args.password,
    });
  } finally {
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - startedAt,
      { phase: "local_login", authFlow: "local" },
    );
  }
}

async function approveLocalFlowIfNeeded(args: {
  trellisUrl: string;
  flowId: string;
  grantMissingCapabilities?: (
    state: PortalFlowInsufficientCapabilitiesState,
  ) => Promise<void>;
}): Promise<void> {
  const startedAt = performance.now();
  const config = { authUrl: args.trellisUrl };
  const initialFetchStartedAt = performance.now();
  let state = await fetchPortalFlowState(config, args.flowId);
  recordTrellisDuration(
    "trellis.auth.flow.duration",
    performance.now() - initialFetchStartedAt,
    { phase: "approval_fetch" },
  );
  if (state.status === "insufficient_capabilities") {
    const grantStartedAt = performance.now();
    await args.grantMissingCapabilities?.(state);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - grantStartedAt,
      { phase: "grant_capabilities" },
    );
    const refetchStartedAt = performance.now();
    state = await fetchPortalFlowState(config, args.flowId);
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - refetchStartedAt,
      { phase: "approval_fetch" },
    );
  }
  if (state.status === "redirect") {
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - startedAt,
      { phase: "total" },
    );
    return;
  }
  if (state.status === "approval_required") {
    const approvalStartedAt = performance.now();
    const approved = await submitPortalApproval(
      config,
      args.flowId,
      "approved",
    );
    recordTrellisDuration(
      "trellis.auth.flow.duration",
      performance.now() - approvalStartedAt,
      { phase: "approval_submit" },
    );
    if (approved.status === "redirect") {
      recordTrellisDuration(
        "trellis.auth.flow.duration",
        performance.now() - startedAt,
        { phase: "total" },
      );
      return;
    }
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
  const startedAt = performance.now();
  const flowId = flowIdFromUrl(args.loginUrl);
  await performLocalLogin({
    trellisUrl: args.trellisUrl,
    flowId,
    password: args.password,
  });
  await approveLocalFlowIfNeeded({ trellisUrl: args.trellisUrl, flowId });
  recordTrellisDuration(
    "trellis.auth.flow.duration",
    performance.now() - startedAt,
    { phase: "total" },
  );
  return { status: "bound", flowId };
}

function deploymentKey(deployment: string): string {
  return `service:${deployment}`;
}

function isAuthorityPlanClassification(
  value: string,
): value is TrellisTestAuthorityPlanClassification {
  return value === "update" || value === "migration";
}

/** Internal public-surface admin automation used by `TrellisTestRuntime`. */
export class TrellisTestAdminAutomation {
  readonly #trellisUrl: string;
  readonly #adminPassword: string;
  readonly #defaultDeployment: string;
  readonly #defaultMutableDev: boolean;
  readonly #reconciliationMs: number;
  readonly #autoAccept: ReadonlySet<TrellisTestAuthorityPlanClassification>;
  readonly #getBootstrapUrl: () => Promise<string>;
  readonly #createdDeployments = new Set<string>();
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
    autoAccept: readonly TrellisTestAuthorityPlanClassification[];
    getBootstrapUrl: () => Promise<string>;
  }) {
    this.#trellisUrl = args.trellisUrl.replace(/\/$/, "");
    this.#adminPassword = args.adminPassword;
    this.#defaultDeployment = args.defaultDeployment;
    this.#defaultMutableDev = args.defaultMutableDev;
    this.#reconciliationMs = args.reconciliationMs;
    this.#autoAccept = new Set(args.autoAccept);
    this.#getBootstrapUrl = args.getBootstrapUrl;
  }

  async #completeBootstrap(): Promise<void> {
    this.#bootstrapComplete ??= (async () => {
      const startedAt = performance.now();
      try {
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
      } finally {
        recordTrellisDuration(
          "trellis.admin.workflow.duration",
          performance.now() - startedAt,
          { operation: "complete_bootstrap", phase: "total" },
        );
      }
    })();
    await this.#bootstrapComplete;
  }

  async #client(): Promise<AdminClient> {
    this.#adminClient ??= (async () => {
      const startedAt = performance.now();
      try {
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
      } finally {
        recordTrellisDuration(
          "trellis.admin.workflow.duration",
          performance.now() - startedAt,
          { operation: "register_service", phase: "connect" },
        );
      }
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
    const startedAt = performance.now();
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
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: "register_service", phase: "create_deployment" },
    );
  }

  /** Completes a public app/client authentication flow as the test admin user. */
  async completeClientAuth(
    ctx: ClientAuthRequiredContext,
  ): Promise<ClientAuthContinuation> {
    const startedAt = performance.now();
    await this.#completeBootstrap();
    const flowId = flowIdFromUrl(ctx.loginUrl);
    await performLocalLogin({
      trellisUrl: this.#trellisUrl,
      flowId,
      password: this.#adminPassword,
    });
    await approveLocalFlowIfNeeded({
      trellisUrl: this.#trellisUrl,
      flowId,
      grantMissingCapabilities: (state) =>
        this.#grantClientCapabilities({
          state,
          deployment: this.#defaultDeployment,
        }),
    });
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: "register_client", phase: "total" },
    );
    return { status: "bound", flowId };
  }

  async #grantClientCapabilities(args: {
    state: PortalFlowInsufficientCapabilitiesState;
    deployment: string;
  }): Promise<void> {
    const startedAt = performance.now();
    const createDeploymentStartedAt = performance.now();
    await this.createDeployment({ deployment: args.deployment });
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - createDeploymentStartedAt,
      { operation: "grant_client_capabilities", phase: "create_deployment" },
    );
    const client = await this.#client();
    const missingCapabilities = [...new Set(args.state.missingCapabilities)]
      .sort();
    const meStartedAt = performance.now();
    const me = await client.rpc.auth.sessionsMe({}).orThrow();
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - meStartedAt,
      { operation: "grant_client_capabilities", phase: "sessions_me" },
    );
    if (!me.user) {
      throw new Error("Trellis test admin session did not resolve to a user");
    }
    const adminCapabilities = [
      ...new Set([...me.user.capabilities, ...missingCapabilities]),
    ].sort();
    if (adminCapabilities.length !== me.user.capabilities.length) {
      const updateStartedAt = performance.now();
      await client.rpc.auth.usersUpdate({
        userId: me.user.userId,
        capabilities: adminCapabilities,
      }).orThrow();
      recordTrellisDuration(
        "trellis.admin.workflow.duration",
        performance.now() - updateStartedAt,
        { operation: "grant_client_capabilities", phase: "users_update" },
      );
    }
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: "grant_client_capabilities", phase: "total" },
    );
  }

  /** Plans, accepts, reconciles, and waits for a contract authority change. */
  async approveContract(args: {
    deployment?: string;
    contract: TrellisTestContractLike;
    allowPlanClassifications?:
      readonly TrellisTestAuthorityPlanClassification[];
  }): Promise<TrellisTestContractApproval> {
    const totalStartedAt = performance.now();
    const deployment = args.deployment ?? this.#defaultDeployment;
    await this.createDeployment({ deployment });
    const client = await this.#client();
    const planStartedAt = performance.now();
    const planned = await client.rpc.auth.deploymentAuthorityPlan({
      deploymentId: deployment,
      contract: args.contract.CONTRACT,
      expectedDigest: args.contract.CONTRACT_DIGEST!,
    }).orThrow();
    const classification = planned.plan.classification;
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - planStartedAt,
      {
        operation: "approve_contract",
        phase: "plan",
        planClassification: classification,
      },
    );
    if (!isAuthorityPlanClassification(classification)) {
      throw new Error(
        `Trellis test runtime received unsupported authority plan classification '${classification}'`,
      );
    }
    const allowed = args.allowPlanClassifications === undefined
      ? this.#autoAccept
      : new Set(args.allowPlanClassifications);
    if (!allowed.has(classification)) {
      throw new Error(
        `Trellis test runtime cannot auto-accept '${classification}' authority plans; allowed classifications: ${
          [...allowed].join(", ") || "none"
        }`,
      );
    }
    const acceptStartedAt = performance.now();
    if (classification === "update") {
      await client.rpc.auth.deploymentAuthorityAcceptUpdate({
        planId: planned.plan.planId,
      }).orThrow();
    } else {
      await client.rpc.auth.deploymentAuthorityAcceptMigration({
        planId: planned.plan.planId,
        acknowledgement:
          "Approved by TrellisTestRuntime for an isolated mutable-dev integration test.",
      }).orThrow();
    }
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - acceptStartedAt,
      {
        operation: "approve_contract",
        phase: "accept",
        planClassification: classification,
      },
    );
    await this.reconcile(deployment, "approveContract.reconcile");
    await this.waitReady(deployment, "approveContract.waitReady");
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - totalStartedAt,
      {
        operation: "approve_contract",
        phase: "total",
        planClassification: classification,
      },
    );
    return { planId: planned.plan.planId, classification };
  }

  /** Triggers deployment-authority reconciliation for a service deployment. */
  async reconcile(deployment: string, label = "reconcile"): Promise<void> {
    const startedAt = performance.now();
    const client = await this.#client();
    await client.rpc.auth.deploymentAuthorityReconcile({
      deploymentId: deployment,
    }).orThrow();
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: label, phase: "reconcile" },
    );
  }

  /** Waits until materialized deployment authority is current. */
  async waitReady(deployment: string, label = "waitReady"): Promise<void> {
    const startedAt = performance.now();
    let polls = 0;
    let lastStatus = "missing";
    let lastDesiredVersion = "missing";
    let lastAuthorityVersion = "missing";
    const client = await this.#client();
    await waitFor(async () => {
      polls += 1;
      const pollStartedAt = performance.now();
      const result = await client.rpc.auth.deploymentAuthorityGet({
        deploymentId: deployment,
      }).orThrow();
      const materialized = result.materializedAuthority;
      lastStatus = materialized?.status ?? "missing";
      lastDesiredVersion = materialized?.desiredVersion ?? "missing";
      lastAuthorityVersion = result.authority.version;
      recordTrellisDuration(
        "trellis.admin.workflow.duration",
        performance.now() - pollStartedAt,
        { operation: `${label}.poll`, phase: "wait_ready" },
      );
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
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: label, phase: "wait_ready" },
    );
  }

  /** Provisions a service instance key through `Auth.ServiceInstances.Provision`. */
  async provisionServiceInstance(args: {
    deployment?: string;
    contract: TrellisTestContractLike;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    const startedAt = performance.now();
    const deployment = args.deployment ?? this.#defaultDeployment;
    await this.approveContract({ deployment, contract: args.contract });
    const seed = args.sessionKeySeed ?? generateSessionSeed();
    const auth = await createAuth({ sessionKeySeed: seed });
    const client = await this.#client();
    await client.rpc.auth.serviceInstancesProvision({
      deploymentId: deployment,
      instanceKey: auth.sessionKey,
    }).orThrow();
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: "provision_service", phase: "total" },
    );
    return { seed, sessionKey: auth.sessionKey };
  }

  /** Runs the full service registration sequence used by test services. */
  async registerService(args: {
    deployment?: string;
    contract: TrellisTestContractLike;
    sessionKeySeed?: string;
  }): Promise<{ seed: string; sessionKey: string }> {
    const startedAt = performance.now();
    const deployment = args.deployment ?? this.#defaultDeployment;
    const key = await this.provisionServiceInstance({
      deployment,
      contract: args.contract,
      sessionKeySeed: args.sessionKeySeed,
    });
    await this.reconcile(deployment, "registerService.postProvision.reconcile");
    await this.waitReady(deployment, "registerService.postProvision.waitReady");
    recordTrellisDuration(
      "trellis.admin.workflow.duration",
      performance.now() - startedAt,
      { operation: "register_service", phase: "total" },
    );
    return key;
  }

  /** Closes the lazily connected admin client, when it exists. */
  async close(): Promise<void> {
    await this.#connectedAdminClient?.connection.close();
  }
}
