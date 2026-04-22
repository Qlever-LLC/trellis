import { defineAppContract } from "../../../js/packages/trellis/contracts.ts";
import { Type } from "typebox";
import { trellisJobs } from "../../../js/packages/trellis-sdk/jobs.ts";
import { auth } from "../../../js/packages/trellis-sdk/auth.ts";
import { useDefaults as useDefaultState } from "../../../js/packages/trellis-sdk/state.ts";
import { trellisDemoJobsService } from "@trellis-demo/jobs-service-sdk";
import { trellisDemoKvService } from "@trellis-demo/kv-service-sdk";
import { trellisDemoOperationService } from "@trellis-demo/operation-service-sdk";
import { trellisDemoRpcService } from "@trellis-demo/rpc-service-sdk";
import { trellisDemoTransferService } from "@trellis-demo/transfer-service-sdk";

const schemas = {
  InspectionContextState: Type.Object({
    siteId: Type.String(),
    note: Type.String(),
    updatedBy: Type.String(),
    updatedAt: Type.String({ format: "date-time" }),
  }),
} as const;

const contract = defineAppContract({ schemas }, (ref) => ({
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
}));

export default contract;
