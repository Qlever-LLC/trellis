import Type, { type StaticDecode } from "typebox";

import {
  JsonValueSchema,
  type StateScope,
} from "../../../packages/trellis/models/trellis/State.ts";
import { IsoDateSchema } from "../../../packages/trellis/models/trellis/IsoDate.ts";

export const StoredStateEntrySchema = Type.Object({
  value: JsonValueSchema,
  updatedAt: IsoDateSchema,
  expiresAt: Type.Optional(IsoDateSchema),
}, { additionalProperties: false });
export type StoredStateEntry = StaticDecode<typeof StoredStateEntrySchema>;

export type StateNamespace = {
  scope: StateScope;
  contractId: string;
  ownerKey: string;
};
