import { err, ok, type Result, UnexpectedError } from "@qlever-llc/result";

function noopLogger() {
  return {
    child: () => noopLogger(),
    debug: () => {},
    error: () => {},
    info: () => {},
    trace: () => {},
    warn: () => {},
  };
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      // empty
    },
  };
}

type TestKv = {
  get: (...args: unknown[]) => Promise<Result<never, UnexpectedError>>;
  keys: (
    ...args: unknown[]
  ) => Promise<Result<AsyncIterable<string>, UnexpectedError>>;
  put: (...args: unknown[]) => Promise<Result<void, UnexpectedError>>;
  delete: (...args: unknown[]) => Promise<Result<void, UnexpectedError>>;
  watch: (
    ...args: unknown[]
  ) => Promise<Result<AsyncIterable<unknown>, UnexpectedError>>;
};

function testKv(): TestKv {
  return {
    get: async () => err(new UnexpectedError({ cause: new Error("test kv") })),
    keys: async () => ok(emptyAsyncIterable<string>()),
    put: async () => ok(undefined),
    delete: async () => ok(undefined),
    watch: async () => ok(emptyAsyncIterable<unknown>()),
  };
}

export const logger = noopLogger();
export const sentinelCreds = { jwt: "", seed: "" };
export const natsAuth = {
  close: async () => {},
  isClosed: () => true,
};
export const natsSystem = natsAuth;
export const natsTrellis = natsAuth;
export const oauthStateKV = testKv();
export const pendingAuthKV = testKv();
export const browserFlowsKV = testKv();
export const connectionsKV = testKv();
export const trellisService = {
  handle: { rpc: {}, operation: {} },
  stop: async () => {},
};
const eventPublisher = { publish: () => ({ inspectErr: () => {} }) };
export const trellis = {
  handle: trellisService.handle,
  event: {
    auth: {
      connectionsClosed: eventPublisher,
      connectionsKicked: eventPublisher,
      connectionsOpened: eventPublisher,
      deviceUserAuthoritiesApproved: eventPublisher,
      deviceUserAuthoritiesRequested: eventPublisher,
      deviceUserAuthoritiesResolved: eventPublisher,
      deviceUserAuthoritiesReviewRequested: eventPublisher,
      sessionsRevoked: eventPublisher,
    },
  },
};

export async function shutdownGlobals(): Promise<void> {}
