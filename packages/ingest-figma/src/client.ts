import type { FigmaFile } from "./figma-types";

export class FigmaApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`Figma API ${status} for ${url}: ${body.slice(0, 200)}`);
  }
}

const MAX_RETRIES = 3;

export class FigmaClient {
  constructor(
    private readonly pat: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl = "https://api.figma.com",
  ) {}

  async getFile(fileKey: string): Promise<{ file: FigmaFile; raw: string }> {
    const raw = await this.request(`/v1/files/${fileKey}`);
    return { file: JSON.parse(raw) as FigmaFile, raw };
  }

  private async request(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        headers: { "X-Figma-Token": this.pat },
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      if (!res.ok) throw new FigmaApiError(res.status, url, await res.text());
      return res.text();
    }
  }
}
