import type {
  ClientTrellis,
  RuntimeStateStoresForContract,
  TrellisAPI,
  TrellisConnection,
  TrellisConnectionStatus,
  TrellisContractV1,
} from "@qlever-llc/trellis";
import { createContext } from "svelte";
import { createSubscriber } from "svelte/reactivity";

/** Minimal contract shape required to create a typed Trellis Svelte app context. */
export type TrellisContractLike<TA extends TrellisAPI = TrellisAPI> = {
  CONTRACT: TrellisContractV1;
  CONTRACT_DIGEST: string;
  API: {
    trellis: TA;
  };
};

/** Real connected Trellis client type exposed by a Svelte app context. */
export type TrellisClientFor<TContract extends TrellisContractLike> =
  ClientTrellis<
    TContract["API"]["trellis"],
    RuntimeStateStoresForContract<TContract>
  >;

/** Minimal client surface required for Trellis Svelte context clients. */
export type TrellisContextClient = {
  readonly connection: TrellisConnection;
};

/** Svelte-reactive adapter around a framework-neutral Trellis connection. */
export class SvelteTrellisConnection {
  #connection: TrellisConnection;
  #subscribe: () => void;

  /** Creates a reactive connection adapter for a connected Trellis runtime. */
  constructor(connection: TrellisConnection) {
    this.#connection = connection;
    this.#subscribe = createSubscriber((update) => {
      return this.#connection.subscribe(() => update());
    });
  }

  /** Latest connection status, reactive when read by Svelte effects or markup. */
  get status(): TrellisConnectionStatus {
    this.#subscribe();
    return this.#connection.status;
  }

  /** Closes the underlying Trellis runtime connection. */
  close(): Promise<void> {
    return this.#connection.close();
  }
}

type TrellisAppContext<TClient extends TrellisContextClient> = {
  trellis: TClient;
  connection: SvelteTrellisConnection;
};

const provideTrellisContext = Symbol("provideTrellisContext");
const trellisAppOwnerBrand: unique symbol = Symbol("trellisAppOwner");

/** Minimal branded app owner surface accepted by the Trellis Svelte provider. */
export type TrellisAppOwner<
  TContract extends TrellisContractLike = TrellisContractLike,
> = {
  readonly contract: TContract;
  readonly [trellisAppOwnerBrand]: true;
};

/**
 * Public app-scoped typed Svelte context owner for a Trellis browser app.
 *
 * `TClient` is a type-only facade over the runtime client that `TrellisProvider`
 * installs. Use it with generated client facade types for the same contract.
 */
export interface TrellisApp<
  TContract extends TrellisContractLike = TrellisContractLike,
  TClient extends TrellisContextClient = TrellisClientFor<TContract>,
> extends TrellisAppOwner<TContract> {
  /** Contract used by this app context and by `TrellisProvider` connections. */
  readonly contract: TContract;

  /** Returns the contract-typed connected Trellis client from Svelte context synchronously. */
  getTrellis(): TClient;

  /** Returns a Svelte-reactive adapter for the real Trellis connection. */
  getConnection(): SvelteTrellisConnection;
}

/** Internal app-scoped typed Svelte context implementation. */
class TrellisAppImpl<
  TContract extends TrellisContractLike = TrellisContractLike,
  TClient extends TrellisContextClient = TrellisClientFor<TContract>,
> {
  readonly [trellisAppOwnerBrand] = true as const;
  readonly #contract: TContract;
  readonly #getContext: () => TrellisAppContext<TClient>;
  readonly #setContext: (
    context: TrellisAppContext<TClient>,
  ) => TrellisAppContext<TClient>;

  /** Creates an app-scoped context owner for a specific Trellis contract. */
  constructor(contract: TContract) {
    this.#contract = contract;
    const [getContext, setContext] = createContext<
      TrellisAppContext<TClient>
    >();
    this.#getContext = getContext;
    this.#setContext = setContext;
  }

  /** Contract used by this app context and by `TrellisProvider` connections. */
  get contract(): TContract {
    return this.#contract;
  }

  /** Returns the contract-typed connected Trellis client from Svelte context synchronously. */
  getTrellis(): TClient {
    return this.#getContext().trellis;
  }

  /** Returns a Svelte-reactive adapter for the real Trellis connection. */
  getConnection(): SvelteTrellisConnection {
    return this.#getContext().connection;
  }

  /** Installs the connected Trellis runtime into Svelte context synchronously. */
  [provideTrellisContext](trellis: TrellisContextClient): void {
    this.#setContext({
      trellis: trellis as TClient,
      connection: new SvelteTrellisConnection(trellis.connection),
    });
  }
}

/**
 * Creates an app-scoped typed Svelte context owner for the given Trellis contract.
 *
 * The optional `TClient` type parameter is a type-only facade over the connected
 * runtime client. It should be a generated client facade for `contract`.
 */
export function createTrellisApp<
  TContract extends TrellisContractLike,
  TClient extends TrellisContextClient = TrellisClientFor<TContract>,
>(
  contract: TContract,
): TrellisApp<TContract, TClient> {
  return new TrellisAppImpl<TContract, TClient>(contract);
}

function isTrellisAppImpl(
  app: TrellisAppOwner,
): app is TrellisAppImpl<TrellisContractLike> {
  return app instanceof TrellisAppImpl;
}

/**
 * Internal provider helper that synchronously installs connected Trellis context.
 *
 * This is intentionally not exported from `src/index.ts`.
 */
export function provideConnectedTrellisContext(
  app: TrellisAppOwner,
  trellis: TrellisContextClient,
): void {
  if (!isTrellisAppImpl(app)) {
    throw new TypeError("Expected an app created by createTrellisApp");
  }
  app[provideTrellisContext](trellis);
}
