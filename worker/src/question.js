// Does a comment read like a question? A question mark anywhere, or a question word at the start of the comment or of a
// sentence (English and Swahili). Shared by scripts/qa-sync.mjs (which comments become a published Q&A) and the Worker
// (which comments alert the owner).
const QUESTION = /\?|(^|[.!,\n]\s*)(how|what|why|when|where|which|who|whom|whose|can|could|do|does|did|is|are|am|was|were|will|would|should|may|nini|vipi|je|wapi|lini|nani|kwa nini|naweza|ninawezaje|unaweza|ni\s+(nini|nani|wapi|lini)|inawezekana)\b/i;

export function looksLikeQuestion(text) {
  return typeof text === 'string' && QUESTION.test(text);
}
