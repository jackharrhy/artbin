// Upstream fixture only: Artbin's HTTP routes, job runner, ingestion and rendering remain real.
const originalFetch = globalThis.fetch;
const positions = Buffer.from(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer);
const json = Buffer.from(
  JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
  }),
);
const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
json.copy(paddedJson);
const glb = Buffer.alloc(28 + paddedJson.length + positions.length);
glb.write("glTF");
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(paddedJson.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
paddedJson.copy(glb, 20);
glb.writeUInt32LE(positions.length, 20 + paddedJson.length);
glb.writeUInt32LE(0x004e4942, 24 + paddedJson.length);
positions.copy(glb, 28 + paddedJson.length);

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "pub-13a5286ea5b347fbb60687b5ebb02b5a.r2.dev")
    return originalFetch(input, init);
  if (url.pathname.endsWith(".json")) {
    return Promise.resolve(
      Response.json([
        { status: "no_model", file: "" },
        { status: "exported", file: "0001_Test Model..glb" },
      ]),
    );
  }
  return Promise.resolve(
    url.pathname.endsWith("/0001_Test%20Model.glb")
      ? new Response(glb, { headers: { "Content-Type": "model/gltf-binary" } })
      : new Response("Fixture not found", { status: 404 }),
  );
};
