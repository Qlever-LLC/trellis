import Type, { type StaticDecode } from "typebox";
import type { parseUnknownSchema } from "../../../packages/trellis/codec.ts";

import {
  type JsonValue,
  JsonValueSchema,
  type StateStoreKind,
} from "../../../packages/trellis/models/trellis/State.ts";
import { IsoDateSchema } from "../../../packages/trellis/models/trellis/IsoDate.ts";

export const StoredStateEntrySchema = Type.Object({
  value: JsonValueSchema,
  updatedAt: IsoDateSchema,
  expiresAt: Type.Optional(IsoDateSchema),
}, { additionalProperties: false });
export type StoredStateEntry = {
  value: JsonValue;
  updatedAt: Date;
  expiresAt?: Date;
};

export type ResolvedStateStore = {
  ownerType: "user" | "device";
  contractId: string;
  ownerKey: string;
  store: string;
  kind: StateStoreKind;
  schema: Parameters<typeof parseUnknownSchema>[0];
};
