import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";

import { assetServer } from "../assets.ts";
import { routes } from "../routes.ts";
import { Document } from "./document.tsx";
import { loadFoldersPage } from "../data/folders-page.ts";
import { FoldersPage } from "./folders-page.tsx";
import { loadFilePage } from "../data/file-page.ts";
import { FileRoutePage } from "./file-page.tsx";
import { loadMyUploadsPage } from "../data/my-uploads-page.ts";
import { MyUploadsPage } from "./my-uploads-page.tsx";

export default createController(routes, {
  actions: {
    async assets({ request }) {
      return (await assetServer.fetch(request)) ?? new Response("Not Found", { status: 404 });
    },
    home(context) {
      return redirect(context.user ? routes.folders.href() : routes.login.href(), 302);
    },
    async login(context) {
      const user = context.user;
      if (user) return redirect(routes.folders.href(), 302);

      const errorParam = context.url.searchParams.get("error");
      const errorMessage =
        errorParam === "access_denied"
          ? "Authorization was denied"
          : errorParam
            ? "Login failed. Please try again."
            : null;

      return context.render(
        <Document title="Login - artbin">
          <main className="max-w-[360px] mx-auto mt-16 p-8 bg-bg border border-border">
            <h1 className="text-xl text-center mb-6">Login</h1>
            {errorMessage ? <div className="alert alert-error">{errorMessage}</div> : null}
            <a href={routes.auth.fourm.href()} className="btn btn-primary w-full text-center block">
              Login with 4orm
            </a>
            <p className="mt-4 text-sm text-center text-text-muted">
              You need a 4orm account to use artbin.
            </p>
          </main>
        </Document>,
      );
    },
    async myUploads(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadMyUploadsPage(context.url, context.user.id);
      return context.render(<MyUploadsPage data={data} user={context.user} />);
    },
    async folders(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadFoldersPage(context.url);
      return context.render(<FoldersPage data={data} user={context.user} />);
    },
    async file(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const data = await loadFilePage(context.params.path, context.user);
      if (!data) return new Response("File not found", { status: 404 });
      if (data.page === "wad-redirect") {
        return redirect(routes.folder.index.href({ path: data.path }), 302);
      }
      return context.render(<FileRoutePage data={data} user={context.user} />);
    },
    async legacyWad(context) {
      const { getVisibleWADLibrary } = await import("#lib/wad-assets.server");
      const user = context.user;
      if (!user) return redirect(routes.login.href(), 303);
      const resolved = await getVisibleWADLibrary(context.params.fileId, user);
      return resolved
        ? redirect(routes.folder.index.href({ path: resolved.file.path }), 302)
        : new Response("Not Found", { status: 404 });
    },
    async legacyWadTexture(context) {
      const { getVisibleWADLibrary } = await import("#lib/wad-assets.server");
      const { getWADTextureFilename } = await import("#lib/wad-paths");
      const user = context.user;
      if (!user) return redirect(routes.login.href(), 303);
      const resolved = await getVisibleWADLibrary(context.params.fileId, user);
      const index = Number.parseInt(context.params.textureIndex, 10);
      const texture = resolved?.contents.textures[index];
      return resolved && texture
        ? redirect(
            routes.file.href({
              path: `${resolved.file.path}/${getWADTextureFilename(
                texture,
                resolved.contents.textures,
              )}`,
            }),
            302,
          )
        : new Response("Not Found", { status: 404 });
    },
  },
});
