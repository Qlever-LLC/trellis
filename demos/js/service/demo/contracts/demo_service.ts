import { defineServiceContract, type RpcName } from "@qlever-llc/trellis";
import { auth } from "@qlever-llc/trellis-sdk/auth";
import { health } from "@qlever-llc/trellis-sdk/health";
import * as errors from "../errors/index.ts";
import * as schemas from "../schemas/index.ts";
import type { ServiceRpcHandler } from "@qlever-llc/trellis/host";

export const contract = defineServiceContract(
  {
    schemas,
    errors,
  },
  (ref) => ({
    id: "trellis.demo-service@v1",
    displayName: "Demo Service",
    description:
      "Demo installable service with a groups RPC and a file upload endpoint.",
    uses: {
      auth: auth.useDefaults(),
      health: health.useDefaults(),
    },
    resources: {
      store: {
        uploads: {
          purpose: "Temporary uploaded files for the demo service.",
          ttlMs: 0,
          maxObjectBytes: 1024 * 1024,
          maxTotalBytes: 8 * 1024 * 1024,
        },
      },
    },
    rpc: {
      "Demo.Groups.List": {
        version: "v1",
        input: ref.schema("GroupsListRequest"),
        output: ref.schema("GroupsListResponse"),
        capabilities: { call: [] },
        errors: [ref.error("UnexpectedError")],
      },
      "Demo.Files.InitiateUpload": {
        version: "v1",
        input: ref.schema("FilesInitiateUploadRequest"),
        output: ref.schema("FilesInitiateUploadResponse"),
        capabilities: { call: ["uploader"] },
        errors: [
          ref.error("ReservedUploadKey"),
          ref.error("TransferError"),
          ref.error("UnexpectedError"),
        ],
      },
    },
  }),
);

export default contract;
export type Rpc<T extends RpcName<typeof contract>> = ServiceRpcHandler<
  typeof contract,
  T
>;
