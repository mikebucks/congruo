import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { BlobStore } from "@congruo/core";

export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    const path = normalize(join(this.root, key));
    if (!path.startsWith(normalize(this.root) + sep)) {
      throw new Error(`blob key escapes store root: ${key}`);
    }
    return path;
  }

  async put(key: string, data: Uint8Array | string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}
