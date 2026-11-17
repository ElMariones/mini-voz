// Compare the browser front end (site/tts/frontend.js) with the Python one.
// Run through scripts/check_site_frontend.py, which writes the reference.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const load = (path) => import(pathToFileURL(join(site, path)).href);
const { makeFrontend, sentences, finished, shorter, NothingToPronounce } = await load("tts/frontend.js");
const espeakModule = await (await load("vendor/espeak-ng.js")).default();
const worker = new espeakModule.eSpeakNGWorker();
worker.set_voice("es", "es");
const config = JSON.parse(readFileSync(join(site, "model", "mini-voz.json"), "utf8"));
const frontend = makeFrontend(config.symbols, (piece) => worker.synthesize_ipa(piece).ipa);

const reference = JSON.parse(readFileSync(process.argv[2], "utf8"));
let wrong = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const report = (what, text, expected, got) => {
  if (++wrong <= 10) console.log(`${what} differs for ${JSON.stringify(text)}\n  python: ${JSON.stringify(expected)}\n  site:   ${JSON.stringify(got)}`);
};
for (const row of reference.rows) {
  let got;
  try {
    const phones = frontend.phonemize(row.text);
    got = { ids: phones.ids, stress: phones.stress };
  } catch (error) {
    if (!(error instanceof NothingToPronounce)) throw error;
    got = null;
  }
  if (!same(got, row.phones)) report("phonemes", row.text, row.phones && row.phones.ids, got && got.ids);
  if (!same(sentences(finished(row.text)), row.sentences)) report("sentences", row.text, row.sentences, sentences(finished(row.text)));
  if (!same(shorter(row.text), row.shorter)) report("shorter", row.text, row.shorter, shorter(row.text));
}
console.log(`${reference.rows.length} texts compared, ${wrong} differences`);
process.exit(wrong ? 1 : 0);
