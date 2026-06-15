import { assertEquals, fail } from "@std/assert";
import {
  AsyncResult,
  type BaseError,
  type MaybeAsync,
  Result,
  type TerminalJob,
  type TerminalOperation,
} from "@qlever-llc/trellis";
import type { WaitForOptions } from "./types.ts";
import { waitFor } from "./wait.ts";

type MaybePromise<T> = T | Promise<T>;

/** Recursive subset expectation used by Trellis test assertion helpers. */
export type TrellisTestDeepPartial<T> = T extends readonly unknown[] ? T
  : T extends object
    ? { readonly [K in keyof T]?: TrellisTestDeepPartial<T[K]> }
  : T;

/** Minimal captured-event shape accepted by the generic event assertion helpers. */
export type TrellisTestAssertionCapturedEvent<
  TEventName extends string = string,
  TPayload = unknown,
> = {
  /** Contract event name captured by the test listener. */
  readonly event: TEventName;
  /** Decoded event payload. */
  readonly payload: TPayload;
  /** Trellis listener metadata for the captured event. */
  readonly context: unknown;
  /** Wall-clock time when the test capture observed the event. */
  readonly receivedAt: unknown;
};

/** Captured-event variant selected by event name when the event type is a union. */
export type TrellisTestEventByName<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
> = TEvent extends TrellisTestAssertionCapturedEvent
  ? TEventName extends TEvent["event"] ? TEvent & { readonly event: TEventName }
  : never
  : never;

/** Predicate used by event assertion helpers to select a captured event. */
export type TrellisTestAssertionEventPredicate<
  TEvent extends TrellisTestAssertionCapturedEvent =
    TrellisTestAssertionCapturedEvent,
> = (event: TEvent) => MaybePromise<boolean>;

/** Structural event capture accepted by Trellis test event assertion helpers. */
export type TrellisTestAssertionEventCapture<
  TEvent extends TrellisTestAssertionCapturedEvent =
    TrellisTestAssertionCapturedEvent,
> = {
  /** Returns events captured so far in capture order. */
  all(): ReadonlyArray<TEvent>;
  /** Waits for a captured event matching the name and optional predicate. */
  waitFor<TEventName extends TEvent["event"]>(
    name: TEventName,
    predicate?: TrellisTestAssertionEventPredicate<
      TrellisTestEventByName<TEvent, TEventName>
    >,
    opts?: WaitForOptions,
  ): Promise<TrellisTestEventByName<TEvent, TEventName>>;
};

/** Event expectation object accepted by `assertEventsCaptured`. */
export type TrellisTestEventExpectationObject<
  TEvent extends TrellisTestAssertionCapturedEvent =
    TrellisTestAssertionCapturedEvent,
> = {
  [TEventName in TEvent["event"]]: {
    /** Contract event name to match. */
    readonly event: TEventName;
    /** Optional predicate that must match the captured event. */
    readonly predicate?: TrellisTestAssertionEventPredicate<
      TrellisTestEventByName<TEvent, TEventName>
    >;
  };
}[TEvent["event"]];

/** Event expectation accepted by `assertEventsCaptured`. */
export type TrellisTestEventExpectation<
  TEvent extends TrellisTestAssertionCapturedEvent =
    TrellisTestAssertionCapturedEvent,
> = TEvent["event"] | TrellisTestEventExpectationObject<TEvent>;

/** Options for `assertEventsCaptured`. */
export type TrellisTestAssertEventsCapturedOptions = WaitForOptions & {
  /** Match expectations in capture order when true. Defaults to unordered. */
  readonly ordered?: boolean;
};

/** Options for `assertNoEventDuring`. */
export type TrellisTestAssertNoEventDuringOptions = {
  /** Duration to observe for newly captured events. */
  readonly durationMs: number;
  /** Poll interval while observing. Defaults to 10ms. */
  readonly intervalMs?: number;
};

/** Expected captured event context fields for `assertCapturedEventContext`. */
export type TrellisTestCapturedEventContextExpectation = {
  /** Expected Trellis event id. */
  readonly id?: string;
  /** Expected Trellis event creation time. */
  readonly time?: Date;
  /** Expected listener mode. Defaults to `ephemeral`. */
  readonly mode?: "ephemeral";
  /** Expected capture receipt time. */
  readonly receivedAt?: Date;
};

/** Structural Trellis job reference accepted by `assertJobCompleted`. */
export type TrellisTestWaitableJob<TPayload = unknown, TResult = unknown> = {
  /** Waits for the job to reach a terminal state. */
  wait(): MaybeAsync<TerminalJob<TPayload, TResult>, BaseError>;
};

/** Structural Trellis operation reference accepted by `assertOperationCompleted`. */
export type TrellisTestWaitableOperation<
  TProgress = unknown,
  TOutput = unknown,
> = {
  /** Waits for the operation to reach a terminal state. */
  wait(): MaybeAsync<TerminalOperation<TProgress, TOutput>, BaseError>;
};

/** Error constructor or class object accepted by `assertRpcErr`. */
export type TrellisTestErrorConstructor<TError extends Error = Error> =
  & (abstract new (...args: never[]) => TError)
  & { readonly name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function hasFunctionProperty(value: unknown, key: string): boolean {
  return isRecord(value) && typeof value[key] === "function";
}

function isNoEventDuringOptions(
  value: unknown,
): value is TrellisTestAssertNoEventDuringOptions {
  return isRecord(value) && typeof value["durationMs"] === "number";
}

function isWaitableJob<TPayload, TResult>(
  value:
    | TerminalJob<TPayload, TResult>
    | TrellisTestWaitableJob<TPayload, TResult>,
): value is TrellisTestWaitableJob<TPayload, TResult> {
  return hasFunctionProperty(value, "wait");
}

function isWaitableOperation<TProgress, TOutput>(
  value:
    | TerminalOperation<TProgress, TOutput>
    | TrellisTestWaitableOperation<TProgress, TOutput>,
): value is TrellisTestWaitableOperation<TProgress, TOutput> {
  return hasFunctionProperty(value, "wait");
}

function isExpectationObject<TEvent extends TrellisTestAssertionCapturedEvent>(
  value: TrellisTestEventExpectation<TEvent>,
): value is TrellisTestEventExpectationObject<TEvent> {
  return isRecord(value) && typeof value["event"] === "string";
}

function eventMatchesName<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
>(
  event: TEvent,
  eventName: TEventName,
): event is TrellisTestEventByName<TEvent, TEventName> {
  return event.event === eventName;
}

function expectationName<TEvent extends TrellisTestAssertionCapturedEvent>(
  expectation: TrellisTestEventExpectation<TEvent>,
): TEvent["event"] {
  return isExpectationObject(expectation) ? expectation.event : expectation;
}

function compactJson(value: unknown, maxLength = 240): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested) ?? String(value);
  } catch {
    rendered = String(value);
  }
  return rendered.length > maxLength
    ? `${rendered.slice(0, maxLength - 3)}...`
    : rendered;
}

function eventContextId(event: TrellisTestAssertionCapturedEvent): string {
  const context = event.context;
  if (!isRecord(context)) return "<missing>";
  const id = context.id;
  return typeof id === "string" && id.length > 0 ? id : "<missing>";
}

function formatEvent(event: TrellisTestAssertionCapturedEvent): string {
  return `${event.event} ${compactJson(event.payload)} context=${
    eventContextId(event)
  }`;
}

function formatEvents(
  events: ReadonlyArray<TrellisTestAssertionCapturedEvent>,
): string {
  const maxEvents = 12;
  if (events.length === 0) return "none";
  const rendered = events.slice(0, maxEvents).map(formatEvent);
  if (events.length > maxEvents) {
    rendered.push(`... ${events.length - maxEvents} more event(s)`);
  }
  return rendered.join("\n");
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertDeepPartial(
  actual: unknown,
  expected: unknown,
  label: string,
): void {
  if (
    expected instanceof Date || Array.isArray(expected) || !isRecord(expected)
  ) {
    assertEquals(actual, expected, `${label} mismatch`);
    return;
  }

  if (!isRecord(actual)) {
    fail(
      `${label} mismatch: expected object subset ${
        compactJson(expected)
      }, got ${compactJson(actual)}`,
    );
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    assertDeepPartial(actual[key], expectedValue, `${label}.${key}`);
  }
}

async function matchesExpectation<
  TEvent extends TrellisTestAssertionCapturedEvent,
>(
  event: TEvent,
  expectation: TrellisTestEventExpectation<TEvent>,
): Promise<boolean> {
  if (!isExpectationObject(expectation)) return event.event === expectation;
  if (!eventMatchesName(event, expectation.event)) return false;
  return expectation.predicate === undefined ||
    await expectation.predicate(event);
}

async function eventAssignment<
  TEvent extends TrellisTestAssertionCapturedEvent,
>(
  events: ReadonlyArray<TEvent>,
  expectations: readonly TrellisTestEventExpectation<TEvent>[],
  ordered: boolean,
): Promise<TEvent[] | undefined> {
  const used = new Set<number>();

  async function assign(
    expectationIndex: number,
    minimumEventIndex: number,
  ): Promise<TEvent[] | undefined> {
    if (expectationIndex === expectations.length) return [];

    const expectation = expectations[expectationIndex];
    if (expectation === undefined) return undefined;
    for (
      let eventIndex = minimumEventIndex;
      eventIndex < events.length;
      eventIndex++
    ) {
      if (used.has(eventIndex)) continue;
      const event = events[eventIndex];
      if (event === undefined) continue;
      if (!await matchesExpectation(event, expectation)) continue;

      used.add(eventIndex);
      const rest = await assign(
        expectationIndex + 1,
        ordered ? eventIndex + 1 : 0,
      );
      used.delete(eventIndex);
      if (rest !== undefined) return [event, ...rest];
    }

    return undefined;
  }

  return await assign(0, 0);
}

async function firstUnmatchedExpectationIndex<
  TEvent extends TrellisTestAssertionCapturedEvent,
>(
  events: ReadonlyArray<TEvent>,
  expectations: readonly TrellisTestEventExpectation<TEvent>[],
  ordered: boolean,
): Promise<number> {
  for (let index = 0; index < expectations.length; index++) {
    const prefix = expectations.slice(0, index + 1);
    if (await eventAssignment(events, prefix, ordered) === undefined) {
      return index;
    }
  }
  return Math.max(0, expectations.length - 1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveResultLike<T, E extends BaseError>(
  resultLike: MaybeAsync<T, E>,
): Promise<Result<T, E>> {
  if (resultLike instanceof Result) return resultLike;
  if (resultLike instanceof AsyncResult) return await resultLike;
  return await resultLike;
}

/**
 * Waits for a captured event and fails with captured-event context when it is absent.
 *
 * The helper delegates waiting to `capture.waitFor(...)`, then wraps failures with a
 * compact list of events captured so far.
 */
export async function assertEventCaptured<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
>(
  capture: TrellisTestAssertionEventCapture<TEvent>,
  eventName: TEventName,
  predicate?: TrellisTestAssertionEventPredicate<
    TrellisTestEventByName<TEvent, TEventName>
  >,
  options?: WaitForOptions,
): Promise<TrellisTestEventByName<TEvent, TEventName>> {
  try {
    return await capture.waitFor(eventName, predicate, options);
  } catch (error) {
    fail(
      `Expected captured event ${eventName}; ${describeCause(error)}\n` +
        `Captured events so far (${capture.all().length}):\n${
          formatEvents(capture.all())
        }`,
    );
  }
}

/**
 * Waits for several captured-event expectations.
 *
 * Expectations are matched unordered by default. Pass `{ ordered: true }` to
 * require capture order. Returned events are always in expectation order.
 */
export async function assertEventsCaptured<
  TEvent extends TrellisTestAssertionCapturedEvent,
>(
  capture: TrellisTestAssertionEventCapture<TEvent>,
  expectations: readonly TrellisTestEventExpectation<TEvent>[],
  options?: TrellisTestAssertEventsCapturedOptions,
): Promise<TEvent[]> {
  if (expectations.length === 0) return [];

  try {
    return await waitFor(async () => {
      const matched = await eventAssignment(
        capture.all(),
        expectations,
        options?.ordered === true,
      );
      return matched ?? false;
    }, options);
  } catch (error) {
    const events = capture.all();
    const index = await firstUnmatchedExpectationIndex(
      events,
      expectations,
      options?.ordered === true,
    );
    const expectation = expectations[index];
    const name = expectation === undefined
      ? "<missing>"
      : expectationName(expectation);
    fail(
      `Expected captured event expectation ${
        index + 1
      }/${expectations.length} (${name}); ${describeCause(error)}\n` +
        `Captured events so far (${events.length}):\n${formatEvents(events)}`,
    );
  }
}

/**
 * Asserts that no matching event has been captured so far.
 *
 * This is an immediate negative assertion. Use `assertNoEventDuring(...)` when a
 * test needs an explicit observation window.
 */
export async function assertNoEventCaptured<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
>(
  capture: TrellisTestAssertionEventCapture<TEvent>,
  eventName: TEventName,
  predicate?: TrellisTestAssertionEventPredicate<
    TrellisTestEventByName<TEvent, TEventName>
  >,
  options?: { readonly message?: string },
): Promise<void> {
  for (const event of capture.all()) {
    if (!eventMatchesName(event, eventName)) continue;
    if (predicate !== undefined && !await predicate(event)) continue;
    fail(
      `${
        options?.message ?? `Expected no captured event ${eventName}`
      } but found:\n` +
        `${
          formatEvent(event)
        }\nCaptured events so far (${capture.all().length}):\n${
          formatEvents(capture.all())
        }`,
    );
  }
}

/**
 * Asserts that no matching event is captured during an explicit observation window.
 *
 * Events already captured before this helper starts are ignored.
 */
export function assertNoEventDuring<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
>(
  capture: TrellisTestAssertionEventCapture<TEvent>,
  eventName: TEventName,
  options: TrellisTestAssertNoEventDuringOptions,
): Promise<void>;
export async function assertNoEventDuring<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
>(
  capture: TrellisTestAssertionEventCapture<TEvent>,
  eventName: TEventName,
  predicate:
    | TrellisTestAssertionEventPredicate<
      TrellisTestEventByName<TEvent, TEventName>
    >
    | undefined,
  options: TrellisTestAssertNoEventDuringOptions,
): Promise<void>;
export async function assertNoEventDuring<
  TEvent extends TrellisTestAssertionCapturedEvent,
  TEventName extends TEvent["event"],
>(
  capture: TrellisTestAssertionEventCapture<TEvent>,
  eventName: TEventName,
  predicateOrOptions:
    | TrellisTestAssertionEventPredicate<
      TrellisTestEventByName<TEvent, TEventName>
    >
    | TrellisTestAssertNoEventDuringOptions
    | undefined,
  options?: TrellisTestAssertNoEventDuringOptions,
): Promise<void> {
  const predicate = isNoEventDuringOptions(predicateOrOptions)
    ? undefined
    : predicateOrOptions;
  const resolvedOptions = options ??
    (isNoEventDuringOptions(predicateOrOptions)
      ? predicateOrOptions
      : undefined);
  if (resolvedOptions === undefined) {
    fail("assertNoEventDuring requires durationMs options");
    return;
  }
  const timingOptions = resolvedOptions;
  if (
    !Number.isFinite(timingOptions.durationMs) || timingOptions.durationMs < 0
  ) {
    fail("assertNoEventDuring requires finite durationMs >= 0");
  }
  if (
    timingOptions.intervalMs !== undefined &&
    (!Number.isFinite(timingOptions.intervalMs) ||
      timingOptions.intervalMs <= 0)
  ) {
    fail("assertNoEventDuring requires finite intervalMs > 0 when provided");
  }

  let nextEventIndex = capture.all().length;
  const intervalMs = timingOptions.intervalMs ?? 10;
  const deadline = Date.now() + timingOptions.durationMs;

  async function scan(): Promise<void> {
    const events = capture.all();
    for (let index = nextEventIndex; index < events.length; index++) {
      const event = events[index];
      if (event === undefined) continue;
      if (
        eventMatchesName(event, eventName) &&
        (predicate === undefined || await predicate(event))
      ) {
        fail(
          `Expected no captured event ${eventName} during ${timingOptions.durationMs}ms but found:\n` +
            `${
              formatEvent(event)
            }\nCaptured events so far (${capture.all().length}):\n${
              formatEvents(capture.all())
            }`,
        );
      }
    }
    nextEventIndex = events.length;
  }

  while (true) {
    await scan();
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await delay(Math.min(intervalMs, remainingMs));
  }

  await scan();
}

/**
 * Asserts that a job reference or terminal job completed successfully.
 *
 * When `expectedResult` is provided, object results are matched as a recursive
 * subset while arrays and primitives are compared exactly.
 */
export async function assertJobCompleted<TPayload, TResult>(
  jobOrTerminal:
    | TerminalJob<TPayload, TResult>
    | TrellisTestWaitableJob<TPayload, TResult>,
  expectedResult?: TrellisTestDeepPartial<TResult>,
): Promise<TerminalJob<TPayload, TResult>> {
  const terminal = isWaitableJob(jobOrTerminal)
    ? await assertRpcOk(jobOrTerminal.wait())
    : jobOrTerminal;

  if (terminal.state !== "completed") {
    fail(`Expected job ${terminal.id} to complete, got ${terminal.state}`);
  }
  if (expectedResult !== undefined) {
    assertDeepPartial(terminal.result, expectedResult, "job.result");
  }
  return terminal;
}

/**
 * Asserts that an operation reference or terminal operation completed successfully.
 *
 * When `expectedOutput` is provided, object outputs are matched as a recursive
 * subset while arrays and primitives are compared exactly.
 */
export async function assertOperationCompleted<TProgress, TOutput>(
  opOrTerminal:
    | TerminalOperation<TProgress, TOutput>
    | TrellisTestWaitableOperation<TProgress, TOutput>,
  expectedOutput?: TrellisTestDeepPartial<TOutput>,
): Promise<TerminalOperation<TProgress, TOutput> & { state: "completed" }> {
  const terminal = isWaitableOperation(opOrTerminal)
    ? await assertRpcOk(opOrTerminal.wait())
    : opOrTerminal;

  if (terminal.state !== "completed") {
    fail(
      `Expected operation ${terminal.id} to complete, got ${terminal.state}`,
    );
  }
  if (expectedOutput !== undefined) {
    assertDeepPartial(terminal.output, expectedOutput, "operation.output");
  }
  return terminal;
}

/**
 * Asserts that a Trellis RPC-style result is Ok and returns the Ok value.
 *
 * Accepts `Result`, `AsyncResult`, or `Promise<Result>`. When `expected` is
 * provided, object values are matched as a recursive subset while arrays and
 * primitives are compared exactly.
 */
export async function assertRpcOk<T, E extends BaseError>(
  resultLike: MaybeAsync<T, E>,
  expected?: TrellisTestDeepPartial<T>,
): Promise<T> {
  const result = await resolveResultLike(resultLike);
  if (result.isErr()) {
    fail(
      `Expected Result Ok, got Err ${result.error.name}: ${result.error.message}`,
    );
  }
  const value = result.orThrow();
  if (expected !== undefined) {
    assertDeepPartial(value, expected, "result.value");
  }
  return value;
}

/**
 * Asserts that a Trellis RPC-style result is Err and returns the error.
 *
 * The optional expectation may be an error `name` string or an error class.
 */
export async function assertRpcErr<T, E extends BaseError>(
  resultLike: MaybeAsync<T, E>,
  expectedErrorNameOrCtor?: string | TrellisTestErrorConstructor<E>,
): Promise<E> {
  const result = await resolveResultLike(resultLike);
  if (result.isOk()) {
    fail(`Expected Result Err, got Ok ${compactJson(result.orThrow())}`);
  }

  const error = result.error;
  if (typeof expectedErrorNameOrCtor === "string") {
    assertEquals(
      error.name,
      expectedErrorNameOrCtor,
      "result.error.name mismatch",
    );
  } else if (
    expectedErrorNameOrCtor !== undefined &&
    !(error instanceof expectedErrorNameOrCtor)
  ) {
    fail(
      `Expected Result Err ${expectedErrorNameOrCtor.name}, got ${error.name}: ${error.message}`,
    );
  }
  return error;
}

/**
 * Validates standard Trellis captured-event context metadata and returns the event.
 *
 * The helper requires a string context id, `Date` context time, `ephemeral` mode
 * by default, and a `Date` `receivedAt` value.
 */
export function assertCapturedEventContext<
  TEvent extends TrellisTestAssertionCapturedEvent,
>(
  event: TEvent,
  expected?: TrellisTestCapturedEventContextExpectation,
): TEvent {
  if (!isRecord(event.context)) {
    fail(`Expected captured event ${event.event} context to be an object`);
  }
  if (typeof event.context.id !== "string" || event.context.id.length === 0) {
    fail(
      `Expected captured event ${event.event} context.id to be a non-empty string`,
    );
  }
  if (!isDate(event.context.time)) {
    fail(
      `Expected captured event ${event.event} context.time to be a valid Date`,
    );
  }
  const expectedMode = expected?.mode ?? "ephemeral";
  assertEquals(event.context.mode, expectedMode, "event.context.mode mismatch");
  if (!isDate(event.receivedAt)) {
    fail(
      `Expected captured event ${event.event} receivedAt to be a valid Date`,
    );
  }

  if (expected?.id !== undefined) {
    assertEquals(event.context.id, expected.id, "event.context.id mismatch");
  }
  if (expected?.time !== undefined) {
    assertEquals(
      event.context.time,
      expected.time,
      "event.context.time mismatch",
    );
  }
  if (expected?.receivedAt !== undefined) {
    assertEquals(
      event.receivedAt,
      expected.receivedAt,
      "event.receivedAt mismatch",
    );
  }
  return event;
}
