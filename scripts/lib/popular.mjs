// The order of the Popular page. `ranked` is the list of article slugs the readers open most (content/popular.json, written by
// scripts/popular-sync.mjs from the Worker's private counts: only the order, never numbers). It is used only once at least MOST_READ_MIN
// of them are real articles; before that the page keeps its honest old order (editor's picks first, then the newest) and its old wording.
export const MOST_READ_MIN = 5;

export function popularOrder(posts, ranked = []) {
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  const hits = [...new Set(Array.isArray(ranked) ? ranked : [])].map((s) => bySlug.get(s)).filter(Boolean);
  const mostRead = hits.length >= MOST_READ_MIN;
  const rest = mostRead ? posts.filter((p) => !hits.includes(p)) : posts;
  return { mostRead, list: [...(mostRead ? hits : []), ...rest.filter((p) => p.featured), ...rest.filter((p) => !p.featured)] };
}
