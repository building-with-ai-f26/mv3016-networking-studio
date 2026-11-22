// Types for brief.mjs so the TypeScript tests can import it.
import type { AiBrief, AiEventInput } from '../src/types';

export const LIMITS: Record<keyof AiEventInput, number>;
export const MAX_ATTACHMENT_BASE64: number;
export interface BriefAttachment { mimeType: 'application/pdf'; data: string; name: string }
export function validateEventInput(body: unknown): { event: AiEventInput; attachment?: BriefAttachment; error?: undefined } | { error: string; event?: undefined; attachment?: undefined };
export const BRIEF_SCHEMA: Record<string, unknown>;
export function buildUserPrompt(event: AiEventInput): string;
export function buildGeminiRequest(event: AiEventInput, opts: { model: string; maxOutputTokens: number; attachment?: BriefAttachment }): {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
  generationConfig: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
};
export function parseGeminiResponse(data: unknown): { brief: AiBrief & { questionCount?: number }; usage: { inputTokens: number; outputTokens: number; searches: number } };
export function estimateCostUsd(usage: { inputTokens: number; outputTokens: number; searches?: number }, prices: { inputPerMillion: number; outputPerMillion: number }): number;

export interface FollowUpInput { event: AiEventInput; brief: AiBrief; existing: string[]; messages: Array<{ role: 'user' | 'assistant'; text: string }> }
export function briefContext(event: AiEventInput, brief: AiBrief): string;
export function validateFollowUp(body: unknown): { input: FollowUpInput; error?: undefined } | { error: string; input?: undefined };
export function buildMoreQuestionsRequest(input: FollowUpInput, opts: { model: string }): { contents: Array<{ parts: Array<{ text: string }> }>; generationConfig: Record<string, unknown> };
export function parseMoreQuestions(data: unknown, existing?: string[]): { questions: Array<{ theme: string; question: string }>; usage: { inputTokens: number; outputTokens: number } };
export function buildChatRequest(input: FollowUpInput, opts: { model: string }): { contents: Array<{ role: string; parts: Array<{ text: string }> }>; systemInstruction: { parts: Array<{ text: string }> }; generationConfig: Record<string, unknown> };
export function parseChat(data: unknown): { reply: string; usage: { inputTokens: number; outputTokens: number } };
