export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeSearchTerm(term: string): string {
  return stripDiacritics(term.trim().toLowerCase());
}
