import { isErr } from "@qlever-llc/trellis-result";
import type {
  ActivityListOutput,
} from "@qlever-llc/trellis-sdk-activity";
import type { AuthMeOutput } from "@qlever-llc/trellis-sdk-auth";
import { getTrellis } from "@qlever-llc/trellis-svelte";

export type UserProfile = AuthMeOutput["user"];
export type AuthMeResponse = AuthMeOutput;
export type ActivityEntry = ActivityListOutput["entries"][number];
export type ActivityKind = ActivityEntry["kind"];

type RequestInput = Record<string, unknown>;
type RpcClient = {
  request(method: string, input: unknown): Promise<{ take(): unknown }>;
};

export function createAppRequester() {
  const trellisPromise = (getTrellis as () => Promise<RpcClient>)();

  return async function request<T>(method: string, input: RequestInput): Promise<T> {
    const client = await trellisPromise;
    const result = await client.request(method, input);
    const value = result.take();
    if (isErr(value)) {
      throw value;
    }
    return value as T;
  };
}
