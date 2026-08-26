import { StarIcon } from "@acme/icons";
import { Badge, Banner, Button, Input, Tag } from "@acme/ui";

export function Settings() {
  return (
    <div>
      <Banner message="Changes are saved automatically" tone="info" />
      <StarIcon />
      <Input value="" size="md" isDisabled />
      <Tag label="Pro" tone="success" />
      <Badge label="Beta" />
      <Button variant="primary" label="Save" />
      {/* seeded: raw styled element — coverage denominator */}
      <span style={{ color: "#654321", padding: "4px" }}>unsaved</span>
    </div>
  );
}
