// Download an AI brief as Word (.docx) or PDF.
// - Word: built in the browser with the `docx` library, loaded only when the user clicks (keeps the app light).
// - PDF: the browser's print dialog with a print-only layout (Save as PDF). No extra library.
import { allAiQuestions } from '../components/brief/AiBriefDocument';
import type { AiBriefRun, UserEvent } from '../types';
import { formatLongDate, formatTimeRange, tzAbbrev } from './time';

/** A file name like "brief-coffee-chat-with-sam-2026-11-18.docx". */
export function briefFileName(event: UserEvent, ext: string): string {
  const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'event';
  return `brief-${slug}-${event.start.slice(0, 10)}.${ext}`;
}

/** The brief as ordered sections of plain text: one source for the Word file (and easy to test). */
export function briefSections(run: AiBriefRun, event: UserEvent): Array<{ heading: string; paragraphs?: string[]; bullets?: string[]; numbered?: Array<{ theme: string; items: string[] }> }> {
  const b = run.brief;
  const saved = new Set(run.savedQuestions ?? []);
  return [
    {
      heading: '1. Event essentials & what to prepare',
      paragraphs: [b.essentials.summary, b.essentials.goal ? `Your goal: ${b.essentials.goal}` : ''].filter(Boolean),
      bullets: b.essentials.prepareFor,
    },
    {
      heading: '2. People & roles',
      bullets: b.people.length
        ? b.people.map((p) => `${p.name} · ${p.role || 'role not in the event details'} · ${p.company || 'company not in the event details'}${p.howToConnect ? `. How to connect: ${p.howToConnect}` : ''}`)
        : ['No speaker or host is named in this event.'],
    },
    {
      heading: '3. Companies',
      bullets: b.companies.length
        ? b.companies.map((c) => `${c.name}: ${c.overview}${c.businessModel ? ` Business model: ${c.businessModel}` : ''}${c.products.length ? ` Products: ${c.products.map((p) => `${p.name} (${p.whyItMatters})`).join('; ')}` : ''}`)
        : ['No company could be identified from this event.'],
    },
    b.financialHighlights?.length
      ? { heading: '4. Latest financial-report highlights', bullets: [...b.financialHighlights.map((f) => `${f.fact}${f.refs?.length ? ` [${f.refs.map((k) => k + 1).join('][')}]` : ''} (${[f.period, f.source].filter(Boolean).join(', ')})`), ...b.financialsToCheck.map((x) => `Also check: ${x}`)] }
      : { heading: '4. Latest financial-report highlights', paragraphs: ['Not verified: no figures found. Look up:'], bullets: b.financialsToCheck },
    b.companyNews?.length
      ? { heading: '5. Company news (last 3 months)', bullets: [...b.companyNews.map((n) => `${n.headline}${n.refs?.length ? ` [${n.refs.map((k) => k + 1).join('][')}]` : ''} (${[n.date, n.source].filter(Boolean).join(', ')})${n.whyItMatters ? `: ${n.whyItMatters}` : ''}`), ...b.companyNewsToCheck.map((x) => `Also check: ${x}`)] }
      : { heading: '5. Company news (last 3 months)', paragraphs: ['Not verified: no news found. Look up:'], bullets: b.companyNewsToCheck },
    { heading: '6. Industry themes & why they matter', bullets: b.industryThemes.map((t) => `${t.theme}: ${t.whyItMatters}`) },
    {
      heading: '7. Suggested questions',
      numbered: allAiQuestions(run).map((g) => ({ theme: g.theme, items: g.questions.map((q) => (saved.has(q) ? `${q} (saved)` : q)) })),
    },
    {
      heading: '8. Sources & what to verify',
      bullets: [
        event.source === 'google' ? 'Your Google Calendar event (emails, links and numbers removed).' : 'The event details you typed.',
        b.web ? "Google Search results and the model's general knowledge." : "The model's general knowledge (not checked against the web).",
        ...(b.web?.sources ?? []).map((s, i) => `[${i + 1}] ${s.title || 'web page'} — ${s.uri}`),
        ...b.verifyBeforeEvent.map((v) => `Verify: ${v}`),
      ],
    },
  ];
}

export async function downloadBriefDocx(run: AiBriefRun, event: UserEvent): Promise<void> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import('docx');
  const when = `${formatLongDate(event.start)} · ${formatTimeRange(event.start, event.end)} ${tzAbbrev(event.start)}${event.location ? ` · ${event.location}` : ''}`;
  const children = [
    new Paragraph({ text: event.title, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: when, color: '686073' })] }),
    new Paragraph({ children: [new TextRun({ text: 'AI-generated draft (Networking Studio). Check anything marked "Not verified" before the event.', italics: true, color: '7A3A12' })] }),
  ];
  let n = 0;
  for (const s of briefSections(run, event)) {
    children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2, spacing: { before: 240 } }));
    for (const p of s.paragraphs ?? []) children.push(new Paragraph({ text: p }));
    for (const x of s.bullets ?? []) children.push(new Paragraph({ text: x, bullet: { level: 0 } }));
    for (const g of s.numbered ?? []) {
      children.push(new Paragraph({ text: g.theme, heading: HeadingLevel.HEADING_3 }));
      for (const q of g.items) children.push(new Paragraph({ text: `${(n += 1)}. ${q}` }));
    }
  }
  children.push(new Paragraph({ children: [new TextRun({ text: `Model ${run.model} · generated ${new Date(run.generatedAt).toLocaleString('en-US')}`, size: 16, color: '686073' })], spacing: { before: 240 } }));
  const blob = await Packer.toBlob(new Document({ creator: 'Networking Studio', title: event.title, sections: [{ children }] }));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = briefFileName(event, 'docx');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the print dialog with the print layout; the user picks "Save as PDF". */
export function downloadBriefPdf(event: UserEvent): void {
  const previous = document.title;
  document.title = briefFileName(event, 'pdf').replace(/\.pdf$/, ''); // used as the suggested PDF file name
  window.print();
  setTimeout(() => (document.title = previous), 500);
}
