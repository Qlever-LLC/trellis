import type { NatsConnection } from "@nats-io/nats-core";
import {
  API as TRELLIS_CORE_API,
  type TrellisBindingsGetOutput,
  type TrellisCatalogOutput,
} from "@qlever-llc/trellis/sdk/core";
import { createAuth } from "@qlever-llc/trellis/auth";
import { isErr, Trellis as RootTrellis } from "@qlever-llc/trellis";

import { logger as noopLogger, type LoggerLike } from "../globals.ts";
import { serverLogger } from "../server_logger.ts";
import type { TrellisAPI } from "@qlever-llc/trellis/contracts";
import type { ContractKvMetadata } from "../contract_support/mod.ts";
import { DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS } from "../runtime_transport.ts";
import type { TrellisServiceRuntimeDeps } from "./runtime.ts";
import {
  createConnectedService,
  type ResourceBindings,
  type ServiceTrellis,
  type Trellis,
  type TrellisService,
  type TrellisServiceInternalConnectArgs,
} from "./service.ts";

type BootstrapTrellisApi = {
  rpc: Pick<
    typeof TRELLIS_CORE_API.owned.rpc,
    "Trellis.Catalog" | "Trellis.Bindings.Get"
  >;
  operations: {};
  events: {};
  subjects: {};
};

function resolveServiceLogger(log?: LoggerLike | false): LoggerLike {
  if (log === false) {
    return noopLogger;
  }

  return log ?? serverLogger;
}

function getErrorCauseMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const context = (error as { context?: Record<string, unknown> }).context;
    if (
      typeof context?.causeMessage === "string" &&
      context.causeMessage.length > 0
    ) {
      return context.causeMessage;
    }
  }

  return error instanceof Error ? error.message : String(error);
}

function bootstrapContractStateError(args: {
  serviceName: string;
  contractId: string;
  contractDigest: string;
  step: "catalog lookup" | "bindings lookup";
  cause?: unknown;
}): Error {
  const base =
    `Service '${args.serviceName}' could not bootstrap contract '${args.contractId}' (${args.contractDigest}) during ${args.step}. ` +
    "This usually means Trellis has stale or incomplete state for this service session. " +
    "Re-run the service profile apply or instance provisioning flow so Trellis records the allowed digest, permissions, and resource bindings for this instance key.";
  const cause = args.cause
    ? ` Underlying error: ${getErrorCauseMessage(args.cause)}`
    : "";
  return new Error(base + cause);
}

async function closeFailedServiceBootstrapConnection(
  nc: NatsConnection,
): Promise<void> {
  if (nc.isClosed()) {
    return;
  }

  try {
    await nc.drain();
  } catch {
    await nc.closed().catch(() => undefined);
  }
}

export async function connectTrellisServiceInternal<
  TOwnedApi extends TrellisAPI = TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
  TKv extends ContractKvMetadata = {},
>(
  name: string,
  opts: TrellisServiceInternalConnectArgs<TOwnedApi, TTrellisApi, TKv>,
  deps: TrellisServiceRuntimeDeps,
): Promise<TrellisService<TOwnedApi, TTrellisApi, {}, TKv>> {
  const connectFn = deps.connect;
  const readFileSync = deps.readFileSync;
  const credsAuthenticator = deps.credsAuthenticator;

  const auth = opts.auth ??
    (opts.sessionKeySeed
      ? await createAuth({ sessionKeySeed: opts.sessionKeySeed })
      : undefined);
  if (!auth) {
    throw new Error(
      "TrellisService.connect requires either opts.auth or opts.sessionKeySeed",
    );
  }

  const authenticator = opts.nats.authenticator ??
    (() => {
      if (opts.nats.sentinelCreds) {
        if (!credsAuthenticator) {
          throw new Error(
            "TrellisService.connect requires a runtime creds authenticator when sentinel creds are provided",
          );
        }
        return credsAuthenticator(opts.nats.sentinelCreds);
      }
      if (opts.nats.sentinelCredsPath) {
        if (!credsAuthenticator || !readFileSync) {
          throw new Error(
            "TrellisService.connect requires runtime file and creds adapters when opts.nats.sentinelCredsPath is used",
          );
        }
        return credsAuthenticator(readFileSync(opts.nats.sentinelCredsPath));
      }
      throw new Error(
        "TrellisService.connect requires opts.nats.authenticator, opts.nats.sentinelCreds, or opts.nats.sentinelCredsPath",
      );
    })();

  const { authenticator: authTokenAuthenticator, inboxPrefix } = await auth
    .natsConnectOptions();

  const nc = await connectFn({
    servers: opts.nats.servers,
    maxReconnectAttempts: DEFAULT_RUNTIME_MAX_RECONNECT_ATTEMPTS,
    inboxPrefix,
    authenticator: [authTokenAuthenticator, authenticator],
    ...(opts.nats.options ?? {}),
  });

  try {
    let bindings: ResourceBindings = { kv: {}, store: {}, streams: {} };
    const contractKv = opts.contractKv ?? ({} as TKv);

    if (opts.contractId && opts.contractDigest) {
      const resolvedLog = resolveServiceLogger(opts.server.log);
      const runtimeApi = (opts.server.trellisApi ?? opts.server.api) as
        & TOwnedApi
        & TTrellisApi;
      const outbound = new RootTrellis<TTrellisApi>(
        name,
        nc,
        { sessionKey: auth.sessionKey, sign: auth.sign },
        {
          log: resolvedLog,
          timeout: opts.server.timeout,
          stream: opts.server.stream,
          noResponderRetry: opts.server.noResponderRetry,
          api: runtimeApi,
        },
      );
      const trellis = Object.assign(
        outbound,
        {
          mount: () => {
            throw new Error(
              "mount is unavailable during internal bootstrap probing",
            );
          },
        },
      ) as ServiceTrellis<TOwnedApi, TTrellisApi>;
      const bootstrapRequest = trellis.request.bind(trellis) as Pick<
        Trellis<BootstrapTrellisApi>,
        "request"
      >["request"];
      const catalogResult = await bootstrapRequest("Trellis.Catalog", {});
      const catalogValue = catalogResult.take();
      if (isErr(catalogValue)) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "catalog lookup",
          cause: catalogValue.error,
        });
      }
      const catalog: TrellisCatalogOutput = catalogValue;
      const isActive = catalog.catalog.contracts.some(
        (contract: { digest: string }) =>
          contract.digest === opts.contractDigest,
      );
      if (!isActive) {
        throw new Error(
          `Contract ${opts.contractId} (${opts.contractDigest}) is not active. Install it with the trellis CLI first.`,
        );
      }

      const bindingsResult = await bootstrapRequest(
        "Trellis.Bindings.Get",
        { contractId: opts.contractId },
      );
      const bindingsValue = bindingsResult.take();
      if (isErr(bindingsValue)) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "bindings lookup",
          cause: bindingsValue.error,
        });
      }
      const resolved: TrellisBindingsGetOutput = bindingsValue;
      if (!resolved.binding) {
        throw bootstrapContractStateError({
          serviceName: name,
          contractId: opts.contractId,
          contractDigest: opts.contractDigest,
          step: "bindings lookup",
        });
      }

      if (
        resolved.binding.contractId !== opts.contractId ||
        resolved.binding.digest !== opts.contractDigest
      ) {
        throw new Error(
          `Service '${name}' received bindings for '${
            resolved.binding.contractId ?? "unknown"
          }' (${resolved.binding.digest ?? "unknown"}) ` +
            `while bootstrapping '${opts.contractId}' (${opts.contractDigest}). Re-run the service profile apply or instance provisioning flow so Trellis records the correct active contract for this instance key.`,
        );
      }

      bindings = {
        kv: resolved.binding.resources?.kv ?? {},
        store: resolved.binding.resources?.store ?? {},
        streams: resolved.binding.resources?.streams ?? {},
        ...(resolved.binding.resources?.jobs
          ? { jobs: resolved.binding.resources.jobs }
          : {}),
      };

      if (
        Object.keys(bindings.kv).length > 0 &&
        Object.keys(contractKv).length === 0
      ) {
        throw new Error(
          `Internal Trellis service connect requires opts.contractKv when contract '${opts.contractId}' has KV bindings`,
        );
      }
    }

    return await createConnectedService<TOwnedApi, TTrellisApi, {}, TKv>({
      name,
      auth,
      nc,
      contractId: opts.contractId,
      contractDigest: opts.contractDigest,
      contractJobs: {},
      contractKv,
      server: opts.server,
      bindings,
    });
  } catch (cause) {
    await closeFailedServiceBootstrapConnection(nc);
    throw cause;
  }
}
