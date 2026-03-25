import Type, { type Static } from "typebox";

export const UserStatsSchema = Type.Object({}, { additionalProperties: false });
export type UserStatsInput = Static<typeof UserStatsSchema>;

export const UserStatsResponseSchema = Type.Object(
  {
    total: Type.Number(),
    byOrigin: Type.Array(
      Type.Object({
        origin: Type.String(),
        count: Type.Number(),
      }),
    ),
  },
  { additionalProperties: false },
);
export type UserStatsResponse = Static<typeof UserStatsResponseSchema>;
