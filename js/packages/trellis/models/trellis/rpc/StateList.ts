import Type, { type Static } from "typebox";

import { PaginatedSchema } from "../../../contracts.ts";
import { StateEntrySchema } from "../State.ts";
import { PaginateSchema } from "../Paginate.ts";

export const StateListSchema = Type.Intersect([
  PaginateSchema,
  Type.Object({
    store: Type.String({ minLength: 1 }),
    prefix: Type.Optional(Type.String({ minLength: 1 })),
  }),
]);
export type StateListInput = Static<typeof StateListSchema>;

export const StateListResponseSchema = Type.Intersect([
  PaginatedSchema,
  Type.Object({
    entries: Type.Array(StateEntrySchema, { default: [] }),
  }),
]);
export type StateListResponse = Static<typeof StateListResponseSchema>;
