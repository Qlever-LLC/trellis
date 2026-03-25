import { readFileSync } from "node:fs";
import {
  connect,
  credsAuthenticator,
} from "@nats-io/transport-node";
import type { TrellisAPI } from "@trellis/contracts";
import type { TrellisServiceRuntimeDeps } from "./runtime.ts";
import type { TrellisServiceConnectOpts } from "./service.ts";
import { connectService as connectServiceWithRuntime } from "./service.ts";

const nodeRuntimeDeps: TrellisServiceRuntimeDeps = {
  connect: connect as TrellisServiceRuntimeDeps["connect"],
  credsAuthenticator: credsAuthenticator as TrellisServiceRuntimeDeps["credsAuthenticator"],
  readFileSync: (path: string) => new Uint8Array(readFileSync(path)),
};

// This Node entrypoint mirrors the Deno adapter so service authors can use the
// same high-level API from npm without pulling in Deno-only transports.
export function connectService<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
>(
  contract: {
    API: {
      owned: TOwnedApi;
      trellis: TTrellisApi;
    };
  },
  name: string,
  opts: Omit<TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>, "server"> & {
    server: Omit<TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>["server"], "api" | "trellisApi">;
  },
  deps?: Partial<TrellisServiceRuntimeDeps>,
) {
  return connectServiceWithRuntime(contract, name, opts, {
    ...nodeRuntimeDeps,
    ...deps,
  });
}
