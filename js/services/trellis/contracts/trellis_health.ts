import {
  type ContractDependencyUse,
  defineServiceContract,
  type UseSpec,
} from "@qlever-llc/trellis/contracts";
import { HealthHeartbeatSchema } from "@qlever-llc/trellis/health";

const schemas = {
  HealthHeartbeat: HealthHeartbeatSchema,
} as const;

const baseTrellisHealth = defineServiceContract(
  { schemas },
  (ref) => ({
    id: "trellis.health@v1",
    displayName: "Trellis Health",
    description: "Expose shared Trellis heartbeat events for service observability.",
    events: {
      "Health.Heartbeat": {
        version: "v1",
        event: ref.schema("HealthHeartbeat"),
      },
    },
  }),
);

const DEFAULT_HEALTH_EVENT_PUBLISH = ["Health.Heartbeat"] as const;

type TrellisHealthOwnedApi = typeof baseTrellisHealth.API.owned;
type TrellisHealthUseSpec = UseSpec<TrellisHealthOwnedApi>;
type TrellisHealthDefaultEventPublish = typeof DEFAULT_HEALTH_EVENT_PUBLISH;

type WithDefaultHealthEventPublish<TSpec extends TrellisHealthUseSpec | undefined> =
  TSpec extends { events?: { publish?: infer TPublish extends readonly string[] } }
    ? readonly [...TrellisHealthDefaultEventPublish, ...TPublish]
    : TrellisHealthDefaultEventPublish;

type WithDefaultHealthUseSpec<TSpec extends TrellisHealthUseSpec | undefined> =
  & (TSpec extends TrellisHealthUseSpec ? Omit<TSpec, "events"> : {})
  & {
    events: {
      publish: WithDefaultHealthEventPublish<TSpec>;
      subscribe: TSpec extends { events?: { subscribe?: infer TSubscribe extends readonly string[] } }
        ? TSubscribe
        : readonly [];
    };
  };

type TrellisHealthUseDefaultsFn = <
  const TSpec extends TrellisHealthUseSpec | undefined = undefined,
>(
  spec?: TSpec,
) => ContractDependencyUse<
  typeof baseTrellisHealth.CONTRACT_ID,
  TrellisHealthOwnedApi,
  WithDefaultHealthUseSpec<TSpec>
>;

type TrellisHealthModule = typeof baseTrellisHealth & {
  useDefaults: TrellisHealthUseDefaultsFn;
};

function mergeHealthUseDefaults(
  spec?: TrellisHealthUseSpec,
): TrellisHealthUseSpec {
  const publish = [...DEFAULT_HEALTH_EVENT_PUBLISH];
  for (const key of spec?.events?.publish ?? []) {
    if (!publish.includes(key as (typeof publish)[number])) {
      publish.push(key as (typeof publish)[number]);
    }
  }

  return {
    ...spec,
    events: {
      ...spec?.events,
      publish,
      ...(spec?.events?.subscribe ? { subscribe: [...spec.events.subscribe] } : {}),
    },
  };
}

export const health: TrellisHealthModule = Object.assign(baseTrellisHealth, {
  useDefaults: ((spec?: TrellisHealthUseSpec) => {
    return baseTrellisHealth.use(mergeHealthUseDefaults(spec));
  }) as TrellisHealthUseDefaultsFn,
});

export const CONTRACT_ID = health.CONTRACT_ID;
export const CONTRACT = health.CONTRACT;
export const CONTRACT_DIGEST = health.CONTRACT_DIGEST;
export const API: typeof health.API = health.API;
export const use: typeof health.use = health.use;
export const useDefaults: typeof health.useDefaults = health.useDefaults;
export default health;
