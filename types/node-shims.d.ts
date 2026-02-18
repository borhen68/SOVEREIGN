declare module "node:assert/strict" {
  const assert: any;
  export default assert;
}

declare module "node:crypto" {
  const crypto: any;
  export default crypto;
}

declare module "node:fs" {
  const fs: any;
  export default fs;
}

declare module "node:http" {
  const http: any;
  export default http;
}

declare module "node:os" {
  const os: any;
  export default os;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare module "node:process" {
  export const stdin: any;
  export const stdout: any;
  export const env: any;
  export const argv: any;
  export function cwd(): string;
  const processLike: any;
  export default processLike;
}

declare module "node:readline/promises" {
  const readline: any;
  export default readline;
}

declare module "node:stream" {
  export const Readable: any;
  const stream: any;
  export default stream;
}

declare module "node:test" {
  const test: any;
  export default test;
}

declare module "node:url" {
  export const fileURLToPath: any;
  export const pathToFileURL: any;
  const url: any;
  export default url;
}

declare const process: any;
