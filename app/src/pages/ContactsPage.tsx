import { ArrowDown, ArrowUp, ArrowUpDown, FileText, Pencil, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { activeFilterChips, EMPTY_FILTERS, filterContacts, REFERRAL_LABEL, sortContacts, type ContactFilters, type Sort, type SortKey } from '../lib/contactFilters';
import { formatShortDate } from '../lib/time';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useStore } from '../state/store';
import type { Contact, ReferralStatus } from '../types';

const REFERRALS = Object.keys(REFERRAL_LABEL) as ReferralStatus[];

const initialsOf = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || '?';

function RefBadge({ r }: { r: ReferralStatus }) {
  return <span className={`ref ${r}`}>{REFERRAL_LABEL[r]}</span>;
}

function Blank({ text = 'Not recorded' }: { text?: string }) {
  return <span className="unknown">{text}</span>;
}

// ---------- Add / edit form ----------

function ContactForm({ initial, onSave, onCancel }: { initial: Contact | null; onSave: (c: Contact) => void; onCancel: () => void }) {
  const [c, setC] = useState<Contact>(
    initial ?? { id: `c-${Date.now().toString(36)}`, name: '', role: '', company: '', lastContact: '', referral: 'not-asked', notes: '', isSample: false },
  );
  const [error, setError] = useState('');
  const uid = useId();
  const set = <K extends keyof Contact>(k: K, v: Contact[K]) => setC((x) => ({ ...x, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!c.name.trim()) {
      setError('Name is required.');
      document.getElementById(`${uid}-name`)?.focus();
      return;
    }
    onSave({ ...c, name: c.name.trim(), role: c.role.trim(), company: c.company.trim() });
  };
  return (
    <Dialog title={initial ? 'Edit contact' : 'Add contact'} onClose={onCancel}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${uid}-name`}>Name (required)</label>
          <input
            id={`${uid}-name`}
            className="input"
            value={c.name}
            onChange={(e) => {
              set('name', e.target.value);
              setError('');
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${uid}-err` : undefined}
            required
          />
          {error && (
            <span className="field-error" id={`${uid}-err`} role="alert">
              {error}
            </span>
          )}
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`${uid}-role`}>Role (optional)</label>
            <input id={`${uid}-role`} className="input" value={c.role} onChange={(e) => set('role', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-company`}>Company (optional)</label>
            <input id={`${uid}-company`} className="input" value={c.company} onChange={(e) => set('company', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-date`}>Last contact (optional)</label>
            <input id={`${uid}-date`} type="date" className="input" value={c.lastContact} onChange={(e) => set('lastContact', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-ref`}>Open to referral?</label>
            <select id={`${uid}-ref`} className="select" value={c.referral} onChange={(e) => set('referral', e.target.value as ReferralStatus)}>
              {REFERRALS.map((r) => (
                <option key={r} value={r}>
                  {REFERRAL_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-notes`}>Conversation notes</label>
          <textarea id={`${uid}-notes`} className="textarea" value={c.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn">
            {initial ? 'Save changes' : 'Add contact'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Notes drawer ----------

function NotesDrawer({ contact, onSave, onClose }: { contact: Contact; onSave: (notes: string) => void; onClose: () => void }) {
  const [notes, setNotes] = useState(contact.notes);
  const id = useId();
  return (
    <Dialog
      variant="drawer"
      title={`Notes · ${contact.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => onSave(notes)} disabled={notes === contact.notes}>
            Save notes
          </button>
        </>
      }
    >
      <p className="muted small">
        {[contact.role, contact.company].filter(Boolean).join(' · ') || 'Role and company not recorded'} · Last contact: {formatShortDate(contact.lastContact)}
      </p>
      {contact.isSample && <p className="chip peach small">Sample contact</p>}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor={id}>Conversation notes</label>
        <textarea id={id} className="textarea" style={{ minHeight: 260 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="No notes yet." />
      </div>
    </Dialog>
  );
}

// ---------- Page ----------

export function ContactsPage() {
  const { state, upsertContact, deleteContact } = useStore();
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [editing, setEditing] = useState<Contact | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [notesFor, setNotesFor] = useState<Contact | null>(null);
  const [toast, showToast] = useToast();
  const mobile = useMediaQuery('(max-width: 760px)');
  const uid = useId();

  const results = useMemo(() => sortContacts(filterContacts(state.contacts, filters), sort), [state.contacts, filters, sort]);
  const chips = activeFilterChips(filters);
  const setF = <K extends keyof ContactFilters>(k: K, v: ContactFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const sortHeader = (k: SortKey, label: string) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th key={k} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} scope="col">
        <button type="button" className="sort-btn" onClick={() => toggleSort(k)}>
          {label} <Icon size={13} aria-hidden />
        </button>
      </th>
    );
  };

  const rowActions = (c: Contact) => (
    <div className="row-actions">
      <button type="button" className="icon-btn" aria-label={`Open notes for ${c.name}`} title="Notes" onClick={() => setNotesFor(c)}>
        <FileText size={17} aria-hidden />
      </button>
      <button type="button" className="icon-btn" aria-label={`Edit ${c.name}`} title="Edit" onClick={() => setEditing(c)}>
        <Pencil size={17} aria-hidden />
      </button>
      <button type="button" className="icon-btn" aria-label={`Delete ${c.name}`} title="Delete" onClick={() => setDeleting(c)}>
        <Trash2 size={17} aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your people</h1>
          <p className="subtitle">Keep track of who you met and what comes next.</p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          <Plus size={17} aria-hidden /> Add contact
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <Search size={17} aria-hidden />
          <label htmlFor={`${uid}-search`} className="sr-only">
            Search all contacts
          </label>
          <input id={`${uid}-search`} className="input" type="search" placeholder="Search names, roles, companies, notes…" value={filters.search} onChange={(e) => setF('search', e.target.value)} />
        </div>
        <button type="button" className="btn secondary" aria-expanded={showFilters} aria-controls={`${uid}-filters`} onClick={() => setShowFilters((v) => !v)}>
          <SlidersHorizontal size={16} aria-hidden /> Filters{chips.filter((c) => c.key !== 'search').length ? ` (${chips.filter((c) => c.key !== 'search').length})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="card filters-panel" id={`${uid}-filters`} role="group" aria-label="Column filters">
          <div className="field">
            <label htmlFor={`${uid}-fname`}>Name</label>
            <input id={`${uid}-fname`} className="input" value={filters.name} onChange={(e) => setF('name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-frole`}>Role</label>
            <input id={`${uid}-frole`} className="input" value={filters.role} onChange={(e) => setF('role', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-fcompany`}>Company</label>
            <input id={`${uid}-fcompany`} className="input" value={filters.company} onChange={(e) => setF('company', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-ffrom`}>Last contact from</label>
            <input id={`${uid}-ffrom`} type="date" className="input" value={filters.dateFrom} onChange={(e) => setF('dateFrom', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-fto`}>Last contact to</label>
            <input id={`${uid}-fto`} type="date" className="input" value={filters.dateTo} onChange={(e) => setF('dateTo', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-fref`}>Open to referral?</label>
            <select id={`${uid}-fref`} className="select" value={filters.referral} onChange={(e) => setF('referral', e.target.value as ReferralStatus | '')}>
              <option value="">Any</option>
              {REFERRALS.map((r) => (
                <option key={r} value={r}>
                  {REFERRAL_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-fnotes`}>Notes contain</label>
            <input id={`${uid}-fnotes`} className="input" value={filters.notes} onChange={(e) => setF('notes', e.target.value)} />
          </div>
          {(filters.dateFrom || filters.dateTo) && <p className="muted small">A date range hides contacts with no recorded date.</p>}
        </div>
      )}

      <div className="result-bar">
        <span role="status" aria-live="polite">
          Showing <strong>{results.length}</strong> of {state.contacts.length} contacts
        </span>
        {chips.map((c) => (
          <span className="chip" key={c.key}>
            {c.label}
            <button type="button" className="chip-remove" aria-label={`Remove filter ${c.label}`} onClick={() => setF(c.key, '')}>
              <X size={14} aria-hidden />
            </button>
          </span>
        ))}
        {chips.length > 0 && (
          <button type="button" className="btn ghost small" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <div className="card empty-state" style={{ display: 'block', textAlign: 'center' }}>
          {state.contacts.length === 0 ? (
            <>
              <p>
                <strong>No contacts yet.</strong>
              </p>
              <button type="button" className="btn" onClick={() => setEditing('new')}>
                Add your first contact
              </button>
            </>
          ) : (
            <>
              <p>
                <strong>No contacts match these filters.</strong> Try removing a filter or searching for something shorter.
              </p>
              <button type="button" className="btn secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : mobile ? (
        <div className="contact-cards">
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Sort by</span>
            <select
              className="select"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                setSort({ key, dir });
              }}
            >
              <option value="name:asc">Name (A–Z)</option>
              <option value="company:asc">Company (A–Z)</option>
              <option value="lastContact:desc">Last contact (newest)</option>
              <option value="lastContact:asc">Last contact (oldest)</option>
              <option value="referral:asc">Referral status</option>
            </select>
          </label>
          {results.map((c) => (
            <article className="card contact-card" key={c.id} data-testid="contact">
              <div className="person-cell">
                <span className={c.isSample ? 'initials' : 'initials alt'} aria-hidden>
                  {initialsOf(c.name)}
                </span>
                <div>
                  <h2 style={{ fontSize: 16 }}>{c.name}</h2>
                  {c.isSample && <span className="muted small">Sample contact</span>}
                </div>
              </div>
              <dl>
                <dt>Role</dt>
                <dd>{c.role || <Blank />}</dd>
                <dt>Company</dt>
                <dd>{c.company || <Blank />}</dd>
                <dt>Last contact</dt>
                <dd>{c.lastContact ? formatShortDate(c.lastContact) : <Blank />}</dd>
                <dt>Open to referral?</dt>
                <dd>
                  <RefBadge r={c.referral} />
                </dd>
                <dt>Notes</dt>
                <dd className="notes-preview">{c.notes || <Blank text="No notes" />}</dd>
              </dl>
              {rowActions(c)}
            </article>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <caption className="sr-only">Contacts, sortable by column</caption>
            <thead>
              <tr>
                {sortHeader('name', 'Name')}
                {sortHeader('role', 'Role')}
                {sortHeader('company', 'Company')}
                {sortHeader('lastContact', 'Last contact')}
                {sortHeader('referral', 'Open to referral?')}
                <th scope="col">Conversation notes</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((c) => (
                <tr key={c.id} data-testid="contact">
                  <td>
                    <div className="person-cell">
                      <span className={c.isSample ? 'initials' : 'initials alt'} aria-hidden>
                        {initialsOf(c.name)}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        {c.isSample && <div className="muted small">Sample contact</div>}
                      </div>
                    </div>
                  </td>
                  <td>{c.role || <Blank />}</td>
                  <td>{c.company || <Blank />}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.lastContact ? formatShortDate(c.lastContact) : <Blank />}</td>
                  <td>
                    <RefBadge r={c.referral} />
                  </td>
                  <td className="notes-cell">
                    {c.notes ? (
                      <button type="button" className="sort-btn notes-preview" style={{ textAlign: 'left', textTransform: 'none', letterSpacing: 0 }} onClick={() => setNotesFor(c)}>
                        {c.notes}
                      </button>
                    ) : (
                      <Blank text="No notes" />
                    )}
                  </td>
                  <td>
                    {rowActions(c)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ContactForm
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(c) => {
            upsertContact(c);
            showToast(editing === 'new' ? `${c.name} added` : `Changes to ${c.name} saved`);
            setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete contact?"
          message={
            <p>
              This removes <strong>{deleting.name}</strong> and their notes from this browser. This can’t be undone (except by resetting the demo).
            </p>
          }
          confirmLabel="Delete contact"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            deleteContact(deleting.id);
            showToast(`${deleting.name} deleted`);
            setDeleting(null);
          }}
        />
      )}
      {notesFor && (
        <NotesDrawer
          contact={notesFor}
          onClose={() => setNotesFor(null)}
          onSave={(notes) => {
            upsertContact({ ...notesFor, notes });
            showToast('Notes saved');
            setNotesFor(null);
          }}
        />
      )}
      {toast}
    </div>
  );
}
