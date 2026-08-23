import type { Config } from "./config.ts";

export interface FolderSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  parentSlug: string | null;
  fileCount: number;
  childCount: number;
  descendantCount: number;
  totalFileCount: number;
  createdAt: string | null;
}

export interface FolderSource {
  provider: "gamebanana" | "scmapdb" | "direct";
  externalId: string;
  sourceUrl: string;
  title: string;
  author: string | null;
  game: string | null;
}

export interface FolderDetail extends FolderSummary {
  children: FolderSummary[];
  source: FolderSource | null;
}

export interface FolderPlan {
  operation: "rename" | "move";
  from: {
    id: string;
    name: string;
    slug: string;
    parentSlug: string | null;
  };
  to: {
    name: string;
    slug: string;
    parentSlug: string | null;
  };
  affected: {
    folders: number;
    files: number;
  };
  noOp: boolean;
}

export type ManageFolderInput =
  | { operation: "rename"; slug: string; name: string; dryRun: boolean }
  | { operation: "move"; slug: string; destinationSlug: string | null; dryRun: boolean };

export interface ManageFolderResponse {
  success: true;
  dryRun: boolean;
  plan: FolderPlan;
  result?: {
    folder?: {
      id: string;
      name: string;
      slug: string;
      parentId: string | null;
      fileCount: number | null;
    };
    renamedFolders?: number;
    renamedFiles?: number;
    movedFolders?: number;
    movedFiles?: number;
  };
}

function encodeSlugPath(slug: string): string {
  return slug
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

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

  async listFolders(options: { includeSystem?: boolean } = {}): Promise<{
    folders: FolderSummary[];
  }> {
    const url = new URL(`${this.serverUrl}/api/cli/folders`);
    if (options.includeSystem) url.searchParams.set("includeSystem", "true");

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`List folders failed (${res.status}): ${body}`);
    }
    return (await res.json()) as { folders: FolderSummary[] };
  }

  async getFolder(slug: string): Promise<{ folder: FolderDetail }> {
    const url = new URL(`${this.serverUrl}/api/cli/folders`);
    url.searchParams.set("slug", slug);

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Get folder failed (${res.status}): ${body}`);
    }
    return (await res.json()) as { folder: FolderDetail };
  }

  async manageFolder(input: ManageFolderInput): Promise<ManageFolderResponse> {
    const res = await fetch(`${this.serverUrl}/api/cli/folder/manage`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Manage folder failed (${res.status}): ${body}`);
    }
    return (await res.json()) as ManageFolderResponse;
  }

  async downloadFolder(slug: string): Promise<Response> {
    const res = await fetch(`${this.serverUrl}/api/folder/download/${encodeSlugPath(slug)}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Download folder failed (${res.status}): ${body}`);
    }
    return res;
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
      const bytes = new Uint8Array(f.buffer.byteLength);
      bytes.set(f.buffer);
      const blob = new Blob([bytes]);
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

  async finalize(parentFolder: string): Promise<{ finalized: number }> {
    const res = await fetch(`${this.serverUrl}/api/cli/finalize`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolder }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Finalize failed (${res.status}): ${body}`);
    }
    return (await res.json()) as { finalized: number };
  }
}
