import { defineAppContract } from "../../../../js/packages/trellis/contract_support/mod.ts";
import { Type } from "typebox";
import { auth } from "../../../../js/packages/trellis-sdk/auth.ts";
import { useDefaults as useDefaultState } from "../../../../js/packages/trellis-sdk/state.ts";
import { trellisDemoJobsService } from "../../../generated/js/sdks/demo-jobs-service/mod.ts";
import { trellisDemoKvService } from "../../../generated/js/sdks/demo-kv-service/mod.ts";
import { trellisDemoOperationService } from "../../../generated/js/sdks/demo-operation-service/mod.ts";
import { trellisDemoRpcService } from "../../../generated/js/sdks/demo-rpc-service/mod.ts";
import { trellisDemoTransferService } from "../../../generated/js/sdks/demo-transfer-service/mod.ts";
import { trellisJobs } from "../../../../generated/js/sdks/jobs/mod.ts";

const schemas = {
  InspectionContextState: Type.Object({
    siteId: Type.String(),
    note: Type.String(),
    updatedBy: Type.String(),
    updatedAt: Type.String({ format: "date-time" }),
  }),
} as const;

const contract = defineAppContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-app@v1",
    displayName: "Inspection Demo App",
    description: "Browser app for the field inspection demos.",
    uses: {
      auth: auth.useDefaults(),
      rpcDemo: trellisDemoRpcService.use({
        rpc: {
          call: ["Inspection.Assignments.List", "Inspection.Sites.GetSummary"],
        },
      }),
      operationDemo: trellisDemoOperationService.use({
        operations: {
          call: ["Inspection.Report.Generate"],
        },
      }),
      transferDemo: trellisDemoTransferService.use({
        operations: {
          call: ["Inspection.Evidence.Upload"],
        },
      }),
      kvDemo: trellisDemoKvService.use({
        rpc: {
          call: ["Inspection.Summaries.List", "Inspection.Summaries.Get"],
        },
      }),
      jobsDemo: trellisDemoJobsService.use({
        rpc: {
          call: [
            "Inspection.Summaries.Refresh",
            "Inspection.Summaries.RefreshStatus.Get",
          ],
        },
      }),
      jobs: trellisJobs.use({
        rpc: {
          call: ["Jobs.Health", "Jobs.List", "Jobs.ListServices"],
        },
      }),
      state: useDefaultState(),
    },
    state: {
      inspectionContext: {
        kind: "map",
        schema: ref.schema("InspectionContextState"),
      },
    },
  }),
);

export default contract;
