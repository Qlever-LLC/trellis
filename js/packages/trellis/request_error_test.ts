import { assertEquals, assertInstanceOf, fail } from "@std/assert";
import {
  headers as natsHeaders,
  type Msg,
  type NatsConnection,
} from "@nats-io/nats-core";
import Type from "typebox";

import { defineServiceContract } from "./contract.ts";
import { UnexpectedError } from "./errors/index.ts";
import { Trellis } from "./trellis.ts";

const contract = defineServiceContract(
  {
    schemas: {
      Empty: Type.Object({}),
    },
  },
  (ref) => ({
    id: "trellis.request-error-test@v1",
    displayName: "Request Error Test",
    description: "Exercise declared RPC error reconstruction.",
    rpc: {
      "Demo.Fail": {
        version: "v1",
        input: ref.schema("Empty"),
        output: ref.schema("Empty"),
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

function errorMsg(data: Record<string, unknown>): Msg {
  const body = JSON.stringify(data);
  const headers = natsHeaders();
  headers.set("status", "error");
  return {
    subject: "rpc.v1.Demo.Fail",
    sid: 1,
    data: new TextEncoder().encode(body),
    headers,
    respond: () => false,
    json: <T>() => JSON.parse(body) as T,
    string: () => body,
  } as Msg;
}

Deno.test("Trellis.request returns declared RPC errors as Err results", async () => {
  const nc = {
    options: {
      inboxPrefix: "_INBOX.request-error-test",
    },
    request() {
      return Promise.resolve(errorMsg({
        type: "UnexpectedError",
        id: "01KPCJTESTERROR",
        message: "boom",
      }));
    },
  } as unknown as NatsConnection;

  const trellis = new Trellis("request-error-test", nc, {
    sessionKey: "session-key",
    sign: () => new Uint8Array(64),
  }, {
    api: contract.API.owned,
  });

  const result = await trellis.request("Demo.Fail", {});
  result.match({
    ok: (value) => fail(`unexpected ok: ${JSON.stringify(value)}`),
    err: (error) => {
      assertInstanceOf(error, UnexpectedError);
      assertEquals(error.id, "01KPCJTESTERROR");
    },
  });
});
