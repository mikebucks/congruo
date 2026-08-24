export interface BannerProps {
  message: string;
  tone: "info" | "warning" | "critical";
  dismissible?: boolean;
}

export function Banner({ message, tone, dismissible }: BannerProps) {
  return (
    <div role="status" data-tone={tone}>
      {message}
      {dismissible && <button type="button">×</button>}
    </div>
  );
}
