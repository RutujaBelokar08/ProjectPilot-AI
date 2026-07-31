export type BrowserPaper = {
  externalId: string;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: string | null;
  metadata: { authors: string[]; citationCount: number; doi: string; fullTextUrl: string | null; provider: 'crossref' };
};

function dateFromParts(value?: { 'date-parts'?: number[][] }) {
  const parts = value?.['date-parts']?.[0];
  return parts?.[0] ? new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1)).toISOString() : null;
}

/** Uses the browser's network path when the local API cannot reach Crossref. */
export async function searchCrossrefFromBrowser(query: string): Promise<BrowserPaper[]> {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query', query);
  url.searchParams.set('rows', '8');
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Crossref search is temporarily unavailable.');
  const payload = await response.json() as { message?: { items?: any[] } };
  return (payload.message?.items ?? []).flatMap(paper => {
    if (typeof paper.DOI !== 'string') return [];
    const authors = Array.isArray(paper.author) ? paper.author.map((author: any) => author.name ?? [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean) : [];
    return [{
      externalId: paper.DOI,
      title: Array.isArray(paper.title) && paper.title[0] ? paper.title[0] : paper.DOI,
      summary: typeof paper.abstract === 'string' ? paper.abstract.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null,
      url: `https://doi.org/${paper.DOI}`,
      publishedAt: dateFromParts(paper['published-online']) ?? dateFromParts(paper['published-print']) ?? dateFromParts(paper.published),
      metadata: { authors, citationCount: typeof paper['is-referenced-by-count'] === 'number' ? paper['is-referenced-by-count'] : 0, doi: paper.DOI, fullTextUrl: Array.isArray(paper.link) && typeof paper.link[0]?.URL === 'string' ? paper.link[0].URL : null, provider: 'crossref' as const },
    }];
  });
}
