import { defineDeviceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import { trellisDemoTransferService as transferService } from "@trellis-demo/transfer-service-sdk";

const contract = defineDeviceContract(() => ({
  id: "trellis.demo-transfer-device@v1",
  displayName: "Inspection Transfer Demo Device",
  description: "Field inspection transfer demo device.",
  uses: {
    auth: auth.useDefaults(),
    health: health.useDefaults(),
    transfer: transferService.use({
      operations: {
        call: ["Inspection.Evidence.Upload"],
      },
    }),
  },
}));

export default contract;
