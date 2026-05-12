import { AsyncResult } from "@qlever-llc/result";

import type { AuthRuntimeDeps } from "../runtime_deps.ts";

type KickDeps = {
  logger: Pick<AuthRuntimeDeps["logger"], "debug" | "warn">;
  natsSystem: Pick<AuthRuntimeDeps["natsSystem"], "request">;
};

/** Creates a connection-kick helper from explicit NATS system dependencies. */
export function createKick(deps: KickDeps) {
  return async (serverId: string, clientId: number): Promise<void> => {
    deps.logger.debug({ serverId, clientId }, "Kicking connection");
    const result = await AsyncResult.try(() =>
      deps.natsSystem.request(
        `$SYS.REQ.SERVER.${serverId}.KICK`,
        JSON.stringify({ cid: clientId }),
      )
    );
    if (result.isErr()) {
      deps.logger.warn(
        { serverId, clientId, error: result.error },
        "Failed to kick connection",
      );
    } else {
      deps.logger.debug({ serverId, clientId }, "Connection kicked");
    }
  };
}
