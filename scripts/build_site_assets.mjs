// Build the files the browser demo in site/ needs that are not written by hand.
//
//   npm install --prefix /tmp/espeak @echogarden/espeak-ng-emscripten@0.3.5
//   node scripts/build_site_assets.mjs /tmp/espeak/node_modules/@echogarden/espeak-ng-emscripten
//
// 1. eSpeak NG compiled to WebAssembly, with its data cut down to what Spanish
//    needs (24 MB -> under 1 MB): site/vendor/espeak-ng.js and espeak-ng.data.
// 2. The exported model: models/mini-voz.onnx and .json -> site/model/.
//
// eSpeak NG is GPL-3.0; site/vendor/COPYING is its licence.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build_site_assets.mjs <folder of @echogarden/espeak-ng-emscripten>");
  process.exit(2);
}

// Phoneme tables, the Spanish dictionary and voices, and English for the few
// words eSpeak's Spanish rules hand over to it.
const KEEP = /\/(phontab|phonindex|phondata|intonations|es_dict|en_dict|lang\/roa\/es|lang\/roa\/es-419|lang\/gmw\/en|lang\/gmw\/en-US)$/;

const script = readFileSync(join(source, "espeak-ng.js"), "utf8");
const data = readFileSync(join(source, "espeak-ng.data"));
const pattern = /loadPackage\(\{files:(\[.*?\]),remote_package_size:(\d+)\}\)/s;
const found = script.match(pattern);
if (!found || Number(found[2]) !== data.length) throw new Error("espeak-ng.js is not laid out as expected (another version?)");
const files = Function(`return ${found[1]}`)();
const kept = [];
const parts = [];
let offset = 0;
for (const file of files) {
  if (!KEEP.test(file.filename)) continue;
  const bytes = data.subarray(file.start, file.end);
  kept.push({ filename: file.filename, start: offset, end: offset + bytes.length });
  parts.push(bytes);
  offset += bytes.length;
}
// Folders are created from a separate list, so the ones left empty do no harm.
const table = JSON.stringify(kept);
const output = join(root, "site", "vendor");
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "espeak-ng.js"), script.replace(pattern, () => `loadPackage({files:${table},remote_package_size:${offset}})`));
writeFileSync(join(output, "espeak-ng.data"), Buffer.concat(parts));
copyFileSync(join(source, "COPYING"), join(output, "COPYING"));
console.log(`eSpeak NG: ${kept.length} of ${files.length} data files, ${(offset / 1e6).toFixed(2)} MB`);

mkdirSync(join(root, "site", "model"), { recursive: true });
for (const name of ["mini-voz.onnx", "mini-voz.json"]) {
  copyFileSync(join(root, "models", name), join(root, "site", "model", name));
}
console.log("model copied to site/model/");
