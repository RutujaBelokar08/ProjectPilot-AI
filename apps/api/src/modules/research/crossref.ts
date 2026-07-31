import { z } from 'zod';

const dateSchema = z.object({ 'date-parts': z.array(z.array(z.number())).optional() });
const crossrefResponseSchema = z.object({
  message: z.object({
    items: z.array(z.object({
      DOI: z.string(),
      title: z.array(z.string()).default([]),
      abstract: z.string().optional(),
      URL: z.string().url().optional(),
      author: z.array(z.object({ given: z.string().optional(), family: z.string().optional(), name: z.string().optional() })).optional(),
      published: dateSchema.optional(),
      'published-online': dateSchema.optional(),
      'published-print': dateSchema.optional(),
      'is-referenced-by-count': z.number().default(0),
      link: z.array(z.object({ URL: z.string().url() })).optional(),
    })),
  }),
});

export type PaperEvidence = {
  externalId: string;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date | null;
  metadata: { authors: string[]; citationCount: number; doi: string; fullTextUrl: string | null; provider: 'crossref' };
};

export class PaperSearchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PaperSearchError';
  }
}

function dateFromParts(value?: { 'date-parts'?: number[][] }) {
  const parts = value?.['date-parts']?.[0];
  if (!parts?.[0]) return null;
  return new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1));
}

function plainText(value?: string) {
  return value?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

export async function searchResearchPapers(query: string, limit = 8): Promise<PaperEvidence[]> {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query', query);
  url.searchParams.set('rows', String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set('select', 'DOI,title,abstract,URL,author,published,published-online,published-print,is-referenced-by-count,link');
  if (process.env.CROSSREF_MAILTO) url.searchParams.set('mailto', process.env.CROSSREF_MAILTO);

  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ProjectPilot-AI/1.0' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new PaperSearchError(response.status === 429 ? 'Research paper search is temporarily rate-limited. Please try again shortly.' : 'Research paper search is temporarily unavailable. Please try again shortly.', response.status === 429 ? 429 : 502);

  const payload = crossrefResponseSchema.parse(await response.json());
  return payload.message.items.map(paper => {
    const authors = (paper.author ?? []).map(author => author.name ?? [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean);
    const fullTextUrl = paper.link?.[0]?.URL ?? null;
    return {
      externalId: paper.DOI,
      title: paper.title[0] ?? paper.DOI,
      summary: plainText(paper.abstract),
      url: `https://doi.org/${paper.DOI}`,
      publishedAt: dateFromParts(paper['published-online']) ?? dateFromParts(paper['published-print']) ?? dateFromParts(paper.published),
      metadata: { authors, citationCount: paper['is-referenced-by-count'], doi: paper.DOI, fullTextUrl, provider: 'crossref' },
    };
  });
}
