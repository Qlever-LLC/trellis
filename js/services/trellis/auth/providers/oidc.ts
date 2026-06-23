import { Type } from "typebox";
import { Value } from "typebox/value";
import { OIDCProvider } from "./index.ts";
import type { ProviderLogoutConfig } from "./index.ts";
import type { OAuth2User } from "./oauth2_user.ts";

const OIDCUserInfoSchema = Type.Object({
  sub: Type.String(),
  name: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  email_verified: Type.Optional(Type.Boolean()),
  picture: Type.Optional(Type.String({ format: "url" })),
  updated_at: Type.Optional(Type.String({ format: "date-time" })),
});

type FetchImpl = typeof fetch;

let fetchImpl: FetchImpl = fetch;

export const __testing__ = {
  setFetch(nextFetch: FetchImpl): () => void {
    const previous = fetchImpl;
    fetchImpl = nextFetch;
    return () => {
      fetchImpl = previous;
    };
  },
};

async function discoverUserInfoEndpoint(issuer: string): Promise<string> {
  const config = await discoverOIDCConfiguration(issuer);
  return Value.Parse(
    Type.Object({
      userinfo_endpoint: Type.String({ format: "url" }),
    }),
    config,
  ).userinfo_endpoint;
}

async function discoverOIDCConfiguration(issuer: string): Promise<unknown> {
  const url = new URL("/.well-known/openid-configuration", issuer);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  return await response.json();
}

export class OIDC extends OIDCProvider {
  override name: string;
  override displayName: string;
  override issuer: string;
  override authorizationEndpoint = "";
  override tokenEndpoint = "";
  override scope: string;
  override supportsDiscovery = true;
  override supportsPKCE = true;
  override organization?: string;
  override logout?: ProviderLogoutConfig;

  constructor(opts: {
    name: string;
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectBase: string;
    scopes: string[];
    organization?: string;
    logout?: ProviderLogoutConfig;
  }) {
    super(opts.clientId, opts.clientSecret, opts.redirectBase);
    this.name = opts.name;
    this.displayName = opts.displayName;
    this.issuer = opts.issuer;
    this.scope = opts.scopes.join(" ");
    this.organization = opts.organization;
    this.logout = opts.logout;
  }

  /** Resolve the configured or discovered OIDC end-session endpoint. */
  async getEndSessionEndpoint(): Promise<string | undefined> {
    if (!this.logout?.enabled) return undefined;
    if (this.logout.endpoint) return this.logout.endpoint;
    if (this.logout.mode === "auth0") {
      return new URL("/v2/logout", this.issuer).toString();
    }

    const config = Value.Parse(
      Type.Object({
        end_session_endpoint: Type.Optional(Type.String({ format: "url" })),
      }),
      await discoverOIDCConfiguration(this.issuer),
    );
    return config.end_session_endpoint;
  }

  /** Build a provider logout URL without mutating Trellis session state. */
  async buildLogoutUrl(args: {
    returnTo?: string;
    federated?: boolean;
  } = {}): Promise<string | undefined> {
    if (!this.logout?.enabled) return undefined;
    const endpoint = await this.getEndSessionEndpoint();
    if (!endpoint) return undefined;

    const url = new URL(endpoint);
    url.searchParams.set("client_id", this.clientId);

    if (this.logout.mode === "auth0") {
      if (args.returnTo) url.searchParams.set("returnTo", args.returnTo);
      if (args.federated && this.logout.allowFederated) {
        url.searchParams.set("federated", "");
      }
      return url.toString();
    }

    if (args.returnTo) {
      url.searchParams.set("post_logout_redirect_uri", args.returnTo);
    }
    return url.toString();
  }

  override async getUserInfo(token: string): Promise<OAuth2User> {
    const userInfoEndpoint = await discoverUserInfoEndpoint(this.issuer);
    const response = await fetchImpl(userInfoEndpoint, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = Value.Parse(OIDCUserInfoSchema, await response.json());

    return {
      provider: this.name,
      id: payload.sub,
      name: payload.name ?? payload.email ?? payload.sub,
      email: payload.email ??
        `${this.name}-${payload.sub}@users.noreply.invalid`,
      emailVerified: payload.email_verified ?? false,
      picture: payload.picture,
      updated: payload.updated_at,
    };
  }
}
