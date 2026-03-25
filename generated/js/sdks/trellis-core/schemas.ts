// Generated from ./generated/contracts/manifests/trellis.core@v1.json
export const SCHEMAS = {
  rpc: {
    "Trellis.Bindings.Get": {
      input: {"additionalProperties":false,"properties":{"contractId":{"minLength":1,"type":"string"},"digest":{"pattern":"^[A-Za-z0-9_-]+$","type":"string"}},"type":"object"} as const,
      output: {"additionalProperties":false,"properties":{"binding":{"additionalProperties":false,"properties":{"contractId":{"minLength":1,"type":"string"},"digest":{"pattern":"^[A-Za-z0-9_-]+$","type":"string"},"resources":{"properties":{"kv":{"patternProperties":{"^.*$":{"additionalProperties":false,"properties":{"bucket":{"minLength":1,"type":"string"},"history":{"minimum":1,"type":"integer"},"maxValueBytes":{"minimum":1,"type":"integer"},"ttlMs":{"minimum":0,"type":"integer"}},"required":["bucket","history","ttlMs"],"type":"object"}},"type":"object"}},"type":"object"}},"required":["contractId","digest","resources"],"type":"object"}},"type":"object"} as const,
    },
    "Trellis.Catalog": {
      input: {"additionalProperties":false,"properties":{},"type":"object"} as const,
      output: {"additionalProperties":false,"properties":{"catalog":{"additionalProperties":false,"properties":{"contracts":{"items":{"additionalProperties":false,"properties":{"description":{"minLength":1,"type":"string"},"digest":{"type":"string"},"displayName":{"minLength":1,"type":"string"},"id":{"type":"string"},"kind":{"minLength":1,"type":"string"}},"required":["id","digest","displayName","description","kind"],"type":"object"},"type":"array"},"format":{"const":"trellis.catalog.v1","type":"string"}},"required":["format","contracts"],"type":"object"}},"required":["catalog"],"type":"object"} as const,
    },
    "Trellis.Contract.Get": {
      input: {"additionalProperties":false,"properties":{"digest":{"pattern":"^[A-Za-z0-9_-]+$","type":"string"}},"required":["digest"],"type":"object"} as const,
      output: {"additionalProperties":false,"properties":{"contract":{"properties":{"description":{"minLength":1,"type":"string"},"displayName":{"minLength":1,"type":"string"},"errors":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"events":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"format":{"const":"trellis.contract.v1","type":"string"},"id":{"minLength":1,"type":"string"},"kind":{"minLength":1,"type":"string"},"resources":{"properties":{"kv":{"patternProperties":{"^.*$":{"additionalProperties":false,"properties":{"history":{"default":1,"minimum":1,"type":"integer"},"maxValueBytes":{"minimum":1,"type":"integer"},"purpose":{"minLength":1,"type":"string"},"required":{"default":true,"type":"boolean"},"ttlMs":{"default":0,"minimum":0,"type":"integer"}},"required":["purpose"],"type":"object"}},"type":"object"}},"type":"object"},"rpc":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"subjects":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"},"uses":{"patternProperties":{"^.*$":{"type":"object"}},"type":"object"}},"required":["format","id","displayName","description","kind"],"type":"object"}},"required":["contract"],"type":"object"} as const,
    },
  },
  events: {
  },
  subjects: {
  },
} as const;

