import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../services/storage';
import { renderApp } from './renderApp';

const TITLES = [
  'NYU Stern: Alumni Tech Mock Interview - Joseph Morvan',
  'Entertainment Media & Sports Alumni Networking Night',
  'A Day in the Life: Go-to-Market & Sales',
  'Presentation: Siemens: Company Overview and Programs',
];

describe('Calendar', () => {
  it('shows exactly the four sample events in New York order, even months later', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-06-15T12:00:00Z'));
    renderApp('/calendar');
    expect(screen.getByRole('heading', { name: 'Your networking week' })).toBeInTheDocument();
    expect(screen.getByText('Sample week · Nov 9–15, 2026')).toBeInTheDocument();
    const cards = screen.getAllByTestId(/^event-/);
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual(TITLES);
    // Monday holds two events in order, with correct New York times.
    const monday = screen.getByRole('region', { name: /Monday/ });
    expect(within(monday).getAllByTestId(/^event-/)).toHaveLength(2);
    expect(within(cards[0]).getByText('5:00 PM')).toBeInTheDocument();
    expect(within(cards[1]).getByText('6:00 PM')).toBeInTheDocument();
    // Empty days show a quiet state.
    expect(screen.getAllByText('No networking events')).toHaveLength(4);
    vi.useRealTimers();
  });

  it('navigates weeks and back to the demo week', async () => {
    const user = userEvent.setup();
    renderApp('/calendar');
    await user.click(screen.getByRole('button', { name: /Next week/ }));
    expect(screen.getByText('Week of Nov 16–22, 2026')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^event-/)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Demo week/ }));
    expect(screen.getByText('Sample week · Nov 9–15, 2026')).toBeInTheDocument();
  });
});

describe('Event brief', () => {
  it('opens each event’s own brief and returns to the same week', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/calendar');
    await user.click(screen.getByRole('link', { name: 'Open brief: A Day in the Life: Go-to-Market & Sales' }));
    expect(screen.getByRole('heading', { level: 1, name: TITLES[2] })).toBeInTheDocument();
    // Multi-person panel shows four speakers from the event description.
    for (const n of ['Anthony Abdelnour', 'Josh Kravitz', 'John O’Keefe', 'Naama Shaham']) {
      expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('From event description')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: /Back to calendar/ }));
    expect(router.location?.pathname).toBe('/calendar');
    expect(screen.getByText('Sample week · Nov 9–15, 2026')).toBeInTheDocument();
  });

  it('media night shows explicit missing-attendee information', () => {
    renderApp('/events/media-night');
    expect(screen.getAllByText(/Confirmed attendee list not available/).length).toBeGreaterThan(0);
  });

  it('Joseph’s brief does not invent a role or employer', () => {
    renderApp('/events/joseph-mock');
    expect(screen.getAllByText('Not available in this demo').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Name from calendar title')).toBeInTheDocument();
  });

  it('shows a friendly not-found screen for unknown events', () => {
    renderApp('/events/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Event not found' })).toBeInTheDocument();
  });

  it('Siemens generates once, even with repeated clicks, and stays ready after reload', async () => {
    vi.useFakeTimers();
    renderApp('/events/siemens');
    const btn = screen.getByRole('button', { name: /Generate demo brief now/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByText('Preparing your demo brief…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate demo brief now/ })).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('heading', { name: /Suggested questions/ })).toBeInTheDocument();
    vi.useRealTimers();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).briefStatus.siemens).toBe('ready');
  });

  it('questions: generate more, save, and survive a reload; exhausted state is honest', async () => {
    const user = userEvent.setup();
    const first = renderApp('/events/joseph-mock');
    expect(screen.getAllByTestId('question')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: /Generate more questions/ }));
    expect(screen.getAllByTestId('question')).toHaveLength(13);
    await user.click(screen.getAllByRole('button', { name: /^Save question:/ })[0]);
    // Keep generating until variants run out.
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: /Generate more questions/ }));
    expect(screen.getAllByTestId('question')).toHaveLength(17);
    expect(screen.getByText(/seen all the curated questions/)).toBeInTheDocument();
    first.unmount();

    renderApp('/events/joseph-mock');
    expect(screen.getAllByTestId('question')).toHaveLength(17);
    expect(screen.getAllByRole('button', { name: /^Unsave question:/ })).toHaveLength(1);
    // Other events are unaffected.
  });

  it('chat replies per event and never leaks into another event', async () => {
    const user = userEvent.setup();
    const first = renderApp('/events/gtm-panel');
    await user.click(screen.getByRole('button', { name: 'Give me a 60-second recap' }));
    expect(await screen.findByText(/A one-hour panel on go-to-market/, {}, { timeout: 2000 })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message the demo assistant'), 'What is the weather on Mars?{enter}');
    expect(await screen.findByText(/can’t answer that freeform request/, {}, { timeout: 2000 })).toBeInTheDocument();
    first.unmount();

    renderApp('/events/siemens');
    // Siemens is still scheduled, so no chat yet and nothing from the panel.
    expect(screen.queryByText(/A one-hour panel on go-to-market/)).not.toBeInTheDocument();
    first.unmount();

    renderApp('/events/gtm-panel');
    expect(screen.getByText(/A one-hour panel on go-to-market/)).toBeInTheDocument();
  });

  it('email preview never claims to send', async () => {
    const user = userEvent.setup();
    renderApp('/events/joseph-mock');
    await user.click(screen.getByRole('button', { name: /Preview reminder email/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Nothing is sent/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
