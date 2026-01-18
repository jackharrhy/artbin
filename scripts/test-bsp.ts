/**
 * Test script for BSP parsing
 * Usage: npx tsx scripts/test-bsp.ts <path-to-bsp-or-pak>
 */

import { readFile } from "fs/promises";
import {
  parseBspBuffer,
  parsePakFile,
  extractPakEntry,
  parsePk3File,
  extractPk3Entry,
  detectGameFileType,
  filterBspEntries,
  extractBspTextureFromBuffer,
  miptexToPng,
  parseWalBuffer,
  filterWalEntries,
} from "../src/lib/gamefiles.server";

async function testFile(filePath: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${filePath}`);
  console.log("=".repeat(60));

  const fileType = await detectGameFileType(filePath);
  console.log(`Detected type: ${fileType}`);

  if (fileType === "bsp") {
    // Direct BSP file
    const data = await readFile(filePath);
    console.log(`File size: ${data.length} bytes`);
    console.log(`First 16 bytes (hex): ${data.subarray(0, 16).toString("hex")}`);
    console.log(`First 4 bytes as int32LE: ${data.readInt32LE(0)}`);
    
    const magic = data.toString("ascii", 0, 4);
    console.log(`Magic string: "${magic}"`);

    try {
      const parsed = parseBspBuffer(data);
      console.log(`\nBSP Type: ${parsed.bspType}`);
      console.log(`Texture count: ${parsed.textureCount}`);
      console.log(`Entries: ${parsed.entries.length}`);
      
      if (parsed.entries.length > 0) {
        console.log(`\nFirst 10 textures:`);
        for (const entry of parsed.entries.slice(0, 10)) {
          console.log(`  - ${entry.name} (offset: ${entry.offset}, size: ${entry.size})`);
        }
      }

      // Try extracting first texture if Q1
      if (parsed.bspType === "q1" && parsed.entries.length > 0) {
        console.log(`\nTrying to extract first texture...`);
        const firstEntry = parsed.entries[0];
        const texture = extractBspTextureFromBuffer(data, firstEntry);
        console.log(`  Name: ${texture.name}`);
        console.log(`  Dimensions: ${texture.width}x${texture.height}`);
        console.log(`  Data size: ${texture.data.length}`);
        
        const png = await miptexToPng(texture, false);
        console.log(`  PNG size: ${png.length} bytes`);
      }
    } catch (err) {
      console.error(`\nError parsing BSP:`, err);
    }
  } else if (fileType === "pak") {
    // PAK file - look for BSPs inside
    const parsed = await parsePakFile(filePath);
    console.log(`Total entries: ${parsed.entries.length}`);
    
    const bspEntries = filterBspEntries(parsed.entries);
    console.log(`BSP entries: ${bspEntries.length}`);
    
    const walEntries = filterWalEntries(parsed.entries);
    console.log(`WAL entries: ${walEntries.length}`);
    
    if (bspEntries.length > 0) {
      console.log(`\nBSP files found:`);
      for (const bsp of bspEntries.slice(0, 5)) {
        console.log(`  - ${bsp.name} (${bsp.size} bytes)`);
      }
      
      // Try parsing first BSP
      const firstBsp = bspEntries[0];
      console.log(`\nExtracting and parsing: ${firstBsp.name}`);
      const bspData = await extractPakEntry(filePath, firstBsp);
      console.log(`Extracted ${bspData.length} bytes`);
      console.log(`First 16 bytes (hex): ${bspData.subarray(0, 16).toString("hex")}`);
      
      try {
        const bspParsed = parseBspBuffer(bspData);
        console.log(`BSP Type: ${bspParsed.bspType}`);
        console.log(`Textures: ${bspParsed.entries.length}`);
        
        if (bspParsed.entries.length > 0) {
          console.log(`First 5 textures:`);
          for (const tex of bspParsed.entries.slice(0, 5)) {
            console.log(`  - ${tex.name}`);
          }
        }
      } catch (err) {
        console.error(`Error parsing embedded BSP:`, err);
      }
    }
    
    if (walEntries.length > 0) {
      console.log(`\nWAL files found:`);
      for (const wal of walEntries.slice(0, 5)) {
        console.log(`  - ${wal.name}`);
      }
      
      // Try parsing first WAL
      const firstWal = walEntries[0];
      console.log(`\nExtracting and parsing: ${firstWal.name}`);
      const walData = await extractPakEntry(filePath, firstWal);
      console.log(`Extracted ${walData.length} bytes`);
      
      try {
        const texture = parseWalBuffer(walData);
        console.log(`  Name: ${texture.name}`);
        console.log(`  Dimensions: ${texture.width}x${texture.height}`);
        
        const png = await miptexToPng(texture, true);
        console.log(`  PNG size: ${png.length} bytes`);
      } catch (err) {
        console.error(`Error parsing WAL:`, err);
      }
    }
  } else if (fileType === "pk3") {
    const parsed = await parsePk3File(filePath);
    console.log(`Total entries: ${parsed.entries.length}`);
    
    const bspEntries = filterBspEntries(parsed.entries);
    console.log(`BSP entries: ${bspEntries.length}`);
    
    if (bspEntries.length > 0) {
      for (const bsp of bspEntries.slice(0, 3)) {
        console.log(`  - ${bsp.name}`);
      }
    }
  } else {
    console.log(`Unknown file type`);
  }
}

// Main
const filePath = process.argv[2];
if (!filePath) {
  console.log("Usage: npx tsx scripts/test-bsp.ts <path-to-file>");
  console.log("\nTesting with sample files...\n");
  
  // Test with known files
  const testFiles = [
    "/Users/jack/Downloads/home/quake2/baseq2/maps/marics_space.bsp",
    "/Users/jack/Downloads/gravitybone/gravitybone/baseq2/maps/hof1.bsp",
  ];
  
  for (const f of testFiles) {
    try {
      await testFile(f);
    } catch (err) {
      console.error(`Failed: ${err}`);
    }
  }
} else {
  testFile(filePath).catch(console.error);
}
