// unbzip2-stream ships no type declarations and engine/ never needed one (its .mjs
// scripts bypass tsc entirely). watcher/ is fully typed, so this stays a one-liner: the
// module is used exactly once (catalogsWatch.ts) as a stream transform.
declare module "unbzip2-stream" {
  import type { Transform } from "node:stream";
  function bz2(): Transform;
  export = bz2;
}
