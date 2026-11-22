// Types for google.mjs so the TypeScript tests can import its pure helpers.
import type { GoogleCalendarEvent } from '../src/types';

export const REDIRECT_URI: string;
export const SCOPES: { signin: string[]; calendar: string[] };
export function parseCookies(header?: string): Record<string, string>;
export function buildAuthUrl(opts: { clientId: string; step: 'signin' | 'calendar' | 'login' | 'signup'; state: string; loginHint?: string; codeChallenge?: string }): string;
export const SESSION_MAX_AGE_MS: number;
export function sessionExpired(session: { createdAt?: string } | null, now?: number): boolean;
export function mapCalendarEvent(e: unknown): GoogleCalendarEvent;
export function cleanDescription(text?: string): string;
export function nameFromEmail(email?: string): string;
