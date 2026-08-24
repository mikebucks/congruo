export interface TagProps {
  /** Text shown inside the tag. */
  label: string;
  /** Color treatment. */
  tone?: "neutral" | "success" | "critical";
  /** Seeded issue: declared but never set by any observed usage. */
  rounded?: boolean;
}

export function Tag({ label, tone = "neutral", rounded }: TagProps) {
  return (
    <span
      data-tone={tone}
      style={{
        background: "var(--color-surface)",
        borderRadius: rounded ? "999px" : "var(--radius-100)",
      }}
    >
      {label}
    </span>
  );
}
