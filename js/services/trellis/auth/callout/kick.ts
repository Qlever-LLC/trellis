import { AsyncResult } from "@qlever-llc/result";

import { logger, natsAuth } from "../../bootstrap/globals.ts";

export async function kick(serverId: string, clientId: number): Promise<void> {
  logger.debug({ serverId, clientId }, "Kicking connection");
  const result = await AsyncResult.try(() =>
    natsAuth.request(
      `$SYS.REQ.SERVER.${serverId}.KICK`,
      JSON.stringify({ cid: clientId }),
    )
  );
  if (result.isErr()) {
    logger.warn(
      { serverId, clientId, error: result.error },
      "Failed to kick connection",
    );
  } else {
    logger.debug({ serverId, clientId }, "Connection kicked");
  }
}
