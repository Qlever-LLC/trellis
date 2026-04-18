import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { AsyncResult, ok, type Result } from "../../result/mod.ts";
import type { JsonValue } from "@qlever-llc/trellis/contracts";
import { defineServiceContract } from "../contract.ts";
import {
  controlSubject,
  type OperationEvent,
  OperationInvoker,
  type StartedTransfer,
  type OperationTransferProgress,
  type OperationRef,
  type OperationTransport,
} from "../operations.ts";
import { TransferError, UnexpectedError } from "../errors/index.ts";
import type { TransferBody, UploadTransferGrant } from "../transfer.ts";

const schemas = {
  RefundInput: Type.Object({ chargeId: Type.String() }),
  RefundProgress: Type.Object({ message: Type.String() }),
  RefundOutput: Type.Object({ refundId: Type.String() }),
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(
  schema: TName,
) {
  return { schema } as const;
}

const billing = defineServiceContract(
  { schemas },
  () => ({
    id: "trellis.billing.test@v1",
    displayName: "Billing Test",
    description: "Exercise operations runtime helpers.",
    operations: {
      "Billing.Refund": {
        version: "v1",
        input: schemaRef("RefundInput"),
        progress: schemaRef("RefundProgress"),
        output: schemaRef("RefundOutput"),
        capabilities: {
          call: ["billing.refund"],
          read: ["billing.read"],
          cancel: ["billing.cancel"],
        },
        cancel: true,
      },
    },
  }),
);

const refundOperation = billing.API.owned.operations["Billing.Refund"];
const uploadOperation = {
  ...refundOperation,
  transfer: {
    store: "uploads",
    key: "/chargeId",
    expiresInMs: 60_000,
  },
} as const;

const nonCancelableOperation = {
  subject: "operations.v1.Billing.Status",
  input: schemaRef("RefundInput"),
  progress: schemaRef("RefundProgress"),
  output: schemaRef("RefundOutput"),
} as const;

class FakeOperationTransport implements OperationTransport {
  readonly seen: Array<{ subject: string; body: unknown }> = [];
  readonly transferred: Array<{ grant: UploadTransferGrant; body: TransferBody }> = [];
  readonly #responses: JsonValue[];
  readonly #watchError?: UnexpectedError;

  constructor(
    responses: JsonValue[],
    options: { watchError?: UnexpectedError } = {},
  ) {
    this.#responses = [...responses];
    this.#watchError = options.watchError;
  }

  async requestJson(subject: string, body: unknown) {
    this.seen.push({ subject, body });
    const next = this.#responses.shift();
    if (next === undefined) throw new Error("missing fake response");
    return ok(next);
  }

  async watchJson(subject: string, body: unknown) {
    this.seen.push({ subject, body });
    if (this.#watchError) {
      return AsyncResult.err(this.#watchError);
    }
    const frames = this.#responses.splice(0).map((value) => ok(value));
    return ok((async function* () {
      for (const frame of frames) {
        yield frame;
      }
    })());
  }

  async putTransfer(grant: UploadTransferGrant, body: TransferBody) {
    this.transferred.push({ grant, body });
    return ok({
      key: "incoming/test.bin",
      size: 11,
      updatedAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    });
  }
}

Deno.test("OperationInvoker.input().start() posts input to the operation subject and returns an accepted OperationRef", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
  ]);

  const operation = new OperationInvoker(
    transport,
    refundOperation,
  );
  const result = await operation.input({ chargeId: "ch_123" }).start();
  const reference = result.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(transport.seen, [{
    subject: "operations.v1.Billing.Refund",
    body: { chargeId: "ch_123" },
  }]);
  assertExists(reference);
  assertEquals(reference.id, "op_123");
  assertEquals(reference.service, "billing");
  assertEquals(reference.operation, "Billing.Refund");
  assertExists(reference.get);
});

Deno.test("OperationInvoker.input().start() type surface stays specific", () => {
  type Started = ReturnType<
    ReturnType<OperationInvoker<typeof refundOperation>["input"]>["start"]
  >;
  let started!: Started;
  const typed: AsyncResult<
    OperationRef<typeof refundOperation>,
    UnexpectedError
  > = started;
  assertEquals(true, true);
});

Deno.test("OperationInvoker.input().transfer().start() watches events, transfers bytes, and returns the terminal operation", async () => {
  const events: OperationEvent[] = [];
  const transferUpdates: number[] = [];
  const progressUpdates: string[] = [];
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_upload_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
      transfer: {
        type: "TransferGrant",
        kind: "upload",
        service: "billing",
        sessionKey: "session-key",
        transferId: "transfer_123",
        subject: "transfer.v1.upload.session.transfer_123",
        expiresAt: "2026-01-01T00:00:00.000Z",
        chunkBytes: 262144,
      },
    },
    {
      kind: "event",
      event: {
        type: "transfer",
        transfer: {
          chunkIndex: 0,
          chunkBytes: 11,
          transferredBytes: 11,
        },
        snapshot: {
          id: "op_upload_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 2,
          state: "running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      },
    },
    {
      kind: "event",
      event: {
        type: "progress",
        snapshot: {
          id: "op_upload_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 3,
          state: "running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.500Z",
          progress: {
            message: "stored",
          },
        },
      },
    },
    {
      kind: "event",
      event: {
        type: "completed",
        snapshot: {
          id: "op_upload_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 4,
          state: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          output: {
            refundId: "rf_123",
          },
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, uploadOperation);
  const started = await operation.input({ chargeId: "incoming/test.bin" })
    .transfer(new TextEncoder().encode("hello world"))
    .onTransfer((event) => {
      transferUpdates.push(event.transfer.transferredBytes);
    })
    .onProgress((event) => {
      progressUpdates.push(event.progress.message);
    })
    .onEvent((event) => {
      events.push(event);
    })
    .start();
  const upload = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const result = (await upload.wait()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "incoming/test.bin" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "watch", operationId: "op_upload_123" },
    },
  ]);
  assertEquals(transport.transferred.length, 1);
  assertEquals(upload.operation.id, "op_upload_123");
  assertEquals(result.transferred.key, "incoming/test.bin");
  assertEquals(result.terminal.state, "completed");
  assertEquals(result.terminal.output, { refundId: "rf_123" });
  assertEquals(transferUpdates, [11]);
  assertEquals(progressUpdates, ["stored"]);
  assertEquals(events.map((event) => event.type), ["accepted", "transfer", "progress", "completed"]);
});

Deno.test("OperationInvoker.input().transfer().start() type surface stays specific", () => {
  type Started = ReturnType<
    ReturnType<
      ReturnType<OperationInvoker<typeof uploadOperation>["input"]>["transfer"]
    >["start"]
  >;
  let started!: Started;
  const typed: AsyncResult<
    StartedTransfer<typeof uploadOperation>,
    UnexpectedError | TransferError
  > = started;
  assertEquals(true, true);
});

Deno.test("OperationInvoker.resume() on a transfer-capable operation keeps transfer initiation builder-only", () => {
  const transport = new FakeOperationTransport([]);
  const operation = new OperationInvoker(transport, uploadOperation);
  const resumed = operation.resume({
    id: "op_upload_123",
    service: "billing",
    operation: "Billing.Refund",
  });

  assertEquals("transfer" in resumed, false);

  // @ts-expect-error transfer initiation is builder-only
  resumed.transfer;
});

Deno.test("OperationInvoker.resume() omits cancel() for non-cancelable operations", () => {
  const transport = new FakeOperationTransport([]);
  const operation = new OperationInvoker(transport, nonCancelableOperation);
  const resumed = operation.resume({
    id: "op_status_123",
    service: "billing",
    operation: "Billing.Status",
  });

  assertEquals("cancel" in resumed, false);

  // @ts-expect-error non-cancelable refs do not expose cancel
  resumed.cancel;
});

Deno.test("OperationInvoker.input().transfer().start() dispatches terminal callbacks", async () => {
  const terminalStates: string[] = [];
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_upload_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
      transfer: {
        type: "TransferGrant",
        kind: "upload",
        service: "billing",
        sessionKey: "session-key",
        transferId: "transfer_123",
        subject: "transfer.v1.upload.session.transfer_123",
        expiresAt: "2026-01-01T00:00:00.000Z",
        chunkBytes: 262144,
      },
    },
    {
      kind: "event",
      event: {
        type: "completed",
        snapshot: {
          id: "op_upload_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 2,
          state: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          output: {
            refundId: "rf_123",
          },
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, uploadOperation);
  const started = await operation.input({ chargeId: "incoming/test.bin" })
    .transfer(new TextEncoder().encode("hello world"))
    .onCompleted((event) => {
      terminalStates.push(event.snapshot.state);
    })
    .start();
  const result = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const completed = (await result.wait()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "incoming/test.bin" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "watch", operationId: "op_upload_123" },
    },
  ]);
  assertEquals(result.operation.id, "op_upload_123");
  assertEquals(completed.transferred.key, "incoming/test.bin");
  assertEquals(terminalStates, ["completed"]);
});

Deno.test("OperationInvoker.input().start() dispatches accepted before fast terminal replay", async () => {
  const callbackOrder: string[] = [];
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
        revision: 1,
        state: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
        revision: 2,
        state: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        output: {
          refundId: "rf_123",
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const started = await operation.input({ chargeId: "ch_123" })
    .onAccepted(() => {
      callbackOrder.push("accepted");
    })
    .onCompleted(() => {
      callbackOrder.push("completed");
    })
    .start();
  const reference = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const terminal = await reference.wait();
  terminal.match({
    ok: () => undefined,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(callbackOrder, ["accepted", "completed"]);
});

Deno.test("OperationInvoker.input().start() deduplicates accepted when watch replays the pending snapshot", async () => {
  const callbackOrder: string[] = [];
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
        revision: 1,
        state: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
        revision: 1,
        state: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    {
      kind: "event",
      event: {
        type: "started",
        snapshot: {
          id: "op_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 2,
          state: "running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      },
    },
    {
      kind: "event",
      event: {
        type: "completed",
        snapshot: {
          id: "op_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 3,
          state: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          output: {
            refundId: "rf_123",
          },
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const started = await operation.input({ chargeId: "ch_123" })
    .onAccepted(() => {
      callbackOrder.push("accepted");
    })
    .onStarted(() => {
      callbackOrder.push("started");
    })
    .onCompleted(() => {
      callbackOrder.push("completed");
    })
    .start();
  const reference = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const terminal = await reference.wait();
  terminal.match({
    ok: () => undefined,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(callbackOrder, ["accepted", "started", "completed"]);
});

Deno.test("OperationInvoker.input().start() still returns an OperationRef after accepted when watch setup fails", async () => {
  const callbackOrder: string[] = [];
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        revision: 2,
        state: "completed",
        output: {
          refundId: "rf_123",
        },
      },
    },
  ], {
    watchError: new UnexpectedError({
      cause: new Error("watch unavailable"),
    }),
  });

  const operation = new OperationInvoker(transport, refundOperation);
  const started = await operation.input({ chargeId: "ch_123" })
    .onAccepted(() => {
      callbackOrder.push("accepted");
    })
    .onCompleted(() => {
      callbackOrder.push("completed");
    })
    .start();
  const reference = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const terminal = (await reference.wait()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(reference.id, "op_123");
  assertEquals(terminal.state, "completed");
  assertEquals(terminal.output, { refundId: "rf_123" });
  assertEquals(callbackOrder, ["accepted"]);
  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "ch_123" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "watch", operationId: "op_123" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "wait", operationId: "op_123" },
    },
  ]);
});

Deno.test("OperationInvoker.input().start() returns an accepted ref even when onAccepted fails", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const started = await operation.input({ chargeId: "ch_123" })
    .onAccepted(() => {
      throw new Error("accepted callback failed");
    })
    .start();
  const reference = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const waited = await reference.wait();
  const error = waited.match({
    ok: () => {
      throw new Error("expected wait() to surface callback failure");
    },
    err: (value) => value,
  });

  assertEquals(reference.id, "op_123");
  assertEquals(error.getContext().operationObserverCallback, true);
  assertEquals(error.getContext().causeMessage, "accepted callback failed");
});

Deno.test("OperationInvoker.input().transfer().start() still returns a StartedTransfer after accepted when watch setup fails", async () => {
  const callbackOrder: string[] = [];
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_upload_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
      transfer: {
        type: "TransferGrant",
        kind: "upload",
        service: "billing",
        sessionKey: "session-key",
        transferId: "transfer_123",
        subject: "transfer.v1.upload.session.transfer_123",
        expiresAt: "2026-01-01T00:00:00.000Z",
        chunkBytes: 262144,
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        revision: 2,
        state: "completed",
        output: {
          refundId: "rf_123",
        },
      },
    },
  ], {
    watchError: new UnexpectedError({
      cause: new Error("watch unavailable"),
    }),
  });

  const operation = new OperationInvoker(transport, uploadOperation);
  const started = await operation.input({ chargeId: "incoming/test.bin" })
    .transfer(new TextEncoder().encode("hello world"))
    .onAccepted(() => {
      callbackOrder.push("accepted");
    })
    .onCompleted(() => {
      callbackOrder.push("completed");
    })
    .start();
  const upload = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const completed = (await upload.wait()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(upload.operation.id, "op_upload_123");
  assertEquals(completed.transferred.key, "incoming/test.bin");
  assertEquals(completed.terminal.state, "completed");
  assertEquals(callbackOrder, ["accepted"]);
  assertEquals(transport.transferred.length, 1);
});

Deno.test("OperationInvoker.input().transfer().start() waits for terminal state when no event callback is provided", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_upload_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
      transfer: {
        type: "TransferGrant",
        kind: "upload",
        service: "billing",
        sessionKey: "session-key",
        transferId: "transfer_123",
        subject: "transfer.v1.upload.session.transfer_123",
        expiresAt: "2026-01-01T00:00:00.000Z",
        chunkBytes: 262144,
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        id: "op_upload_123",
        service: "billing",
        operation: "Billing.Refund",
        revision: 2,
        state: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
        output: {
          refundId: "rf_123",
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, uploadOperation);
  const started = await operation.input({ chargeId: "incoming/test.bin" })
    .transfer(new TextEncoder().encode("hello world"))
    .start();
  const upload = started.match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const result = (await upload.wait()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "incoming/test.bin" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "wait", operationId: "op_upload_123" },
    },
  ]);
  assertEquals(result.terminal.state, "completed");
});

Deno.test("OperationInvoker.resume() returns an OperationRef bound to the provided ref data", () => {
  const transport = new FakeOperationTransport([]);
  const operation = new OperationInvoker(transport, refundOperation);

  const reference = operation.resume({
    id: "op_123",
    service: "billing",
    operation: "Billing.Refund",
  });

  assertEquals(reference.id, "op_123");
  assertEquals(reference.service, "billing");
  assertEquals(reference.operation, "Billing.Refund");
});

Deno.test("OperationRef.get() sends action:get to <subject>.control and decodes the snapshot frame", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        revision: 2,
        state: "running",
        progress: {
          message: "working",
        },
      },
    },
  ]);

  const operation = new OperationInvoker(
    transport,
    refundOperation,
  );
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const snapshot = (await reference.get()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "ch_123" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "get", operationId: "op_123" },
    },
  ]);
  assertEquals(snapshot.revision, 2);
  assertEquals(snapshot.state, "running");
  assertEquals(snapshot.progress, { message: "working" });
});

Deno.test("OperationRef.get() surfaces control error frames with the runtime error details", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "error",
      error: {
        type: "AuthError",
        message: "not allowed",
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const result = await reference.get();
  const error = result.match({
    ok: () => {
      throw new Error("expected get() to fail");
    },
    err: (value) => value,
  });

  const context = error.getContext();
  assertEquals(context.controlErrorType, "AuthError");
  assertEquals(context.controlErrorMessage, "not allowed");
  assertEquals(context.causeMessage, "Operation control error AuthError: not allowed");
});

Deno.test("OperationRef.cancel() sends action:cancel to <subject>.control and decodes the returned snapshot frame", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        revision: 3,
        state: "cancelled",
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const snapshot = (await reference.cancel()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "ch_123" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "cancel", operationId: "op_123" },
    },
  ]);
  assertEquals(snapshot.revision, 3);
  assertEquals(snapshot.state, "cancelled");
});

Deno.test("OperationRef.cancel() surfaces control error frames with the runtime error details", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "error",
      error: {
        type: "ValidationError",
        message: "cannot cancel now",
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const result = await reference.cancel();
  const error = result.match({
    ok: () => {
      throw new Error("expected cancel() to fail");
    },
    err: (value) => value,
  });

  const context = error.getContext();
  assertEquals(context.controlErrorType, "ValidationError");
  assertEquals(context.controlErrorMessage, "cannot cancel now");
  assertEquals(
    context.causeMessage,
    "Operation control error ValidationError: cannot cancel now",
  );
});

Deno.test("OperationRef.wait() sends action:wait and rejects a non-terminal snapshot", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        revision: 2,
        state: "running",
        progress: {
          message: "working",
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const result = await reference.wait();
  const error = result.take();

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "ch_123" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "wait", operationId: "op_123" },
    },
  ]);
  assertExists(error);
});

Deno.test("OperationRef.wait() surfaces control error frames with the runtime error details", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "error",
      error: {
        type: "UnexpectedError",
        message: "watch backend unavailable",
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const result = await reference.wait();
  const error = result.match({
    ok: () => {
      throw new Error("expected wait() to fail");
    },
    err: (value) => value,
  });

  const context = error.getContext();
  assertEquals(context.controlErrorType, "UnexpectedError");
  assertEquals(context.controlErrorMessage, "watch backend unavailable");
  assertEquals(
    context.causeMessage,
    "Operation control error UnexpectedError: watch backend unavailable",
  );
});

Deno.test("OperationRef.watch() sends action:watch to <subject>.control and yields operation events", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "snapshot",
      snapshot: {
        revision: 2,
        state: "running",
        progress: {
          message: "working",
        },
      },
    },
    {
      kind: "event",
      event: {
        type: "progress",
        progress: {
          message: "almost there",
        },
        snapshot: {
          revision: 3,
          state: "running",
          progress: {
            message: "almost there",
          },
        },
      },
    },
    { kind: "keepalive" },
    {
      kind: "event",
      event: {
        type: "completed",
        snapshot: {
          revision: 4,
          state: "completed",
          output: {
            refundId: "rf_123",
          },
        },
      },
    },
    {
      kind: "event",
      event: {
        type: "progress",
        snapshot: {
          revision: 5,
          state: "running",
          progress: {
            message: "ignored",
          },
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const watch = (await reference.watch()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const events: OperationEvent[] = [];
  for await (const event of watch) {
    events.push(event);
  }

  assertEquals(transport.seen, [
    {
      subject: "operations.v1.Billing.Refund",
      body: { chargeId: "ch_123" },
    },
    {
      subject: controlSubject("operations.v1.Billing.Refund"),
      body: { action: "watch", operationId: "op_123" },
    },
  ]);
  assertEquals(events.length, 3);
  assertEquals(events[0].type, "started");
  assertEquals(events[1].type, "progress");
  if (events[1].type !== "progress") {
    throw new Error("expected progress event");
  }
  assertEquals(events[1].progress, { message: "almost there" });
  assertEquals(events[1].snapshot.progress, { message: "almost there" });
  assertEquals(events[2].type, "completed");
});

Deno.test("OperationRef.watch() surfaces an initial control error frame during iteration", async () => {
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "error",
      error: {
        type: "AuthError",
        message: "cannot watch this operation",
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const watch = (await reference.watch()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });

  let thrown: unknown;
  try {
    for await (const _event of watch) {
      throw new Error("expected watch iteration to fail");
    }
  } catch (error) {
    thrown = error;
  }

  if (!(thrown instanceof UnexpectedError)) {
    throw new Error(`expected UnexpectedError, got ${String(thrown)}`);
  }
  const context = thrown.getContext();
  assertEquals(context.controlErrorType, "AuthError");
  assertEquals(context.controlErrorMessage, "cannot watch this operation");
  assertEquals(
    context.causeMessage,
    "Operation control error AuthError: cannot watch this operation",
  );
});

Deno.test("OperationRef.watch() yields transfer events with per-chunk progress", async () => {
  const transferProgress: OperationTransferProgress = {
    chunkIndex: 0,
    chunkBytes: 5,
    transferredBytes: 5,
  };
  const transport = new FakeOperationTransport([
    {
      kind: "accepted",
      ref: {
        id: "op_123",
        service: "billing",
        operation: "Billing.Refund",
      },
      snapshot: {
        revision: 1,
        state: "pending",
      },
    },
    {
      kind: "event",
      event: {
        type: "transfer",
        transfer: transferProgress,
        snapshot: {
          id: "op_123",
          service: "billing",
          operation: "Billing.Refund",
          revision: 2,
          state: "running",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          transfer: transferProgress,
        },
      },
    },
    {
      kind: "event",
      event: {
        type: "completed",
        snapshot: {
          revision: 3,
          state: "completed",
          output: {
            refundId: "rf_123",
          },
        },
      },
    },
  ]);

  const operation = new OperationInvoker(transport, refundOperation);
  const reference = (await operation.input({ chargeId: "ch_123" }).start()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const watch = (await reference.watch()).match({
    ok: (value) => value,
    err: (error) => {
      throw error;
    },
  });
  const events: OperationEvent[] = [];
  for await (const event of watch) {
    events.push(event);
  }

  assertEquals(events[0], {
    type: "transfer",
    transfer: transferProgress,
    snapshot: {
      id: "op_123",
      service: "billing",
      operation: "Billing.Refund",
      revision: 2,
      state: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      transfer: transferProgress,
    },
  });
  assertEquals(events[1]?.type, "completed");
});
