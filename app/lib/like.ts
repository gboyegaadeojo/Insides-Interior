/** A LIKE pattern matching `query` anywhere; use with ESCAPE '\'. */
export function likeTerm(query: string) {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
