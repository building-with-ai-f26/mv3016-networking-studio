// Types for brief.mjs so the TypeScript tests can import it.
import type { AiBrief, AiEventInput } from '../src/types';

export const LIMITS: Record<keyof AiEventInput, number>;
export function validateEventInput(body: unknown): { event: AiEventInput; error?: undefined } | { error: string; event?: undefined };
export const BRIEF_SCHEMA: Record<string, unknown>;
export function buildUserPrompt(event: AiEventInput): string;
export function buildGeminiRequest(event: AiEventInput, opts: { model: string; maxOutputTokens: number }): {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig: Record<string, unknown>;
};
export function parseGeminiResponse(data: unknown): { brief: AiBrief; usage: { inputTokens: number; outputTokens: number } };
export function estimateCostUsd(usage: { inputTokens: number; outputTokens: number }, prices: { inputPerMillion: number; outputPerMillion: number }): number;
