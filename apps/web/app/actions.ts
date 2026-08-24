"use server";

import { randomUUID } from "node:crypto";
import { encryptToken, schema } from "@congruo/db";
import { redirect } from "next/navigation";
import { boss, db, encKeys } from "../lib/server";

export async function saveConnections(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const keys = encKeys();

  const [ws] = await db()
    .insert(schema.workspaces)
    .values({ name: get("workspaceName") || "My Design System" })
    .returning();
  if (!ws) throw new Error("workspace creation failed");

  await db()
    .insert(schema.connections)
    .values([
      {
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
      },
      {
        workspaceId: ws.id,
        provider: "github",
        encryptedToken: encryptToken(
          get("githubToken") || "local",
          keys[1] as Buffer,
          1,
        ),
        keyVersion: 1,
        config: {
          rootDir: get("rootDir"),
          repo: get("repo"),
          sha: "local",
          dsPackage: { name: get("dsPackageName"), srcGlob: get("dsSrcGlob") },
          appGlob: get("appGlob"),
        },
      },
    ]);
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
