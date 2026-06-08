export function stripDiacritics(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
export function normalizeSearchTerm(term) {
    return stripDiacritics(term.trim().toLowerCase());
}
//# sourceMappingURL=diacritic.js.map