import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ARTICLE_SIZE, findFreeSlot, layoutCluster } from '../lib/labLayout';
import { STORAGE_KEY } from '../services/storage';
import { renderApp } from './renderApp';

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!);

describe('lab layout', () => {
  it('auto layout has no overlaps for a full cluster', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `a${i}`);
    const pos = Object.values(layoutCluster(ids, {}));
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const overlap = Math.abs(pos[i].x - pos[j].x) < ARTICLE_SIZE.w && Math.abs(pos[i].y - pos[j].y) < ARTICLE_SIZE.h;
        expect(overlap).toBe(false);
      }
  });
  it('a new position avoids user-moved nodes', () => {
    const taken = [{ x: -260, y: -150 }, { x: 250, y: -150 }];
    const slot = findFreeSlot(taken);
    expect(taken.some((t) => t.x === slot.x && t.y === slot.y)).toBe(false);
  });
});

describe('Industry News', () => {
  it('saving adds exactly one Saved card and one Lab node; unsaving removes both', async () => {
    const user = userEvent.setup();
    renderApp('/news');
    const title = 'Example: Small businesses adopt embedded lending inside software tools';
    await user.click(screen.getByRole('button', { name: `Save: ${title}` }));
    expect(screen.getByRole('button', { name: `Unsave: ${title}` })).toBeInTheDocument();
    expect(stored().savedArticleIds.filter((id: string) => id === 'a-fin-3')).toHaveLength(1);
    expect(stored().labPositions['a-fin-3']).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: /Saved/ }));
    expect(screen.getAllByTestId('article-card')).toHaveLength(7);
    expect(screen.getAllByText(title)).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: /Lab/ }));
    await user.click(screen.getByRole('button', { name: 'List view' }));
    const fin = screen.getByRole('region', { name: /Fintech & Payments · 3/ });
    expect(within(fin).getAllByText(title)).toHaveLength(1);

    // Unsave from the Saved tab.
    await user.click(screen.getByRole('tab', { name: /Saved/ }));
    await user.click(screen.getByRole('button', { name: `Unsave: ${title}` }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Lab/ }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(stored().labPositions['a-fin-3']).toBeUndefined();
    await user.click(screen.getByRole('tab', { name: /New/ }));
    expect(screen.getByText(title)).toBeInTheDocument();
  });

  it('keeps the selected tab in the URL and shows the Lab empty state', async () => {
    const user = userEvent.setup();
    renderApp('/news?tab=saved');
    expect(screen.getByRole('tab', { name: /Saved/ })).toHaveAttribute('aria-selected', 'true');
    for (const b of screen.getAllByRole('button', { name: /^Unsave:/ })) await user.click(b);
    await user.click(screen.getByRole('tab', { name: /Lab/ }));
    expect(screen.getByText('Your next conversation starts with a good idea')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Explore news' }));
    expect(screen.getByRole('tab', { name: /New/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens a summary drawer with an honest no-source message', async () => {
    const user = userEvent.setup();
    renderApp('/news');
    await user.click(screen.getAllByRole('button', { name: /^Open summary:/ })[0]);
    const d = screen.getByRole('dialog');
    expect(within(d).getByText('Illustrative article. Original source unavailable in this demo.')).toBeInTheDocument();
    expect(within(d).queryByText('Read full article')).not.toBeInTheDocument();
  });
});
