// Helpers for Google Search grounding (used by the AI brief, which searches the web while it is written).
// Google's terms (aistudio.google.com/docs/terms#grounding-with-google-search): show grounded results with their
// Search Suggestions to the user who asked, don't modify them, and don't track clicks on them (the UI marks that
// block ph-no-capture so PostHog ignores it).

/** Conservative cost per Google search: $14 per 1,000 after the monthly free 5,000. */
export const SEARCH_PRICE_USD = 0.014;

/**
 * Google's Search Suggestions come as HTML+CSS. Shown as is, but defensively stripped of anything executable
 * (scripts, event handlers, javascript: links, frames, forms). The page's CSP also blocks inline scripts.
 */
export function sanitizeSuggestions(html) {
  return String(html)
    .slice(0, 30_000)
    .replace(/<\s*(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\s*\/\s*\1\s*>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}
