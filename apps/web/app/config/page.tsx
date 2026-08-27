import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Nav } from "../../components/nav";
import { db } from "../../lib/server";
import { cancelRun, saveConnections, startAudit } from "../actions";

export const dynamic = "force-dynamic";

function Field({
  label,
  name,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        name={name}
        type={type}
        placeholder={placeholder}
      />
    </label>
  );
}

export default async function Config() {
  const workspace = await db().query.workspaces.findFirst();

  if (!workspace) {
    return (
      <>
        <Nav active="config" />
        <main className="mx-auto max-w-xl p-8">
          <h1 className="text-2xl font-semibold">Connect sources</h1>
          <p className="mt-2 text-xs text-neutral-500">
            Connect Figma, code, or both — a design system can live on either
            side. The first audit starts as soon as you save.
          </p>
          <form action={saveConnections} className="mt-6 space-y-4">
            <Field
              label="Workspace name"
              name="workspaceName"
              placeholder="Acme DS"
            />
            <h2 className="pt-2 text-sm font-medium text-neutral-500">
              Figma{" "}
              <span className="font-normal text-neutral-400">(optional)</span>
            </h2>
            <Field
              label="Personal access token"
              name="figmaPat"
              type="password"
            />
            <Field
              label="Library file key"
              name="libraryFileKey"
              placeholder="from figma.com/design/<KEY>/..."
            />
            <Field
              label="Consumer file keys (comma-separated)"
              name="consumerFileKeys"
            />
            <h2 className="pt-2 text-sm font-medium text-neutral-500">
              Code{" "}
              <span className="font-normal text-neutral-400">(optional)</span>
            </h2>
            <Field
              label="GitHub repo URL"
              name="repoUrl"
              placeholder="https://github.com/acme/design-system"
            />
            <Field
              label="…or local checkout path"
              name="rootDir"
              placeholder="/path/to/checkout"
            />
            <Field label="Repo identity" name="repo" placeholder="acme/ui" />
            <Field
              label="DS package name"
              name="dsPackageName"
              placeholder="@acme/ui"
            />
            <Field
              label="DS source glob"
              name="dsSrcGlob"
              placeholder="packages/ui/src/**/*.{ts,tsx}"
            />
            <Field
              label="App glob"
              name="appGlob"
              placeholder="app/src/**/*.tsx"
            />
            <button
              type="submit"
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Save and run first audit
            </button>
          </form>
        </main>
      </>
    );
  }

  const connections = await db().query.connections.findMany({
    where: eq(schema.connections.workspaceId, workspace.id),
  });
  const runs = await db().query.auditRuns.findMany({
    where: eq(schema.auditRuns.workspaceId, workspace.id),
    orderBy: desc(schema.auditRuns.createdAt),
    limit: 20,
  });
  const snapshots = await db().query.snapshots.findMany({
    where: eq(schema.snapshots.workspaceId, workspace.id),
  });
  const snapshotByRun = new Map(snapshots.map((s) => [s.runId, s]));

  return (
    <>
      <Nav active="config" />
      <main className="mx-auto max-w-3xl space-y-8 p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{workspace.name}</h1>
          <form action={startAudit}>
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <button
              type="submit"
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Run audit
            </button>
          </form>
        </div>

        <section>
          <h2 className="text-sm font-medium text-neutral-500">Sources</h2>
          <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white text-sm">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
                  {c.provider}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">
                  {c.provider === "figma"
                    ? `library ${c.config.libraryFileKey} · ${((c.config.consumerFileKeys as string[]) ?? []).length} consumer file(s)`
                    : String(
                        (c.config as { repoUrl?: string; rootDir?: string })
                          .repoUrl ??
                          (c.config as { rootDir?: string }).rootDir ??
                          "",
                      )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-medium text-neutral-500">Audit runs</h2>
          <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
            {runs.map((run) => {
              const snap = snapshotByRun.get(run.id);
              return (
                <li
                  key={run.id}
                  className="flex items-center gap-3 p-3 text-sm"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                      run.status === "succeeded"
                        ? "bg-green-100 text-green-800"
                        : run.status === "failed"
                          ? "bg-red-100 text-red-800"
                          : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {run.status}
                  </span>
                  <span className="flex-1 truncate font-mono text-xs text-neutral-500">
                    {run.id}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                  {snap && (
                    <Link
                      className="text-blue-600 underline"
                      href={`/report/${snap.id}`}
                    >
                      report
                    </Link>
                  )}
                  {(run.status === "queued" || run.status === "running") && (
                    <form action={cancelRun}>
                      <input type="hidden" name="runId" value={run.id} />
                      <button
                        type="submit"
                        className="text-xs text-red-700 underline"
                      >
                        cancel
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </>
  );
}
