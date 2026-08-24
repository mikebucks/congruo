import type { CanonicalExtract } from "./model.js";

/** Interface only — implementations live in @congruo/db (fs, S3). Defined here
 * so adapters depend on core, never on db. */
export interface BlobStore {
  put(key: string, data: Uint8Array | string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

export interface SourceAdapter<C> {
  extract(config: C, deps: { blobs: BlobStore }): Promise<CanonicalExtract>;
}
