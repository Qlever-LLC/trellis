import { Result } from "@qlever-llc/trellis";
import type { Rpc } from "../../contracts/demo_service.ts";

export const listGroupsRpc: Rpc<"Demo.Groups.List"> = () => {
  return Result.ok({
    groups: ["alpha", "beta", "gamma"],
  });
};
