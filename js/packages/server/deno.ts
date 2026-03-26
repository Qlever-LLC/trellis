import { connect, credsAuthenticator } from "@nats-io/transport-deno";
import type { TrellisAPI } from "@qlever-llc/trellis-contracts";
import type { TrellisServiceRuntimeDeps } from "./runtime.ts";
import type { ServiceContract, TrellisServiceConnectOpts } from "./service.ts";
import { connectService as connectServiceWithRuntime } from "./service.ts";

const denoRuntimeDeps: TrellisServiceRuntimeDeps = {
  connect: connect as TrellisServiceRuntimeDeps["connect"],
  credsAuthenticator:
    credsAuthenticator as TrellisServiceRuntimeDeps["credsAuthenticator"],
  readFileSync: (path: string) => Deno.readFileSync(path),
};

// This Deno entrypoint keeps the default Deno runtime wiring out of the shared
// `@qlever-llc/trellis-server` module so the root package can also be published for Node.
export function connectService<
  TOwnedApi extends TrellisAPI,
  TTrellisApi extends TrellisAPI = TOwnedApi,
>(
  contract: ServiceContract<TOwnedApi, TTrellisApi>,
  name: string,
  opts: Omit<TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>, "server"> & {
    server: Omit<
      TrellisServiceConnectOpts<TOwnedApi, TTrellisApi>["server"],
      "api" | "trellisApi"
    >;
  },
  deps?: Partial<TrellisServiceRuntimeDeps>,
) {
  return connectServiceWithRuntime(contract, name, opts, {
    ...denoRuntimeDeps,
    ...deps,
  });
}
