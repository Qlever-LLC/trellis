import type { JsMsg } from "@nats-io/jetstream";
import type {
  InferSchemaType,
  TrellisAPI,
} from "@qlever-llc/trellis/contracts";

/**
 * Context provided to event handlers with message metadata and acknowledgment controls.
 */
export type EventContext = {
  /** Unique identifier for this event */
  id: string;
  /** Timestamp when the event was created */
  time: Date;
  /** JetStream sequence number for this message */
  seq: number;
  /** Acknowledge successful processing of the message */
  ack: () => void;
  /** Negative acknowledge - request redelivery, optionally after a delay in milliseconds */
  nak: (delay?: number) => void;
  /** Terminate processing - indicate the message should not be redelivered */
  term: () => void;
};

/**
 * Options for subscribing to events.
 */
export type SubscribeOpts = {
  /** Filter events by template variables (e.g., { origin: "github", id: "user-123" }) */
  filter?: Record<string, string>;
  /** Start consuming from a specific sequence number */
  startSeq?: number;
  /** Start consuming from a specific time */
  startTime?: Date;
  /** Name for the durable consumer */
  consumerName?: string;
};

export type Events<TA extends TrellisAPI = TrellisAPI> =
  & keyof TA["events"]
  & string;

export type Event<TA extends TrellisAPI, E extends Events<TA>> =
  InferSchemaType<
    TA["events"][E]["event"]
  >;

/**
 * Handler function for processing events.
 * @template TA - The API module defining event schemas
 * @template E - The event key being handled
 */
export type EventHandler<TA extends TrellisAPI, E extends Events<TA>> = (
  event: Event<TA, E>,
  ctx: EventContext,
) => Promise<void>;

/**
 * Creates an EventContext from a JetStream message.
 * @param msg - The JetStream message
 * @param eventId - The unique event identifier
 * @param eventTime - The event timestamp
 * @returns An EventContext with message controls
 */
export function createEventContext(
  msg: JsMsg,
  eventId: string,
  eventTime: Date,
): EventContext {
  return {
    id: eventId,
    time: eventTime,
    seq: msg.seq,
    ack: () => msg.ack(),
    nak: (delay?: number) => msg.nak(delay),
    term: () => msg.term(),
  };
}

/**
 * Defines a group of events that should be processed together with ordering guarantees.
 */
export type OrderingGroup<TA extends TrellisAPI = TrellisAPI> = {
  /** Unique name for this ordering group */
  name: string;
  /** List of event types that belong to this group */
  events: Array<Events<TA>>;
  /** Processing mode: "strict" maintains order, "independent" allows parallel processing */
  mode: "strict" | "independent";
};

/**
 * A subscription that handles multiple events as a group with shared ordering semantics.
 */
export type GroupedSubscription<TA extends TrellisAPI = TrellisAPI> = {
  /** The ordering group configuration */
  group: OrderingGroup<TA>;
  /** Partial map of event types to their handlers */
  handlers: Partial<Record<Events<TA>, EventHandler<TA, Events<TA>>>>;
};

/**
 * A subscription for a single event type.
 * @template TA - The API module defining event schemas
 * @template E - The event type being subscribed to
 */
export type SingleSubscription<
  TA extends TrellisAPI = TrellisAPI,
  E extends Events<TA> = Events<TA>,
> = {
  /** The event type to subscribe to */
  event: E;
  /** Handler function for processing events of this type */
  handler: EventHandler<TA, E>;
  /** Optional subscription configuration */
  opts?: SubscribeOpts;
};

/**
 * Union type representing either a grouped or single subscription.
 */
export type MultiEventSubscription<TA extends TrellisAPI = TrellisAPI> =
  | GroupedSubscription<TA>
  | SingleSubscription<TA, Events<TA>>;

/**
 * Options for subscribing to multiple events.
 */
export type MultiSubscribeOpts = {
  /** Default processing mode when not specified in a subscription */
  defaultMode?: "strict" | "independent";
};

/**
 * Type guard to check if a subscription is a GroupedSubscription.
 * @param sub - The subscription to check
 * @returns True if the subscription is a GroupedSubscription
 */
export function isGroupedSubscription<TA extends TrellisAPI>(
  sub: MultiEventSubscription<TA>,
): sub is GroupedSubscription<TA> {
  return "group" in sub;
}
