import { join } from "@std/path";
import { createAuth } from "@qlever-llc/trellis";
import type { ClientAuthRequiredContext } from "@qlever-llc/trellis";
import type {
  TrellisTestAuthorityPlanClassification,
  TrellisTestContractLike,
} from "@qlever-llc/trellis-test";
import { startTrellisRuntime } from "./runtime.ts";
import type { LiveRuntimeScope } from "./runtime.ts";
import {
  SHARED_RUNTIME_ENV,
  type SharedRuntimeManifest,
} from "./shared_runtime_protocol.ts";

export type SharedRuntimeHost = {
  readonly manifestPath: string;
  readonly env: Record<string, string>;
  stop(): Promise<void>;
};

function contractLike(contract: {
  readonly CONTRACT: Record<string, unknown>;
  readonly CONTRACT_DIGEST?: string;
}): TrellisTestContractLike {
  return {
    CONTRACT: contract.CONTRACT,
    CONTRACT_DIGEST: contract.CONTRACT_DIGEST ?? "",
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

export async function startSharedRuntimeHost(args: {
  keepWorkdir?: boolean;
}): Promise<SharedRuntimeHost> {
  const runtime = await startTrellisRuntime({
    keepWorkdir: args.keepWorkdir,
  });

  const runId = crypto.randomUUID();
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  let binary = "";
  for (const byte of tokenBytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );

  const ac = new AbortController();

  const handler = async (request: Request): Promise<Response> => {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${token}`) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: false, error: "method not allowed" }),
        {
          status: 405,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const url = new URL(request.url);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid json" }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }

    try {
      const result = await handleCoordinatorRequest(
        url.pathname,
        body,
        runtime,
      );
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  };

  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, signal: ac.signal },
    handler,
  );
  const coordinatorUrl = `http://127.0.0.1:${server.addr.port}`;

  const servePromise = server.finished.catch(() => undefined);

  const manifestPath = join(runtime.workdir, "shared-runtime-manifest.json");
  const manifest: SharedRuntimeManifest = {
    version: 1,
    runId,
    trellisUrl: runtime.trellisUrl,
    natsUrl: runtime.natsUrl,
    workdir: runtime.workdir,
    coordinatorUrl,
    token,
  };
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest));

  const env: Record<string, string> = {
    [SHARED_RUNTIME_ENV]: manifestPath,
  };

  return {
    manifestPath,
    env,
    async stop() {
      ac.abort();
      await servePromise;
      await runtime.stop();
    },
  };
}

async function handleCoordinatorRequest(
  path: string,
  body: unknown,
  runtime: Awaited<ReturnType<typeof startTrellisRuntime>>,
): Promise<unknown> {
  switch (path) {
    case "/deployments/create": {
      const { deployment, mutableDev } = body as {
        deployment?: string;
        mutableDev?: boolean;
      };
      await runtime.deployments.create({ id: deployment, mutableDev });
      return { ok: true };
    }

    case "/deployments/reconcile": {
      const { deployment } = body as { deployment: string };
      await runtime.deployments.reconcile(deployment);
      return { ok: true };
    }

    case "/deployments/wait-ready": {
      const { deployment } = body as { deployment: string };
      await runtime.deployments.waitReady(deployment);
      return { ok: true };
    }

    case "/contracts/approve": {
      const { deployment, contract, allowPlanClassifications } = body as {
        deployment?: string;
        contract: {
          CONTRACT: Record<string, unknown>;
          CONTRACT_DIGEST?: string;
        };
        allowPlanClassifications?: readonly string[];
      };
      const result = await runtime.contracts.approve({
        deployment,
        contract: contractLike(contract),
        allowPlanClassifications: authorityPlanClassifications(
          allowPlanClassifications,
        ),
      });
      return result;
    }

    case "/services/register": {
      const { deployment, contract, sessionKeySeed, name: svcName } = body as {
        deployment?: string;
        contract: {
          CONTRACT: Record<string, unknown>;
          CONTRACT_DIGEST?: string;
        };
        sessionKeySeed?: string;
        name?: string;
      };
      const key = await runtime.services.createInstance({
        deployment,
        name: "coordinated-service",
        contract: contractLike(contract),
        sessionKeySeed,
      });

      // Pre-create the NATS JWT by calling the Trellis bootstrap endpoint.
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
        // Bootstrap pre-creation is best-effort — if it fails, the worker
        // will create the JWT on its own connect.
      }

      return key;
    }

    case "/services/create-instance": {
      const { deployment, contract, sessionKeySeed } = body as {
        deployment?: string;
        contract: {
          CONTRACT: Record<string, unknown>;
          CONTRACT_DIGEST?: string;
        };
        sessionKeySeed?: string;
      };
      const result = await runtime.services.createInstance({
        deployment,
        name: "coordinated-service",
        contract: contractLike(contract),
        sessionKeySeed,
      });
      return result;
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
      const result = await runtime.authority.plans.list(
        body as {
          deploymentId?: string;
          state?: "pending" | "accepted" | "rejected";
          classification?: "update" | "migration";
          limit?: number;
          offset?: number;
        },
      );
      return result;
    }

    case "/authority/plans/reject": {
      const { planId, reason } = body as { planId: string; reason?: string };
      const result = await runtime.authority.plans.reject({ planId, reason });
      return result;
    }

    case "/authority/accept-update": {
      const { planId, expectedDesiredVersion } = body as {
        planId: string;
        expectedDesiredVersion?: string;
      };
      const result = await runtime.authority.acceptUpdate({
        planId,
        expectedDesiredVersion,
      });
      return result;
    }

    case "/authority/accept-migration": {
      const { planId, acknowledgement, expectedDesiredVersion } = body as {
        planId: string;
        acknowledgement: string;
        expectedDesiredVersion?: string;
      };
      const result = await runtime.authority.acceptMigration({
        planId,
        acknowledgement,
        expectedDesiredVersion,
      });
      return result;
    }

    case "/services/provision-instance-only": {
      const { deployment, sessionKeySeed } = body as {
        deployment?: string;
        sessionKeySeed?: string;
      };
      const result = await runtime.services.provisionInstanceOnly({
        deployment,
        sessionKeySeed,
      });
      return result;
    }

    default:
      throw new Error(`unknown endpoint: ${path}`);
  }
}
