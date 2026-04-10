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
  keys: (...args: unknown[]) => Promise<Result<AsyncIterable<string>, UnexpectedError>>;
  put: (...args: unknown[]) => Promise<Result<void, UnexpectedError>>;
  delete: (...args: unknown[]) => Promise<Result<void, UnexpectedError>>;
  watch: (...args: unknown[]) => Promise<Result<AsyncIterable<unknown>, UnexpectedError>>;
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
export const natsTrellis = natsAuth;
export const sessionKV = testKv();
export const oauthStateKV = testKv();
export const pendingAuthKV = testKv();
export const contractApprovalsKV = testKv();
export const bindingTokenKV = testKv();
export const browserFlowsKV = testKv();
export const portalsKV = testKv();
export const portalDefaultsKV = testKv();
export const loginPortalSelectionsKV = testKv();
export const workloadPortalSelectionsKV = testKv();
export const workloadProfilesKV = testKv();
export const workloadInstancesKV = testKv();
export const workloadActivationHandoffsKV = testKv();
export const workloadProvisioningSecretsKV = testKv();
export const workloadActivationsKV = testKv();
export const workloadActivationReviewsKV = testKv();
export const connectionsKV = testKv();
export const servicesKV = testKv();
export const contractsKV = testKv();
export const usersKV = testKv();
export const trellisService = {
  server: {
    mount: () => {},
    operation: () => ({ handle: async () => {} }),
  },
  stop: async () => {},
};
export const trellis = trellisService.server;

export async function shutdownGlobals(): Promise<void> {}
