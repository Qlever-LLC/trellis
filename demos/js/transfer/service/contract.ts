import { defineServiceContract } from "@qlever-llc/trellis/contracts";
import { auth, health } from "@qlever-llc/trellis-sdk";
import * as schemas from "./src/schemas/index.ts";

export const contract = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.demo-transfer-service@v1",
    displayName: "Inspection Transfer Demo Service",
    description: "Field inspection evidence transfer demo service.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    resources: {
      store: {
        uploads: {
          purpose: "Staged evidence files for the transfer demo.",
          ttlMs: 60_000,
          maxObjectBytes: 64 * 1024 * 1024,
          maxTotalBytes: 256 * 1024 * 1024,
        },
      },
    },
    operations: {
      "Inspection.Evidence.Upload": {
        version: "v1",
        input: ref.schema("InspectionEvidenceUploadRequest"),
        progress: ref.schema("InspectionEvidenceUploadProgress"),
        output: ref.schema("InspectionEvidenceUploadResponse"),
        transfer: {
          store: "uploads",
          key: "/key",
          contentType: "/contentType",
          expiresInMs: 60_000,
        },
        capabilities: {
          call: [],
          read: [],
        },
      },
    },
  }),
);

export default contract;
