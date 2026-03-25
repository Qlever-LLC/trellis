import { bootstrapAndConnectActivityService } from "./bootstrap.ts";
import {
  registerActivityProjection,
  registerActivityRpcHandlers,
} from "./projectors.ts";
import { openActivityStore } from "./store.ts";

const service = await bootstrapAndConnectActivityService();
const activityKV = await openActivityStore(service);

await registerActivityRpcHandlers(service, activityKV);
await registerActivityProjection(service, activityKV);

console.info("[activity] service is running", {
  service: service.name,
  sessionKey: service.auth.sessionKey,
});

const shutdown = async () => {
  console.info("[activity] shutting down");
  await service.stop();
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", () => void shutdown());
Deno.addSignalListener("SIGTERM", () => void shutdown());

await new Promise<void>(() => {});
