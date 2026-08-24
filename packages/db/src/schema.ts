import type {
  ComponentRef,
  Dimension,
  Loc,
  MappingSetRevision,
  Severity,
  SourceArtifact,
} from "@congruo/core";
import {
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const connections = pgTable("connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  provider: text("provider", { enum: ["figma", "github"] }).notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  keyVersion: integer("key_version").notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Mutable working set, append-only revisions. Current = highest revision.
 * Audit runs freeze one revision id into the snapshot. */
export const mappingSetRevisions = pgTable(
  "mapping_set_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    revision: integer("revision").notNull(),
    data: jsonb("data").notNull().$type<MappingSetRevision>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mapping_rev_unique").on(t.workspaceId, t.revision)],
);

export const auditRuns = pgTable("audit_runs", {
  /** Deterministic: hash(workspace + source versions + config revision).
   * Retries land on the same row — no duplicate snapshots. */
  id: text("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  status: text("status", {
    enum: ["queued", "running", "failed", "cancelled", "succeeded"],
  }).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Immutable. Created only when a run succeeds; never updated. Every column a
 * historical report needs is frozen here or in snapshot-owned child rows. */
export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: text("run_id")
    .notNull()
    .unique()
    .references(() => auditRuns.id),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  schemaVersion: integer("schema_version").notNull(),
  fingerprintVersion: integer("fingerprint_version").notNull(),
  /** Frozen copy, not a reference to the mutable working set. */
  mappingSet: jsonb("mapping_set").notNull().$type<MappingSetRevision>(),
  analyzerConfig: jsonb("analyzer_config")
    .notNull()
    .$type<Record<string, unknown>>(),
  rubric: jsonb("rubric").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const snapshotSources = pgTable("snapshot_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshots.id),
  artifact: jsonb("artifact").notNull().$type<SourceArtifact>(),
});

export const snapshotGraphs = pgTable("snapshot_graphs", {
  snapshotId: uuid("snapshot_id")
    .primaryKey()
    .references(() => snapshots.id),
  graph: jsonb("graph").notNull(),
});

export const findingOccurrences = pgTable("finding_occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshots.id),
  fingerprint: text("fingerprint").notNull(),
  type: text("type").notNull(),
  dimension: text("dimension").notNull().$type<Dimension>(),
  severity: text("severity").notNull().$type<Severity>(),
  subjectRefKey: text("subject_ref_key"),
  subjectRef: jsonb("subject_ref").$type<ComponentRef>(),
  evidence: jsonb("evidence").notNull(),
  locations: jsonb("locations").notNull().$type<Loc[]>(),
  firstSeenSnapshotId: uuid("first_seen_snapshot_id").notNull(),
});

export const scores = pgTable("scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshots.id),
  /** null = system-level rollup. */
  subjectRefKey: text("subject_ref_key"),
  dimension: text("dimension").notNull().$type<Dimension>(),
  /** null = unassessed (dimension not fully evaluated). */
  score: real("score"),
});

export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshots.id),
  tokenHash: text("token_hash").notNull().unique(),
  revokedAt: timestamp("revoked_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
