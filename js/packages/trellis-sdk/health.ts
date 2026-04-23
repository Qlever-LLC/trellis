import type { ContractDependencyUse, UseSpec } from "@qlever-llc/trellis/contracts";
import {
  API,
  CONTRACT,
  CONTRACT_DIGEST,
  CONTRACT_ID,
  trellisHealth as baseHealth,
  use,
} from "../../../generated/js/sdks/health/mod.ts";

export * from "../../../generated/js/sdks/health/mod.ts";

const DEFAULT_HEALTH_EVENT_PUBLISH = ["Health.Heartbeat"] as const;

type HealthOwnedApi = typeof API.owned;
type HealthUseSpec = UseSpec<HealthOwnedApi>;
type DefaultHealthEventPublish = typeof DEFAULT_HEALTH_EVENT_PUBLISH;

type WithDefaultHealthEventPublish<TSpec extends HealthUseSpec | undefined> =
  TSpec extends { events?: { publish?: infer TPublish extends readonly string[] } }
    ? readonly [...DefaultHealthEventPublish, ...TPublish]
    : DefaultHealthEventPublish;

type WithDefaultHealthUseSpec<TSpec extends HealthUseSpec | undefined> =
  & (TSpec extends HealthUseSpec ? Omit<TSpec, "events"> : {})
  & {
    events: {
      publish: WithDefaultHealthEventPublish<TSpec>;
      subscribe?: TSpec extends { events?: { subscribe?: infer TSubscribe extends readonly string[] } }
        ? TSubscribe
        : never;
    };
  };

type HealthUseDefaultsFn = <
  const TSpec extends HealthUseSpec | undefined = undefined,
>(
  spec?: TSpec,
) => ContractDependencyUse<typeof CONTRACT_ID, HealthOwnedApi, WithDefaultHealthUseSpec<TSpec>>;

function mergeHealthUseDefaults(spec?: HealthUseSpec): HealthUseSpec {
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

export const useDefaults: HealthUseDefaultsFn = ((spec?: HealthUseSpec) => {
  return use(mergeHealthUseDefaults(spec));
}) as HealthUseDefaultsFn;

export const health = Object.assign(baseHealth, { useDefaults });
export { API, CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use };
