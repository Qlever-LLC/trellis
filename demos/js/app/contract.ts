import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import { jobs } from "@qlever-llc/trellis/sdk/jobs";
import { state } from "@qlever-llc/trellis/sdk/state";
import { trellisDemoJobsService } from "@trellis-demo/jobs-service-sdk";
import { trellisDemoKvService } from "@trellis-demo/kv-service-sdk";
import { trellisDemoOperationService } from "@trellis-demo/operation-service-sdk";
import { trellisDemoRpcService } from "@trellis-demo/rpc-service-sdk";
import { trellisDemoTransferService } from "@trellis-demo/transfer-service-sdk";
import * as schemas from "./schemas/index.ts";

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
    jobs: jobs.use({
      rpc: {
        call: ["Jobs.Health", "Jobs.List", "Jobs.ListServices"],
      },
    }),
    state: state.useDefaults(),
  },
  state: {
    inspectionContext: {
      kind: "map",
      schema: ref.schema("InspectionContextState"),
    },
  },
}));

export default contract;
