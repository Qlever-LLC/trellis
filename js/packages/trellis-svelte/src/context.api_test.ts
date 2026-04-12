import type { TrellisAPI } from "@qlever-llc/trellis";
import { createAuthState, getTrellis } from "./index.ts";

const auth = createAuthState({
  authUrl: "http://localhost:4000",
  contract: {
    CONTRACT: {
      format: "trellis.contract.v1",
      id: "trellis.svelte.test@v1",
      displayName: "Trellis Svelte Test",
      description: "Type test contract",
      kind: "app",
    },
    CONTRACT_DIGEST: "digest",
    API: {
      trellis: {
        rpc: {},
        operations: {},
        events: {},
        subjects: {},
      } satisfies TrellisAPI,
    },
  },
  loginPath: "/login",
});

const authUrl: string | null = auth.authUrl;
const signInResult: Promise<never> = auth.signIn({ authUrl: "http://localhost:4000", landingPath: "/dashboard" });
const typedTrellis: Promise<unknown> = getTrellis();

void authUrl;
void signInResult;
void typedTrellis;
