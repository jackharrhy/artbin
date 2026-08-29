import { createController } from "remix/router";

import { action as createFolder } from "./handlers/api.folder.ts";
import { loader as downloadFolder } from "./handlers/api.folder.download.ts";
import { action as moveFolder } from "./handlers/api.folder.move.ts";
import { action as importFromSite } from "./handlers/api.import.ts";
import { action as lucky } from "./handlers/api.lucky.ts";
import { action as upload } from "./handlers/api.upload.ts";
import { loader as wadTexture } from "./handlers/api.wad-texture.ts";
import { paletteLoader as bspPalette, wadLoader as bspWad } from "./handlers/api.bsp-assets.ts";
import { routes } from "../../routes.ts";
import { assetContent, assetMetadata, searchAssets, wadMetadata } from "./handlers/api.assets.ts";

export default createController(routes.api, {
  actions: {
    assets({ request }) {
      return searchAssets(request);
    },
    asset({ request, params }) {
      return assetMetadata(request, params.assetId);
    },
    assetContent({ request, params }) {
      return assetContent(request, params.assetId);
    },
    assetWad({ request, params }) {
      return wadMetadata(request, params.assetId);
    },
    upload({ request }) {
      return upload({ request });
    },
    import({ request }) {
      return importFromSite({ request });
    },
    lucky({ request }) {
      return lucky({ request });
    },
    folder({ request }) {
      return createFolder({ request });
    },
    folderMove({ request }) {
      return moveFolder({ request });
    },
    folderDownload({ request, params }) {
      return downloadFolder({ request, params: { "*": params.path } });
    },
    wadTexture({ request, params }) {
      return wadTexture({ request, params });
    },
    bspWad({ request, params }) {
      return bspWad({ request, params });
    },
    bspPalette({ request, params }) {
      return bspPalette({ request, params });
    },
  },
});
