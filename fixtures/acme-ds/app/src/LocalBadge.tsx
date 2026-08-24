/** Local non-DS component — counts against coverage. */
export function LocalBadge({ text }: { text: string }) {
  return <span style={{ background: "#123456" }}>{text}</span>;
}
