export interface ButtonProps {
  /** Visual style of the button. */
  variant: "primary" | "secondary" | "tertiary";
  /** Disables interaction. */
  disabled?: boolean;
  label: string;
}

export function Button({ variant, disabled, label }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        background: "var(--color-primary)",
        padding: "var(--space-200)",
        // seeded issue: hardcoded hex where a token exists
        borderColor: "#ff5733",
      }}
      data-variant={variant}
    >
      {label}
    </button>
  );
}
