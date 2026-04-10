import { defineContract } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis/sdk/auth";

export const CONTRACT = defineContract({
  id: "trellis.demo-workload@v1",
  displayName: "Demo Workload",
  description: "A simple activated workload that logs its connection details.",
  kind: "workload",
  uses: {
    auth: auth.useDefaults(),
  },
});

export default CONTRACT;
