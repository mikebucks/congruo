import { expect, test } from "vitest";
import { packageName } from "./index";

test("exports package name", () => {
  expect(packageName).toBe("@congruo/scoring");
});
