/** Seeded issue: near-duplicate of Button (the "ButtonNew" redundancy case).
 * Must NOT auto-match to Figma "Button". */
export interface ButtonNewProps {
  variant: "primary" | "secondary";
  disabled?: boolean;
  label: string;
}

export function ButtonNew({ variant, disabled, label }: ButtonNewProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        background: "var(--color-primary)",
        padding: "var(--space-200)",
      }}
      data-variant={variant}
    >
      {label}
    </button>
  );
}
