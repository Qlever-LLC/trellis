import { defineContract } from "@qlever-llc/trellis-contracts";
import {
  HealthResponseSchema,
  HealthRpcSchema,
} from "@qlever-llc/trellis-server";

import { trellisCore } from "../../trellis/catalog/contracts/trellis_core.ts";
import {
  JobEventSchema,
  JobSchema,
  JobsGetRequestSchema,
  JobsGetResponseSchema,
  JobsListRequestSchema,
  JobsListResponseSchema,
  JobsListServicesRequestSchema,
  JobsListServicesResponseSchema,
  JobsMutateRequestSchema,
  JobsMutateResponseSchema,
  ServiceRegistrationSchema,
} from "../schemas.ts";

const schemas = {
  HealthRequest: HealthRpcSchema,
  HealthResponse: HealthResponseSchema,
  Job: JobSchema,
  JobEvent: JobEventSchema,
  JobsGetRequest: JobsGetRequestSchema,
  JobsGetResponse: JobsGetResponseSchema,
  JobsListRequest: JobsListRequestSchema,
  JobsListResponse: JobsListResponseSchema,
  JobsListServicesRequest: JobsListServicesRequestSchema,
  JobsListServicesResponse: JobsListServicesResponseSchema,
  JobsMutateRequest: JobsMutateRequestSchema,
  JobsMutateResponse: JobsMutateResponseSchema,
  ServiceRegistration: ServiceRegistrationSchema,
} as const;

function schemaRef<const TName extends keyof typeof schemas & string>(schema: TName) {
  return { schema } as const;
}

export const trellisJobs = defineContract({
  id: "trellis.jobs@v1",
  displayName: "Trellis Jobs",
  description: "Provide global job visibility and management across Trellis services.",
  kind: "service",
  schemas,
  uses: {
    core: trellisCore.use({
      rpc: {
        call: ["Trellis.Bindings.Get", "Trellis.Catalog"],
      },
    }),
  },
  resources: {
    kv: {
      jobsState: {
        purpose: "Store projected job state for Jobs.List and Jobs.Get.",
        history: 1,
        ttlMs: 0,
      },
      serviceInstances: {
        purpose: "Store service instance registrations for Jobs.ListServices.",
        history: 1,
        ttlMs: 0,
      },
    },
  },
  rpc: {
    "Jobs.Health": {
      version: "v1",
      input: schemaRef("HealthRequest"),
      output: schemaRef("HealthResponse"),
      capabilities: { call: [] },
      errors: ["UnexpectedError"],
    },
    "Jobs.ListServices": {
      version: "v1",
      input: schemaRef("JobsListServicesRequest"),
      output: schemaRef("JobsListServicesResponse"),
      capabilities: { call: ["jobs.read"] },
      errors: ["UnexpectedError"],
    },
    "Jobs.List": {
      version: "v1",
      input: schemaRef("JobsListRequest"),
      output: schemaRef("JobsListResponse"),
      capabilities: { call: ["jobs.read"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Jobs.Get": {
      version: "v1",
      input: schemaRef("JobsGetRequest"),
      output: schemaRef("JobsGetResponse"),
      capabilities: { call: ["jobs.read"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Jobs.Cancel": {
      version: "v1",
      input: schemaRef("JobsMutateRequest"),
      output: schemaRef("JobsMutateResponse"),
      capabilities: { call: ["jobs.admin"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
    "Jobs.Retry": {
      version: "v1",
      input: schemaRef("JobsMutateRequest"),
      output: schemaRef("JobsMutateResponse"),
      capabilities: { call: ["jobs.admin"] },
      errors: ["ValidationError", "UnexpectedError"],
    },
  },
  subjects: {
    "Jobs.Stream": {
      subject: "trellis.jobs.>",
      capabilities: {
        publish: ["service:jobs"],
        subscribe: ["jobs.read"],
      },
    },
  },
});

export const { CONTRACT_ID, CONTRACT, CONTRACT_DIGEST, API, use } = trellisJobs;
export type JobsApi = typeof API;
export type JobsOwnedApi = typeof API.owned;
export type JobsTrellisApi = typeof API.trellis;
