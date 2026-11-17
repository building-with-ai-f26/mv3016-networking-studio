// Types for extract.mjs so the TypeScript tests can import it.
export interface ExtractInput { title: string; description: string; location: string; organizer: string; studentNames: string[]; schoolDomains: string[]; attendees: Array<{ name: string; domain: string }> }
export interface Extracted { people: Array<{ name: string; role: string; company: string; source: string }>; companies: Array<{ name: string; source: string }>; topic: string }
export const EXTRACT_SCHEMA: Record<string, unknown>;
export function validateExtractInput(body: unknown): { input: ExtractInput; error?: undefined } | { error: string; input?: undefined };
export function buildExtractRequest(input: ExtractInput, opts: { model: string }): { contents: Array<{ parts: Array<{ text: string }> }>; systemInstruction: { parts: Array<{ text: string }> }; generationConfig: Record<string, unknown> };
export function parseExtractResponse(data: unknown, input?: ExtractInput): { result: Extracted; usage: { inputTokens: number; outputTokens: number } };
