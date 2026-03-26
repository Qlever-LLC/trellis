// Generated from ./generated/contracts/manifests/trellis.activity@v1.json
import type { SdkContractModule, TrellisContractV1, UseSpec } from "@qlever-llc/trellis-contracts";
import { API } from "./api.ts";

const CONTRACT_MODULE_METADATA = Symbol.for("@qlever-llc/trellis-contracts/contract-module");

export const CONTRACT_ID = "trellis.activity@v1" as const;
export const CONTRACT_DIGEST = "8YG5wtZZEL9foGeGYDKDvQ-GB6IHVLL-M96oQJAEM2M" as const;
export const CONTRACT = {"description":"Project authentication activity into queryable audit records.","displayName":"Trellis Activity","events":{"Activity.Recorded":{"capabilities":{"publish":["service:events:activity"],"subscribe":["service:events:activity"]},"eventSchema":{"additionalProperties":false,"properties":{"actor":{"type":"string"},"header":{"additionalProperties":false,"properties":{"id":{"type":"string"},"time":{"format":"date-time","type":"string"}},"required":["id","time"],"type":"object"},"id":{"type":"string"},"kind":{"anyOf":[{"const":"auth.connect","type":"string"},{"const":"auth.disconnect","type":"string"},{"const":"auth.session_revoked","type":"string"},{"const":"auth.connection_kicked","type":"string"}]},"metadata":{"patternProperties":{"^.*$":{}},"type":"object"},"occurredAt":{"format":"date-time","type":"string"},"principalId":{"type":"string"},"principalLabel":{"type":"string"},"principalOrigin":{"type":"string"},"sessionKey":{"type":"string"},"summary":{"type":"string"},"userNkey":{"type":"string"}},"required":["header","id","kind","occurredAt","principalOrigin","principalId","principalLabel","summary"],"type":"object"},"subject":"events.v1.Activity.Recorded","version":"v1"}},"format":"trellis.contract.v1","id":"trellis.activity@v1","kind":"service","resources":{"kv":{"activity":{"history":1,"purpose":"Store normalized audit activity entries for the service projection.","required":true,"ttlMs":0}}},"rpc":{"Activity.Get":{"capabilities":{"call":["admin"]},"errors":[{"type":"ValidationError"},{"type":"UnexpectedError"}],"inputSchema":{"additionalProperties":false,"properties":{"id":{"type":"string"}},"required":["id"],"type":"object"},"outputSchema":{"additionalProperties":false,"properties":{"entry":{"additionalProperties":false,"properties":{"actor":{"type":"string"},"id":{"type":"string"},"kind":{"anyOf":[{"const":"auth.connect","type":"string"},{"const":"auth.disconnect","type":"string"},{"const":"auth.session_revoked","type":"string"},{"const":"auth.connection_kicked","type":"string"}]},"metadata":{"patternProperties":{"^.*$":{}},"type":"object"},"occurredAt":{"format":"date-time","type":"string"},"principalId":{"type":"string"},"principalLabel":{"type":"string"},"principalOrigin":{"type":"string"},"sessionKey":{"type":"string"},"summary":{"type":"string"},"userNkey":{"type":"string"}},"required":["id","kind","occurredAt","principalOrigin","principalId","principalLabel","summary"],"type":"object"}},"required":["entry"],"type":"object"},"subject":"rpc.v1.Activity.Get","version":"v1"},"Activity.Health":{"capabilities":{"call":[]},"errors":[{"type":"UnexpectedError"}],"inputSchema":{"additionalProperties":false,"properties":{},"type":"object"},"outputSchema":{"additionalProperties":false,"properties":{"checks":{"items":{"additionalProperties":false,"properties":{"error":{"type":"string"},"latencyMs":{"type":"number"},"name":{"type":"string"},"status":{"anyOf":[{"const":"ok","type":"string"},{"const":"failed","type":"string"}]}},"required":["name","status","latencyMs"],"type":"object"},"type":"array"},"service":{"type":"string"},"status":{"anyOf":[{"const":"healthy","type":"string"},{"const":"unhealthy","type":"string"},{"const":"degraded","type":"string"}]},"timestamp":{"format":"date-time","type":"string"}},"required":["status","service","timestamp","checks"],"type":"object"},"subject":"rpc.v1.Activity.Health","version":"v1"},"Activity.List":{"capabilities":{"call":["admin"]},"errors":[{"type":"ValidationError"},{"type":"UnexpectedError"}],"inputSchema":{"additionalProperties":false,"properties":{"kind":{"anyOf":[{"const":"auth.connect","type":"string"},{"const":"auth.disconnect","type":"string"},{"const":"auth.session_revoked","type":"string"},{"const":"auth.connection_kicked","type":"string"}]},"limit":{"maximum":200,"minimum":1,"type":"integer"}},"type":"object"},"outputSchema":{"additionalProperties":false,"properties":{"entries":{"items":{"additionalProperties":false,"properties":{"actor":{"type":"string"},"id":{"type":"string"},"kind":{"anyOf":[{"const":"auth.connect","type":"string"},{"const":"auth.disconnect","type":"string"},{"const":"auth.session_revoked","type":"string"},{"const":"auth.connection_kicked","type":"string"}]},"metadata":{"patternProperties":{"^.*$":{}},"type":"object"},"occurredAt":{"format":"date-time","type":"string"},"principalId":{"type":"string"},"principalLabel":{"type":"string"},"principalOrigin":{"type":"string"},"sessionKey":{"type":"string"},"summary":{"type":"string"},"userNkey":{"type":"string"}},"required":["id","kind","occurredAt","principalOrigin","principalId","principalLabel","summary"],"type":"object"},"type":"array"}},"required":["entries"],"type":"object"},"subject":"rpc.v1.Activity.List","version":"v1"}},"uses":{"auth":{"contract":"trellis.auth@v1","events":{"subscribe":["Auth.Connect","Auth.ConnectionKicked","Auth.Disconnect","Auth.SessionRevoked"]}},"core":{"contract":"trellis.core@v1","rpc":{"call":["Trellis.Bindings.Get","Trellis.Catalog"]}}}} as TrellisContractV1;

function assertSelectedKeysExist(
  kind: "rpc" | "events" | "subjects",
  keys: readonly string[] | undefined,
  api: Record<string, unknown>,
) {
  if (!keys) {
    return;
  }

  for (const key of keys) {
    if (!Object.hasOwn(api, key)) {
      throw new Error(`Contract '${CONTRACT_ID}' does not expose ${kind} key '${key}'`);
    }
  }
}

function assertValidUseSpec(spec: UseSpec<typeof API.owned>) {
  assertSelectedKeysExist("rpc", spec.rpc?.call, API.owned.rpc);
  assertSelectedKeysExist("events", spec.events?.publish, API.owned.events);
  assertSelectedKeysExist("events", spec.events?.subscribe, API.owned.events);
  assertSelectedKeysExist("subjects", spec.subjects?.publish, API.owned.subjects);
  assertSelectedKeysExist("subjects", spec.subjects?.subscribe, API.owned.subjects);
}

export const activity: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {
  CONTRACT_ID,
  CONTRACT_DIGEST,
  CONTRACT,
  API,
  use: ((spec) => {
    assertValidUseSpec(spec);

    const dependencyUse = {
      contract: CONTRACT_ID,
      ...(spec.rpc?.call ? { rpc: { call: [...spec.rpc.call] } } : {}),
      ...((spec.events?.publish || spec.events?.subscribe)
        ? {
          events: {
            ...(spec.events.publish ? { publish: [...spec.events.publish] } : {}),
            ...(spec.events.subscribe ? { subscribe: [...spec.events.subscribe] } : {}),
          },
        }
        : {}),
      ...((spec.subjects?.publish || spec.subjects?.subscribe)
        ? {
          subjects: {
            ...(spec.subjects.publish ? { publish: [...spec.subjects.publish] } : {}),
            ...(spec.subjects.subscribe ? { subscribe: [...spec.subjects.subscribe] } : {}),
          },
        }
        : {}),
    };

    Object.defineProperty(dependencyUse, CONTRACT_MODULE_METADATA, {
      value: activity,
      enumerable: false,
    });

    return dependencyUse;
  }) as SdkContractModule<typeof CONTRACT_ID, typeof API.owned>["use"],
};

export const use = activity.use;
