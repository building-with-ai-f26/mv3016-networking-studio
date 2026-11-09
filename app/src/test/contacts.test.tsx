import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { filterContacts, EMPTY_FILTERS, sortContacts } from '../lib/contactFilters';
import { SEED_CONTACTS } from '../data/seed';
import { renderApp } from './renderApp';

describe('contact filter logic', () => {
  it('combines filters with AND and handles blank dates', () => {
    const f = { ...EMPTY_FILTERS, company: 'cobalt', referral: 'yes' as const };
    expect(filterContacts(SEED_CONTACTS, f).map((c) => c.name)).toEqual(['Sam Whitfield']);
    const range = filterContacts(SEED_CONTACTS, { ...EMPTY_FILTERS, dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(range.map((c) => c.name).sort()).toEqual(['Avery Lindqvist', 'Jordan Okafor']);
    expect(filterContacts(SEED_CONTACTS, { ...EMPTY_FILTERS, notes: 'digital twin', role: 'innovation' })).toHaveLength(1);
    expect(filterContacts(SEED_CONTACTS, { ...EMPTY_FILTERS, search: 'warner' }).map((c) => c.name)).toEqual(['Trip']);
  });
  it('sorts blank last-contact dates last in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const sorted = sortContacts(SEED_CONTACTS, { key: 'lastContact', dir });
      expect(sorted.slice(-3).every((c) => c.lastContact === '')).toBe(true);
    }
  });
});

describe('Contacts page', () => {
  it('shows eight seeded contacts, with real contacts kept blank', () => {
    renderApp('/contacts');
    expect(screen.getByRole('heading', { name: 'Your people' })).toBeInTheDocument();
    expect(screen.getAllByTestId('contact')).toHaveLength(8);
    const joe = screen.getByText('Joe (Yannaphol Kaewbaidhoon)').closest('tr')!;
    expect(within(joe).getByText('Mastercard')).toBeInTheDocument();
    expect(within(joe).getAllByText('Not recorded')).toHaveLength(2);
    expect(within(joe).getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByText('Sample contact')).toHaveLength(6);
  });

  it('filters combine, show chips and count, and Clear restores everything', async () => {
    const user = userEvent.setup();
    renderApp('/contacts');
    await user.type(screen.getByLabelText('Search all contacts'), 'cobalt');
    expect(screen.getAllByTestId('contact')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Open to referral?'), 'yes');
    expect(screen.getAllByTestId('contact')).toHaveLength(1);
    expect(screen.getByText(/Showing/).closest('[role=status]')).toHaveTextContent('Showing 1 of 8 contacts');
    expect(screen.getByText('Referral: Yes')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Notes contain'), 'zzz-nothing');
    expect(screen.getByText(/No contacts match these filters/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(screen.getAllByTestId('contact')).toHaveLength(8);
  });

  it('adds, edits (with validation) and deletes contacts; edits persist after reload', async () => {
    const user = userEvent.setup();
    const first = renderApp('/contacts');
    await user.click(screen.getByRole('button', { name: /Add contact/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add contact' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.');
    await user.type(screen.getByLabelText('Name (required)'), 'Test Person');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add contact' }));
    expect(screen.getAllByTestId('contact')).toHaveLength(9);

    await user.click(screen.getByRole('button', { name: 'Edit Trip' }));
    await user.type(screen.getByLabelText('Role (optional)'), 'A&R');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('A&R')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Hannah Becker' }));
    await user.click(screen.getByRole('button', { name: 'Delete contact' }));
    expect(screen.queryByText('Hannah Becker')).not.toBeInTheDocument();
    first.unmount();

    renderApp('/contacts');
    expect(screen.getAllByTestId('contact')).toHaveLength(8);
    expect(screen.getByText('Test Person')).toBeInTheDocument();
    expect(screen.getByText('A&R')).toBeInTheDocument();
  });

  it('notes drawer saves longer notes', async () => {
    const user = userEvent.setup();
    renderApp('/contacts');
    await user.click(screen.getByRole('button', { name: 'Open notes for Trip' }));
    await user.type(screen.getByLabelText('Conversation notes'), 'Met at the media night.');
    await user.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(screen.getByText('Met at the media night.')).toBeInTheDocument();
  });
});
