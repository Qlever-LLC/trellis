import { assert, assertEquals } from "@std/assert";
import { defineAppContract, defineDeviceContract } from "@qlever-llc/trellis";
import {
  buildDeviceActivationPayload,
  deriveDeviceIdentity,
  startDeviceActivationRequest,
} from "@qlever-llc/trellis/auth";
import { assertOperationCompleted } from "@qlever-llc/trellis-test";
import { sdk as trellisAuth } from "@qlever-llc/trellis/sdk/auth";
import type { LiveTrellisRuntime } from "../_support/runtime.ts";
import {
  caseScopedContractId,
  caseScopedName,
  integrationSlug,
} from "../_support/names.ts";

type ProvisionedDevice = {
  readonly instance: {
    readonly deploymentId: string;
    readonly publicIdentityKey: string;
    readonly instanceId: string;
  };
};

type PlannedAuthority = {
  readonly plan: {
    readonly classification: "update" | "migration";
    readonly planId: string;
  };
};

type DeploymentAuthority = {
  readonly authority: { readonly version: string };
  readonly materializedAuthority?: {
    readonly status: string;
    readonly desiredVersion?: string;
    readonly reconciledAt?: string | null;
    readonly error?: string | null;
  } | null;
};

type DeviceAuthorityList = {
  readonly entries: readonly {
    readonly deploymentId: string;
    readonly instanceId: string;
    readonly publicIdentityKey: string;
    readonly state: string;
  }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireProvisionedDevice(value: unknown): ProvisionedDevice {
  if (!isRecord(value) || !isRecord(value.instance)) {
    throw new Error("expected provisioned device response");
  }
  const instance = value.instance;
  if (
    typeof instance.deploymentId !== "string" ||
    typeof instance.publicIdentityKey !== "string" ||
    typeof instance.instanceId !== "string"
  ) {
    throw new Error("expected provisioned device instance fields");
  }
  return {
    instance: {
      deploymentId: instance.deploymentId,
      publicIdentityKey: instance.publicIdentityKey,
      instanceId: instance.instanceId,
    },
  };
}

function requirePlannedAuthority(value: unknown): PlannedAuthority {
  if (!isRecord(value) || !isRecord(value.plan)) {
    throw new Error("expected authority plan response");
  }
  const plan = value.plan;
  if (
    (plan.classification !== "update" && plan.classification !== "migration") ||
    typeof plan.planId !== "string"
  ) {
    throw new Error("expected authority plan fields");
  }
  return { plan: { classification: plan.classification, planId: plan.planId } };
}

function requireDeploymentAuthority(value: unknown): DeploymentAuthority {
  if (!isRecord(value) || !isRecord(value.authority)) {
    throw new Error("expected deployment authority response");
  }
  const authority = value.authority;
  if (typeof authority.version !== "string") {
    throw new Error("expected deployment authority version");
  }
  const materializedAuthority = value.materializedAuthority;
  if (materializedAuthority !== undefined && materializedAuthority !== null) {
    if (!isRecord(materializedAuthority)) {
      throw new Error("expected materialized authority object");
    }
    if (typeof materializedAuthority.status !== "string") {
      throw new Error("expected materialized authority status");
    }
    return {
      authority: { version: authority.version },
      materializedAuthority: {
        status: materializedAuthority.status,
        desiredVersion: typeof materializedAuthority.desiredVersion === "string"
          ? materializedAuthority.desiredVersion
          : undefined,
        reconciledAt: typeof materializedAuthority.reconciledAt === "string" ||
            materializedAuthority.reconciledAt === null
          ? materializedAuthority.reconciledAt
          : undefined,
        error: typeof materializedAuthority.error === "string" ||
            materializedAuthority.error === null
          ? materializedAuthority.error
          : undefined,
      },
    };
  }
  return {
    authority: { version: authority.version },
    materializedAuthority: null,
  };
}

export function requireDeviceAuthorityList(
  value: unknown,
): DeviceAuthorityList {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    throw new Error("expected device authority list response");
  }
  const entries = value.entries.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("expected device authority entry");
    }
    if (
      typeof entry.deploymentId !== "string" ||
      typeof entry.instanceId !== "string" ||
      typeof entry.publicIdentityKey !== "string" ||
      typeof entry.state !== "string"
    ) {
      throw new Error("expected device authority entry fields");
    }
    return {
      deploymentId: entry.deploymentId,
      instanceId: entry.instanceId,
      publicIdentityKey: entry.publicIdentityKey,
      state: entry.state,
    };
  });
  return { entries };
}

export function createDeviceActivationFixture(caseId: string) {
  const slug = integrationSlug(caseId);
  const adminContract = defineAppContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.device-activation-admin",
      caseId,
    ),
    displayName: `Trellis Integration Device Activation Admin (${slug})`,
    description:
      "Admin participant for the device activation integration fixture.",
    uses: {
      required: {
        auth: trellisAuth.use({
          rpc: {
            call: [
              "Auth.Deployments.Create",
              "Auth.DeploymentAuthority.AcceptMigration",
              "Auth.DeploymentAuthority.AcceptUpdate",
              "Auth.DeploymentAuthority.Get",
              "Auth.DeploymentAuthority.Plan",
              "Auth.DeploymentAuthority.Reconcile",
              "Auth.Devices.Provision",
              "Auth.DeviceUserAuthorities.List",
              "Auth.Sessions.Me",
            ],
          },
          operations: { call: ["Auth.DeviceUserAuthorities.Resolve"] },
        }),
      },
    },
  }));

  const deviceContract = defineDeviceContract(() => ({
    id: caseScopedContractId(
      "trellis.integration.device-activation-device",
      caseId,
    ),
    displayName: `Trellis Integration Activated Device (${slug})`,
    description:
      "Activated device participant for the device activation integration fixture.",
  }));

  type DeviceActivationAdmin = Awaited<
    ReturnType<LiveTrellisRuntime["connectClient"]>
  >;

  async function setupDeviceDeployment(runtime: LiveTrellisRuntime) {
    const admin = await runtime.connectClient({
      name: caseScopedName("device-activation-fixture-admin", caseId),
      contract: adminContract,
    });
    const deploymentId = caseScopedName(
      `device-activation-${crypto.randomUUID()}`,
      caseId,
    );

    await admin.rpc.auth.deploymentsCreate({
      deploymentId,
      kind: "device",
      reviewMode: "none",
    }).orThrow();
    await approveDeviceContract(admin, deploymentId);

    return { admin, deploymentId };
  }

  async function setupProvisionedDevice(
    admin: DeviceActivationAdmin,
    deploymentId: string,
  ) {
    const rootSecret = crypto.getRandomValues(new Uint8Array(32));
    const identity = await deriveDeviceIdentity(rootSecret);
    const provisioned = requireProvisionedDevice(
      await admin.rpc.auth.devicesProvision({
        deploymentId,
        publicIdentityKey: identity.publicIdentityKey,
        activationKey: identity.activationKeyBase64url,
        metadata: {
          name: caseScopedName("Integration Activated Device", caseId),
        },
      }).orThrow(),
    );
    assertEquals(provisioned.instance.deploymentId, deploymentId);
    assertEquals(
      provisioned.instance.publicIdentityKey,
      identity.publicIdentityKey,
    );

    return { rootSecret, identity, provisioned };
  }

  async function setupActivationRequest(
    runtime: LiveTrellisRuntime,
    identity: Awaited<ReturnType<typeof deriveDeviceIdentity>>,
  ) {
    const nonce = crypto.randomUUID();
    const payload = await buildDeviceActivationPayload({
      activationKey: identity.activationKey,
      publicIdentityKey: identity.publicIdentityKey,
      nonce,
    });
    const activation = await startDeviceActivationRequest({
      trellisUrl: runtime.trellisUrl,
      payload,
    });
    const flowId = new URL(activation.activationUrl, runtime.trellisUrl)
      .searchParams.get("flowId");
    assert(flowId !== null, "activation URL should contain a flowId");

    return { nonce, payload, activation, flowId };
  }

  async function setupResolveActivation(
    admin: DeviceActivationAdmin,
    flowId: string,
    deploymentId: string,
    instanceId: string,
  ) {
    const activationRef = await admin.operation.auth
      .deviceUserAuthoritiesResolve
      .input({ flowId })
      .start()
      .orThrow();
    const terminal = await assertOperationCompleted(activationRef, {
      status: "activated",
      deploymentId,
      instanceId,
    });
    if (!isRecord(terminal.output) || terminal.output.status !== "activated") {
      throw new Error(
        "device activation resolve completed without activated output",
      );
    }
    return terminal;
  }

  async function approveDeviceContract(
    admin: DeviceActivationAdmin,
    deploymentId: string,
  ): Promise<void> {
    const planned = requirePlannedAuthority(
      await admin.rpc.auth.deploymentAuthorityPlan({
        deploymentId,
        contract: deviceContract.CONTRACT,
        expectedDigest: deviceContract.CONTRACT_DIGEST,
      }).orThrow(),
    );

    if (planned.plan.classification === "update") {
      await admin.rpc.auth.deploymentAuthorityAcceptUpdate({
        planId: planned.plan.planId,
      }).orThrow();
    } else {
      await admin.rpc.auth.deploymentAuthorityAcceptMigration({
        planId: planned.plan.planId,
        acknowledgement:
          "Approved by isolated device activation integration test.",
      }).orThrow();
    }

    await admin.rpc.auth.deploymentAuthorityReconcile({ deploymentId })
      .orThrow();
    await waitForDeviceDeploymentAuthority(admin, deploymentId);
  }

  async function waitForDeviceDeploymentAuthority(
    admin: DeviceActivationAdmin,
    deploymentId: string,
  ): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const current = requireDeploymentAuthority(
        await admin.rpc.auth.deploymentAuthorityGet({ deploymentId }).orThrow(),
      );
      const materialized = current.materializedAuthority;
      if (materialized?.status === "failed") {
        throw new Error(
          `device deployment authority reconciliation failed: ${
            materialized.error ?? "unknown error"
          }`,
        );
      }
      if (
        materialized?.status === "current" &&
        materialized.desiredVersion === current.authority.version &&
        materialized.reconciledAt !== null
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `device deployment authority did not become ready for ${deploymentId}`,
    );
  }

  return {
    slug,
    adminContract,
    deviceContract,
    setupDeviceDeployment,
    setupProvisionedDevice,
    setupActivationRequest,
    setupResolveActivation,
  };
}
