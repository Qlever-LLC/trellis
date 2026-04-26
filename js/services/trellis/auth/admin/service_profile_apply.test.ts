import { assert, assertEquals } from "@std/assert";

import {
  createAuthApplyServiceProfileContractHandler,
  type ServiceProfileStorage,
} from "./service_profile_apply.ts";
import type { ServiceProfile } from "./shared.ts";

class InMemoryServiceProfileStorage implements ServiceProfileStorage {
  #profiles = new Map<string, ServiceProfile>();

  seed(profile: ServiceProfile): void {
    this.#profiles.set(profile.profileId, profile);
  }

  getValue(profileId: string): ServiceProfile | undefined {
    return this.#profiles.get(profileId);
  }

  async get(profileId: string): Promise<ServiceProfile | undefined> {
    await Promise.resolve();
    return this.#profiles.get(profileId);
  }

  async put(profile: ServiceProfile): Promise<void> {
    await Promise.resolve();
    this.#profiles.set(profile.profileId, profile);
  }
}

Deno.test("Auth.ApplyServiceProfileContract refreshes active contracts after persisting profile", async () => {
  const serviceProfileStorage = new InMemoryServiceProfileStorage();
  serviceProfileStorage.seed({
    profileId: "billing.default",
    namespaces: ["billing"],
    disabled: false,
    appliedContracts: [],
  });
  const observedProfiles: ServiceProfile[] = [];

  const handler = createAuthApplyServiceProfileContractHandler({
    serviceProfileStorage,
    installServiceContract: async () => ({
      id: "acme.billing@v1",
      digest: "digest-a",
      displayName: "Billing",
      description: "Billing service",
      usedNamespaces: ["billing", "audit"],
    }),
    refreshActiveContracts: async () => {
      const profile = serviceProfileStorage.getValue("billing.default");
      assert(profile !== undefined);
      observedProfiles.push(profile);
    },
  });

  const result = await handler({
    input: { profileId: "billing.default", contract: {} },
    context: { caller: { type: "user", id: "admin" } },
  });
  assert(!result.isErr());
  const value = result.take() as {
    profile: ServiceProfile;
    contract: { digest: string };
  };

  assertEquals(observedProfiles.length, 1);
  assertEquals(observedProfiles[0], value.profile);
  assertEquals(value.profile.namespaces, ["audit", "billing"]);
  assertEquals(value.profile.appliedContracts, [{
    contractId: "acme.billing@v1",
    allowedDigests: ["digest-a"],
  }]);
});
