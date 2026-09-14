import { museumFixture } from "../../../../apps/web/test/fixtures/early-web-graphics.mjs";

const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  return Promise.resolve(museumFixture(url) ?? originalFetch(input, init));
};
