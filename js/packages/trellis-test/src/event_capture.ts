import {
  type ClientOpts,
  type ContractModule,
  defineAppContract,
  type EventListenerContext,
  type EventName,
  type EventType,
  type TrellisAPI,
  type TrellisApiLike,
} from "@qlever-llc/trellis";
import type {
  TrellisTestClientContract,
  TrellisTestConnectedClient,
  WaitForOptions,
} from "./types.ts";

type EventSourceContract = ContractModule<
  string,
  TrellisAPI,
  TrellisApiLike,
  TrellisApiLike
>;

type ConnectedClient = { connection: { close(): Promise<void> } };

type EventListenerStart = { orThrow(): Promise<void> };

type EventCaptureListener<TEvent> = {
  listen(
    handler: (event: TEvent, context: EventListenerContext) => void,
    subjectData: Record<string, unknown>,
    opts: { mode: "ephemeral"; signal: AbortSignal },
  ): EventListenerStart;
};

type EventCaptureRuntime = {
  contracts: {
    approve(args: { contract: EventSourceContract }): Promise<unknown>;
  };
  connectClient<TContract extends TrellisTestClientContract<TrellisAPI>>(
    args: ClientOpts & { name: string; contract: TContract },
  ): Promise<TrellisTestConnectedClient<TContract>>;
  waitFor<T>(
    fn: () =>
      | T
      | null
      | undefined
      | false
      | Promise<T | null | undefined | false>,
    opts?: WaitForOptions,
  ): Promise<T>;
};

/** Contract value accepted by `TrellisTestRuntime.captureEvents`. */
export type TrellisTestEventSourceContract = EventSourceContract;

/** Options for starting a live decoded contract event capture. */
export type TrellisTestEventCaptureOptions<
  TContract extends TrellisTestEventSourceContract,
  TEvents extends readonly EventName<TContract>[],
> = ClientOpts & {
  /** Logical name for the synthetic app/client participant used by the capture. */
  name: string;
  /** Source contract whose owned events should be captured. */
  contract: TContract;
  /** Owned event names to subscribe to through the generated event facade. */
  events: TEvents;
};

/** Transport-neutral listener metadata captured with a test event. */
export type TrellisTestCapturedEventContext = {
  /** Stable event id from the Trellis event header. */
  readonly id: string;
  /** Event creation time from the Trellis event header. */
  readonly time: Date;
  /** Runtime listener mode that delivered the event. */
  readonly mode: "ephemeral";
};

/** A decoded contract event observed by a `TrellisTestEventCapture`. */
export type TrellisTestCapturedEvent<
  TContract extends TrellisTestEventSourceContract,
  E extends EventName<TContract>,
> = {
  /** Contract event name that matched this captured event. */
  readonly event: E;
  /** Decoded event payload from the generated Trellis event facade. */
  readonly payload: EventType<TContract, E>;
  /** Listener metadata without transport subjects or envelopes. */
  readonly context: TrellisTestCapturedEventContext;
  /** Wall-clock time when the test capture observed this event. */
  readonly receivedAt: Date;
};

/** Predicate used by `TrellisTestEventCapture.waitFor`. */
export type TrellisTestCapturedEventPredicate<
  TContract extends TrellisTestEventSourceContract,
  E extends EventName<TContract>,
> = (
  event: TrellisTestCapturedEvent<TContract, E>,
) => boolean | Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEventCaptureListener<TEvent>(
  value: unknown,
): value is EventCaptureListener<TEvent> {
  return isRecord(value) && typeof value.listen === "function";
}

function lowerCamelIdent(value: string): string {
  const pascal = value
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return pascal.length === 0 ? "_" : pascal[0]!.toLowerCase() + pascal.slice(1);
}

function surfaceGroupName(event: string): string {
  return lowerCamelIdent(event.split(".")[0] ?? event);
}

function surfaceLeafName(event: string): string {
  const parts = event.split(".");
  parts.shift();
  return lowerCamelIdent(parts.length === 0 ? event : parts.join("."));
}

function captureContractName(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(
    /^-+|-+$/gu,
    "",
  );
  return safe || "capture";
}

function selectedEvents<
  TContract extends TrellisTestEventSourceContract,
  TEvents extends readonly EventName<TContract>[],
>(
  contract: TContract,
  events: TEvents,
): TEvents {
  if (events.length === 0) {
    throw new Error("Trellis event capture requires at least one event name");
  }

  const known = Object.keys(contract.API.owned.events ?? {});
  const seen = new Set<string>();
  for (const event of events) {
    const eventName = String(event);
    if (seen.has(eventName)) {
      throw new Error(
        `Duplicate event name '${eventName}' in Trellis event capture options`,
      );
    }
    seen.add(eventName);
    if (!known.includes(String(event))) {
      throw new Error(
        `Cannot capture unknown event '${eventName}' from contract '${contract.CONTRACT.id}'. Known events: ${
          known.join(", ") || "none"
        }`,
      );
    }
  }
  return events;
}

function isCapturedEvent<
  TContract extends TrellisTestEventSourceContract,
  TSelectedEvent extends EventName<TContract>,
  E extends TSelectedEvent,
>(
  event: TrellisTestCapturedEvent<TContract, TSelectedEvent>,
  name: E,
): event is TrellisTestCapturedEvent<TContract, E> {
  return event.event === name;
}

function getEventListener<
  TContract extends TrellisTestEventSourceContract,
  E extends EventName<TContract>,
>(
  client: TrellisTestConnectedClient<TrellisTestClientContract>,
  event: E,
): EventCaptureListener<EventType<TContract, E>> {
  const eventFacade: unknown = client.event;
  if (!isRecord(eventFacade)) {
    throw new Error("Connected Trellis client is missing its event facade");
  }

  const groupName = surfaceGroupName(String(event));
  const leafName = surfaceLeafName(String(event));
  const group = eventFacade[groupName];
  if (!isRecord(group)) {
    throw new Error(
      `Generated event facade is missing group '${groupName}' for event '${
        String(event)
      }'`,
    );
  }

  const leaf = group[leafName];
  if (!isEventCaptureListener<EventType<TContract, E>>(leaf)) {
    throw new Error(
      `Generated event facade is missing listener '${groupName}.${leafName}' for event '${
        String(event)
      }'`,
    );
  }
  return leaf;
}

/**
 * Disposable helper that captures live decoded contract events in integration tests.
 *
 * Create instances with `TrellisTestRuntime.captureEvents(...)`. The capture uses a
 * synthetic app contract with normal `uses.events.subscribe` authority and ephemeral
 * generated event facade listeners.
 */
export class TrellisTestEventCapture<
  TContract extends TrellisTestEventSourceContract,
  TSelectedEvent extends EventName<TContract>,
> implements AsyncDisposable {
  readonly #client: ConnectedClient;
  readonly #waitFor: EventCaptureRuntime["waitFor"];
  readonly #onStop: (
    client: ConnectedClient,
    capture: TrellisTestEventCapture<TContract, TSelectedEvent>,
  ) => void;
  readonly #controller = new AbortController();
  readonly #events: Array<TrellisTestCapturedEvent<TContract, TSelectedEvent>> =
    [];
  #stopped = false;

  protected constructor(args: {
    client: ConnectedClient;
    waitFor: EventCaptureRuntime["waitFor"];
    onStop: (
      client: ConnectedClient,
      capture: TrellisTestEventCapture<TContract, TSelectedEvent>,
    ) => void;
  }) {
    this.#client = args.client;
    this.#waitFor = args.waitFor;
    this.#onStop = args.onStop;
  }

  protected get listenerSignal(): AbortSignal {
    return this.#controller.signal;
  }

  protected record(
    event: TrellisTestCapturedEvent<TContract, TSelectedEvent>,
  ): void {
    this.#events.push(event);
  }

  /** Returns captured events, optionally filtered by event name. */
  all(): ReadonlyArray<
    TrellisTestCapturedEvent<TContract, TSelectedEvent>
  >;
  all<E extends TSelectedEvent>(
    name: E,
  ): ReadonlyArray<TrellisTestCapturedEvent<TContract, E>>;
  all<E extends TSelectedEvent>(
    name?: E,
  ):
    | ReadonlyArray<TrellisTestCapturedEvent<TContract, TSelectedEvent>>
    | ReadonlyArray<TrellisTestCapturedEvent<TContract, E>> {
    if (name === undefined) return [...this.#events];
    return this.#events.filter((event) => isCapturedEvent(event, name));
  }

  /** Removes all events captured so far without stopping live listeners. */
  clear(): void {
    this.#events.length = 0;
  }

  /**
   * Waits for the first captured event with the requested name and optional predicate.
   *
   * Already-captured events are checked first, then future live events are observed
   * until the runtime wait timeout elapses.
   */
  async waitFor<E extends TSelectedEvent>(
    name: E,
    predicate?: TrellisTestCapturedEventPredicate<TContract, E>,
    opts?: WaitForOptions,
  ): Promise<TrellisTestCapturedEvent<TContract, E>> {
    return await this.#waitFor(async () => {
      for (const event of this.#events) {
        if (!isCapturedEvent(event, name)) continue;
        if (predicate === undefined || await predicate(event)) {
          return event;
        }
      }
      return false;
    }, opts);
  }

  /** Stops live listeners and closes the synthetic capture client connection once. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#controller.abort();
    await this.#client.connection.close();
    this.#stopped = true;
    this.#onStop(this.#client, this);
  }

  /** Stops the capture when used with `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.stop();
  }
}

class StartedTrellisTestEventCapture<
  TContract extends TrellisTestEventSourceContract,
  TSelectedEvent extends EventName<TContract>,
> extends TrellisTestEventCapture<TContract, TSelectedEvent> {
  constructor(args: {
    client: ConnectedClient;
    waitFor: EventCaptureRuntime["waitFor"];
    onStop: (
      client: ConnectedClient,
      capture: TrellisTestEventCapture<TContract, TSelectedEvent>,
    ) => void;
  }) {
    super(args);
  }

  get signal(): AbortSignal {
    return this.listenerSignal;
  }

  recordCaptured(
    event: TrellisTestCapturedEvent<TContract, TSelectedEvent>,
  ): void {
    this.record(event);
  }
}

/** @internal Starts a capture using runtime-owned client connection helpers. */
export async function startTrellisTestEventCapture<
  TContract extends TrellisTestEventSourceContract,
  const TEvents extends readonly EventName<TContract>[],
>(args: {
  runtime: EventCaptureRuntime;
  options: TrellisTestEventCaptureOptions<TContract, TEvents>;
  onStop: (
    client: ConnectedClient,
    capture: TrellisTestEventCapture<TContract, TEvents[number]>,
  ) => void;
}): Promise<TrellisTestEventCapture<TContract, TEvents[number]>> {
  const events = selectedEvents(args.options.contract, args.options.events);
  await args.runtime.contracts.approve({ contract: args.options.contract });

  const appContract = defineAppContract(() => ({
    id: `trellis.test.event-capture.${
      captureContractName(args.options.name)
    }@v1`,
    displayName: `Trellis Test Event Capture: ${args.options.name}`,
    description:
      "Synthetic app/client participant for live test event capture.",
    uses: {
      required: {
        source: args.options.contract.use({
          events: { subscribe: events },
        }),
      },
    },
  }));

  const { contract: _sourceContract, events: _events, ...clientOptions } =
    args.options;
  const clientContract = appContract as TrellisTestClientContract<TrellisAPI>;
  const client = await args.runtime.connectClient({
    ...clientOptions,
    contract: clientContract,
  });
  const capture = new StartedTrellisTestEventCapture<
    TContract,
    TEvents[number]
  >({
    client,
    waitFor: args.runtime.waitFor.bind(args.runtime),
    onStop: args.onStop,
  });

  try {
    for (const event of events) {
      const listener = getEventListener<TContract, TEvents[number]>(
        client,
        event,
      );
      await listener.listen(
        (decoded, context) => {
          capture.recordCaptured({
            event,
            payload: decoded,
            context: {
              id: context.id,
              time: context.time,
              mode: "ephemeral",
            },
            receivedAt: new Date(),
          });
        },
        {},
        { mode: "ephemeral", signal: capture.signal },
      ).orThrow();
    }
  } catch (error) {
    await capture.stop().catch(() => undefined);
    throw error;
  }

  return capture;
}
