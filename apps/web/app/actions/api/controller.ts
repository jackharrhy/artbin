import { createController } from "remix/router";

import { action as createFolder } from "./handlers/api.folder.ts";
import { loader as downloadFolder } from "./handlers/api.folder.download.ts";
import { action as moveFolder } from "./handlers/api.folder.move.ts";
import { action as importFromSite } from "./handlers/api.import.ts";
import { action as lucky } from "./handlers/api.lucky.ts";
import { action as upload } from "./handlers/api.upload.ts";
import { loader as wadTexture } from "./handlers/api.wad-texture.ts";
import { routes } from "../../routes.ts";

export default createController(routes.api, {
  actions: {
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
  },
});
