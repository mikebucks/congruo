import { expect, test } from "vitest";
import { packageName } from "./index.js";

test("exports package name", () => {
  expect(packageName).toBe("@congruo/ingest-code");
});
