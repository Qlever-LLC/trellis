import Type, { type Static } from "typebox";

import type { StateEntry } from "../State.ts";
import { JsonValueSchema, StateEntrySchema } from "../State.ts";

export const StatePutSchema = Type.Object({
  store: Type.String({ minLength: 1 }),
  key: Type.Optional(Type.String({ minLength: 1 })),
  expectedRevision: Type.Optional(Type.Union([
    Type.String({ minLength: 1 }),
    Type.Null(),
  ])),
  value: JsonValueSchema,
  ttlMs: Type.Optional(Type.Integer({ minimum: 1 })),
});
export type StatePutInput = Static<typeof StatePutSchema>;

export const StatePutResponseSchema = Type.Union([
  Type.Object({
    applied: Type.Literal(true),
    entry: StateEntrySchema,
  }),
  Type.Object({
    applied: Type.Literal(false),
    found: Type.Boolean(),
    entry: Type.Optional(StateEntrySchema),
  }),
]);
export type StatePutResponse =
  | { applied: true; entry: StateEntry }
  | { applied: false; found: boolean; entry?: StateEntry };
