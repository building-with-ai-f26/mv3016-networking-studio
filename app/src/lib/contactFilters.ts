// Pure filtering/sorting for the Contacts tracker. All filters combine with AND.
import type { Contact, ReferralStatus } from '../types';

export const REFERRAL_LABEL: Record<ReferralStatus, string> = {
  'not-asked': 'Not asked yet',
  yes: 'Yes',
  no: 'No',
  unknown: 'Unknown',
};

export interface ContactFilters {
  search: string;
  name: string;
  role: string;
  company: string;
  dateFrom: string;
  dateTo: string;
  referral: ReferralStatus | '';
  notes: string;
}

export const EMPTY_FILTERS: ContactFilters = { search: '', name: '', role: '', company: '', dateFrom: '', dateTo: '', referral: '', notes: '' };

export type SortKey = 'name' | 'role' | 'company' | 'lastContact' | 'referral';
export interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.trim().toLowerCase());

export function filterContacts(list: Contact[], f: ContactFilters): Contact[] {
  return list.filter((c) => {
    if (f.search.trim()) {
      const text = [c.name, c.role, c.company, c.notes, REFERRAL_LABEL[c.referral], c.lastContact].join(' ');
      if (!has(text, f.search)) return false;
    }
    if (f.name.trim() && !has(c.name, f.name)) return false;
    if (f.role.trim() && !has(c.role, f.role)) return false;
    if (f.company.trim() && !has(c.company, f.company)) return false;
    if (f.notes.trim() && !has(c.notes, f.notes)) return false;
    if (f.referral && c.referral !== f.referral) return false;
    // A date range excludes contacts with no recorded date.
    if (f.dateFrom && (!c.lastContact || c.lastContact < f.dateFrom)) return false;
    if (f.dateTo && (!c.lastContact || c.lastContact > f.dateTo)) return false;
    return true;
  });
}

export function sortContacts(list: Contact[], s: Sort): Contact[] {
  const dir = s.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = s.key === 'referral' ? REFERRAL_LABEL[a.referral] : a[s.key];
    const vb = s.key === 'referral' ? REFERRAL_LABEL[b.referral] : b[s.key];
    // Blank values always sort last.
    if (!va && vb) return 1;
    if (va && !vb) return -1;
    return va.localeCompare(vb, undefined, { sensitivity: 'base' }) * dir || a.name.localeCompare(b.name);
  });
}

export function activeFilterChips(f: ContactFilters): Array<{ key: keyof ContactFilters; label: string }> {
  const chips: Array<{ key: keyof ContactFilters; label: string }> = [];
  if (f.search.trim()) chips.push({ key: 'search', label: `Search: “${f.search.trim()}”` });
  if (f.name.trim()) chips.push({ key: 'name', label: `Name: ${f.name.trim()}` });
  if (f.role.trim()) chips.push({ key: 'role', label: `Role: ${f.role.trim()}` });
  if (f.company.trim()) chips.push({ key: 'company', label: `Company: ${f.company.trim()}` });
  if (f.dateFrom) chips.push({ key: 'dateFrom', label: `Contacted from ${f.dateFrom}` });
  if (f.dateTo) chips.push({ key: 'dateTo', label: `Contacted until ${f.dateTo}` });
  if (f.referral) chips.push({ key: 'referral', label: `Referral: ${REFERRAL_LABEL[f.referral]}` });
  if (f.notes.trim()) chips.push({ key: 'notes', label: `Notes: ${f.notes.trim()}` });
  return chips;
}
