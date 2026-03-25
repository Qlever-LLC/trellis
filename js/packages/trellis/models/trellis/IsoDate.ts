import Type from "typebox";

function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(
      `Expected canonical ISO 8601 UTC date-time string, received '${value}'`,
    );
  }
  return parsed;
}

function formatIsoDate(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Expected a valid Date instance");
  }
  return value.toISOString();
}

export const IsoDateSchema = Type.Codec(
  Type.String({ format: "date-time" }),
)
  .Decode((value) => parseIsoDate(value))
  .Encode((value) => formatIsoDate(value));
