import { defineAppContract } from "@qlever-llc/trellis/contracts";
import { auth, state } from "@qlever-llc/trellis-sdk";
import { trellisDemoJobsService } from "../../../generated/js/sdks/demo-jobs-service/mod.ts";
import { trellisDemoKvService } from "../../../generated/js/sdks/demo-kv-service/mod.ts";
import { trellisDemoOperationService } from "../../../generated/js/sdks/demo-operation-service/mod.ts";
import { trellisDemoRpcService } from "../../../generated/js/sdks/demo-rpc-service/mod.ts";
import { trellisDemoTransferService } from "../../../generated/js/sdks/demo-transfer-service/mod.ts";
import { trellisJobs } from "../../../../generated/js/sdks/jobs/mod.ts";

const contract = defineAppContract(() => ({
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
    state: state.use({
      rpc: {
        call: ["State.Get", "State.Put", "State.List", "State.Delete"],
      },
    }),
  },
}));

export default contract;
