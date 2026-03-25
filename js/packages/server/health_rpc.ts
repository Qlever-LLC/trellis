import type { TrellisAPI } from "@trellis/contracts";

import { Result } from "@trellis/result";
import { type HealthCheckFn, runAllHealthChecks } from "./health.ts";

type HealthRpcServer = {
  name: string;
  api: TrellisAPI;
  natsConnection: { isClosed(): boolean };
  mount(method: string, handler: (...args: any[]) => unknown): Promise<unknown>;
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

  await server.mount(
    rpcName as never,
    (async () => {
      const response = await runAllHealthChecks(server.name, {
        nats: async () => Result.ok(!server.natsConnection.isClosed()),
        ...(opts?.checks ?? {}),
      });
      return Result.ok(response);
    }) as never,
  );
}
