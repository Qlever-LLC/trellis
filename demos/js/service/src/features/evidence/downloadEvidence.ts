import {
  isErr,
  ok,
  Result,
  type RpcArgs,
  type RpcResult,
} from "@qlever-llc/trellis";
import type { TransferError } from "@qlever-llc/trellis";
import type { ReceiveTransferGrant } from "@qlever-llc/trellis";
import type { AsyncResult } from "@qlever-llc/trellis";
import contract from "../../../contract.ts";

type Args = RpcArgs<typeof contract, "Evidence.Download">;
type HandlerResult = RpcResult<typeof contract, "Evidence.Download">;

type ReceiveTransferIssuer = {
  createTransfer(args: {
    direction: "receive";
    store: string;
    key: string;
    sessionKey: string;
    expiresInMs?: number;
  }): AsyncResult<ReceiveTransferGrant, TransferError>;
};

/** Creates a handler that returns a receive transfer grant for stored evidence. */
export function downloadEvidence(service: ReceiveTransferIssuer) {
  return async ({ context, input }: Args): Promise<HandlerResult> => {
    const transfer = await service.createTransfer({
      direction: "receive",
      store: "uploads",
      key: input.key,
      sessionKey: context.sessionKey,
      expiresInMs: 60_000,
    }).take();

    if (isErr(transfer)) {
      return Result.err(transfer.error);
    }

    return ok({ transfer });
  };
}
