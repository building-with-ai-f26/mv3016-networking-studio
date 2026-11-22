export interface ResearchInput {
  title: string;
  company: string;
  person: string;
  role: string;
  topic: string;
  datetime: string;
}
export const SEARCH_PRICE_USD: number;
export function validateResearchInput(body: unknown): { input?: ResearchInput; error?: string };
export function buildResearchRequest(input: ResearchInput): any;
export function parseResearchResponse(data: any): {
  text: string;
  sources: Array<{ uri: string; title: string }>;
  queries: string[];
  suggestionsHtml: string;
  usage: { inputTokens: number; outputTokens: number; searches: number };
};
export function sanitizeSuggestions(html: string): string;
export function researchCostUsd(usage: { inputTokens: number; outputTokens: number; searches: number }, prices: { inputPerMillion: number; outputPerMillion: number }): number;
