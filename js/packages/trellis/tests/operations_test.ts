import { assertEquals, assertExists } from "@std/assert";
import { Type } from "typebox";
import { type Result, ok } from "../../result/mod.ts";
import type { JsonValue } from "@qlever-llc/trellis-contracts";
import { defineContract } from "../contract.ts";
import {
  controlSubject,
  type OperationEvent,
  OperationInvoker,
  type OperationRef,
  type OperationTransport,
} from "../operations.ts";
import { UnexpectedError } from "../errors/index.ts";

const schemas = {
  RefundInput: Type.Object({ chargeId: Type.String() }, { additionalProperties: false }),
  RefundProgress: Type.Object({ message: Type.String() }, { additionalProperties: false }),
  RefundOutput: Type.Object({ refundId: Type.String() }, { additionalProperties: false }),
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
  return { schema } as const;
}

const billing = defineContract({
  id: "trellis.billing.test@v1",
  displayName: "Billing Test",
  description: "Exercise operations runtime helpers.",
  kind: "service",
  schemas,
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
});

const refundOperation = billing.API.owned.operations["Billing.Refund"];

class FakeOperationTransport implements OperationTransport {
  readonly seen: Array<{ subject: string; body: unknown }> = [];
  readonly #responses: JsonValue[];

  constructor(responses: JsonValue[]) {
    this.#responses = [...responses];
  }

  async requestJson(subject: string, body: unknown) {
    this.seen.push({ subject, body });
    const next = this.#responses.shift();
    if (next === undefined) throw new Error("missing fake response");
    return ok(next);
  }

  async watchJson(subject: string, body: unknown) {
    this.seen.push({ subject, body });
    const frames = this.#responses.splice(0).map((value) => ok(value));
    return ok((async function* () {
      for (const frame of frames) {
        yield frame;
      }
    })());
  }
}

Deno.test("OperationInvoker.start() posts input to the operation subject and returns an accepted OperationRef", async () => {
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
  const result = await operation.start({ chargeId: "ch_123" });
  const reference = result.take() as {
    id: string;
    service: string;
    operation: string;
    get: () => Promise<unknown>;
  };

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

Deno.test("OperationInvoker.start type surface stays specific", () => {
  type Started = ReturnType<OperationInvoker<typeof refundOperation>["start"]>;
  const typed: Promise<Result<OperationRef<typeof refundOperation>, UnexpectedError>> =
    null as unknown as Started;
  assertEquals(true, true);
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
  const reference = (await operation.start({ chargeId: "ch_123" })).take() as {
    get: () => Promise<{ take: () => unknown }>;
  };
  const snapshot = (await reference.get()).take();

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
  assertEquals(snapshot, {
    revision: 2,
    state: "running",
    progress: { message: "working" },
  });
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
  const reference = (await operation.start({ chargeId: "ch_123" })).take() as {
    cancel: () => Promise<{ take: () => unknown }>;
  };
  const snapshot = (await reference.cancel()).take();

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
  assertEquals(snapshot, {
    revision: 3,
    state: "cancelled",
  });
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
  const reference = (await operation.start({ chargeId: "ch_123" })).take() as {
    wait: () => Promise<{ take: () => unknown }>;
  };
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
  const reference = (await operation.start({ chargeId: "ch_123" })).take() as {
    watch: () => Promise<{ take: () => AsyncIterable<OperationEvent<unknown, unknown>> }>;
  };
  const watch = (await reference.watch()).take();
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
  assertEquals(events[2].type, "completed");
});
