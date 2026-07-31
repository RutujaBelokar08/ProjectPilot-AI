export type SimilarityEvidence = {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  metadata: unknown;
};

export type SimilarityMatch = {
  evidenceId: string;
  source: string;
  title: string;
  url: string;
  similarity: number;
  relevance: string;
  matchedTerms: string[];
};

const stopWords = new Set(['about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'been', 'being', 'but', 'can', 'could', 'describe', 'each', 'for', 'from', 'have', 'idea', 'into', 'its', 'more', 'not', 'our', 'project', 'should', 'that', 'the', 'their', 'then', 'there', 'these', 'this', 'through', 'using', 'was', 'were', 'what', 'when', 'which', 'will', 'with', 'would', 'your', 'you', 'build', 'solution', 'provide', 'helps', 'help', 'users']);

function terms(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(word => !stopWords.has(word)) ?? []);
}

function relevance(source: string) {
  if (source === 'github') return 'Implementation and technical approach';
  if (source === 'paper') return 'Research evidence and methodology';
  return 'Related external evidence';
}

/** Local, explainable Sørensen-Dice keyword similarity. */
export function rankSimilarEvidence(project: { title: string; description: string; domain: string }, evidence: SimilarityEvidence[], limit = 8): SimilarityMatch[] {
  const projectTerms = terms(`${project.title} ${project.domain} ${project.description}`);
  return evidence.map(item => {
    const evidenceTerms = terms(`${item.title} ${item.summary ?? ''} ${typeof item.metadata === 'object' ? JSON.stringify(item.metadata) : ''}`);
    const matchedTerms = [...projectTerms].filter(term => evidenceTerms.has(term)).sort();
    const denominator = projectTerms.size + evidenceTerms.size;
    return { evidenceId: item.id, source: item.source, title: item.title, url: item.url, similarity: denominator ? Math.round((2 * matchedTerms.length / denominator) * 100) : 0, relevance: relevance(item.source), matchedTerms: matchedTerms.slice(0, 8) };
  }).sort((a, b) => b.similarity - a.similarity || a.title.localeCompare(b.title)).slice(0, Math.min(Math.max(limit, 1), 20));
}
