import { Button, Card } from "@acme/ui";
import { LocalBadge } from "./LocalBadge.js";

export function Home() {
  return (
    <Card title="Welcome" padded>
      <Button variant="primary" label="Get started" />
      <Button variant="secondary" label="Learn more" disabled />
      <LocalBadge text="beta" />
    </Card>
  );
}
