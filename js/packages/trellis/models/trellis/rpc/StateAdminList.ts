import Type, { type Static } from "typebox";

import { PaginatedSchema } from "../../../contracts.ts";
import {
  StateEntrySchema,
  StateUserTargetSchema,
} from "../State.ts";
import { PaginateSchema } from "../Paginate.ts";

export const StateAdminListSchema = Type.Intersect([
  PaginateSchema,
  Type.Union([
    Type.Object({
      scope: Type.Literal("userApp"),
      contractId: Type.String({ minLength: 1 }),
      user: StateUserTargetSchema,
      prefix: Type.Optional(Type.String({ minLength: 1 })),
    }, { additionalProperties: false }),
    Type.Object({
      scope: Type.Literal("deviceApp"),
      contractId: Type.String({ minLength: 1 }),
      deviceId: Type.String({ minLength: 1 }),
      prefix: Type.Optional(Type.String({ minLength: 1 })),
    }, { additionalProperties: false }),
  ]),
]);
export type StateAdminListInput = Static<typeof StateAdminListSchema>;

export const StateAdminListResponseSchema = Type.Intersect([
  PaginatedSchema,
  Type.Object({
    entries: Type.Array(StateEntrySchema, { default: [] }),
  }, { additionalProperties: false }),
]);
export type StateAdminListResponse = Static<typeof StateAdminListResponseSchema>;
