"use server";

import type { ComponentRef, ComponentStatus, Mapping } from "@congruo/core";
import { refKey } from "@congruo/core";
import { revalidatePath } from "next/cache";
import { saveRevision } from "../../lib/revisions";

function parseRef(json: string): ComponentRef {
  return JSON.parse(json) as ComponentRef;
}

export async function confirmMapping(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const figmaRef = parseRef(String(formData.get("figmaRef")));
  const codeRef = parseRef(String(formData.get("codeRef")));
  const mapping: Mapping = {
    figmaRef,
    codeRef,
    confidence: 1,
    source: "user",
    propMappings: [],
  };
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    mappings: [
      ...cur.mappings.filter((m) => refKey(m.figmaRef) !== refKey(figmaRef)),
      mapping,
    ],
  }));
  revalidatePath("/mapping");
}

export async function unlinkMapping(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const figmaRef = parseRef(String(formData.get("figmaRef")));
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    mappings: cur.mappings.filter(
      (m) => refKey(m.figmaRef) !== refKey(figmaRef),
    ),
    // an explicit user unlink must also veto future auto-matching
    unlinked: [...new Set([...(cur.unlinked ?? []), refKey(figmaRef)])],
  }));
  revalidatePath("/mapping");
}

/** Manual assign: resolves a typed component name against the provided
 * candidates (unpaired code defs, serialized by the page). */
export async function assignMapping(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const figmaRef = parseRef(String(formData.get("figmaRef")));
  const typed = String(formData.get("codeName")).trim();
  const candidates = JSON.parse(String(formData.get("candidates"))) as {
    name: string;
    ref: ComponentRef;
  }[];
  const hits = candidates.filter((c) => c.name === typed);
  if (hits.length !== 1 || !hits[0]) return; // unknown or ambiguous — no-op
  const codeRef = hits[0].ref;
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    mappings: [
      ...cur.mappings.filter((m) => refKey(m.figmaRef) !== refKey(figmaRef)),
      { figmaRef, codeRef, confidence: 1, source: "user", propMappings: [] },
    ],
    unlinked: (cur.unlinked ?? []).filter((k) => k !== refKey(figmaRef)),
  }));
  revalidatePath("/mapping");
}

export async function ignoreComponent(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const refs = JSON.parse(String(formData.get("refs"))) as ComponentRef[];
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    ignored: [...new Set([...(cur.ignored ?? []), ...refs.map(refKey)])],
  }));
  revalidatePath("/mapping");
}

export async function unignoreComponent(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const key = String(formData.get("refKey"));
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    ignored: (cur.ignored ?? []).filter((k) => k !== key),
  }));
  revalidatePath("/mapping");
}

export async function setStatus(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const ref = parseRef(String(formData.get("ref")));
  const status = String(formData.get("status")) as ComponentStatus | "stable";
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    statuses: [
      ...cur.statuses.filter((s) => refKey(s.ref) !== refKey(ref)),
      // "stable" is the default: storing it explicitly is fine and simplest
      { ref, status },
    ],
  }));
  revalidatePath("/mapping");
}
