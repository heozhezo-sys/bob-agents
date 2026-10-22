interface BrandProps {
  size?: number;
  wordmark?: boolean;
  subtitle?: boolean;
}

export function Brand({ size = 30, wordmark = true, subtitle = false }: BrandProps) {
  return (
    <span className="brand" aria-label="CUTROOM">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        role="img"
        aria-hidden="true"
        className="brand-mark"
      >
        <rect width="64" height="64" rx="14" fill="currentColor" opacity="0.08" />
        <path d="M17 13h9v38h-9z" fill="#ff8a3d" />
        <path d="M38 13h9v38h-9z" fill="#ff8a3d" opacity="0.5" />
        <path d="M29 23l14 9-14 9z" fill="currentColor" />
      </svg>
      {wordmark ? (
        <span className="brand-text">
          <span className="brand-name">CUTROOM</span>
          {subtitle ? <span className="brand-sub">AI VIDEO AGENT STUDIO</span> : null}
        </span>
      ) : null}
    </span>
  );
}
