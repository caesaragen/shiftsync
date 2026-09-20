type IconProps = { readonly className?: string };

const base = "h-4 w-4";

export function DashboardIcon({ className = base }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </svg>
  );
}

export function CalendarIcon({ className = base }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" strokeLinecap="round" />
    </svg>
  );
}

export function LocationIcon({ className = base }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <path d="M10 17.5s6-5.15 6-9.5a6 6 0 1 0-12 0c0 4.35 6 9.5 6 9.5Z" strokeLinejoin="round" />
      <circle cx="10" cy="8" r="2.2" />
    </svg>
  );
}

export function SkillIcon({ className = base }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <path
        d="M10 2.5l2.1 4.35 4.8.65-3.45 3.35.8 4.75L10 13.4l-4.25 2.2.8-4.75L3.1 7.5l4.8-.65L10 2.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StaffIcon({ className = base }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={className}
    >
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 17c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" strokeLinecap="round" />
      <circle cx="14.5" cy="6" r="2" />
      <path d="M13.2 12.7c2.1.3 3.3 1.9 3.3 4.3" strokeLinecap="round" />
    </svg>
  );
}

export function BackIcon({ className = base }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className={className}
    >
      <path d="M12.5 4.5 6 10l6.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
