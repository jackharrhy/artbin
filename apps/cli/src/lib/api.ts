import type { Config } from "./config.ts";

export class ApiClient {
  private serverUrl: string;
  private sessionId: string;

  constructor(config: Config) {
    this.serverUrl = config.serverUrl.replace(/\/$/, "");
    this.sessionId = config.sessionId;
  }

  private headers(): Record<string, string> {
    return {
      Cookie: `artbin_session=${this.sessionId}`,
    };
  }

  async whoami(): Promise<{
    user: { id: string; name: string; isAdmin: boolean };
  }> {
    const res = await fetch(`${this.serverUrl}/api/cli/whoami`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`whoami failed (${res.status}): ${body}`);
    }
    return (await res.json()) as { user: { id: string; name: string; isAdmin: boolean } };
  }

  async createFolders(
    folders: { slug: string; name: string; parentSlug?: string | null }[],
  ): Promise<{
    created: { slug: string; id: string }[];
    existing: { slug: string; id: string }[];
  }> {
    const res = await fetch(`${this.serverUrl}/api/cli/folders`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ folders }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Create folders failed (${res.status}): ${body}`);
    }
    return (await res.json()) as {
      created: { slug: string; id: string }[];
      existing: { slug: string; id: string }[];
    };
  }

  async checkManifest(
    parentFolder: string,
    files: { path: string; sha256: string; size: number }[],
  ): Promise<{ newFiles: string[]; existingFiles: string[] }> {
    const res = await fetch(`${this.serverUrl}/api/cli/manifest`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolder, files }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Manifest check failed (${res.status}): ${body}`);
    }
    return (await res.json()) as { newFiles: string[]; existingFiles: string[] };
  }

  async uploadBatch(
    parentFolder: string,
    files: {
      path: string;
      kind: string;
      mimeType: string;
      sha256: string;
      sourceArchive?: string;
      buffer: Buffer;
    }[],
  ): Promise<{
    uploaded: string[];
    errors: { path: string; error: string }[];
  }> {
    const formData = new FormData();

    const metadata = {
      parentFolder,
      files: files.map((f) => ({
        path: f.path,
        kind: f.kind,
        mimeType: f.mimeType,
        sha256: f.sha256,
        sourceArchive: f.sourceArchive,
      })),
    };
    formData.set("metadata", JSON.stringify(metadata));

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const blob = new Blob([f.buffer]);
      const filename = f.path.split("/").pop() || `file_${i}`;
      formData.set(`file_${i}`, blob, filename);
    }

    const res = await fetch(`${this.serverUrl}/api/cli/upload`, {
      method: "POST",
      headers: this.headers(),
      body: formData,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upload failed (${res.status}): ${body}`);
    }
    return (await res.json()) as {
      uploaded: string[];
      errors: { path: string; error: string }[];
    };
  }
}
