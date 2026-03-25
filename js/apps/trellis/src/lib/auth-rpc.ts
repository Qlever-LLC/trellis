import { isErr } from "@trellis/result";
import type { Api as AuthApi, RpcMap as AuthRpcMap } from "@trellis/sdk-auth";
import { getTrellis } from "@trellis/svelte";

type AuthMethod = (keyof AuthApi["rpc"] & keyof AuthRpcMap) & string;
type AuthRequestInput<M extends AuthMethod> = AuthRpcMap[M]["input"];
type AuthRequestOutput<M extends AuthMethod> = AuthRpcMap[M]["output"];

type RpcClient = {
  request(method: string, input: unknown): Promise<{ take(): unknown }>;
};

export function createAuthRequester() {
  const trellisPromise = (getTrellis as <T>() => Promise<RpcClient>)<AuthApi>();

  return async function authRequest<M extends AuthMethod>(
    method: M,
    input: AuthRequestInput<M>,
  ): Promise<AuthRequestOutput<M>> {
    const client = await trellisPromise;
    const result = await client.request(method, input);
    const value = result.take();
    if (isErr(value)) {
      throw value;
    }
    return value as AuthRequestOutput<M>;
  };
}
