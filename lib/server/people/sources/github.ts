import type { PeopleSearchPlan, PersonCandidate } from "@/lib/people";
import type { SocialNetwork } from "@/lib/types";
import { isValidEmail, socialNetworkOf } from "@/lib/server/contact-scrape";
import { mapLimit, withTimeout } from "./serper";

const GITHUB_TIMEOUT_MS = 12_000;
const CONCURRENCY = 3;

type GithubUser = { login: string; html_url: string; name?: string | null; bio?: string | null; location?: string | null; email?: string | null; blog?: string | null; twitter_username?: string | null; company?: string | null; type?: string };

function headers(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "leadta-people-search",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Perfil público → candidato. Pura: la usa el self-check. */
export function candidateFromGithubUser(user: GithubUser, role: string): PersonCandidate {
  const email = user.email && isValidEmail(user.email) ? user.email : "";
  const blog = (user.blog ?? "").trim();
  const website = blog && !/^https?:\/\//i.test(blog) ? `https://${blog}` : blog;
  const socialProfiles: Partial<Record<SocialNetwork, string>> = {};
  const network = website ? socialNetworkOf(website) : null;
  if (network) socialProfiles[network] = website;
  return {
    name: (user.name || user.login).slice(0, 120),
    role: (user.bio || role).replace(/\s+/g, " ").trim().slice(0, 120),
    location: (user.location ?? "").slice(0, 160),
    phone: "",
    whatsapp: "",
    email,
    website: network ? "" : website.slice(0, 1000),
    socialProfiles,
    source: "github",
    sourceUrl: user.html_url,
    snippet: [user.bio, user.twitter_username ? `x.com/${user.twitter_username}` : ""].filter(Boolean).join(" · ").slice(0, 500),
    isBusiness: user.type === "Organization",
  };
}

const rateLimited = (response: Response) => response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");

export async function searchGithub(plan: PeopleSearchPlan, opts: { signal?: AbortSignal; limit?: number }): Promise<PersonCandidate[]> {
  if (!plan.githubQuery) return [];
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 30);
  const q = `${plan.githubQuery} type:user`.slice(0, 256);
  const search = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=${limit}`, {
    headers: headers(),
    cache: "no-store",
    signal: withTimeout(GITHUB_TIMEOUT_MS, opts.signal),
  });
  if (rateLimited(search)) return [];
  if (!search.ok) throw new Error(`GitHub search responded ${search.status}`);
  const { items = [] } = await search.json() as { items?: { login: string; url: string }[] };

  // Perfiles uno por uno (email/blog solo vienen en /users/:login). Si el rate limit se agota, cortamos ahí.
  let exhausted = false;
  const users = await mapLimit(items.slice(0, limit), CONCURRENCY, async (item) => {
    if (exhausted || opts.signal?.aborted) return null;
    try {
      const response = await fetch(`https://api.github.com/users/${encodeURIComponent(item.login)}`, { headers: headers(), cache: "no-store", signal: withTimeout(GITHUB_TIMEOUT_MS, opts.signal) });
      if (rateLimited(response)) { exhausted = true; return null; }
      if (response.headers.get("x-ratelimit-remaining") === "0") exhausted = true;
      return response.ok ? await response.json() as GithubUser : null;
    } catch {
      return null;
    }
  });
  return users.filter((user): user is GithubUser => user !== null).map((user) => candidateFromGithubUser(user, plan.role));
}
