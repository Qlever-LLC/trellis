import type { NatsConnection } from "@nats-io/nats-core";

// Keep the public server package runtime-neutral.
//
// Third-party service authors may use Deno or Node, so the shared server core cannot
// hard-code a transport or file system API. Environment-specific modules wire
// these adapters in from `./deno.ts` or `./node.ts`.
export type NatsConnectOpts = {
  servers: string | string[];
  token?: string;
  inboxPrefix?: string;
  authenticator?: unknown;
} & Record<string, unknown>;

export type NatsConnectFn = (opts: NatsConnectOpts) => Promise<NatsConnection>;

export type NatsCredsAuthenticatorFn = (creds: Uint8Array) => unknown;

export type ReadFileSyncFn = (path: string) => Uint8Array;

export type TrellisServiceRuntimeDeps = {
  connect: NatsConnectFn;
  credsAuthenticator?: NatsCredsAuthenticatorFn;
  readFileSync?: ReadFileSyncFn;
};
