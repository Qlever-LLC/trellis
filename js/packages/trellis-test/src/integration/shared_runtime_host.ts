import { join } from "@std/path";
import {
  type ClientAuthRequiredContext,
  createAuth,
} from "@qlever-llc/trellis";
import { TrellisTestRuntime } from "../runtime.ts";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestContractLike,
} from "../types.ts";
import type { TrellisIntegrationRuntimeOptions } from "./types.ts";
import {
  TRELLIS_TEST_SHARED_RUNTIME_ENV,
  type TrellisIntegrationContractDescriptor,
  type TrellisIntegrationCoordinatorRequest,
  type TrellisIntegrationSharedRuntimeManifest,
} from "./shared_runtime_protocol.ts";

/** Shared runtime host started for parallel Trellis integration test workers. */
export type TrellisIntegrationSharedRuntimeHost = {
  /** Path to the manifest file passed to worker processes. */
  readonly manifestPath: string;
  /** Environment variables workers need to attach to this shared runtime. */
  readonly env: Record<string, string>;
  /** Stops the coordinator server and the underlying Trellis test runtime. */
  stop(): Promise<void>;
};

/**
 * Starts a localhost-only shared Trellis integration runtime coordinator.
 *
 * The caller must provide Trellis runtime options, including the control-plane
 * command. The host writes its manifest inside the runtime workdir and protects
 * all coordinator endpoints with a random bearer token.
 */
export async function startTrellisIntegrationSharedRuntimeHost(args: {
  readonly runtime: TrellisIntegrationRuntimeOptions;
}): Promise<TrellisIntegrationSharedRuntimeHost> {
  const runtime = await TrellisTestRuntime.start(args.runtime);
  const runId = crypto.randomUUID();
  const token = randomToken();
  const abortController = new AbortController();

  const handler = async (request: Request): Promise<Response> => {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method not allowed" }, 405);
    }

    const url = new URL(request.url);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid json" }, 400);
    }

    try {
      const result = await handleCoordinatorRequest(
        url.pathname,
        body,
        runtime,
      );
      return jsonResponse(result, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ ok: false, error: message }, 500);
    }
  };

  let serveFinished: Promise<void | undefined> | undefined;
  try {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, signal: abortController.signal },
      handler,
    );
    serveFinished = server.finished.catch(() => undefined);
    const coordinatorUrl = `http://127.0.0.1:${server.addr.port}`;
    const manifestPath = join(runtime.workdir, "shared-runtime-manifest.json");
    const manifest: TrellisIntegrationSharedRuntimeManifest = {
      version: 1,
      runId,
      trellisUrl: runtime.trellisUrl,
      natsUrl: runtime.natsUrl,
      workdir: runtime.workdir,
      coordinatorUrl,
      token,
    };
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifest));

    return {
      manifestPath,
      env: { [TRELLIS_TEST_SHARED_RUNTIME_ENV]: manifestPath },
      async stop() {
        abortController.abort();
        await serveFinished;
        await runtime.stop();
      },
    };
  } catch (error) {
    abortController.abort();
    await serveFinished;
    await runtime.stop().catch(() => undefined);
    throw error;
  }
}

async function handleCoordinatorRequest(
  path: string,
  body: unknown,
  runtime: TrellisTestRuntime,
): Promise<unknown> {
  switch (path) {
    case "/deployments/create": {
      const { deployment, mutableDev } =
        body as TrellisIntegrationCoordinatorRequest<
          "/deployments/create"
        >;
      await runtime.deployments.create({ id: deployment, mutableDev });
      return { ok: true };
    }

    case "/deployments/reconcile": {
      const { deployment } = body as TrellisIntegrationCoordinatorRequest<
        "/deployments/reconcile"
      >;
      await runtime.deployments.reconcile(deployment);
      return { ok: true };
    }

    case "/deployments/wait-ready": {
      const { deployment } = body as TrellisIntegrationCoordinatorRequest<
        "/deployments/wait-ready"
      >;
      await runtime.deployments.waitReady(deployment);
      return { ok: true };
    }

    case "/contracts/approve": {
      const { deployment, contract, allowPlanClassifications } =
        body as TrellisIntegrationCoordinatorRequest<"/contracts/approve">;
      return await runtime.contracts.approve({
        deployment,
        contract: contractLike(contract),
        allowPlanClassifications: authorityPlanClassifications(
          allowPlanClassifications,
        ),
      });
    }

    case "/services/register": {
      const { deployment, name, contract, sessionKeySeed } =
        body as TrellisIntegrationCoordinatorRequest<"/services/register">;
      const key = await runtime.registerService({
        deployment,
        name,
        contract: contractLike(contract),
        sessionKeySeed,
      });

      try {
        const auth = await createAuth({ sessionKeySeed: key.seed });
        await fetch(`${runtime.trellisUrl}/bootstrap/service`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contractId: contract.CONTRACT.id,
            contractDigest: contract.CONTRACT_DIGEST,
            instanceKey: auth.sessionKey,
            deployment,
          }),
        });
      } catch {
        // Bootstrap pre-creation is best-effort; service connect can retry it.
      }

      return key;
    }

    case "/services/create-instance": {
      const { deployment, contract, sessionKeySeed } =
        body as TrellisIntegrationCoordinatorRequest<
          "/services/create-instance"
        >;
      return await runtime.services.createInstance({
        deployment,
        name: "coordinated-service",
        contract: contractLike(contract),
        sessionKeySeed,
      });
    }

    case "/services/provision-instance-only": {
      const { deployment, sessionKeySeed } =
        body as TrellisIntegrationCoordinatorRequest<
          "/services/provision-instance-only"
        >;
      return await runtime.services.provisionInstanceOnly({
        deployment,
        sessionKeySeed,
      });
    }

    case "/client-auth/complete": {
      return await runtime.completeClientAuth(
        body as ClientAuthRequiredContext,
      );
    }

    case "/flush": {
      await runtime.flush();
      return { ok: true };
    }

    case "/authority/plans/list": {
      const args = body as TrellisIntegrationCoordinatorRequest<
        "/authority/plans/list"
      >;
      return await runtime.authority.plans.list(args);
    }

    case "/authority/plans/reject": {
      const args = body as TrellisIntegrationCoordinatorRequest<
        "/authority/plans/reject"
      >;
      return await runtime.authority.plans.reject(args);
    }

    case "/authority/accept-update": {
      const args = body as TrellisIntegrationCoordinatorRequest<
        "/authority/accept-update"
      >;
      return await runtime.authority.acceptUpdate(args);
    }

    case "/authority/accept-migration": {
      const args = body as TrellisIntegrationCoordinatorRequest<
        "/authority/accept-migration"
      >;
      return await runtime.authority.acceptMigration(args);
    }

    default:
      throw new Error(`unknown endpoint: ${path}`);
  }
}

function contractLike(
  contract: TrellisIntegrationContractDescriptor,
): TrellisTestContractLike {
  return {
    CONTRACT: contract.CONTRACT,
    CONTRACT_DIGEST: contract.CONTRACT_DIGEST,
  };
}

function authorityPlanClassifications(
  value: readonly string[] | undefined,
): readonly TrellisTestAuthorityPlanClassification[] | undefined {
  if (value === undefined) return undefined;
  return value.map((classification) => {
    if (classification === "update" || classification === "migration") {
      return classification;
    }
    throw new Error(
      `unsupported authority plan classification: ${classification}`,
    );
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}
