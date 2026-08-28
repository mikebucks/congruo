// Congruo Token Sync — exports the file's complete variables table.
// The Plugin API exposes variable names on EVERY Figma plan; this replaces
// the Enterprise-only REST Variables endpoint.

function rgbaToHex(c) {
  const h = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a !== undefined && c.a < 1 ? `${base}${h(c.a)}` : base;
}

async function resolveValue(variable, depth) {
  if (depth > 6) return undefined;
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId,
  );
  const modeId = collection ? collection.defaultModeId : null;
  const raw =
    modeId !== null && variable.valuesByMode[modeId] !== undefined
      ? variable.valuesByMode[modeId]
      : Object.values(variable.valuesByMode)[0];
  if (raw === undefined) return undefined;
  if (
    typeof raw === "object" &&
    raw !== null &&
    raw.type === "VARIABLE_ALIAS"
  ) {
    const target = await figma.variables.getVariableByIdAsync(raw.id);
    return target ? resolveValue(target, depth + 1) : undefined;
  }
  if (typeof raw === "object" && raw !== null && "r" in raw) {
    return rgbaToHex(raw);
  }
  return String(raw);
}

async function collectVariables() {
  const seen = new Map();

  const add = async (variable) => {
    if (!variable || seen.has(variable.id)) return;
    seen.set(variable.id, {
      id: variable.id,
      key: variable.key || undefined,
      name: variable.name,
      type: variable.resolvedType,
      value: await resolveValue(variable, 0),
    });
  };

  // all local variables
  for (const v of await figma.variables.getLocalVariablesAsync()) {
    await add(v);
  }

  // plus every bound variable in the document (catches library-subscribed)
  figma.ui.postMessage({ kind: "status", text: "scanning document…" });
  const nodes = figma.root.findAll(
    (n) => n.boundVariables && Object.keys(n.boundVariables).length > 0,
  );
  const ids = new Set();
  for (const node of nodes) {
    for (const binding of Object.values(node.boundVariables)) {
      const list = Array.isArray(binding) ? binding : [binding];
      for (const item of list) {
        if (item && item.id) ids.add(item.id);
        else if (item && typeof item === "object") {
          for (const inner of Object.values(item)) {
            if (inner && inner.id) ids.add(inner.id);
          }
        }
      }
    }
    if ("fills" in node && Array.isArray(node.fills)) {
      for (const paint of node.fills) {
        const b = paint.boundVariables && paint.boundVariables.color;
        if (b && b.id) ids.add(b.id);
      }
    }
    if ("strokes" in node && Array.isArray(node.strokes)) {
      for (const paint of node.strokes) {
        const b = paint.boundVariables && paint.boundVariables.color;
        if (b && b.id) ids.add(b.id);
      }
    }
  }
  for (const id of ids) {
    if (!seen.has(id)) {
      await add(await figma.variables.getVariableByIdAsync(id));
    }
  }

  // styles are a separate API from variables — export them with serialized values
  const styles = [];
  for (const st of await figma.getLocalTextStylesAsync()) {
    const lh =
      st.lineHeight && st.lineHeight.unit !== "AUTO"
        ? "/" + Math.round(st.lineHeight.value)
        : "";
    styles.push({
      id: st.id,
      key: st.key || undefined,
      name: st.name,
      type: "TYPOGRAPHY",
      value:
        st.fontName.family +
        " " +
        Math.round(st.fontSize) +
        lh +
        " " +
        st.fontName.style,
    });
  }
  for (const st of await figma.getLocalPaintStylesAsync()) {
    const solid = st.paints.find((p) => p.type === "SOLID");
    styles.push({
      id: st.id,
      key: st.key || undefined,
      name: st.name,
      type: "COLOR",
      value: solid
        ? rgbaToHex(
            solid.opacity !== undefined && solid.opacity < 1
              ? { ...solid.color, a: solid.opacity }
              : solid.color,
          )
        : undefined,
    });
  }
  for (const st of await figma.getLocalEffectStylesAsync()) {
    const kinds = {};
    for (const e of st.effects) kinds[e.type] = (kinds[e.type] || 0) + 1;
    styles.push({
      id: st.id,
      key: st.key || undefined,
      name: st.name,
      type: "EFFECT",
      value: Object.entries(kinds)
        .map(([k, n]) => n + "× " + k.toLowerCase().replace(/_/g, " "))
        .join(", "),
    });
  }
  return [...seen.values()].concat(styles);
}

figma.showUI(__html__, { width: 420, height: 420 });

collectVariables().then((manifest) => {
  figma.ui.postMessage({
    kind: "manifest",
    fileName: figma.root.name,
    manifest,
  });
});

figma.ui.onmessage = (msg) => {
  if (msg.kind === "done") figma.closePlugin(msg.text || "Token sync complete");
};
