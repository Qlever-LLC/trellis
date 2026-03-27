import { Type } from "typebox";
import { Value } from "typebox/value";
import { OIDCProvider } from "./index.ts";
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
  const url = new URL("/.well-known/openid-configuration", issuer);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  const config = Value.Parse(Type.Object({
    userinfo_endpoint: Type.String({ format: "url" }),
  }), await response.json());
  return config.userinfo_endpoint;
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

  constructor(opts: {
    name: string;
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
  }) {
    super(opts.clientId, opts.clientSecret);
    this.name = opts.name;
    this.displayName = opts.displayName;
    this.issuer = opts.issuer;
    this.scope = opts.scopes.join(" ");
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
      email: payload.email ?? `${this.name}-${payload.sub}@users.noreply.invalid`,
      emailVerified: payload.email_verified ?? false,
      picture: payload.picture,
      updated: payload.updated_at,
    };
  }
}
