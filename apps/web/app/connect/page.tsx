import { saveConnections } from "../actions";

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

export default function Connect() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Connect sources</h1>
      <form action={saveConnections} className="mt-6 space-y-4">
        <Field label="Workspace name" name="workspaceName" placeholder="Acme DS" />
        <h2 className="pt-2 text-sm font-medium text-neutral-500">Figma</h2>
        <Field label="Personal access token" name="figmaPat" type="password" />
        <Field
          label="Library file key"
          name="libraryFileKey"
          placeholder="from figma.com/design/<KEY>/..."
        />
        <Field
          label="Consumer file keys (comma-separated)"
          name="consumerFileKeys"
        />
        <h2 className="pt-2 text-sm font-medium text-neutral-500">Code</h2>
        <Field
          label="Repo checkout path (local)"
          name="rootDir"
          placeholder="/path/to/checkout"
        />
        <Field label="Repo identity" name="repo" placeholder="acme/ui" />
        <Field label="DS package name" name="dsPackageName" placeholder="@acme/ui" />
        <Field
          label="DS source glob"
          name="dsSrcGlob"
          placeholder="packages/ui/src/**/*.{ts,tsx}"
        />
        <Field label="App glob" name="appGlob" placeholder="app/src/**/*.tsx" />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Save connections
        </button>
      </form>
    </main>
  );
}
