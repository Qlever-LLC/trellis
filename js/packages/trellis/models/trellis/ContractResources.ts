import {
  ContractJobQueueResourceSchema,
  ContractJobsResourceSchema,
  ContractKvResourceSchema,
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  InstalledServiceContractSchema,
  JobsQueueBindingSchema,
  JobsResourceBindingSchema,
  KvResourceBindingSchema,
  ContractStoreResourceSchema,
  StoreResourceBindingSchema,
} from "../../contracts.ts";
import type { Static } from "typebox";

export {
  ContractJobQueueResourceSchema,
  ContractJobsResourceSchema,
  ContractKvResourceSchema,
  ContractStoreResourceSchema,
  ContractResourceBindingsSchema,
  ContractResourcesSchema,
  InstalledServiceContractSchema,
  JobsQueueBindingSchema,
  JobsResourceBindingSchema,
  KvResourceBindingSchema,
  StoreResourceBindingSchema,
};

export type ContractKvResource = Static<typeof ContractKvResourceSchema>;
export type ContractStoreResource = Static<typeof ContractStoreResourceSchema>;
export type ContractJobQueueResource = Static<typeof ContractJobQueueResourceSchema>;
export type ContractJobsResource = Static<typeof ContractJobsResourceSchema>;
export type ContractResources = Static<typeof ContractResourcesSchema>;
export type KvResourceBinding = Static<typeof KvResourceBindingSchema>;
export type StoreResourceBinding = Static<typeof StoreResourceBindingSchema>;
export type JobsQueueBinding = Static<typeof JobsQueueBindingSchema>;
export type JobsResourceBinding = Static<typeof JobsResourceBindingSchema>;
export type ContractResourceBindings = Static<typeof ContractResourceBindingsSchema>;
export type InstalledServiceContract = Static<typeof InstalledServiceContractSchema>;
