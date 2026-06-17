import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { Type } from "typebox";
import { createClient } from "../client.ts";
import { defineServiceContract } from "../contract.ts";
import { SchemaValidationError, ValidationError } from "../errors/index.ts";
import { ok } from "../../result/mod.ts";
import { withTrellisValidation } from "../contract_support/mod.ts";
import { createRoutedNatsConnections } from "../testing/routed_nats.ts";

const testValidationContract = defineServiceContract(
  {
    schemas: {
      TestInput: Type.Object({
        items: withTrellisValidation(
          Type.Array(Type.String(), { minItems: 1 }),
          {
            label: "Items",
            issues: {
              minItems: {
                code: "test.items.required",
                message: "Add at least one item.",
              },
            },
          },
        ),
      }),
      TestOutput: Type.Object({ success: Type.Boolean() }),
    },
  },
  (ref) => ({
    id: "trellis.test.validation@v1",
    displayName: "Validation Test",
    description: "Test SchemaValidationError in integration.",
    rpc: {
      "Test.Validate": {
        version: "v1",
        input: ref.schema("TestInput"),
        output: ref.schema("TestOutput"),
        errors: [],
        authRequired: false,
      },
    },
  }),
);

const mixedContract = defineServiceContract(
  {
    schemas: {
      MixedInput: Type.Object({
        items: withTrellisValidation(
          Type.Array(Type.String(), { minItems: 1 }),
          {
            label: "Items",
            issues: {
              minItems: { code: "test.items", message: "Add items" },
            },
          },
        ),
        name: Type.String({ minLength: 3 }),
      }),
      MixedOutput: Type.Object({ success: Type.Boolean() }),
    },
  },
  (ref) => ({
    id: "trellis.test.mixed-validation@v1",
    displayName: "Mixed Validation Test",
    description: "Test mixed annotation returns ValidationError.",
    rpc: {
      "Test.Mixed": {
        version: "v1",
        input: ref.schema("MixedInput"),
        output: ref.schema("MixedOutput"),
        errors: [],
        authRequired: false,
      },
    },
  }),
);

Deno.test({
  name:
    "RPC annotated validation failure returns SchemaValidationError over wire",
  async fn() {
    const natsFactory = createRoutedNatsConnections();
    const nc = natsFactory();

    let handlerCalled = false;

    const service = createClient(
      testValidationContract,
      nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "validation-service" },
    );
    await service.handle.rpc.test.validate(async () => {
      handlerCalled = true;
      throw new Error("Handler should not be called");
    });

    const client = createClient(
      testValidationContract,
      nc,
      { sessionKey: "test", sign: () => new Uint8Array(64) },
      { name: "validation-client" },
    );

    const result = await client.rpc.test.validate(
      { items: [] },
      { timeout: 500 },
    );

    assert(result.isErr(), "expected error result");
    assertInstanceOf(result.error, SchemaValidationError);
    assertEquals(result.error.issues.length, 1);
    assertEquals(result.error.issues[0].code, "test.items.required");
    assertEquals(handlerCalled, false, "handler should not have been called");

    await nc.close();
  },
});

Deno.test({
  name: "RPC mixed failure (annotated + unannotated) returns ValidationError",
  async fn() {
    const natsFactory = createRoutedNatsConnections();
    const nc = natsFactory();

    const service = createClient(
      mixedContract,
      nc,
      { sessionKey: "mixed-test", sign: () => new Uint8Array(64) },
      { name: "mixed-service" },
    );
    await service.handle.rpc.test.mixed(async () => {
      throw new Error("Handler should not be called");
    });

    const client = createClient(
      mixedContract,
      nc,
      { sessionKey: "mixed-test", sign: () => new Uint8Array(64) },
      { name: "mixed-client" },
    );

    const result = await client.rpc.test.mixed(
      { items: [], name: "ab" },
      { timeout: 500 },
    );

    assert(result.isErr(), "expected error result");
    assertInstanceOf(result.error, ValidationError);
    assert(
      !(result.error instanceof SchemaValidationError),
      "expected ValidationError not SchemaValidationError",
    );

    await nc.close();
  },
});

Deno.test({
  name: "RPC valid annotated input succeeds and handler is called",
  async fn() {
    const natsFactory = createRoutedNatsConnections();
    const nc = natsFactory();

    let handlerCalled = false;

    const service = createClient(
      testValidationContract,
      nc,
      { sessionKey: "valid-test", sign: () => new Uint8Array(64) },
      { name: "valid-service" },
    );
    await service.handle.rpc.test.validate(async () => {
      handlerCalled = true;
      return ok({ success: true });
    });

    const client = createClient(
      testValidationContract,
      nc,
      { sessionKey: "valid-test", sign: () => new Uint8Array(64) },
      { name: "valid-client" },
    );

    const result = await client.rpc.test.validate(
      { items: ["valid"] },
      { timeout: 500 },
    );

    assert(result.isOk(), "expected ok result");
    assertEquals(handlerCalled, true, "handler should have been called");

    await nc.close();
  },
});
