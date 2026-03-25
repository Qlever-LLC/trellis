import {
  type InferSchemaType,
  type SchemaLike,
  unwrapSchema,
} from "@trellis/contracts";
import { Result } from "@trellis/result";
import type { StaticDecode, TSchema } from "typebox";
import { EncodeError, ParseError, Value } from "typebox/value";
import { UnexpectedError, ValidationError } from "./errors/index.ts";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
    [key: string]: JsonValue;
  };

function parseWithSchema(schema: TSchema, data: JsonValue): unknown {
  return Value.Parse(schema, data);
}

function encodeWithSchema(schema: TSchema, data: unknown): string {
  return JSON.stringify(Value.Encode(schema, data));
}

export function parse<T extends TSchema>(
  schema: T,
  data: JsonValue,
): Result<StaticDecode<T>, ValidationError | UnexpectedError> {
  try {
    return Result.ok(parseWithSchema(schema, data) as StaticDecode<T>);
  } catch (cause) {
    if (cause instanceof ParseError) {
      const errors = Value.Errors(schema, data);
      return Result.err(new ValidationError({ errors, cause }));
    }
    return Result.err(new UnexpectedError({ cause }));
  }
}

export function parseSchema<S extends SchemaLike>(
  schema: S,
  data: JsonValue,
): Result<InferSchemaType<S>, ValidationError | UnexpectedError> {
  const raw = unwrapSchema(schema);
  try {
    return Result.ok(parseWithSchema(raw as TSchema, data) as InferSchemaType<S>);
  } catch (cause) {
    if (cause instanceof ParseError) {
      const errors = Value.Errors(raw as TSchema, data);
      return Result.err(new ValidationError({ errors, cause }));
    }
    return Result.err(new UnexpectedError({ cause }));
  }
}

export function encode<T extends TSchema>(
  schema: T,
  data: unknown,
): Result<string, ValidationError | UnexpectedError> {
  try {
    return Result.ok(encodeWithSchema(schema, data));
  } catch (cause) {
    if (cause instanceof EncodeError) {
      const errors = Value.Errors(schema, data);
      return Result.err(new ValidationError({ errors, cause }));
    }
    return Result.err(new UnexpectedError({ cause }));
  }
}

export function encodeSchema<S extends SchemaLike>(
  schema: S,
  data: unknown,
): Result<string, ValidationError | UnexpectedError> {
  const raw = unwrapSchema(schema);
  try {
    return Result.ok(encodeWithSchema(raw as TSchema, data));
  } catch (cause) {
    if (cause instanceof EncodeError) {
      const errors = Value.Errors(raw as TSchema, data);
      return Result.err(new ValidationError({ errors, cause }));
    }
    return Result.err(new UnexpectedError({ cause }));
  }
}
