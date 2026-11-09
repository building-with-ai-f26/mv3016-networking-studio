import { Illustration } from '../components/Illustration';

/** Shown if a screen fails to render. Never shows the raw exception. */
export function ErrorPage() {
  return (
    <div className="page" style={{ padding: 32 }}>
      <div className="card not-found">
        <Illustration kind="lost" />
        <h1>Something went wrong</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          This screen could not be displayed. Your saved demo data is still in this browser.
        </p>
        <a href="/calendar" className="btn">
          Return to Calendar
        </a>
      </div>
    </div>
  );
}
