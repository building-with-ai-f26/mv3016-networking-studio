// Types for google.mjs so the TypeScript tests can import its pure helpers.
import type { GoogleCalendarEvent } from '../src/types';

export const REDIRECT_URI: string;
export const SCOPES: { signin: string[]; calendar: string[] };
export function parseCookies(header?: string): Record<string, string>;
export function buildAuthUrl(opts: { clientId: string; step: 'signin' | 'calendar'; state: string; loginHint?: string }): string;
export function mapCalendarEvent(e: unknown): GoogleCalendarEvent;
