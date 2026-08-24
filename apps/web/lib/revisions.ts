import type { MappingSetRevision } from "@congruo/core";
import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import { db } from "./server";

const EMPTY: MappingSetRevision = {
  revision: 0,
  mappings: [],
  statuses: [],
  tokenMappings: [],
};

export async function currentRevision(
  workspaceId: string,
): Promise<MappingSetRevision> {
  const row = await db().query.mappingSetRevisions.findFirst({
    where: eq(schema.mappingSetRevisions.workspaceId, workspaceId),
    orderBy: desc(schema.mappingSetRevisions.revision),
  });
  return row?.data ?? EMPTY;
}

/** Append-only: every edit lands as a new revision. */
export async function saveRevision(
  workspaceId: string,
  mutate: (current: MappingSetRevision) => MappingSetRevision,
): Promise<void> {
  const current = await currentRevision(workspaceId);
  const next = { ...mutate(current), revision: current.revision + 1 };
  await db()
    .insert(schema.mappingSetRevisions)
    .values({ workspaceId, revision: next.revision, data: next });
}
