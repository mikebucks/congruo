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
  revalidatePath("/components");
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
  revalidatePath("/components");
}

/** Manual assign, from either side: a Figma-only row picks a code
 * counterpart, a code-only row picks a Figma one. The typed name resolves
 * against the candidates the page serialized for that row's opposite side. */
export async function assignMapping(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const subjectSide = String(formData.get("subjectSide")) as "figma" | "code";
  const subjectRef = parseRef(String(formData.get("subjectRef")));
  const typed = String(formData.get("counterpartName")).trim();
  const candidates = JSON.parse(String(formData.get("candidates"))) as {
    name: string;
    ref: ComponentRef;
  }[];
  const hits = candidates.filter((c) => c.name === typed);
  if (hits.length !== 1 || !hits[0]) return; // unknown or ambiguous — no-op
  const counterpart = hits[0].ref;
  const figmaRef = subjectSide === "figma" ? subjectRef : counterpart;
  const codeRef = subjectSide === "figma" ? counterpart : subjectRef;
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    mappings: [
      ...cur.mappings.filter(
        (m) =>
          refKey(m.figmaRef) !== refKey(figmaRef) &&
          refKey(m.codeRef) !== refKey(codeRef),
      ),
      { figmaRef, codeRef, confidence: 1, source: "user", propMappings: [] },
    ],
    unlinked: (cur.unlinked ?? []).filter((k) => k !== refKey(figmaRef)),
  }));
  revalidatePath("/components");
}

export async function ignoreComponent(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const refs = JSON.parse(String(formData.get("refs"))) as ComponentRef[];
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    ignored: [...new Set([...(cur.ignored ?? []), ...refs.map(refKey)])],
  }));
  revalidatePath("/components");
}

export async function unignoreComponent(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const key = String(formData.get("refKey"));
  await saveRevision(workspaceId, (cur) => ({
    ...cur,
    ignored: (cur.ignored ?? []).filter((k) => k !== key),
  }));
  revalidatePath("/components");
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
  revalidatePath("/components");
}
