export const SEARCH_PRICE_USD: number;
export function canResearch(event: { company?: string; person?: string }): boolean;
export function buildFactsRequest(event: { title?: string; company?: string; person?: string; role?: string; topic?: string }): any;
export interface WebFacts {
  financialHighlights: Array<{ fact: string; period: string; source: string; refs: number[] }>;
  companyNews: Array<{ headline: string; date: string; source: string; whyItMatters: string; refs: number[] }>;
  peopleWeb: Array<{ name: string; info: string; refs: number[] }>;
  web: { sources: Array<{ uri: string; title: string }>; queries: string[]; suggestionsHtml: string } | null;
  usage: { inputTokens: number; outputTokens: number; searches: number };
}
export function parseFacts(data: any): WebFacts;
export function sanitizeSuggestions(html: string): string;
