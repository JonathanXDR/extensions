import { ApolloClient, HttpLink, InMemoryCache, NormalizedCacheObject } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import fetch from "cross-fetch";

import { getHttpAgent, GitLab } from "./gitlabapi";
import { authorize, refreshToken } from "./oauth";
import { getInstance, getPrefs, isOAuthEnabled, requirePersonalAccessToken } from "./preferences";

/**
 * Resolve the token used for either `Authorization: Bearer ...` (OAuth) or
 * `PRIVATE-TOKEN` (PAT). OAuth triggers the PKCE flow on first use and
 * refreshes transparently. PAT throws a clear preferences error if missing,
 * rather than letting the request fail with an opaque 401.
 */
export async function resolveToken(): Promise<string> {
  if (isOAuthEnabled()) return authorize();
  return requirePersonalAccessToken();
}

export function createGitLabClient(): GitLab {
  return new GitLab(
    getInstance(),
    isOAuthEnabled()
      ? { authType: "oauth", resolve: resolveToken, refresh: refreshToken }
      : { authType: "pat", resolve: resolveToken },
  );
}

export class GitLabGQL {
  public url: string;
  public client: ApolloClient<NormalizedCacheObject>;
  constructor(url: string, client: ApolloClient<NormalizedCacheObject>) {
    this.url = url;
    this.client = client;
  }
  public urlJoin(url: string): string {
    return `${this.url}/${url}`;
  }
}

export function createGitLabGQLClient(): GitLabGQL {
  const instance = getInstance();
  const httpLink = new HttpLink({
    uri: `${instance}/api/graphql`,
    fetch,
    fetchOptions: { agent: getHttpAgent() },
  });

  const authLink = setContext(async (_, prevContext) => {
    const token = await resolveToken();
    return {
      headers: {
        ...(prevContext.headers ?? {}),
        authorization: token ? `Bearer ${token}` : "",
      },
    };
  });

  return new GitLabGQL(
    instance,
    new ApolloClient({
      link: authLink.concat(httpLink),
      cache: new InMemoryCache(),
    }),
  );
}

export const gitlab = createGitLabClient();

const defaultRefreshInterval = 10 * 1000;

let gitlabgql: GitLabGQL | undefined;

export function getGitLabGQL(): GitLabGQL {
  if (!gitlabgql) gitlabgql = createGitLabGQLClient();
  return gitlabgql;
}

export function getCIRefreshInterval(): number | null {
  const userValue = getPrefs().cirefreshinterval;
  if (!userValue || userValue.length <= 0) return defaultRefreshInterval;
  const sec = parseFloat(userValue);
  if (Number.isNaN(sec)) {
    console.log(`invalid value ${userValue}, fallback to null`);
    return null;
  }
  return sec < 1 ? null : sec * 1000; // ms
}

export enum PrimaryAction {
  Detail = "detail",
  Browser = "browser",
}

export function getPrimaryActionPreference(): PrimaryAction {
  const val = getPrefs().primaryaction;
  return val === PrimaryAction.Detail || val === PrimaryAction.Browser ? val : PrimaryAction.Browser;
}

export function getPreferPopToRootPreference(): boolean {
  return getPrefs().poptoroot === true;
}

export function getListDetailsPreference(): boolean {
  return getPrefs().listdetails === true;
}

export function getExcludeTodoAuthorUsernamesPreference(): string[] {
  const raw = getPrefs().excludeTodoAuthorUsernames;
  return raw?.split(",").map((u) => u.trim()) ?? [];
}
