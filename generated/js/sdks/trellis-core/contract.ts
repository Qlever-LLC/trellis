// Generated from ../generated/contracts/manifests/trellis.core@v1.json
import type { SdkContractModule, TrellisContractV1, UseSpec } from "@trellis/contracts";
import { API } from "./api.ts";

const CONTRACT_MODULE_METADATA = Symbol.for("@trellis/contracts/contract-module");

export const CONTRACT_ID = "trellis.core@v1" as const;
export const CONTRACT_DIGEST = "u6jM9gtkoGwuqOf6Uzjs4jT_ONa5Tw635F9FgQIHBoQ" as const;
export const CONTRACT = {"description":"Trellis runtime RPCs available to all connected participants.","displayName":"Trellis Core","format":"trellis.contract.v1","id":"trellis.core@v1","kind":"service","rpc":{"Trellis.Bindings.Get":{"capabilities":{"call":["service"]},"errors":[{"type":"ValidationError"},{"type":"UnexpectedError"}],"inputSchema":{"additionalProperties":false,"properties":{"contractId":{"minLength":1,"type":"string"},"digest":{"pattern":"^[A-Za-z0-9_-]+$","type":"string"}},"type":"object"},"outputSchema":{"additionalProperties":false,"properties":{"binding":{"additionalProperties":false,"properties":{"contractId":{"minLength":1,"type":"string"},"digest":{"pattern":"^[A-Za-z0-9_-]+$","type":"string"},"resources":{"properties":{"kv":{"patternProperties":{"^.*$":{"additionalProperties":false,"properties":{"bucket":{"minLength":1,"type":"string"},"history":{"minimum":1,"type":"integer"},"maxValueBytes":{"minimum":1,"type":"integer"},"ttlMs":{"minimum":0,"type":"integer"}},"required":["bucket","history","ttlMs"],"type":"object"}},"type":"object"}},"type":"object"}},"required":["contractId","digest","resources"],"type":"object"}},"type":"object"},"subject":"rpc.v1.Trellis.Bindings.Get","version":"v1"},"Trellis.Catalog":{"capabilities":{"call":["trellis.catalog.read"]},"errors":[{"type":"ValidationError"},{"type":"UnexpectedError"}],"inputSchema":{"additionalProperties":false,"properties":{},"type":"object"},"outputSchema":{"additionalProperties":false,"properties":{"catalog":{"additionalProperties":false,"properties":{"contracts":{"items":{"additionalProperties":false,"properties":{"description":{"minLength":1,"type":"string"},"digest":{"type":"string"},"displayName":{"minLength":1,"type":"string"},"id":{"type":"string"},"kind":{"minLength":1,"type":"string"}},"required":["id","digest","displayName","description","kind"],"type":"object"},"type":"array"},"format":{"const":"trellis.catalog.v1","type":"string"}},"required":["format","contracts"],"type":"object"}},"required":["catalog"],"type":"object"},"subject":"rpc.v1.Trellis.Catalog","version":"v1"},"Trellis.Contract.Get":{"capabilities":{"call":["trellis.contract.read"]},"errors":[{"type":"ValidationError"},{"type":"UnexpectedError"}],"inputSchema":{"additionalProperties":false,"properties":{"digest":{"pattern":"^[A-Za-z0-9_-]+$","type":"string"}},"required":["digest"],"type":"object"},"outputSchema":{"additionalProperties":false,"properties":{"contract":{"properties":{"description":{"minLength":1,"type":"string"},"displayName":{"minLength":1,"type":"string"},"errors":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"events":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"format":{"const":"trellis.contract.v1","type":"string"},"id":{"minLength":1,"type":"string"},"kind":{"minLength":1,"type":"string"},"resources":{"properties":{"kv":{"patternProperties":{"^.*$":{"additionalProperties":false,"properties":{"history":{"default":1,"minimum":1,"type":"integer"},"maxValueBytes":{"minimum":1,"type":"integer"},"purpose":{"minLength":1,"type":"string"},"required":{"default":true,"type":"boolean"},"ttlMs":{"default":0,"minimum":0,"type":"integer"}},"required":["purpose"],"type":"object"}},"type":"object"}},"type":"object"},"rpc":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"subjects":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"uses":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"}},"required":["format","id","displayName","description","kind"],"type":"object"}},"required":["contract"],"type":"object"},"subject":"rpc.v1.Trellis.Contract.Get","version":"v1"}}} as TrellisContractV1;

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

export const trellisCore: SdkContractModule<typeof CONTRACT_ID, typeof API.owned> = {
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
      value: trellisCore,
      enumerable: false,
    });

    return dependencyUse;
  }) as SdkContractModule<typeof CONTRACT_ID, typeof API.owned>["use"],
};

export const use = trellisCore.use;
