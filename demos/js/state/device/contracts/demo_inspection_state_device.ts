import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth, health, state } from "@qlever-llc/trellis-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-state-device@v1",
  displayName: "Inspection State Demo Device",
  description: "Field inspection state demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    state: state.use({
      rpc: {
        call: ["State.Get", "State.Put", "State.List"],
      },
    }),
  },
}));

export default contract;
