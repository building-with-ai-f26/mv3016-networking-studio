// Profile pickers shared by Settings and the "Almost set!" welcome screen.
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

export function OrderedMultiSelect({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const id = useId();
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const unselected = options.filter((o) => !value.includes(o));
  return (
    <div>
      <h3 id={`${id}-sel`} style={{ marginBottom: 8 }}>
        Selected {label.toLowerCase()} (priority order)
      </h3>
      {value.length === 0 ? (
        <p className="muted small">None selected. Add at least one below.</p>
      ) : (
        <ol className="ordered" aria-labelledby={`${id}-sel`}>
          {value.map((v, i) => (
            <li key={v}>
              <span className="priority-num" aria-hidden>
                {i + 1}
              </span>
              <span className="name">
                <span className="sr-only">Priority {i + 1}: </span>
                {v}
              </span>
              <button type="button" className="icon-btn" aria-label={`Move ${v} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={16} aria-hidden />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${v} down`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={16} aria-hidden />
              </button>
              <button type="button" className="icon-btn" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      )}
      {unselected.length > 0 && (
        <>
          <p className="small muted" style={{ margin: '4px 0 6px' }} id={`${id}-add`}>
            Add {label.toLowerCase()}:
          </p>
          <div className="chip-row" role="group" aria-labelledby={`${id}-add`}>
            {unselected.map((o) => (
              <button key={o} type="button" className="chip outline" onClick={() => onChange([...value, o])} aria-label={`Add ${o}`}>
                <Plus size={13} aria-hidden /> {o}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function CompanyChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  const add = (e?: FormEvent) => {
    e?.preventDefault();
    const v = draft.trim();
    if (!v) {
      setError('Type a company name first.');
      return;
    }
    if (value.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`${v} is already on your list.`);
      return;
    }
    onChange([...value, v]);
    setDraft('');
    setError('');
  };
  return (
    <div>
      <ul className="chip-row" style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }} aria-label="Target companies">
        {value.map((c) => (
          <li className="chip" key={c}>
            {c}
            <button type="button" className="chip-remove" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter((x) => x !== c))}>
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
        {value.length === 0 && <li className="muted small">No target companies yet.</li>}
      </ul>
      <div className="composer" style={{ maxWidth: 440 }}>
        <label htmlFor={id} className="sr-only">
          Add a target company
        </label>
        <input
          id={id}
          className="input"
          placeholder="Add a company"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn secondary" onClick={() => add()}>
          <Plus size={16} aria-hidden /> Add
        </button>
      </div>
      {error && (
        <p className="field-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
