export function normalizeSearchTerms(terms: string[]): string[] {
  return terms
    .flatMap((term) => term.split(/\s+/))
    .map((term) => term.trim())
    .filter(Boolean);
}

export function isGlobalQuestion(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    lower.includes('entire') ||
    lower.includes('whole') ||
    lower.includes('overall') ||
    lower.includes('pcap') ||
    lower.includes('capture') ||
    lower.includes('all sessions')
  );
}

export function isDomainLike(term: string): boolean {
  const cleaned = term.toLowerCase().trim();
  return cleaned.includes('.') && !cleaned.includes(' ');
}
