import { defineContract } from "@qlever-llc/trellis/contracts";
import { auth } from "@qlever-llc/trellis/sdk/auth";
import * as schemas from "../schemas/index.ts";
import type { RpcName } from "@qlever-llc/trellis";
import type { ServiceRpcHandler } from "@qlever-llc/trellis/server";

export const contract = defineContract({
  id: "trellis.demo-service@v1",
  displayName: "Demo Service",
  description:
    "Demo installable service with a groups RPC and a file upload endpoint.",
  kind: "service",
  schemas,
  uses: {
    auth: auth.useDefaults(),
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
      input: { schema: "GroupsListRequestdf" },
      output: { schema: "GroupsListResponse" },
      capabilities: { call: [] },
      errors: ["UnexpectedError"],
    },
    "Demo.Files.InitiateUpload": {
      version: "v1",
      input: { schema: "FilesInitiateUploadRequest" },
      output: { schema: "FilesInitiateUploadResponse" },
      capabilities: { call: ["uploader"] },
      errors: ["TransferError", "UnexpectedError"],
    },
  },
});

export default contract;
export type Rpc<T extends RpcName<typeof contract>> = ServiceRpcHandler<
  typeof contract,
  T
>;
