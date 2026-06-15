import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  AsyncResult,
  BaseError,
  Result,
  type TerminalJob,
  type TerminalOperation,
} from "@qlever-llc/trellis";
import {
  assertCapturedEventContext,
  assertEventCaptured,
  assertEventsCaptured,
  assertJobCompleted,
  assertNoEventCaptured,
  assertNoEventDuring,
  assertOperationCompleted,
  assertRpcErr,
  assertRpcEventuallyOk,
  assertRpcOk,
  type TrellisTestAssertionEventCapture,
  type TrellisTestEventByName,
  waitFor,
  type WaitForOptions,
} from "../index.ts";

type SerializableTestError = {
  id: string;
  type: string;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
};

class TestError extends BaseError<SerializableTestError> {
  override readonly name = "TestError" as const;

  override toSerializable(): SerializableTestError {
    return {
      id: this.id,
      type: this.name,
      message: this.message,
      context: this.getContext(),
    };
  }
}

type ChangedEvent = {
  readonly event: "Entity.Changed";
  readonly payload: {
    readonly id: string;
    readonly value: string;
    readonly nested?: { readonly a: number; readonly b: number };
  };
  readonly context: {
    readonly id: string;
    readonly time: Date;
    readonly mode: "ephemeral";
  };
  readonly receivedAt: Date;
};

type DeletedEvent = {
  readonly event: "Entity.Deleted";
  readonly payload: { readonly id: string };
  readonly context: {
    readonly id: string;
    readonly time: Date;
    readonly mode: "ephemeral";
  };
  readonly receivedAt: Date;
};

type TestEvent = ChangedEvent | DeletedEvent;

function isTestEvent<TEventName extends TestEvent["event"]>(
  event: TestEvent,
  name: TEventName,
): event is TrellisTestEventByName<TestEvent, TEventName> {
  return event.event === name;
}

class FakeCapture implements TrellisTestAssertionEventCapture<TestEvent> {
  readonly #events: TestEvent[] = [];

  constructor(events: readonly TestEvent[] = []) {
    this.#events.push(...events);
  }

  add(event: TestEvent): void {
    this.#events.push(event);
  }

  all(): ReadonlyArray<TestEvent> {
    return [...this.#events];
  }

  async waitFor<TEventName extends TestEvent["event"]>(
    name: TEventName,
    predicate?: (
      event: TrellisTestEventByName<TestEvent, TEventName>,
    ) => boolean | Promise<boolean>,
    opts?: WaitForOptions,
  ): Promise<TrellisTestEventByName<TestEvent, TEventName>> {
    const timeoutMs = opts?.timeoutMs ?? 50;
    const intervalMs = opts?.intervalMs ?? 1;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      for (const event of this.#events) {
        if (!isTestEvent(event, name)) continue;
        if (predicate === undefined || await predicate(event)) return event;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`timed out waiting for ${name}`);
  }
}

class IdentityChangingCapture extends FakeCapture {
  override all(): ReadonlyArray<TestEvent> {
    return super.all().map((event) => ({ ...event }));
  }
}

class DirectMultiEventCaptureLike {
  readonly #events: TestEvent[] = [];

  constructor(events: readonly TestEvent[] = []) {
    this.#events.push(...events);
  }

  all(): ReadonlyArray<TestEvent>;
  all<TEventName extends TestEvent["event"]>(
    name: TEventName,
  ): ReadonlyArray<TrellisTestEventByName<TestEvent, TEventName>>;
  all<TEventName extends TestEvent["event"]>(
    name?: TEventName,
  ):
    | ReadonlyArray<TestEvent>
    | ReadonlyArray<TrellisTestEventByName<TestEvent, TEventName>> {
    if (name === undefined) return [...this.#events];
    return this.#events.filter((event): event is TrellisTestEventByName<
      TestEvent,
      TEventName
    > => isTestEvent(event, name));
  }

  async waitFor<TEventName extends TestEvent["event"]>(
    name: TEventName,
    predicate?: (
      event: TrellisTestEventByName<TestEvent, TEventName>,
    ) => boolean | Promise<boolean>,
    opts?: WaitForOptions,
  ): Promise<TrellisTestEventByName<TestEvent, TEventName>> {
    return await waitFor(async () => {
      for (const event of this.all(name)) {
        if (predicate === undefined || await predicate(event)) return event;
      }
      return false;
    }, opts);
  }
}

function changed(
  id: string,
  value = "updated",
  contextId = `ctx-${id}`,
): ChangedEvent {
  return {
    event: "Entity.Changed",
    payload: { id, value, nested: { a: 1, b: 2 } },
    context: {
      id: contextId,
      time: new Date("2026-06-15T00:00:00Z"),
      mode: "ephemeral",
    },
    receivedAt: new Date("2026-06-15T00:00:01Z"),
  };
}

function deleted(id: string, contextId = `ctx-delete-${id}`): DeletedEvent {
  return {
    event: "Entity.Deleted",
    payload: { id },
    context: {
      id: contextId,
      time: new Date("2026-06-15T00:00:02Z"),
      mode: "ephemeral",
    },
    receivedAt: new Date("2026-06-15T00:00:03Z"),
  };
}

function completedJob<TResult>(result: TResult): TerminalJob<unknown, TResult> {
  return {
    id: "job-1",
    service: "entity",
    type: "Entity.Sync",
    state: "completed",
    context: {
      traceId: "trace-1",
      traceparent: "00-00000000000000000000000000000001-0000000000000001-01",
      requestId: "request-1",
    },
    payload: {},
    result,
    createdAt: "2026-06-15T00:00:00Z",
    updatedAt: "2026-06-15T00:00:01Z",
    tries: 1,
    maxTries: 3,
  };
}

function terminalOperation<TOutput>(
  state: "completed" | "failed" | "cancelled",
  output?: TOutput,
): TerminalOperation<unknown, TOutput> {
  return {
    id: "op-1",
    service: "entity",
    operation: "Entity.Process",
    revision: 1,
    state,
    createdAt: "2026-06-15T00:00:00Z",
    updatedAt: "2026-06-15T00:00:01Z",
    output,
  };
}

Deno.test("assertEventCaptured returns the matching event", async () => {
  const capture = new FakeCapture([changed("entity-1"), changed("entity-2")]);

  const event = await assertEventCaptured(
    capture,
    "Entity.Changed",
    (record) => record.payload.id === "entity-2",
  );

  assertEquals(event.payload.id, "entity-2");
});

Deno.test("assertEventCaptured narrows selected event predicate and return", async () => {
  const capture = new FakeCapture([changed("entity-1")]);

  const event = await assertEventCaptured(
    capture,
    "Entity.Changed",
    (record) => record.payload.value === "updated",
  );
  const value: string = event.payload.value;

  assertEquals(value, "updated");
});

Deno.test("assertEventCaptured uses capture-specific waitFor when available", async () => {
  const expected = changed("entity-1");
  let usedCaptureWaitFor = false;
  const capture: TrellisTestAssertionEventCapture<TestEvent> = {
    all: () => [],
    waitFor: async (name, predicate) => {
      usedCaptureWaitFor = true;
      if (!isTestEvent(expected, name)) {
        throw new Error(`unexpected event ${name}`);
      }
      if (predicate !== undefined && !await predicate(expected)) {
        throw new Error("predicate rejected event");
      }
      return expected;
    },
  };

  const event = await assertEventCaptured(
    capture,
    "Entity.Changed",
    (record) => record.payload.value === "updated",
  );

  assertEquals(event, expected);
  assertEquals(usedCaptureWaitFor, true);
});

Deno.test("assertEventCaptured failure lists captured events", async () => {
  const capture = new FakeCapture([changed("entity-1")]);

  const error = await assertRejects(
    () =>
      assertEventCaptured(
        capture,
        "Entity.Deleted",
        undefined,
        { timeoutMs: 1, intervalMs: 1 },
      ),
    Error,
  );

  assertStringIncludes(error.message, "Expected captured event Entity.Deleted");
  assertStringIncludes(error.message, "Entity.Changed");
  assertStringIncludes(error.message, "context=ctx-entity-1");
});

Deno.test("assertEventsCaptured matches unordered expectations by default", async () => {
  const first = deleted("entity-1");
  const second = changed("entity-2");
  const capture = new FakeCapture([first, second]);

  const events = await assertEventsCaptured(capture, [
    {
      event: "Entity.Changed",
      predicate: (event) => event.payload.id === "entity-2",
    },
    "Entity.Deleted",
  ]);

  assertEquals(events, [second, first]);
});

Deno.test("assertEventsCaptured backtracks unordered broad and narrow expectations", async () => {
  const first = changed("entity-1");
  const second = changed("entity-2");
  const capture = new FakeCapture([first, second]);

  const events = await assertEventsCaptured(capture, [
    "Entity.Changed",
    {
      event: "Entity.Changed",
      predicate: (event) => event.payload.id === "entity-1",
    },
  ]);

  assertEquals(events, [second, first]);
});

Deno.test("assertEventsCaptured narrows object predicate by event name", async () => {
  const event = changed("entity-1", "typed-value");
  const capture = new FakeCapture([event]);

  const events = await assertEventsCaptured(capture, [
    {
      event: "Entity.Changed",
      predicate: (record) => record.payload.value === "typed-value",
    },
  ]);

  assertEquals(events, [event]);
});

Deno.test("event assertions accept direct multi-event capture-like shape", async () => {
  const changedEvent = changed("entity-1", "direct");
  const deletedEvent = deleted("entity-2");
  const capture = new DirectMultiEventCaptureLike([changedEvent, deletedEvent]);

  const event = await assertEventCaptured(
    capture,
    "Entity.Changed",
    (record) => {
      const value: string = record.payload.value;
      return value === "direct";
    },
  );
  const changedValue: string = event.payload.value;

  const events = await assertEventsCaptured(capture, [
    {
      event: "Entity.Deleted",
      predicate: (record) => {
        const id: string = record.payload.id;
        return id === "entity-2";
      },
    },
    {
      event: "Entity.Changed",
      predicate: (record) => {
        const nestedA: number | undefined = record.payload.nested?.a;
        return nestedA === 1;
      },
    },
  ]);

  await assertNoEventCaptured(
    capture,
    "Entity.Deleted",
    (record) => {
      const id: string = record.payload.id;
      return id === "missing";
    },
  );

  assertEquals(changedValue, "direct");
  assertEquals(events, [deletedEvent, changedEvent]);
});

Deno.test("assertEventsCaptured supports ordered matching", async () => {
  const first = changed("entity-1");
  const second = deleted("entity-1");
  const capture = new FakeCapture([first, second]);

  const events = await assertEventsCaptured(
    capture,
    ["Entity.Changed", "Entity.Deleted"],
    { ordered: true },
  );

  assertEquals(events, [first, second]);
});

Deno.test("assertEventsCaptured ordered failure includes expectation", async () => {
  const capture = new FakeCapture([deleted("entity-1"), changed("entity-1")]);

  const error = await assertRejects(
    () =>
      assertEventsCaptured(
        capture,
        ["Entity.Changed", "Entity.Deleted"],
        { ordered: true, timeoutMs: 1, intervalMs: 1 },
      ),
    Error,
  );

  assertStringIncludes(error.message, "expectation 2/2");
  assertStringIncludes(error.message, "Entity.Deleted");
});

Deno.test("assertNoEventCaptured succeeds immediately when no event matches", async () => {
  const capture = new FakeCapture([changed("entity-1")]);

  await assertNoEventCaptured(
    capture,
    "Entity.Changed",
    (event) => event.payload.id === "entity-2",
  );
});

Deno.test("assertNoEventCaptured fails for matching event captured so far", async () => {
  const capture = new FakeCapture([changed("entity-1")]);

  const error = await assertRejects(
    () => assertNoEventCaptured(capture, "Entity.Changed"),
    Error,
  );

  assertStringIncludes(
    error.message,
    "Expected no captured event Entity.Changed",
  );
  assertStringIncludes(error.message, "Entity.Changed");
});

Deno.test("assertNoEventDuring ignores baseline events and succeeds without new matches", async () => {
  const capture = new FakeCapture([changed("entity-1")]);

  await assertNoEventDuring(capture, "Entity.Changed", {
    durationMs: 5,
    intervalMs: 1,
  });
});

Deno.test("assertNoEventDuring ignores baseline order instead of event identity", async () => {
  const capture = new IdentityChangingCapture([changed("entity-1")]);

  await assertNoEventDuring(
    capture,
    "Entity.Changed",
    (event) => event.payload.id === "entity-1",
    { durationMs: 5, intervalMs: 1 },
  );

  setTimeout(() => capture.add(changed("entity-2")), 1);
  const error = await assertRejects(
    () =>
      assertNoEventDuring(
        capture,
        "Entity.Changed",
        (event) => event.payload.id === "entity-2",
        { durationMs: 25, intervalMs: 1 },
      ),
    Error,
  );

  assertStringIncludes(error.message, "entity-2");
});

Deno.test("assertNoEventDuring fails for newly captured matching event", async () => {
  const capture = new FakeCapture();
  setTimeout(() => capture.add(changed("entity-1")), 1);

  const error = await assertRejects(
    () =>
      assertNoEventDuring(capture, "Entity.Changed", undefined, {
        durationMs: 25,
        intervalMs: 1,
      }),
    Error,
  );

  assertStringIncludes(error.message, "during 25ms");
  assertStringIncludes(error.message, "Entity.Changed");
});

Deno.test("assertNoEventDuring scans at deadline when interval exceeds duration", async () => {
  const capture = new FakeCapture();
  setTimeout(() => capture.add(changed("entity-1")), 1);

  const error = await assertRejects(
    () =>
      assertNoEventDuring(capture, "Entity.Changed", {
        durationMs: 10,
        intervalMs: 50,
      }),
    Error,
  );

  assertStringIncludes(error.message, "during 10ms");
  assertStringIncludes(error.message, "Entity.Changed");
});

Deno.test("assertNoEventDuring validates timing options", async () => {
  const capture = new FakeCapture();

  const durationError = await assertRejects(
    () => assertNoEventDuring(capture, "Entity.Changed", { durationMs: -1 }),
    Error,
  );
  assertStringIncludes(durationError.message, "durationMs");

  const intervalError = await assertRejects(
    () =>
      assertNoEventDuring(capture, "Entity.Changed", {
        durationMs: 1,
        intervalMs: 0,
      }),
    Error,
  );
  assertStringIncludes(intervalError.message, "intervalMs");
});

Deno.test("assertJobCompleted accepts terminal and waitable jobs", async () => {
  const terminal = completedJob({ ok: true, nested: { a: 1, b: 2 } });
  const waitable = { wait: () => AsyncResult.ok(terminal) };

  assertEquals(
    await assertJobCompleted(terminal, { nested: { a: 1 } }),
    terminal,
  );
  assertEquals(await assertJobCompleted(waitable, { ok: true }), terminal);
});

Deno.test("assertJobCompleted accepts generated orThrow wait result", async () => {
  const terminal = completedJob({ ok: true });
  const waitable = {
    wait: () => ({ orThrow: () => Promise.resolve(terminal) }),
  };

  assertEquals(await assertJobCompleted(waitable, { ok: true }), terminal);
});

Deno.test("assertJobCompleted fails for non-completed job and result mismatch", async () => {
  const failed: TerminalJob<unknown, { ok: boolean }> = {
    ...completedJob({ ok: false }),
    state: "failed",
    lastError: "boom",
  };

  const stateError = await assertRejects(
    () => assertJobCompleted(failed),
    Error,
  );
  assertStringIncludes(stateError.message, "got failed");

  const resultError = await assertRejects(
    () => assertJobCompleted(completedJob({ ok: false }), { ok: true }),
    Error,
  );
  assertStringIncludes(resultError.message, "job.result.ok mismatch");
});

Deno.test("assertOperationCompleted accepts terminal and waitable operations", async () => {
  const terminal = terminalOperation("completed", {
    ok: true,
    nested: { a: 1, b: 2 },
  });
  const waitable = { wait: () => Result.ok(terminal) };

  assertEquals(
    await assertOperationCompleted(terminal, { nested: { a: 1 } }),
    terminal,
  );
  assertEquals(
    await assertOperationCompleted(waitable, { ok: true }),
    terminal,
  );
});

Deno.test("assertOperationCompleted accepts generated orThrow wait result", async () => {
  const terminal = terminalOperation("completed", { ok: true });
  const waitable = {
    wait: () => ({ orThrow: () => Promise.resolve(terminal) }),
  };

  assertEquals(
    await assertOperationCompleted(waitable, { ok: true }),
    terminal,
  );
});

Deno.test("assertOperationCompleted fails for non-completed operation and output mismatch", async () => {
  const stateError = await assertRejects(
    () => assertOperationCompleted(terminalOperation("cancelled")),
    Error,
  );
  assertStringIncludes(stateError.message, "got cancelled");

  const outputError = await assertRejects(
    () => assertOperationCompleted(terminalOperation("completed", [1, 2]), [1]),
    Error,
  );
  assertStringIncludes(outputError.message, "operation.output mismatch");
});

Deno.test("assertRpcOk accepts Result, AsyncResult, and Promise<Result>", async () => {
  assertEquals(
    await assertRpcOk(Result.ok({ ok: true, nested: { a: 1, b: 2 } }), {
      nested: { a: 1 },
    }),
    {
      ok: true,
      nested: { a: 1, b: 2 },
    },
  );
  assertEquals(await assertRpcOk(AsyncResult.ok("async-ok")), "async-ok");
  assertEquals(await assertRpcOk(Promise.resolve(Result.ok([1, 2]))), [1, 2]);
});

Deno.test("assertRpcOk fails for Err and expected mismatch", async () => {
  const errError = await assertRejects(
    () => assertRpcOk(Result.err(new TestError("nope"))),
    Error,
  );
  assertStringIncludes(
    errError.message,
    "Expected Result Ok, got Err TestError",
  );

  const expectedError = await assertRejects(
    () => assertRpcOk(Result.ok({ ok: false }), { ok: true }),
    Error,
  );
  assertStringIncludes(expectedError.message, "result.value.ok mismatch");
});

Deno.test("assertRpcEventuallyOk polls Err until Ok and returns value", async () => {
  let calls = 0;

  const value = await assertRpcEventuallyOk(
    waitFor,
    () => {
      calls += 1;
      return calls < 3
        ? Result.err<TestError, { readonly ok: boolean }>(
          new TestError("not yet"),
        )
        : Result.ok({ ok: true });
    },
    undefined,
    { timeoutMs: 50, intervalMs: 1 },
  );

  assertEquals(value, { ok: true });
  assertEquals(calls, 3);
});

Deno.test("assertRpcEventuallyOk waits for expected partial to match", async () => {
  let calls = 0;
  const runtime = { waitFor };

  const value = await assertRpcEventuallyOk(
    runtime,
    () => {
      calls += 1;
      return Result.ok({ id: "entity-1", revision: calls });
    },
    { revision: 3 },
    { timeoutMs: 50, intervalMs: 1 },
  );

  assertEquals(value, { id: "entity-1", revision: 3 });
});

Deno.test("assertRpcEventuallyOk failure includes last Err or mismatch", async () => {
  const errError = await assertRejects(
    () =>
      assertRpcEventuallyOk(
        waitFor,
        () =>
          Result.err<TestError, { readonly ok: boolean }>(
            new TestError("still missing"),
          ),
        undefined,
        { timeoutMs: 3, intervalMs: 1 },
      ),
    Error,
  );
  assertStringIncludes(errError.message, "last Err TestError: still missing");

  const mismatchError = await assertRejects(
    () =>
      assertRpcEventuallyOk(
        waitFor,
        () => Result.ok({ ok: false }),
        { ok: true },
        { timeoutMs: 3, intervalMs: 1 },
      ),
    Error,
  );
  assertStringIncludes(mismatchError.message, "last expected mismatch");
  assertStringIncludes(mismatchError.message, "result.value.ok mismatch");
});

Deno.test("assertRpcErr accepts Result and AsyncResult with name or constructor", async () => {
  const resultError = new TestError("result-error");
  const asyncError = new TestError("async-error");
  const promiseError = new TestError("promise-error");

  assertEquals(
    await assertRpcErr(Result.err(resultError), "TestError"),
    resultError,
  );
  assertEquals(
    await assertRpcErr(AsyncResult.err(asyncError), TestError),
    asyncError,
  );
  assertEquals(
    await assertRpcErr(Promise.resolve(Result.err(promiseError)), TestError),
    promiseError,
  );
});

Deno.test("assertRpcErr fails for Ok and expected error mismatch", async () => {
  const okError = await assertRejects(
    () => assertRpcErr(Result.ok({ ok: true })),
    Error,
  );
  assertStringIncludes(okError.message, "Expected Result Err, got Ok");

  const nameError = await assertRejects(
    () => assertRpcErr(Result.err(new TestError("wrong")), "OtherError"),
    Error,
  );
  assertStringIncludes(nameError.message, "result.error.name mismatch");
});

Deno.test("assertCapturedEventContext validates context and returns event", () => {
  const event = changed("entity-1");

  assertEquals(
    assertCapturedEventContext(event, {
      id: "ctx-entity-1",
      time: new Date("2026-06-15T00:00:00Z"),
      receivedAt: new Date("2026-06-15T00:00:01Z"),
    }),
    event,
  );
});

Deno.test("assertCapturedEventContext fails for invalid context", () => {
  const invalid = {
    ...changed("entity-1"),
    context: { id: "ctx-entity-1", time: "not-a-date", mode: "ephemeral" },
  };

  const error = assertThrows(() => assertCapturedEventContext(invalid), Error);

  assertStringIncludes(error.message, "context.time");
});
