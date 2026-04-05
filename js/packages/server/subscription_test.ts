import { assertEquals, assertExists } from "@std/assert";
import type { JsMsg } from "@nats-io/jetstream";
import type {
  EventContext,
  GroupedSubscription,
  MultiEventSubscription,
  MultiSubscribeOpts,
  OrderingGroup,
  SingleSubscription,
  SubscribeOpts,
} from "./subscription.ts";
import { createEventContext, isGroupedSubscription } from "./subscription.ts";

// Mock JsMsg for testing
function createMockJsMsg(overrides: Partial<JsMsg> = {}): JsMsg {
  let acked = false;
  let naked = false;
  let termed = false;
  let nakDelay: number | undefined;

  return {
    seq: 42,
    ack: () => {
      acked = true;
    },
    nak: (delay?: number) => {
      naked = true;
      nakDelay = delay;
    },
    term: () => {
      termed = true;
    },
    // Track state for assertions
    get _acked() {
      return acked;
    },
    get _naked() {
      return naked;
    },
    get _termed() {
      return termed;
    },
    get _nakDelay() {
      return nakDelay;
    },
    ...overrides,
  } as JsMsg & {
    _acked: boolean;
    _naked: boolean;
    _termed: boolean;
    _nakDelay: number | undefined;
  };
}

Deno.test("EventContext", async (t) => {
  await t.step("has correct shape with all required properties", () => {
    // Type-level test: ensure EventContext has the expected structure
    const ctx: EventContext = {
      id: "test-id",
      time: new Date(),
      seq: 1,
      ack: () => {},
      nak: (_delay?: number) => {},
      term: () => {},
    };

    assertExists(ctx.id);
    assertExists(ctx.time);
    assertExists(ctx.seq);
    assertExists(ctx.ack);
    assertExists(ctx.nak);
    assertExists(ctx.term);
  });

  await t.step("id is a string", () => {
    const ctx: EventContext = {
      id: "event-123",
      time: new Date(),
      seq: 1,
      ack: () => {},
      nak: () => {},
      term: () => {},
    };

    assertEquals(typeof ctx.id, "string");
  });

  await t.step("time is a Date", () => {
    const now = new Date();
    const ctx: EventContext = {
      id: "test",
      time: now,
      seq: 1,
      ack: () => {},
      nak: () => {},
      term: () => {},
    };

    assertEquals(ctx.time instanceof Date, true);
    assertEquals(ctx.time, now);
  });

  await t.step("seq is a number", () => {
    const ctx: EventContext = {
      id: "test",
      time: new Date(),
      seq: 42,
      ack: () => {},
      nak: () => {},
      term: () => {},
    };

    assertEquals(typeof ctx.seq, "number");
    assertEquals(ctx.seq, 42);
  });
});

Deno.test("createEventContext", async (t) => {
  await t.step("creates context from JsMsg with correct properties", () => {
    const mockMsg = createMockJsMsg({ seq: 100 });
    const eventId = "event-abc-123";
    const eventTime = new Date("2024-01-15T10:30:00Z");

    const ctx = createEventContext(mockMsg, eventId, eventTime);

    assertEquals(ctx.id, eventId);
    assertEquals(ctx.time, eventTime);
    assertEquals(ctx.seq, 100);
  });

  await t.step("ack() delegates to JsMsg.ack()", () => {
    const mockMsg = createMockJsMsg() as JsMsg & { _acked: boolean };

    const ctx = createEventContext(mockMsg, "test", new Date());

    assertEquals(mockMsg._acked, false);
    ctx.ack();
    assertEquals(mockMsg._acked, true);
  });

  await t.step("nak() delegates to JsMsg.nak()", () => {
    const mockMsg = createMockJsMsg() as JsMsg & { _naked: boolean };

    const ctx = createEventContext(mockMsg, "test", new Date());

    assertEquals(mockMsg._naked, false);
    ctx.nak();
    assertEquals(mockMsg._naked, true);
  });

  await t.step("nak(delay) passes delay to JsMsg.nak()", () => {
    const mockMsg = createMockJsMsg() as JsMsg & {
      _nakDelay: number | undefined;
    };

    const ctx = createEventContext(mockMsg, "test", new Date());

    ctx.nak(5000);
    assertEquals(mockMsg._nakDelay, 5000);
  });

  await t.step("term() delegates to JsMsg.term()", () => {
    const mockMsg = createMockJsMsg() as JsMsg & { _termed: boolean };

    const ctx = createEventContext(mockMsg, "test", new Date());

    assertEquals(mockMsg._termed, false);
    ctx.term();
    assertEquals(mockMsg._termed, true);
  });
});

Deno.test("SubscribeOpts", async (t) => {
  await t.step("allows empty options object", () => {
    const opts: SubscribeOpts = {};
    assertExists(opts);
  });

  await t.step("accepts filter as Record<string, string>", () => {
    const opts: SubscribeOpts = {
      filter: { origin: "github", id: "user-123" },
    };

    assertEquals(opts.filter?.origin, "github");
    assertEquals(opts.filter?.id, "user-123");
  });

  await t.step("accepts startSeq as number", () => {
    const opts: SubscribeOpts = {
      startSeq: 100,
    };

    assertEquals(opts.startSeq, 100);
  });

  await t.step("accepts startTime as Date", () => {
    const startTime = new Date("2024-01-01T00:00:00Z");
    const opts: SubscribeOpts = {
      startTime,
    };

    assertEquals(opts.startTime, startTime);
  });

  await t.step("accepts consumerName as string", () => {
    const opts: SubscribeOpts = {
      consumerName: "my-consumer",
    };

    assertEquals(opts.consumerName, "my-consumer");
  });

  await t.step("accepts all options together", () => {
    const opts: SubscribeOpts = {
      filter: { key: "value" },
      startSeq: 50,
      startTime: new Date(),
      consumerName: "full-options-consumer",
    };

    assertExists(opts.filter);
    assertExists(opts.startSeq);
    assertExists(opts.startTime);
    assertExists(opts.consumerName);
  });
});

Deno.test("OrderingGroup", async (t) => {
  await t.step("has correct shape", () => {
    const group: OrderingGroup = {
      name: "my-group",
      events: [],
      mode: "strict",
    };

    assertEquals(group.name, "my-group");
    assertEquals(group.mode, "strict");
    assertEquals(Array.isArray(group.events), true);
  });

  await t.step("mode can be 'independent'", () => {
    const group: OrderingGroup = {
      name: "my-group",
      events: [],
      mode: "independent",
    };

    assertEquals(group.mode, "independent");
  });
});

Deno.test("Subscription unions", async (t) => {
  await t.step("SingleSubscription is a MultiEventSubscription", () => {
    const sub: SingleSubscription = {
      event: "User.Changed",
      handler: async () => {},
    };

    const multi: MultiEventSubscription = sub as MultiEventSubscription;
    assertExists(multi);
  });

  await t.step("GroupedSubscription is a MultiEventSubscription", () => {
    const group: GroupedSubscription = {
      group: { name: "g", events: [], mode: "strict" },
      handlers: {},
    };

    const multi: MultiEventSubscription = group as MultiEventSubscription;
    assertExists(multi);
  });

  await t.step("isGroupedSubscription detects grouped subscriptions", () => {
    const grouped: GroupedSubscription = {
      group: { name: "g", events: [], mode: "strict" },
      handlers: {},
    };

    const single: SingleSubscription = {
      event: "User.Changed",
      handler: async () => {},
    };

    assertEquals(isGroupedSubscription(grouped), true);
    assertEquals(isGroupedSubscription(single), false);
  });
});

Deno.test("MultiSubscribeOpts", async (t) => {
  await t.step("allows empty options", () => {
    const opts: MultiSubscribeOpts = {};
    assertExists(opts);
  });

  await t.step("defaultMode can be 'strict'", () => {
    const opts: MultiSubscribeOpts = { defaultMode: "strict" };
    assertEquals(opts.defaultMode, "strict");
  });

  await t.step("defaultMode can be 'independent'", () => {
    const opts: MultiSubscribeOpts = { defaultMode: "independent" };
    assertEquals(opts.defaultMode, "independent");
  });
});
