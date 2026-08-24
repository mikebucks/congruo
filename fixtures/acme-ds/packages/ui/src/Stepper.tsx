export interface StepperProps {
  steps: string[];
  active: number;
}

/** Seeded issue: exported but never used anywhere in the app. */
export function Stepper({ steps, active }: StepperProps) {
  return (
    <ol>
      {steps.map((s, i) => (
        <li key={s} aria-current={i === active}>
          {s}
        </li>
      ))}
    </ol>
  );
}
