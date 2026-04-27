import Type, { type Static } from "typebox";

import type { StateEntry, StateMigrationRequired } from "../State.ts";
import {
  JsonValueSchema,
  StateEntrySchema,
  StateMigrationRequiredSchema,
} from "../State.ts";

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
    entry: Type.Optional(Type.Union([
      StateEntrySchema,
      StateMigrationRequiredSchema,
    ])),
  }),
]);
export type StatePutResponse =
  | { applied: true; entry: StateEntry }
  | {
    applied: false;
    found: boolean;
    entry?: StateEntry | StateMigrationRequired;
  };
