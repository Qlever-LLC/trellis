import { compileSchema } from "json-schema-library";

export type SubjectParam = `/${string}`;

type JsonPrimitive = string | number | boolean | null;
type TokenPrimitive = string | number;

type IsPlainObject<T> = T extends object ? T extends JsonPrimitive ? false
  : T extends readonly unknown[] ? false
  : T extends Date ? false
  : T extends Function ? false
  : true
  : false;

type JoinPointer<Prefix extends string, Key extends string> = Prefix extends ""
  ? `/${Key}`
  : `${Prefix}/${Key}`;

type Dec = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type PointerPaths<
  T,
  Prefix extends string,
  Depth extends number,
> = Depth extends 0 ? never
  : IsPlainObject<T> extends true ? {
      [K in Extract<keyof T, string>]-?:
        | JoinPointer<Prefix, K>
        | PointerPaths<NonNullable<T[K]>, JoinPointer<Prefix, K>, Dec[Depth]>;
    }[Extract<keyof T, string>]
  : never;

export type JsonPointer<T> = PointerPaths<T, "", 6> extends infer P
  ? P extends SubjectParam ? P
  : never
  : never;

type ScalarPointerPaths<
  T,
  Prefix extends string,
  Depth extends number,
> = Depth extends 0 ? never
  : IsPlainObject<T> extends true ? {
      [K in Extract<keyof T, string>]-?: NonNullable<T[K]> extends TokenPrimitive
        ? JoinPointer<Prefix, K>
        : ScalarPointerPaths<
          NonNullable<T[K]>,
          JoinPointer<Prefix, K>,
          Dec[Depth]
        >;
    }[Extract<keyof T, string>]
  : never;

export type ScalarJsonPointer<T> = ScalarPointerPaths<T, "", 6> extends infer P
  ? P extends SubjectParam ? P
  : never
  : never;

function isTokenableSchema(schema: unknown): boolean {
  if (schema === true || schema === false) return false;
  if (!schema || typeof schema !== "object") return false;

  const s = schema as Record<string, unknown>;

  const allOf = s.allOf;
  if (Array.isArray(allOf) && allOf.length > 0) {
    return allOf.every(isTokenableSchema);
  }

  const anyOf = s.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    return anyOf.every(isTokenableSchema);
  }

  const oneOf = s.oneOf;
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    return oneOf.every(isTokenableSchema);
  }

  const constant = s.const;
  if (typeof constant === "string" || typeof constant === "number") return true;

  const enumValues = s.enum;
  if (Array.isArray(enumValues)) {
    if (enumValues.length === 0) return false;
    return enumValues.every(
      (v) => typeof v === "string" || typeof v === "number",
    );
  }

  const type = s.type;
  if (type === "string" || type === "number" || type === "integer") return true;
  if (Array.isArray(type)) {
    return type.every(
      (t) => t === "string" || t === "number" || t === "integer",
    );
  }

  return false;
}

export function getSubschemaAtDataPointer(
  schema: unknown,
  pointer: string,
): unknown | undefined {
  const root = compileSchema(schema as Record<string, unknown>);
  const { node, error } = root.getNode(pointer, undefined, {
    withSchemaWarning: true,
  });
  if (error || !node) return undefined;
  return node.schema;
}

export function assertDataPointersExistAndAreTokenable(
  name: string,
  schema: unknown,
  pointers: readonly string[],
): void {
  const root = compileSchema(schema as Record<string, unknown>);

  for (const pointer of pointers) {
    const { node, error } = root.getNode(pointer, undefined, {
      withSchemaWarning: true,
    });
    if (error || !node) {
      throw new Error(
        `Invalid event subject param pointer '${pointer}' for event '${name}' (path not found in schema)`,
      );
    }

    if (!isTokenableSchema(node.schema)) {
      throw new Error(
        `Invalid event subject param pointer '${pointer}' for event '${name}' (must resolve to string/number schema)`,
      );
    }
  }
}
