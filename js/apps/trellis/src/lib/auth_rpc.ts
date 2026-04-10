import type { InferSchemaType } from "@qlever-llc/trellis";
import type { Api as AuthApi, AuthLogoutOutput, AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";

type AuthRpc = AuthApi["rpc"];
type RequestOpts = { timeout?: number };
type RequestSurface = {
  requestOrThrow<M extends keyof AuthRpc & string>(
    method: M,
    input: InferSchemaType<AuthRpc[M]["input"]>,
    opts?: RequestOpts,
  ): Promise<InferSchemaType<AuthRpc[M]["output"]>>;
};

export async function authRequestOrThrow<M extends keyof AuthRpc & string>(
  trellisPromise: Promise<RequestSurface>,
  method: M,
  input: InferSchemaType<AuthRpc[M]["input"]>,
): Promise<InferSchemaType<AuthRpc[M]["output"]>> {
  const trellis = await trellisPromise;
  return trellis.requestOrThrow(method, input);
}

export async function authMeRequest(
  trellisPromise: Promise<RequestSurface>,
): Promise<AuthMeOutput> {
  return authRequestOrThrow(trellisPromise, "Auth.Me", {});
}

export async function authLogoutRequest(
  trellisPromise: Promise<RequestSurface>,
): Promise<AuthLogoutOutput> {
  return authRequestOrThrow(trellisPromise, "Auth.Logout", {});
}
