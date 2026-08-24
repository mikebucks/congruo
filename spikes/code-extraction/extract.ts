// Spike: react-docgen-typescript over a DS repo.
// Usage: tsx extract.ts <srcDir> [tsconfigPath] [sampleComponent...]
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { withCustomConfig, withDefaultConfig } from "react-docgen-typescript";

const [srcDir, tsconfigPath, ...samples] = process.argv.slice(2);
if (!srcDir) throw new Error("srcDir required");
const sampleNames = samples.length ? samples : ["Button"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.(test|stories|spec)\.tsx$/.test(name))
      out.push(p);
  }
  return out;
}

const files = walk(srcDir);
console.log(`files: ${files.length}`);

const opts = {
  shouldExtractLiteralValuesFromEnum: true,
  shouldRemoveUndefinedFromOptional: true,
  propFilter: (prop: { parent?: { fileName: string } }) =>
    process.env.NOFILTER === "1" ||
    !prop.parent?.fileName.includes("node_modules"),
};
const parser =
  tsconfigPath && tsconfigPath !== "-"
    ? withCustomConfig(tsconfigPath, opts)
    : withDefaultConfig(opts);

const t0 = Date.now();
const docs = parser.parse(files);
const ms = Date.now() - t0;

console.log(`parse time: ${ms}ms`);
console.log(`components found: ${docs.length}`);

const empty = new Set(files);
for (const d of docs) empty.delete(d.filePath!);
console.log(`files yielding no components: ${empty.size}`);

for (const d of docs) {
  const props = Object.values(d.props);
  const anyProps = props.filter((p) => p.type.name === "any");
  if (sampleNames.includes(d.displayName)) {
    console.log(`\n=== ${d.displayName} (${d.filePath})`);
    console.log(`description: ${JSON.stringify(d.description?.slice(0, 120))}`);
    console.log(`props: ${props.length}, any-typed: ${anyProps.length}`);
    for (const p of props.slice(0, 12)) {
      console.log(
        `  ${p.name}${p.required ? "" : "?"}: ${p.type.name.slice(0, 100)}  // ${(p.description ?? "").slice(0, 60)}`,
      );
    }
  }
}

const withAny = docs.filter((d) =>
  Object.values(d.props).some((p) => p.type.name === "any"),
);
console.log(
  `\ncomponents with any-typed props: ${withAny.length}/${docs.length}`,
);
const noProps = docs.filter((d) => Object.keys(d.props).length === 0);
console.log(`components with zero props: ${noProps.length}`);
