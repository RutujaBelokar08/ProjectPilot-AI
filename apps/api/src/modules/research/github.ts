import { z } from 'zod';

const githubResponseSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    full_name: z.string(),
    description: z.string().nullable(),
    html_url: z.string().url(),
    stargazers_count: z.number(),
    forks_count: z.number(),
    language: z.string().nullable(),
    updated_at: z.string().datetime(),
    owner: z.object({ login: z.string() }),
  })),
});

export type GitHubEvidence = {
  externalId: string;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date;
  metadata: { fullName: string; owner: string; stars: number; forks: number; language: string | null };
};

export class GitHubSearchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GitHubSearchError';
  }
}

export function researchQuery(project: { title: string; domain: string; description: string }) {
  const keywords = project.description
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 4)
    .slice(0, 4)
    .join(' ');
  return `${project.title} ${project.domain} ${keywords}`.trim().slice(0, 220);
}

export async function searchGitHubRepositories(query: string, limit = 8): Promise<GitHubEvidence[]> {
  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', `${query} in:name,description`);
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(Math.min(Math.max(limit, 1), 10)));

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ProjectPilot-AI',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text();
    const detail = body ? ` GitHub responded: ${body.slice(0, 180)}` : '';
    throw new GitHubSearchError(`GitHub search is unavailable.${detail}`, response.status === 403 ? 429 : 502);
  }

  const payload = githubResponseSchema.parse(await response.json());
  return payload.items.map(repository => ({
    externalId: String(repository.id),
    title: repository.full_name,
    summary: repository.description,
    url: repository.html_url,
    publishedAt: new Date(repository.updated_at),
    metadata: {
      fullName: repository.full_name,
      owner: repository.owner.login,
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      language: repository.language,
    },
  }));
}
