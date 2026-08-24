import { expect, test } from "vitest";
import { createFinding } from "./findings";
import type { CodeLoc, ComponentRef } from "./refs";
import { refKey, sameRef } from "./refs";

const button: ComponentRef = {
  kind: "code",
  repo: "acme/ui",
  pkg: "@acme/ui",
  exportSymbol: "Button",
  filePath: "src/Button.tsx",
};

const loc = (line: number, sha: string): CodeLoc => ({
  kind: "code",
  filePath: "src/Button.tsx",
  sha,
  line,
  col: 1,
  endLine: line,
  endCol: 10,
});

test("registry rejects evidence that violates its schema", () => {
  expect(() =>
    createFinding({
      type: "UNUSED_COMPONENT",
      subjectRef: button,
      // @ts-expect-error deliberately wrong shape
      evidence: { instanceCount: "many" },
      locations: [],
    }),
  ).toThrow();
});

test("fingerprints are stable across constructions", () => {
  const make = () =>
    createFinding({
      type: "HARDCODED_VALUE_CODE",
      subjectRef: button,
      evidence: {
        value: "#ff0000",
        property: "background",
        matchingToken: null,
      },
      locations: [loc(10, "aaa")],
    });
  expect(make().fingerprint).toBe(make().fingerprint);
});

test("fingerprints are invariant under location shifts", () => {
  const at = (line: number, sha: string) =>
    createFinding({
      type: "HARDCODED_VALUE_CODE",
      subjectRef: button,
      evidence: {
        value: "#ff0000",
        property: "background",
        matchingToken: null,
      },
      locations: [loc(line, sha)],
    });
  expect(at(10, "aaa").fingerprint).toBe(at(99, "bbb").fingerprint);
});

test("fingerprints differ across types, subjects, and discriminators", () => {
  const base = createFinding({
    type: "HARDCODED_VALUE_CODE",
    subjectRef: button,
    evidence: { value: "#ff0000", property: "background", matchingToken: null },
    locations: [],
  });
  const otherValue = createFinding({
    type: "HARDCODED_VALUE_CODE",
    subjectRef: button,
    evidence: { value: "#00ff00", property: "background", matchingToken: null },
    locations: [],
  });
  const otherSubject = createFinding({
    type: "HARDCODED_VALUE_CODE",
    subjectRef: { ...button, exportSymbol: "Tag" },
    evidence: { value: "#ff0000", property: "background", matchingToken: null },
    locations: [],
  });
  expect(base.fingerprint).not.toBe(otherValue.fingerprint);
  expect(base.fingerprint).not.toBe(otherSubject.fingerprint);
});

test("code ref identity ignores file path and survives moves", () => {
  const moved = { ...button, filePath: "src/buttons/Button.tsx" };
  expect(sameRef(button, moved)).toBe(true);
  expect(refKey(button)).toBe("code:acme/ui#@acme/ui#Button");
});

test("figma ref identity uses the stable component key, not the file", () => {
  const a: ComponentRef = { kind: "figma", fileKey: "f1", componentKey: "k1" };
  const b: ComponentRef = { kind: "figma", fileKey: "f2", componentKey: "k1" };
  const c: ComponentRef = { kind: "figma-node", fileKey: "f1", nodeId: "1:2" };
  expect(sameRef(a, b)).toBe(true);
  expect(sameRef(a, c)).toBe(false);
});
