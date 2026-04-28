import { AsyncResult } from "@qlever-llc/result";

import type { AuthRuntimeDeps } from "../runtime_deps.ts";

type KickDeps = {
  logger: Pick<AuthRuntimeDeps["logger"], "debug" | "warn">;
  natsAuth: Pick<AuthRuntimeDeps["natsAuth"], "request">;
};

/** Creates a connection-kick helper from explicit NATS auth dependencies. */
export function createKick(deps: KickDeps) {
  return async (serverId: string, clientId: number): Promise<void> => {
    deps.logger.debug({ serverId, clientId }, "Kicking connection");
    const result = await AsyncResult.try(() =>
      deps.natsAuth.request(
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
