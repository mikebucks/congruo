// Spike: ts-morph + TypeChecker over the same DS repo.
// Usage: tsx extract-tsmorph.ts <tsconfigPath> <componentFile...>
import { type Node, Project, Symbol as TsSymbol, type Type } from "ts-morph";

const [tsconfigPath, ...files] = process.argv.slice(2);
if (!tsconfigPath || !files.length)
  throw new Error("tsconfig + component files required");

const t0 = Date.now();
const project = new Project({
  tsConfigFilePath: tsconfigPath,
  skipAddingFilesFromTsConfig: true,
});
project.addSourceFilesAtPaths(files);
const checker = project.getTypeChecker();

function propsType(decl: Node): Type | undefined {
  const type = checker.getTypeAtLocation(decl);
  for (const sig of type.getCallSignatures()) {
    const ret = sig.getReturnType().getText();
    if (/Element|ReactNode|ReactElement|null/.test(ret)) {
      const param = sig.getParameters()[0];
      if (param) return checker.getTypeOfSymbolAtLocation(param, decl);
    }
  }
  return undefined;
}

function describe(name: string, props: Type, decl: Node) {
  const members = props.getProperties();
  console.log(`\n=== ${name}: ${members.length} props`);
  for (const m of members.slice(0, 12)) {
    const mType = checker.getTypeOfSymbolAtLocation(m, decl);
    const doc = m
      .getDeclarations()[0]
      ?.getLeadingCommentRanges()
      .map((r) => r.getText())
      .join(" ")
      .replace(/[/*\n\s]+/g, " ")
      .trim();
    const optional = m.isOptional?.() ?? false;
    console.log(
      `  ${m.getName()}${optional ? "?" : ""}: ${mType.getText().slice(0, 100)}  // ${(doc ?? "").slice(0, 60)}`,
    );
  }
}

for (const file of files) {
  const sf = project.getSourceFileOrThrow(file);
  let found = 0;
  for (const [name, decls] of sf.getExportedDeclarations()) {
    for (const decl of decls) {
      const props = propsType(decl);
      if (props) {
        describe(name, props, decl);
        found++;
        break;
      }
    }
  }
  if (!found) console.log(`\n(no components found in ${file})`);
}
console.log(`\ntotal time: ${Date.now() - t0}ms`);
