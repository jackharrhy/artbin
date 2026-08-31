import { createWorldview } from "@jackharrhy/worldview";
import { serializeWalkability } from "@jackharrhy/worldview/walkability";

export interface BspOverviewRenderInput {
  bspUrl: string;
  paletteUrl?: string;
  wadBaseUrl: string;
  width: number;
  height: number;
  maxWalkabilityNodes: number;
}

export interface BspDerivativeGenerationResult {
  pngBase64: string;
  walkabilityJson?: string;
  usedWalkability: boolean;
  warnings: string[];
}

async function encodeBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function generateBspDerivatives(
  input: BspOverviewRenderInput,
): Promise<BspDerivativeGenerationResult> {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const warnings: string[] = [];
  const viewer = await createWorldview({
    canvas,
    controls: "none",
    audio: false,
    autoStart: false,
    maxDevicePixelRatio: 1,
  });

  viewer.addEventListener("warning", (event) => warnings.push(event.detail.message));

  try {
    await viewer.load({
      bsp: input.bspUrl,
      ...(input.paletteUrl ? { palette: input.paletteUrl } : {}),
      wadBaseUrl: input.wadBaseUrl,
    });

    let usedWalkability = false;
    let walkabilityJson: string | undefined;
    try {
      const walkability = await viewer.generateWalkability({
        spacing: 32,
        maximumNodes: input.maxWalkabilityNodes,
        yieldEvery: 16,
      });
      viewer.setWalkability(walkability);
      walkabilityJson = serializeWalkability(walkability);
      usedWalkability = true;
    } catch (error) {
      warnings.push(
        `Walkability unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const overview = await viewer.captureOverview({
      width: input.width,
      height: input.height,
      background: [0.025, 0.035, 0.03, 1],
      cutaway: usedWalkability ? "walkability" : "none",
      imageType: "image/png",
      includeSky: false,
      includeSprites: false,
      lighting: "lightmapped",
      rotation: "auto",
    });

    return {
      pngBase64: await encodeBase64(overview.image),
      ...(walkabilityJson ? { walkabilityJson } : {}),
      usedWalkability,
      warnings,
    };
  } finally {
    viewer.dispose();
  }
}
