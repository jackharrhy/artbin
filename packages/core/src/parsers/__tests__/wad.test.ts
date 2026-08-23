import sharp from "sharp";
import { describe, expect, test } from "vitest";

import {
  extractTextureFromWAD,
  extractTexturesFromWAD,
  inspectWAD,
  isWADFile,
  parseWADHeader,
  parseWADLumps,
} from "../wad";

function makeWad3Texture(name = "BRICK", masked = false): Buffer {
  const width = 8;
  const height = 8;
  const mipSizes = [64, 16, 4, 1];
  const textureSize = 40 + mipSizes.reduce((total, size) => total + size, 0) + 2 + 768;
  const textureOffset = 12;
  const directoryOffset = textureOffset + textureSize;
  const buffer = Buffer.alloc(directoryOffset + 32);
  const textureName = masked ? `{${name}` : name;

  buffer.write("WAD3", 0, "ascii");
  buffer.writeInt32LE(1, 4);
  buffer.writeInt32LE(directoryOffset, 8);

  buffer.write(textureName, textureOffset, 16, "ascii");
  buffer.writeUInt32LE(width, textureOffset + 16);
  buffer.writeUInt32LE(height, textureOffset + 20);
  buffer.writeUInt32LE(40, textureOffset + 24);
  buffer.writeUInt32LE(40 + mipSizes[0], textureOffset + 28);
  buffer.writeUInt32LE(40 + mipSizes[0] + mipSizes[1], textureOffset + 32);
  buffer.writeUInt32LE(40 + mipSizes[0] + mipSizes[1] + mipSizes[2], textureOffset + 36);

  const pixelsOffset = textureOffset + 40;
  buffer.fill(1, pixelsOffset, pixelsOffset + mipSizes[0]);
  buffer[pixelsOffset] = 2;
  buffer[pixelsOffset + 1] = 255;

  const paletteCountOffset = pixelsOffset + mipSizes.reduce((total, size) => total + size, 0);
  buffer.writeUInt16LE(256, paletteCountOffset);
  const paletteOffset = paletteCountOffset + 2;
  buffer.set([255, 0, 0], paletteOffset + 3);
  buffer.set([0, 255, 0], paletteOffset + 6);
  buffer.set([0, 0, 255], paletteOffset + 255 * 3);

  buffer.writeInt32LE(textureOffset, directoryOffset);
  buffer.writeInt32LE(textureSize, directoryOffset + 4);
  buffer.writeInt32LE(textureSize, directoryOffset + 8);
  buffer[directoryOffset + 12] = 0x43;
  buffer[directoryOffset + 13] = 0;
  buffer.write(textureName, directoryOffset + 16, 16, "ascii");

  return buffer;
}

describe("WAD parser", () => {
  test("parses a valid WAD3 directory", () => {
    const buffer = makeWad3Texture();
    const header = parseWADHeader(buffer);

    expect(header).toEqual({ version: "WAD3", lumpCount: 1, directoryOffset: buffer.length - 32 });
    expect(parseWADLumps(buffer, header!)).toEqual([
      expect.objectContaining({ name: "BRICK", type: 0x43, compression: 0 }),
    ]);
    expect(isWADFile(buffer)).toBe(true);
  });

  test("extracts WAD3 palette textures as PNG", async () => {
    const wad = makeWad3Texture();
    expect(inspectWAD(wad)).toEqual({
      version: "WAD3",
      lumpCount: 1,
      textures: [{ index: 0, name: "BRICK", width: 8, height: 8, isTransparent: false }],
    });

    const [texture] = await extractTexturesFromWAD(wad);

    expect(texture).toMatchObject({ name: "BRICK", width: 8, height: 8 });
    const { data, info } = await sharp(texture.pngBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info).toMatchObject({ width: 8, height: 8, channels: 4 });
    expect([...data.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...data.subarray(4, 8)]).toEqual([0, 0, 255, 255]);
    expect([...data.subarray(8, 12)]).toEqual([255, 0, 0, 255]);
  });

  test("renders one virtual texture by directory index", async () => {
    const wad = makeWad3Texture("VIRTUAL");
    const texture = await extractTextureFromWAD(wad, 0);

    expect(texture).toMatchObject({ name: "VIRTUAL", width: 8, height: 8 });
    expect(await sharp(texture!.pngBuffer).metadata()).toMatchObject({
      format: "png",
      width: 8,
      height: 8,
    });
    await expect(extractTextureFromWAD(wad, 1)).resolves.toBeNull();
    await expect(extractTextureFromWAD(wad, -1)).resolves.toBeNull();
  });

  test("makes palette index 255 transparent for masked GoldSource textures", async () => {
    const [texture] = await extractTexturesFromWAD(makeWad3Texture("MASK", true));
    const data = await sharp(texture.pngBuffer).ensureAlpha().raw().toBuffer();

    expect(texture.name).toBe("{MASK");
    expect([...data.subarray(4, 8)]).toEqual([0, 0, 255, 0]);
  });

  test("rejects invalid directory bounds", () => {
    const buffer = Buffer.alloc(12);
    buffer.write("WAD3", 0, "ascii");
    buffer.writeInt32LE(1, 4);
    buffer.writeInt32LE(999, 8);

    expect(parseWADHeader(buffer)).toBeNull();
    expect(isWADFile(buffer)).toBe(false);
  });
});
