"use server";

import { randomUUID } from "node:crypto";
import { encryptToken, schema } from "@congruo/db";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { boss, db, encKeys } from "../lib/server";

/** A workspace needs at least one source — Figma, code, or both. Sections
 * left blank are simply not connected. The first audit starts immediately. */
export async function saveConnections(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const keys = encKeys();

  const hasFigma = get("figmaPat") !== "" && get("libraryFileKey") !== "";
  const hasCode = get("repoUrl") !== "" || get("rootDir") !== "";
  if (!hasFigma && !hasCode) return; // nothing to connect

  const [ws] = await db()
    .insert(schema.workspaces)
    .values({ name: get("workspaceName") || "My Design System" })
    .returning();
  if (!ws) throw new Error("workspace creation failed");

  if (hasFigma) {
    await db()
      .insert(schema.connections)
      .values({
        workspaceId: ws.id,
        provider: "figma",
        encryptedToken: encryptToken(get("figmaPat"), keys[1] as Buffer, 1),
        keyVersion: 1,
        config: {
          libraryFileKey: get("libraryFileKey"),
          consumerFileKeys: get("consumerFileKeys")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
  }
  if (hasCode) {
    const dsPackages = [
      { name: get("dsPackageName"), srcGlob: get("dsSrcGlob") },
    ];
    const config = get("repoUrl")
      ? { repoUrl: get("repoUrl"), dsPackages, appGlob: get("appGlob") }
      : {
          rootDir: get("rootDir"),
          repo: get("repo") || "local",
          sha: "local",
          dsPackages,
          appGlob: get("appGlob"),
        };
    await db()
      .insert(schema.connections)
      .values({
        workspaceId: ws.id,
        provider: "github",
        encryptedToken: encryptToken(
          get("githubToken") || "local",
          keys[1] as Buffer,
          1,
        ),
        keyVersion: 1,
        config,
      });
  }

  // onboarding flow: the first audit kicks off in the background right away
  const runId = `run-${randomUUID()}`;
  await db()
    .insert(schema.auditRuns)
    .values({ id: runId, workspaceId: ws.id, status: "queued" });
  await (await boss()).send("audit", { runId });
  redirect("/");
}

export async function cancelRun(formData: FormData) {
  const runId = String(formData.get("runId"));
  await db()
    .update(schema.auditRuns)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(schema.auditRuns.id, runId),
        inArray(schema.auditRuns.status, ["queued", "running"]),
      ),
    );
  redirect("/");
}

export async function startAudit(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId"));
  const runId = `run-${randomUUID()}`;
  await db()
    .insert(schema.auditRuns)
    .values({ id: runId, workspaceId, status: "queued" });
  await (await boss()).send("audit", { runId });
  redirect("/");
}
