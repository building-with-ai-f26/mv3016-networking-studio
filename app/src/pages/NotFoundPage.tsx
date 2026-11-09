import { Link } from 'react-router-dom';
import { Illustration } from '../components/Illustration';

export function NotFoundPage({ title = 'Page not found', message = 'This page does not exist in the demo.' }: { title?: string; message?: string }) {
  return (
    <div className="page">
      <div className="card not-found">
        <Illustration kind="lost" />
        <h1>{title}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{message}</p>
        <Link to="/calendar" className="btn" style={{ marginTop: 8 }}>
          Back to your calendar
        </Link>
      </div>
    </div>
  );
}
