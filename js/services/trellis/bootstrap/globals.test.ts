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

function testRepository<T, K extends string = string>(keyOf: (value: T) => K) {
  const values = new Map<K, T>();
  return {
    get: async (key: K) => values.get(key),
    put: async (value: T) => {
      values.set(keyOf(value), value);
    },
    delete: async (key: K) => {
      values.delete(key);
    },
    list: async () => [...values.values()],
  };
}

function testPortalDefaultRepository() {
  let login: { portalId: string | null } | undefined;
  let device: { portalId: string | null } | undefined;
  return {
    getLogin: async () => login,
    putLogin: async (value: { portalId: string | null }) => {
      login = value;
    },
    getDevice: async () => device,
    putDevice: async (value: { portalId: string | null }) => {
      device = value;
    },
  };
}

export const logger = noopLogger();
export const sentinelCreds = { jwt: "", seed: "" };
export const natsAuth = {
  close: async () => {},
  isClosed: () => true,
};
export const natsTrellis = natsAuth;
export const oauthStateKV = testKv();
export const pendingAuthKV = testKv();
export const browserFlowsKV = testKv();
export const portalStorage = testRepository<
  { portalId: string; entryUrl: string; disabled?: boolean }
>((value) => value.portalId);
export const portalProfileStorage = testRepository<
  { portalId: string; contractId: string }
>((value) => value.portalId);
export const portalDefaultStorage = testPortalDefaultRepository();
export const loginPortalSelectionStorage = testRepository<
  { contractId: string; portalId: string | null }
>((value) => value.contractId);
export const instanceGrantPolicyStorage = testRepository<
  { contractId: string }
>((value) => value.contractId);
export const devicePortalSelectionStorage = testRepository<
  { profileId: string; portalId: string | null }
>((value) => value.profileId);
export const connectionsKV = testKv();
export const trellisService = {
  server: {
    mount: () => {},
    operation: () => ({ handle: async () => {} }),
  },
  stop: async () => {},
};
export const trellis = trellisService.server;

export async function shutdownGlobals(): Promise<void> {}
