import type { Config } from "../../config.ts";
import { GitHub } from "./github.ts";
import type { Provider } from "./index.ts";
import { OIDC } from "./oidc.ts";

export function createProviders(config: Config): Record<string, Provider> {
  return Object.fromEntries(
    Object.entries(config.oauth.providers).map(([key, provider]) => {
      if (provider.type === "github") {
        return [
          key,
          new GitHub(
            provider.clientId,
            provider.clientSecret,
            provider.displayName,
          ),
        ];
      }

      return [
        key,
        new OIDC({
          name: key,
          displayName: provider.displayName,
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          scopes: provider.scopes,
        }),
      ];
    }),
  );
}
