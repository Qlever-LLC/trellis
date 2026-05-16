import type {
  Msg,
  MsgHdrs,
  NatsConnection,
  Payload,
  Subscription,
} from "@nats-io/nats-core";

export type RoutedNatsConnectionOptions = {
  inboxPrefix?: string;
};

export type RoutedNatsRouterOptions = {
  ackEventsWithoutSubscriber?: boolean;
};

type BufferedSubscription = Subscription & {
  push(message: Msg): void;
};

/**
 * Creates lightweight in-memory NATS connections that route publish/request
 * traffic between subscribers in the same test process.
 */
export function createRoutedNatsConnections(
  routerOptions: RoutedNatsRouterOptions = {},
): (
  opts?: RoutedNatsConnectionOptions,
) => NatsConnection {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const subscriptions: BufferedSubscription[] = [];

  const payloadBytes = (payload: Payload | undefined): Uint8Array => {
    if (payload === undefined) return new Uint8Array();
    if (typeof payload === "string") return encoder.encode(payload);
    return payload;
  };

  const subjectMatches = (pattern: string, subject: string): boolean => {
    const patternParts = pattern.split(".");
    const subjectParts = subject.split(".");
    for (let index = 0; index < patternParts.length; index += 1) {
      const part = patternParts[index];
      if (part === ">") return true;
      if (subjectParts[index] === undefined) return false;
      if (part !== "*" && part !== subjectParts[index]) return false;
    }
    return patternParts.length === subjectParts.length;
  };

  const route = (message: Msg) => {
    for (const subscription of subscriptions) {
      if (subjectMatches(subscription.getSubject(), message.subject)) {
        subscription.push(message);
      }
    }
  };

  const createMessage = (args: {
    subject: string;
    data: Uint8Array;
    headers?: MsgHdrs;
    reply?: string;
    onRespond?: (data: Uint8Array, headers?: MsgHdrs) => void;
  }): Msg => ({
    subject: args.subject,
    sid: 1,
    data: args.data,
    headers: args.headers,
    reply: args.reply,
    respond: (payload?: Payload, opts?: { headers?: MsgHdrs }) => {
      const data = payloadBytes(payload);
      if (args.onRespond) {
        args.onRespond(data, opts?.headers);
        return true;
      }
      if (!args.reply) return false;
      route(
        createMessage({ subject: args.reply, data, headers: opts?.headers }),
      );
      return true;
    },
    json: <T>() => JSON.parse(decoder.decode(args.data)) as T,
    string: () => decoder.decode(args.data),
  });

  const removeSubscription = (subscription: BufferedSubscription) => {
    const index = subscriptions.indexOf(subscription);
    if (index >= 0) subscriptions.splice(index, 1);
  };

  const createSubscription = (
    subject: string,
    onClose: (subscription: BufferedSubscription) => void,
  ): BufferedSubscription => {
    const queue: Msg[] = [];
    let subscriptionClosed = false;
    let received = 0;
    let pendingResolver: (() => void) | undefined;
    let resolveClosed!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const notify = () => {
      pendingResolver?.();
      pendingResolver = undefined;
    };
    const closeSubscription = () => {
      if (subscriptionClosed) return;
      subscriptionClosed = true;
      removeSubscription(subscription);
      onClose(subscription);
      notify();
      resolveClosed();
    };

    const subscription: BufferedSubscription = {
      closed: closedPromise,
      unsubscribe: () => closeSubscription(),
      drain: async () => closeSubscription(),
      isDraining: () => false,
      isClosed: () => subscriptionClosed,
      callback: () => {},
      getSubject: () => subject,
      getReceived: () => received,
      getProcessed: () => received,
      getPending: () => queue.length,
      getID: () => 1,
      getMax: () => undefined,
      push: (message: Msg) => {
        if (subscriptionClosed) return;
        queue.push(message);
        received += 1;
        notify();
      },
      [Symbol.asyncIterator]: async function* () {
        while (!subscriptionClosed) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            pendingResolver = resolve;
          });
        }
      },
    };
    subscriptions.push(subscription);
    return subscription;
  };

  return (opts = {}) => {
    let closed = false;
    let resolveClosed!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const connectionSubscriptions = new Set<BufferedSubscription>();
    const pendingRequests = new Set<() => void>();
    const close = () => {
      if (closed) return;
      closed = true;
      for (const subscription of [...connectionSubscriptions]) {
        subscription.unsubscribe();
      }
      for (const cancel of [...pendingRequests]) {
        cancel();
      }
      pendingRequests.clear();
      resolveClosed();
    };
    const connection: NatsConnection & { options: { inboxPrefix: string } } = {
      options: { inboxPrefix: opts.inboxPrefix ?? "_INBOX.test" },
      info: undefined,
      closed: () => closedPromise,
      close: async () => close(),
      publish: (subject, payload, opts) => {
        route(createMessage({
          subject,
          data: payloadBytes(payload),
          headers: opts?.headers,
          reply: opts?.reply,
        }));
      },
      publishMessage: () => {},
      respondMessage: () => true,
      subscribe: (subject) => {
        const subscription = createSubscription(
          subject,
          (closedSubscription) => {
            connectionSubscriptions.delete(closedSubscription);
          },
        );
        connectionSubscriptions.add(subscription);
        return subscription;
      },
      request: async (subject, payload, opts) => {
        if (closed) {
          throw new Error("connection closed");
        }
        const subscription = subscriptions.find((candidate) =>
          !candidate.isClosed() &&
          subjectMatches(candidate.getSubject(), subject)
        );
        if (!subscription) {
          if (
            routerOptions.ackEventsWithoutSubscriber &&
            subject.startsWith("events.v1.")
          ) {
            return createMessage({
              subject,
              data: encoder.encode(JSON.stringify({
                stream: "EVENTS",
                seq: 1,
                duplicate: false,
              })),
            });
          }
          throw new Error(`no responders for ${subject}`);
        }

        const sessionKey = opts?.headers?.get("session-key");
        const reply = typeof sessionKey === "string"
          ? `_INBOX.${sessionKey.slice(0, 16)}.reply`
          : "_INBOX.test.reply";

        return await new Promise<Msg>((resolve, reject) => {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const cleanup = () => {
            pendingRequests.delete(cancel);
            if (timeout !== undefined) clearTimeout(timeout);
          };
          const cancel = () => {
            cleanup();
            reject(new Error("connection closed"));
          };
          pendingRequests.add(cancel);
          timeout = typeof opts?.timeout === "number"
            ? setTimeout(() => {
              cleanup();
              reject(new Error(`request timed out for ${subject}`));
            }, opts.timeout)
            : undefined;
          subscription.push(createMessage({
            subject,
            data: payloadBytes(payload),
            headers: opts?.headers,
            reply,
            onRespond: (data, headers) => {
              cleanup();
              resolve(createMessage({ subject, data, headers }));
            },
          }));
        });
      },
      requestMany: async () =>
        (async function* () {
          return;
        })(),
      flush: async () => {},
      drain: async () => close(),
      isClosed: () => closed,
      isDraining: () => false,
      getServer: () => "nats://in-memory",
      status: () => ({
        async *[Symbol.asyncIterator]() {},
      }),
      stats: () => ({ inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0 }),
      rtt: async () => 0,
      reconnect: async () => {},
    };
    return connection;
  };
}
