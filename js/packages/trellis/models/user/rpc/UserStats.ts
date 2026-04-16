import Type, { type Static } from "typebox";

export const UserStatsSchema = Type.Object({});
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
);
export type UserStatsResponse = Static<typeof UserStatsResponseSchema>;
