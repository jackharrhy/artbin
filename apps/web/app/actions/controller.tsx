import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css } from "remix/ui";

import { assetServer } from "../assets.ts";
import { routes } from "../routes.ts";
import { Document } from "./document.tsx";
import { loadFoldersPage } from "../data/folders-page.ts";
import { FoldersPage } from "./folders-page.tsx";
import { loadFilePage } from "../data/file-page.ts";
import { FileRoutePage } from "./file-page.tsx";
import { loadMyUploadsPage } from "../data/my-uploads-page.ts";
import { MyUploadsPage } from "./my-uploads-page.tsx";
import { Alert, ButtonLink } from "../ui/primitives.tsx";
import { mutedTextStyle, theme } from "../ui/styles.ts";

const loginPageStyle = css({
  backgroundColor: theme.color.background,
  border: `1px solid ${theme.color.border}`,
  margin: "4rem auto 0",
  maxWidth: "360px",
  padding: "2rem",
});
const loginTitleStyle = css({ fontSize: "1.25rem", margin: "0 0 1.5rem", textAlign: "center" });
const loginNoteStyle = css({ fontSize: "0.875rem", margin: "1rem 0 0", textAlign: "center" });

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
          <main mix={loginPageStyle}>
            <h1 mix={loginTitleStyle}>Login</h1>
            {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
            <ButtonLink href={routes.auth.fourm.href()} variant="primary" block>
              Login with 4orm
            </ButtonLink>
            <p mix={[loginNoteStyle, mutedTextStyle]}>You need a 4orm account to use artbin.</p>
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
