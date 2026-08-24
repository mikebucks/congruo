import { Badge } from "./Badge";

export default { title: "Badge", component: Badge };

export const Neutral = () => <Badge label="Beta" />;
export const Attention = () => <Badge label="New" tone="attention" />;
