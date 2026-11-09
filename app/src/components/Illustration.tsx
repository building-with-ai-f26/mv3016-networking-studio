// Small friendly illustrations made from simple shapes.
type Kind = 'brand' | 'calm-day' | 'idea' | 'lost';

export function Illustration({ kind, size = 72 }: { kind: Kind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 72 72', 'aria-hidden': true as const, focusable: 'false' as const };
  switch (kind) {
    case 'brand':
      return (
        <svg {...common}>
          <rect width="72" height="72" rx="20" fill="#6D46B5" />
          <circle cx="25" cy="29" r="9" fill="#EEE5FF" />
          <circle cx="47" cy="29" r="9" fill="#C4AFF2" />
          <rect x="17" y="45" width="38" height="9" rx="4.5" fill="#DDF2E8" />
        </svg>
      );
    case 'calm-day':
      return (
        <svg {...common}>
          <circle cx="36" cy="36" r="30" fill="#EEE5FF" />
          <circle cx="36" cy="32" r="10" fill="#FFE5D6" />
          <rect x="18" y="46" width="36" height="6" rx="3" fill="#DDF2E8" />
        </svg>
      );
    case 'idea':
      return (
        <svg {...common}>
          <circle cx="36" cy="36" r="30" fill="#EEE5FF" />
          <circle cx="22" cy="40" r="7" fill="#C4AFF2" />
          <circle cx="50" cy="28" r="7" fill="#DDF2E8" />
          <circle cx="46" cy="50" r="6" fill="#FFE5D6" />
          <path d="M22 40 L36 34 L50 28 M36 34 L46 50" stroke="#6D46B5" strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="36" cy="34" r="5" fill="#6D46B5" />
        </svg>
      );
    case 'lost':
      return (
        <svg {...common}>
          <circle cx="36" cy="36" r="30" fill="#FFE5D6" />
          <circle cx="32" cy="32" r="12" fill="none" stroke="#6D46B5" strokeWidth="4" />
          <path d="M41 41 L52 52" stroke="#6D46B5" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
  }
}
