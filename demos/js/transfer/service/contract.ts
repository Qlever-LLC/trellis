import { defineServiceContract } from "@qlever-llc/trellis";
import { auth, health } from "@qlever-llc/trellis-sdk";
import Type from "typebox";

const schemas = {
  InspectionEvidenceUploadRequest: Type.Object({
    key: Type.String({ minLength: 1 }),
    contentType: Type.Optional(Type.String({ minLength: 1 })),
    evidenceType: Type.String({ minLength: 1 }),
  }),
  InspectionEvidenceUploadProgress: Type.Object({
    stage: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  }),
  InspectionEvidenceUploadResponse: Type.Object({
    evidenceId: Type.String({ minLength: 1 }),
    key: Type.String({ minLength: 1 }),
    size: Type.Integer({ minimum: 0 }),
    disposition: Type.String({ minLength: 1 }),
  }),
} as const;

const contract = defineServiceContract(
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
