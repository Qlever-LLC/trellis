import Type, { type Static } from "typebox";

export const TrellisIDSchema = Type.Object({
  id: Type.String(),
  origin: Type.String(),
});
export type TrellisID = Static<typeof TrellisIDSchema>;

export const IDSchema = TrellisIDSchema;
export type ID = TrellisID;
