# Congruo — Data Handling

One page on what Congruo reads, stores, and never keeps. Written for the
security review at design-system customers.

## What Congruo connects to

- **Figma** — via a personal access token you provide, with read scopes only.
  Congruo fetches the file JSON of the library and consumer files you name.
- **GitHub** — read-only. Repositories are fetched as a single-commit shallow
  clone of the SHA under audit. Only `https://github.com/...` URLs are
  accepted.

## What happens to your source code

- Clones are **ephemeral**: a temporary directory per audit, deleted when
  extraction finishes — on success, failure, or cancellation. The worker also
  sweeps orphaned checkout directories at startup after a crash.
- Congruo **never executes repository code**. No build, no lifecycle scripts;
  dependency installation (when enabled for type resolution) always runs with
  `--ignore-scripts`. Extraction is parse-only (TypeScript compiler API).
- What we retain from code is the **extract**, never the source: component
  names, prop shapes, token references, usage counts, and file/line locations
  used to link findings back to your repository.

## What is stored

- **Snapshots**: immutable audit results — the canonical extract described
  above, findings with evidence, and scores. Stored in Postgres.
- **Raw Figma file JSON**: retained in object storage so an audit can be
  re-examined; contains your design structure, not your product data.
- **Access tokens**: encrypted at rest (AES-256-GCM, versioned keys). Tokens
  never appear in logs or database dumps in plaintext.

## Sharing

- Share links are optional, high-entropy tokens stored **hashed**; they can be
  revoked at any time and are served with `noindex` and `no-store` headers.
- PDF exports are rendered from a single-use share link that is revoked
  immediately after rendering.

## Deletion

Deleting a workspace deletes its snapshots, extracts, raw payloads, findings,
and connections. Nothing derived from your sources is retained afterward.
