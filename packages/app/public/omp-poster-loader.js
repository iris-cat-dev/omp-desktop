import initPoster, { create_stencil } from "./poster-DKlr3gMi.js";

let POSTER_ENABLED = true;

globalThis.__OMP_POSTER_MODULE__ = {
  get enabled() {
    return POSTER_ENABLED;
  },
  set enabled(value) {
    POSTER_ENABLED = value;
  },
  init: () => initPoster({ module_or_path: "/poster_bg-DAFj3nST.wasm" }),
  createStencil: create_stencil,
};
