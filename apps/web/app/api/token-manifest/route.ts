import { schema } from "@congruo/db";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/server";

interface ManifestEntry {
  id: string;
  key?: string;
  name: string;
  type?: string;
  value?: string;
}

// the plugin UI posts from Figma's sandboxed iframe — CORS must allow it
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Receives the token manifest from the Congruo Figma plugin (or any tool
 * producing the same shape) and stores it on the Figma connection. */
export async function POST(req: Request) {
  let body: { manifest?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "invalid JSON" },
      { status: 400, headers: CORS },
    );
  }
  const manifest = body.manifest;
  if (
    !Array.isArray(manifest) ||
    !manifest.every(
      (e): e is ManifestEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as ManifestEntry).id === "string" &&
        typeof (e as ManifestEntry).name === "string",
    )
  ) {
    return Response.json(
      { error: "manifest must be an array of {id, name, …}" },
      { status: 400, headers: CORS },
    );
  }

  const conn = await db().query.connections.findFirst({
    where: eq(schema.connections.provider, "figma"),
  });
  if (!conn) {
    return Response.json(
      { error: "no figma connection" },
      { status: 404, headers: CORS },
    );
  }
  await db()
    .update(schema.connections)
    .set({ config: { ...conn.config, tokenManifest: manifest } })
    .where(eq(schema.connections.id, conn.id));
  return Response.json({ count: manifest.length }, { headers: CORS });
}
