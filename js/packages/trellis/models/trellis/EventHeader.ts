import Type, { type Static } from "typebox";
import { IsoDateSchema } from "./IsoDate.ts";

export const EventHeaderSchema = Type.Object({
  header: Type.Object({
    id: Type.String(),
    time: IsoDateSchema,
  }),
});
export type EventHeader = Static<typeof EventHeaderSchema>;
