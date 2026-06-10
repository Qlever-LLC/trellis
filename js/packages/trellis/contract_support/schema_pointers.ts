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
      [K in Extract<keyof T, string>]-?: NonNullable<T[K]> extends
        TokenPrimitive ? JoinPointer<Prefix, K>
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

type PointerResolution = {
  found: boolean;
  schemas: unknown[];
};

function pointerResolution(
  found: boolean,
  schemas: unknown[],
): PointerResolution {
  return { found, schemas };
}

function collectSubschemas(
  schema: unknown,
  segments: readonly string[],
): PointerResolution {
  if (segments.length === 0) return pointerResolution(true, [schema]);
  if (!isJsonObject(schema)) return pointerResolution(false, []);

  const resolved: unknown[] = [];
  let found = false;

  const properties = schema.properties;
  const segment = segments[0];
  if (
    segment !== undefined && isJsonObject(properties) &&
    Object.hasOwn(properties, segment)
  ) {
    const direct = collectSubschemas(properties[segment], segments.slice(1));
    found = found || direct.found;
    resolved.push(...direct.schemas);
  }

  const allOf = schema.allOf;
  if (Array.isArray(allOf)) {
    for (const branch of allOf) {
      const branchResult = collectSubschemas(branch, segments);
      found = found || branchResult.found;
      resolved.push(...branchResult.schemas);
    }
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (!Array.isArray(variants) || variants.length === 0) continue;

    const variantSchemas: unknown[] = [];
    let everyVariantResolved = true;
    for (const variant of variants) {
      const variantResult = collectSubschemas(variant, segments);
      if (!variantResult.found) {
        everyVariantResolved = false;
        break;
      }
      variantSchemas.push(...variantResult.schemas);
    }

    if (everyVariantResolved) found = true;
    resolved.push(...variantSchemas);
  }

  return pointerResolution(found, resolved);
}

function resolveFirstSubschema(
  schema: unknown,
  segments: readonly string[],
): unknown | undefined {
  if (segments.length === 0) return schema;
  if (!isJsonObject(schema)) return undefined;

  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const variants = schema[key];
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      const resolved = resolveFirstSubschema(variant, segments);
      if (resolved !== undefined) return resolved;
    }
  }

  const properties = schema.properties;
  const segment = segments[0];
  if (segment === undefined) return undefined;

  if (!isJsonObject(properties) || !Object.hasOwn(properties, segment)) {
    return undefined;
  }
  return resolveFirstSubschema(properties[segment], segments.slice(1));
}

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

/**
 * Returns the first schema node reachable by following a payload JSON Pointer.
 */
export function getSubschemaAtDataPointer(
  schema: unknown,
  pointer: string,
): unknown | undefined {
  return resolveFirstSubschema(
    schema,
    pointer.slice(1).split("/").map(decodeJsonPointerSegment),
  );
}

/**
 * Verifies that event subject parameter pointers resolve to tokenable schemas.
 */
export function assertDataPointersExistAndAreTokenable(
  name: string,
  schema: unknown,
  pointers: readonly string[],
): void {
  for (const pointer of pointers) {
    const resolved = collectSubschemas(
      schema,
      pointer.slice(1).split("/").map(decodeJsonPointerSegment),
    );
    if (!resolved.found) {
      throw new Error(
        `Invalid event subject param pointer '${pointer}' for event '${name}' (path not found in schema)`,
      );
    }

    if (!resolved.schemas.every(isTokenableSchema)) {
      throw new Error(
        `Invalid event subject param pointer '${pointer}' for event '${name}' (must resolve to string/number schema)`,
      );
    }
  }
}
