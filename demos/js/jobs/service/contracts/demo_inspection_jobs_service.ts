import type { RpcName } from "@qlever-llc/trellis";
import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, health } from "@qlever-llc/trellis-sdk";
import type { ServiceRpcHandler } from "@qlever-llc/trellis/host";
import Type from "typebox";

export const RefreshStatusValueSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
]);

export const InspectionSummariesRefreshStatusSchema = Type.Object({
  refreshId: Type.String({ minLength: 1 }),
  siteId: Type.String({ minLength: 1 }),
  status: RefreshStatusValueSchema,
  updatedAt: Type.String({ minLength: 1 }),
  message: Type.Optional(Type.String({ minLength: 1 })),
});

const schemas = {
  InspectionSummariesRefreshRequest: Type.Object({
    siteId: Type.String({ minLength: 1 }),
  }),
  InspectionSummariesRefreshResponse: Type.Object({
    refreshId: Type.String({ minLength: 1 }),
    status: RefreshStatusValueSchema,
  }),
  InspectionSummariesRefreshStatusRequest: Type.Object({
    refreshId: Type.String({ minLength: 1 }),
  }),
  InspectionSummariesRefreshStatus: InspectionSummariesRefreshStatusSchema,
  InspectionSummariesRefreshStatusResponse: Type.Object({
    refresh: Type.Optional(InspectionSummariesRefreshStatusSchema),
  }),
  InspectionSummariesRefreshJobPayload: Type.Object({
    siteId: Type.String({ minLength: 1 }),
  }),
  InspectionSummariesRefreshJobResult: Type.Object({
    refreshId: Type.String({ minLength: 1 }),
    status: RefreshStatusValueSchema,
  }),
} as const;

export const contract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-jobs-service@v1",
    displayName: "Inspection Jobs Demo Service",
    description: "Field inspection jobs demo service.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    resources: {
      kv: {
        refreshStatuses: {
          purpose: "Stored refresh statuses for the jobs demo.",
          history: 1,
          ttlMs: 0,
        },
      },
      jobs: {
        queues: {
          refreshSummaries: {
            payload: ref.schema("InspectionSummariesRefreshJobPayload"),
            result: ref.schema("InspectionSummariesRefreshJobResult"),
          },
        },
      },
    },
    rpc: {
      "Inspection.Summaries.Refresh": {
        version: "v1",
        input: ref.schema("InspectionSummariesRefreshRequest"),
        output: ref.schema("InspectionSummariesRefreshResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Inspection.Summaries.RefreshStatus.Get": {
        version: "v1",
        input: ref.schema("InspectionSummariesRefreshStatusRequest"),
        output: ref.schema("InspectionSummariesRefreshStatusResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
    },
  }),
);

export type Rpc<T extends RpcName<typeof contract>> = ServiceRpcHandler<
  typeof contract,
  T
>;
export default contract;
