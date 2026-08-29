import { form, get, post, route } from "remix/routes";

export const routes = route({
  assets: get("/assets/*path"),
  mediaFile: get("/media/:fileId/*filename"),
  mediaFolderPreview: get("/media/folder/:folderId/*filename"),
  home: get("/"),
  login: get("/login"),
  settings: form("/settings"),
  myUploads: get("/my-uploads"),
  folders: get("/folders"),
  folder: form("/folder/*path"),
  file: get("/file/*path"),
  legacyWad: get("/wad/:fileId"),
  legacyWadTexture: get("/wad/:fileId/texture/:textureIndex"),
  dev: route("/dev", {
    kitchenSink: get("/kitchen-sink"),
  }),
  auth: route("/auth", {
    fourm: get("/4orm"),
    fourmCallback: get("/4orm/callback"),
    cliAuthorize: get("/cli/authorize"),
    cliCallback: get("/cli/callback"),
  }),
  admin: route("/admin", {
    jobs: form("/"),
    import: form("/import"),
    inbox: form("/inbox"),
    archives: form("/archives"),
    scanSettings: form("/scan-settings"),
    users: get("/users"),
    orphans: form("/orphans"),
  }),
  api: route("/api", {
    assets: get("/assets"),
    asset: get("/assets/:assetId"),
    assetContent: get("/assets/:assetId/content"),
    assetWad: get("/assets/:assetId/wad"),
    upload: post("/upload"),
    import: post("/import"),
    lucky: post("/lucky"),
    folder: post("/folder"),
    folderMove: post("/folder/move"),
    folderDownload: get("/folder/download/*path"),
    wadTexture: get("/wad/:fileId/texture/:textureIndex"),
    bspWad: get("/bsp/:fileId/wad/*wadName"),
    bspPalette: get("/bsp/:fileId/palette"),
    cli: route("/cli", {
      whoami: get("/whoami"),
      foldersGet: get("/folders"),
      foldersPost: post("/folders"),
      folderManage: post("/folder/manage"),
      manifest: post("/manifest"),
      upload: post("/upload"),
      finalize: post("/finalize"),
    }),
  }),
});

export function mediaFileHref(
  file: { id: string; name: string },
  options: { preview?: boolean } = {},
): string {
  const preview = options.preview === true;
  const href = routes.mediaFile.href({
    fileId: file.id,
    filename: preview ? `${file.name}.preview.png` : file.name,
  });
  return preview ? `${href}?preview=1` : href;
}

export function mediaFolderPreviewHref(folder: { id: string; previewPath: string }): string {
  const filename = folder.previewPath.replaceAll("\\", "/").split("/").at(-1)!;
  return routes.mediaFolderPreview.href({ folderId: folder.id, filename });
}
