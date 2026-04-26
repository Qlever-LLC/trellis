import {
  defineAppContract,
  type TrellisConnectionStatus,
} from "@qlever-llc/trellis";
import { Type } from "typebox";
import { auth } from "../../trellis/sdk/auth.ts";
import type { TrellisProviderProps } from "./components/TrellisProvider.types.ts";
import {
  createTrellisApp,
  resolveTrellisAppUrl,
  type TrellisClientFor,
} from "./context.svelte.ts";

const testContract = defineAppContract(
  {
    schemas: {
      Preferences: Type.Object({ theme: Type.String() }),
    },
  },
  (ref) => ({
    id: "trellis.svelte.context-test@v1",
    displayName: "Trellis Svelte Context Test",
    description: "Typecheck the Svelte context public API.",
    uses: {
      auth: auth.useDefaults(),
    },
    state: {
      preferences: { kind: "value", schema: ref.schema("Preferences") },
    },
  }),
);

const app = createTrellisApp({
  contract: testContract,
  trellisUrl: "https://trellis.example",
});
const providerProps: Omit<
  TrellisProviderProps<typeof testContract>,
  "children"
> = {
  trellisApp: app,
};

type GeneratedClient = {
  readonly [K in keyof TrellisClientFor<typeof testContract>]: TrellisClientFor<
    typeof testContract
  >[K];
};

const generatedApp = createTrellisApp<typeof testContract, GeneratedClient>(
  {
    contract: testContract,
    trellisUrl: () => new URL("https://trellis.example"),
  },
);
const generatedProviderProps: Omit<
  TrellisProviderProps<typeof testContract>,
  "children"
> = {
  trellisApp: generatedApp,
};

// @ts-expect-error createTrellisApp requires an options object
const invalidBareContractApp = createTrellisApp(testContract);

const invalidProviderTrellisUrl: Omit<
  TrellisProviderProps<typeof testContract>,
  "children"
> = {
  trellisApp: app,
  // @ts-expect-error provider no longer accepts top-level Trellis URLs
  trellisUrl: "https://trellis.example",
};

const invalidProviderAppProp: Omit<
  TrellisProviderProps<typeof testContract>,
  "children"
> = {
  // @ts-expect-error provider prop is named trellisApp, not app
  app,
};

async function typecheckContextApi(): Promise<void> {
  const trellis: TrellisClientFor<typeof testContract> = app.getTrellis();
  const sameTrellis: TrellisClientFor<typeof testContract> = trellis;
  const connectionStatus: TrellisConnectionStatus = app.getConnection().status;
  const appUrl: string | undefined = resolveTrellisAppUrl(app.trellisUrl);
  const statusPhase: TrellisConnectionStatus["phase"] = connectionStatus.phase;
  // @ts-expect-error context installation is not part of the public app API
  const privateInstaller = app._provide;

  const generatedTrellis: GeneratedClient = generatedApp.getTrellis();
  const generatedConnectionStatus: TrellisConnectionStatus =
    generatedTrellis.connection.status;
  const generatedMe = await generatedTrellis.request("Auth.Me", {}).orThrow();

  const me = await trellis.request("Auth.Me", {}).orThrow();
  const participantKind: "app" | "agent" | "device" | "service" =
    me.participantKind;
  const deviceId: string | undefined = me.device?.deviceId;

  const preferences = await trellis.state.preferences.get().orThrow();
  if (preferences.found) {
    const theme: string = preferences.entry.value.theme;
    // @ts-expect-error declared state values must preserve schema-derived fields
    const missingField: number = preferences.entry.value.missingField;
    void missingField;
    void theme;
  }

  // @ts-expect-error value state stores do not expose map-only list
  const invalidStateList = trellis.state.preferences.list;

  type ClientMethod = Parameters<typeof trellis.request>[0];
  const authMeMethod: ClientMethod = "Auth.Me";
  // @ts-expect-error contract-anchored typing should reject undeclared RPC methods
  const invalidMethod: ClientMethod = "Auth.NotDeclared";
  // @ts-expect-error contract-anchored typing should reject invalid RPC inputs
  const invalidInput = trellis.request("Auth.GetInstalledContract", {});
  // @ts-expect-error contract-anchored typing should reject undeclared RPC methods
  const invalidRpc = trellis.api.rpc.notDeclared;

  void authMeMethod;
  void deviceId;
  void invalidInput;
  void invalidMethod;
  void invalidRpc;
  void invalidStateList;
  void participantKind;
  void sameTrellis;
  void appUrl;
  void statusPhase;
  void privateInstaller;
  void generatedConnectionStatus;
  void generatedMe;
}

void providerProps;
void generatedProviderProps;
void invalidBareContractApp;
void invalidProviderTrellisUrl;
void invalidProviderAppProp;
void typecheckContextApi;
