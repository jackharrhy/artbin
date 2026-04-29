import * as p from "@clack/prompts";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { loadConfig, saveConfig, getDefaultServerUrl } from "../lib/config.ts";
import { ApiClient } from "../lib/api.ts";

function openBrowser(url: string) {
  const platform = process.platform;
  if (platform === "darwin") exec(`open "${url}"`);
  else if (platform === "win32") exec(`start "" "${url}"`);
  else exec(`xdg-open "${url}"`);
}

export async function login(args: Record<string, unknown>) {
  p.intro("artbin login");

  const serverUrl = (args._ as string[])?.[1] || getDefaultServerUrl();

  const existing = await loadConfig();
  if (existing) {
    const shouldContinue = await p.confirm({
      message: `Already logged in to ${existing.serverUrl}. Re-authenticate?`,
    });
    if (p.isCancel(shouldContinue) || !shouldContinue) {
      p.outro("Cancelled");
      return;
    }
  }

  const sessionId = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Login timed out after 2 minutes"));
    }, 120_000);

    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      if (url.pathname === "/callback") {
        const session = url.searchParams.get("session");
        if (session) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Login successful!</h1><p>You can close this tab.</p></body></html>",
          );
          clearTimeout(timeout);
          server.close();
          resolve(session);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing session parameter");
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        clearTimeout(timeout);
        reject(new Error("Failed to start local server"));
        return;
      }

      const port = addr.port;
      const authorizeUrl = `${serverUrl}/auth/cli/authorize?port=${port}`;

      p.log.info(`Opening browser to authenticate...`);
      p.log.info(`If the browser doesn't open, visit: ${authorizeUrl}`);
      openBrowser(authorizeUrl);
    });
  });

  const spinner = p.spinner();
  spinner.start("Verifying session...");

  const config = { serverUrl, sessionId };
  const api = new ApiClient(config);

  try {
    const { user } = await api.whoami();
    await saveConfig(config);
    spinner.stop(`Logged in as ${user.name}`);
    p.outro("Authentication complete");
  } catch (err) {
    spinner.stop("Verification failed");
    p.log.error(String(err));
    process.exit(1);
  }
}
