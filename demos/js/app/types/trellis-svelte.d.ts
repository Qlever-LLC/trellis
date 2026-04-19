declare module "@qlever-llc/trellis-svelte" {
  import type { SvelteComponent } from "svelte";
  import type { Snippet } from "svelte";

  export type SignInOptions = {
    authUrl?: string;
    redirectTo?: string;
    landingPath?: string;
    context?: unknown;
  };

  export type AuthStateLike = {
    authUrl: string | null;
    isAuthenticated: boolean;
    init(): Promise<unknown>;
    signIn(options?: SignInOptions): Promise<never>;
    setAuthUrl(authUrl: string): string;
  };

  export function createAuthState(config: {
    authUrl?: string;
    loginPath?: string;
    contract?: unknown;
  }): AuthStateLike;

  export function getTrellis<T = unknown>(): Promise<T>;

  export class TrellisProvider extends SvelteComponent<{
    children: Snippet;
    trellisUrl: string;
    contract: unknown;
    loginPath?: string;
    loading?: Snippet;
  }> {}
}
