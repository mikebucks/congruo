export interface BadgeProps {
  /** Badge text. */
  label: string;
  /** Color scheme. */
  tone?: "neutral" | "attention";
}

/** Small status indicator. Documented and storied — the negative control. */
export function Badge({ label, tone = "neutral" }: BadgeProps) {
  return (
    <span className="bg-primary-500 p-100" data-tone={tone}>
      {label}
    </span>
  );
}
