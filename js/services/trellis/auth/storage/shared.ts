/** Parses a JSON-encoded auth storage field. */
export function parseJsonField(name: string, value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (cause) {
    throw new Error(`Invalid JSON stored for auth ${name}`, { cause });
  }
}

/** Decodes a JSON-encoded auth storage field as a string array. */
export function decodeStringArrayField(name: string, value: string): string[] {
  const decoded = parseJsonField(name, value);
  if (!Array.isArray(decoded)) {
    throw new Error(`Invalid JSON array stored for auth ${name}`);
  }
  return decoded.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error(`Invalid JSON array entry stored for auth ${name}`);
    }
    return entry;
  });
}

/** Decodes a nullable JSON-encoded string array field. */
export function optionalJsonStringArray(
  name: string,
  value: string | null,
): string[] | undefined {
  return value === null ? undefined : decodeStringArrayField(name, value);
}

/** Normalizes a Date or ISO string into an ISO string. */
export function isoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
