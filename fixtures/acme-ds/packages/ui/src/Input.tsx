import { theme } from "./theme";

export interface InputProps {
  /** Current value. */
  value: string;
  /** Seeded: name diverges from Figma's "Disabled" variant (isDisabled↔Disabled). */
  isDisabled?: boolean;
  /** Control height. */
  size?: "sm" | "md" | "lg";
}

export function Input({ value, isDisabled, size = "md" }: InputProps) {
  return (
    <input
      readOnly
      value={value}
      disabled={isDisabled}
      data-size={size}
      style={{ borderColor: theme.colors.border, padding: theme.spacing[size] }}
    />
  );
}
