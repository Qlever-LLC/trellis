import Type, { type Static } from "typebox";

import { PaginatedSchema } from "../../../contracts.ts";
import { StateEntrySchema, StateScopeSchema } from "../State.ts";
import { PaginateSchema } from "../Paginate.ts";

export const StateListSchema = Type.Intersect([
  PaginateSchema,
  Type.Object({
    scope: StateScopeSchema,
    prefix: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false }),
]);
export type StateListInput = Static<typeof StateListSchema>;

export const StateListResponseSchema = Type.Intersect([
  PaginatedSchema,
  Type.Object({
    entries: Type.Array(StateEntrySchema, { default: [] }),
  }, { additionalProperties: false }),
]);
export type StateListResponse = Static<typeof StateListResponseSchema>;
