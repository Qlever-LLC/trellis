import { TrellisClient } from "../../../trellis/client_connect.ts";

export async function connectProviderTrellis(args) {
  return await TrellisClient.connect(args).orThrow();
}

export function createProviderPublicTrellis(seedTrellis) {
  return {
    jobs: seedTrellis.jobs,
    respondWithError: seedTrellis.respondWithError,
    request: seedTrellis.request,
    publish: seedTrellis.publish,
    event: seedTrellis.event,
    operation: seedTrellis.operation,
    wait: seedTrellis.wait,
    template: seedTrellis.template,
    state: seedTrellis.state,
    name: seedTrellis.name,
    timeout: seedTrellis.timeout,
    stream: seedTrellis.stream,
    api: seedTrellis.api,
  };
}
