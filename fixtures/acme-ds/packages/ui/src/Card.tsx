import type { ReactNode } from "react";

export interface CardProps {
  title: string;
  padded?: boolean;
  children?: ReactNode;
}

export function Card({ title, padded, children }: CardProps) {
  return (
    <section style={{ padding: padded ? "var(--space-400)" : 0 }}>
      <h2 style={{ color: "var(--color-text)" }}>{title}</h2>
      {children}
    </section>
  );
}
