// Text -> speech off the main thread: eSpeak NG (WebAssembly) makes the
// phonemes, ONNX Runtime Web runs the model. Nothing leaves the device.
//
// In:  {type: "load"}, {type: "speak", id, text, voice, speed}
// Out: status {text, progress}, ready {voices, sampleRate},
//      chunk {id, audio, index, total}, done {id, seconds, elapsed},
//      error {id, message, kind}

import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.wasm.min.mjs";
import createEspeak from "../vendor/espeak-ng.js";
import { makeFrontend, sentences, finished, shorter, NothingToPronounce } from "./frontend.js";

const ORT_FILES = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
const VERSION = "1";          // bump when the model changes, so browsers fetch it again
const PEAK = 0.99;

let config, session, frontend, loading, latest = 0;

const post = (message, transfer) => self.postMessage(message, transfer || []);

// The model is kept in the browser's cache storage: a second visit needs no download.
async function download(url, onProgress) {
  const key = `${url}?v=${VERSION}`;
  let store = null;
  try {
    store = await caches.open("mini-voz-" + VERSION);
    const hit = await store.match(key);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { store = null; }
  const response = await fetch(key);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let bytes;
  if (!response.body || !total) {
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    const reader = response.body.getReader();
    const parts = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
      onProgress(Math.min(1, received / total));
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  }
  if (store) store.put(key, new Response(bytes.slice())).catch(() => {});
  return bytes;
}

async function load() {
  post({ type: "status", text: "model", progress: 0 });
  config = await (await fetch(new URL("../model/mini-voz.json", import.meta.url))).json();
  const [bytes, espeak] = await Promise.all([
    download(new URL("../model/mini-voz.onnx", import.meta.url).href, (progress) => post({ type: "status", text: "model", progress })),
    createEspeak(),
  ]);
  const speaker = new espeak.eSpeakNGWorker();
  speaker.set_voice("es", "es");
  frontend = makeFrontend(config.symbols, (piece) => speaker.synthesize_ipa(piece).ipa);
  post({ type: "status", text: "start", progress: 1 });
  ort.env.wasm.wasmPaths = ORT_FILES;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  await synthesize(frontend.phonemize("Hola."), 0, 1);       // warm up, so the first real sentence is quick
  post({ type: "ready", voices: config.voices, sampleRate: config.sample_rate });
}

async function synthesize(phones, voice, speed) {
  const count = phones.ids.length;
  const integers = (values) => new ort.Tensor("int64", BigInt64Array.from(values, BigInt), [1, count]);
  const scalar = (value) => new ort.Tensor("float32", Float32Array.from([value]), [1]);
  const output = await session.run({
    tokens: integers(phones.ids), stress: integers(phones.stress),
    voice: new ort.Tensor("int64", BigInt64Array.from([BigInt(voice)]), [1]),
    speed: scalar(speed), pitch_shift: scalar(0), pitch_range: scalar(1),
  });
  const audio = Float32Array.from(output.audio.data);
  let loudest = 0;
  for (const sample of audio) {
    if (!Number.isFinite(sample)) throw new Error("the model produced no usable audio");
    loudest = Math.max(loudest, Math.abs(sample));
  }
  // The model sometimes peaks above 1.0, which would clip. Scale that piece down.
  if (loudest > PEAK) for (let i = 0; i < audio.length; i++) audio[i] *= PEAK / loudest;
  return audio;
}

// One utterance holds at most max_tokens phonemes; a longer sentence is cut
// after commas, then between words. A piece with nothing to pronounce is skipped.
function fit(piece) {
  let phones;
  try { phones = frontend.phonemize(piece); } catch (error) {
    if (error instanceof NothingToPronounce) return [];
    throw error;
  }
  if (phones.ids.length <= config.max_tokens - 12) return [phones];
  return shorter(piece).flatMap(fit);
}

async function speak({ id, text, voice, speed }) {
  latest = id;
  const started = performance.now();
  const utterances = sentences(finished(text)).flatMap(fit);
  if (!utterances.length) {
    post({ type: "error", id, kind: "nothing", message: "nothing to pronounce" });
    return;
  }
  let samples = 0;
  for (let index = 0; index < utterances.length; index++) {
    const audio = await synthesize(utterances[index], voice, speed);
    if (latest !== id) return;                               // a newer request took over
    samples += audio.length;
    post({ type: "chunk", id, audio, index, total: utterances.length }, [audio.buffer]);
  }
  post({ type: "done", id, seconds: samples / config.sample_rate, elapsed: (performance.now() - started) / 1000 });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      loading = loading || load();
      await loading;
    } else if (data.type === "speak") {
      await loading;
      await speak(data);
    } else if (data.type === "cancel") {
      latest = -1;
    }
  } catch (error) {
    post({ type: "error", id: data.id, kind: data.type === "load" ? "load" : "speak", message: String(error && error.message || error) });
  }
};
