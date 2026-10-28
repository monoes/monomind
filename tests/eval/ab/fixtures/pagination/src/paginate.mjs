// Returns the items of one page. Pages are 1-based.
export function paginate(items, page, size) {
  const start = (page - 1) * size;
  const end = start + size - 1;
  return items.slice(start, end);
}
