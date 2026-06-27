/** Decorative SVG — connected buyers / WiFi audience motif. */
export function CustomerAnalyticsHero({ className }) {
  return (
    <svg
      viewBox="0 0 240 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="120" cy="90" r="72" className="fill-primary/5" />
      <circle cx="120" cy="90" r="48" className="stroke-primary/15" strokeWidth="1.5" strokeDasharray="4 6" />
      <circle cx="120" cy="52" r="18" className="fill-primary/20 stroke-primary/40" strokeWidth="1.5" />
      <circle cx="72" cy="108" r="14" className="fill-emerald-500/20 stroke-emerald-500/40" strokeWidth="1.5" />
      <circle cx="168" cy="108" r="14" className="fill-amber-500/20 stroke-amber-500/40" strokeWidth="1.5" />
      <circle cx="92" cy="138" r="11" className="fill-sky-500/15 stroke-sky-500/30" strokeWidth="1.5" />
      <circle cx="148" cy="138" r="11" className="fill-violet-500/15 stroke-violet-500/30" strokeWidth="1.5" />
      <path
        d="M120 70v12M102 100l-14 4M138 100l14 4M104 128l-6 4M136 128l6 4"
        className="stroke-primary/25"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="120" cy="52" r="6" className="fill-primary/60" />
      <circle cx="72" cy="108" r="4" className="fill-emerald-500/70" />
      <circle cx="168" cy="108" r="4" className="fill-amber-500/70" />
    </svg>
  )
}
