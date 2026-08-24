import { Button, Card } from "@acme/ui";
import { LocalBadge } from "./LocalBadge";

export function Home() {
  return (
    <div>
      <Card title="Welcome" padded>
        <Button variant="primary" label="Get started" />
        <Button variant="secondary" label="Learn more" disabled />
        <LocalBadge text="beta" />
      </Card>
      {/* second usage, same file: Card is seeded SINGLE_FILE_ADOPTION */}
      <Card title="News">nothing yet</Card>
    </div>
  );
}
