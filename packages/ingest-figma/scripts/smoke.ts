// Live smoke: real Figma API via .env PAT. Usage: pnpm smoke <fileKey>
import { readFileSync } from "node:fs";
import { FigmaAdapter } from "../src/adapter";

const fileKey = process.argv[2];
if (!fileKey) throw new Error("usage: pnpm smoke <fileKey>");

const env = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
const pat = env.match(/^FIGMA_PAT=(.+)$/m)?.[1]?.trim();
if (!pat) throw new Error("FIGMA_PAT not set in .env");

const blobs = {
  puts: 0,
  async put() {
    blobs.puts++;
  },
  async get() {
    return new Uint8Array();
  },
  async exists() {
    return false;
  },
};

const extract = await new FigmaAdapter().extract(
  { pat, libraryFileKey: fileKey, consumerFileKeys: [] },
  { blobs },
);
console.log(
  `definitions: ${extract.definitions.length}, tokens: ${extract.tokens.length}, ` +
    `diagnostics: ${extract.diagnostics.length}, raw blobs: ${blobs.puts}`,
);
const sample = extract.definitions.find((d) => d.name === "Button");
console.log(
  "Button:",
  JSON.stringify(
    {
      ref: sample?.ref,
      variants: sample?.variants,
      props: sample?.props.map((p) => p.name),
      tokensUsed: sample?.tokensUsed.length,
      hardcoded: sample?.hardcodedValues.length,
    },
    null,
    1,
  ),
);
