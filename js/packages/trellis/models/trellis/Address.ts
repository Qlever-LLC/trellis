import Type, { type Static } from "typebox";

export const AddressSchema = Type.Object({
  regionCode: Type.Optional(Type.String()),
  addressLines: Type.Array(Type.String(), { default: [] }),
});
export type Address = Static<typeof AddressSchema>;
