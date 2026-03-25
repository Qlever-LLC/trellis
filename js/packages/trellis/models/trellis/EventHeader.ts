import Type, { type Static } from "typebox";
import { IsoDateSchema } from "./IsoDate.ts";

export const EventHeaderSchema = Type.Object({
  header: Type.Object({
    id: Type.String(),
    time: IsoDateSchema,
  }, { additionalProperties: false }),
});
export type EventHeader = Static<typeof EventHeaderSchema>;
