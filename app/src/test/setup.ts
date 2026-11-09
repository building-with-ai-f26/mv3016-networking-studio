import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Newer Node versions define their own (empty) global localStorage, which hides jsdom's.
// Point both globals at jsdom's real Storage objects.
const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.scrollTo = () => {};
});
afterEach(() => cleanup());
