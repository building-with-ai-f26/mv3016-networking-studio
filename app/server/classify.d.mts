// Types for classify.mjs so the TypeScript tests can import it.
export const TYPES: string[];
export const CLASSIFY_SCHEMA: Record<string, unknown>;
export interface ClassifyInput {
  title: string;
  description: string;
  attendeeCompanies: string[];
  attendeeCount: number;
  targetCompanies: string[];
}
export function validateClassifyInput(body: unknown): { input: ClassifyInput; error?: undefined } | { error: string; input?: undefined };
export function buildClassifyRequest(
  input: ClassifyInput,
  opts: { model: string },
): { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: Record<string, unknown>; systemInstruction: { parts: Array<{ text: string }> } };
export function parseClassifyResponse(data: unknown): {
  result: { type: string; confidence: number; reason: string; company: string; person: string; role: string };
  usage: { inputTokens: number; outputTokens: number };
};
