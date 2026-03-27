import { Type } from "typebox";
import { Value } from "typebox/value";
import { OAuth2Provider } from "./index.ts";
import type { OAuth2User } from "./oauth2_user.ts";

const NullableString = Type.Union([Type.String(), Type.Null()]);

const GitHubUserSchema = Type.Object({
  login: Type.String(),
  id: Type.Number(),
  avatar_url: Type.String({ format: "url" }),
  name: NullableString,
  company: NullableString,
  location: NullableString,
  email: NullableString,
  updated_at: Type.String({ format: "date-time" }),
});

export const __testing__ = {
  GitHubUserSchema,
} as const;

export class GitHub extends OAuth2Provider {
  override name = "github";
  override displayName: string;
  override issuer = "https://github.com";
  override authorizationEndpoint = "https://github.com/login/oauth/authorize";
  override tokenEndpoint = "https://github.com/login/oauth/access_token";
  override scope = "read:user";
  override supportsDiscovery = false;
  override supportsPKCE = true;

  constructor(clientId: string, clientSecret: string, displayName = "GitHub") {
    super(clientId, clientSecret);
    this.displayName = displayName;
  }

  override async getUserInfo(token: string): Promise<OAuth2User> {
    const user = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((r) => Value.Parse(GitHubUserSchema, r));

    return {
      provider: "github",
      id: String(user.id),
      name: user.name ?? user.login,
      email: user.email ?? `github-${user.id}@users.noreply.github.com`,
      emailVerified: false,
      picture: user.avatar_url,
      company: user.company ?? undefined,
      location: user.location ?? undefined,
      updated: user.updated_at,
    };
  }
}
