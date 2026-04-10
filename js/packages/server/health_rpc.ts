import type { TrellisAPI } from "@qlever-llc/trellis/contracts";

import { Result } from "@qlever-llc/result";
import { type HealthCheckFn, runAllHealthChecks } from "./health.ts";

type HealthRpcServer = {
  name: string;
  api: TrellisAPI;
  natsConnection: { isClosed(): boolean };
  mount<M extends keyof TrellisAPI["rpc"] & string>(
    method: M,
    handler: (...args: unknown[]) => unknown,
  ): Promise<unknown>;
};

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

export async function mountStandardHealthRpc(
  server: HealthRpcServer,
  opts?: {
    rpcName?: string;
    checks?: Record<string, HealthCheckFn>;
  },
): Promise<void> {
  const rpcName = opts?.rpcName ?? `${pascalCase(server.name)}.Health`;
  const rpc = (server.api.rpc as Record<string, unknown> | undefined)?.[rpcName];
  if (!rpc) return;

  const method = rpcName as keyof TrellisAPI["rpc"] & string;
  await server.mount(method, async () => {
    const response = await runAllHealthChecks(server.name, {
      nats: async () => Result.ok(!server.natsConnection.isClosed()),
      ...(opts?.checks ?? {}),
    });
    return Result.ok(response);
  });
}
