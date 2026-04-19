import type { StaticDecode } from "typebox";
import { NatsAuthTokenV1Schema } from "./schemas.ts";

export type NatsAuthTokenV1 = StaticDecode<typeof NatsAuthTokenV1Schema>;
