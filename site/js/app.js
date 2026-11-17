import { Mascot } from "./mascot.js";
import { Player } from "./player.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const text = $("texto"), go = $("go"), goLabel = $("go-label"), statusLine = $("status");
const wave = $("wave"), canvas = $("wave-canvas"), timeLabel = $("time"), download = $("download"), speedup = $("speedup");
const speed = $("speed"), speedValue = $("speed-value"), loadLine = $("load-line");
const keys = [...document.querySelectorAll(".key")];

const EXAMPLES = [
  "¡Hola! Soy mini voz. Vivo en tu navegador y leo en voz alta todo lo que escribas.",
  "Tres tristes tigres tragaban trigo en un trigal. ¿Cuántos tigres tragaban trigo?",
  "Hoy en Madrid habrá cielos despejados, con 24 grados a las 15:30. Mañana, en cambio, lloverá por la tarde.",
  "Caminante, son tus huellas el camino y nada más; caminante, no hay camino, se hace camino al andar.",
];
const GREETINGS = ["¡Ay! Eso hace cosquillas.", "¡Hola! Me llamo Voz.", "¿Me escribes algo?", "¡Eh! Que estoy trabajando.", "Uno, dos, tres, probando."];
const STEPS = [["008000", "8.000", 8000], ["010000", "10.000", 10000], ["020000", "20.000", 20000], ["030000", "30.000", 30000],
  ["040000", "40.000", 40000], ["050000", "50.000", 50000], ["060000", "60.000", 60000], ["070000", "70.000", 70000],
  ["080000", "80.000", 80000], ["090000", "90.000", 90000], ["100000", "100.000", 100000], ["final", "104.000", 104000]];
const VOICES = ["F1", "F2", "M1", "M2"];

const store = {
  get(key) { try { return localStorage.getItem("mini-voz-" + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem("mini-voz-" + key, value); } catch { /* private window */ } },
};
const decimal = (value, digits) => value.toFixed(digits).replace(".", ",");
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// ───────── state ─────────

const player = new Player();
let ready = false, busy = false, request = 0, spoken = "", voice = 0, sample = null, waveDirty = true, peaks = null, peaksFor = -1;

const mascot = new Mascot($("voz"), {
  onPoke() {
    if (ready && !busy && !player.playing && !sample) generate(GREETINGS[Math.floor(Math.random() * GREETINGS.length)], true);
  },
});
mascot.set("loading");

function setStatus(message, state = "") {
  statusLine.textContent = message;
  statusLine.dataset.state = state;
}

function setButton(state, label) {
  go.dataset.state = state;
  goLabel.textContent = label;
  go.disabled = state === "loading";
}

function refreshButton() {
  if (!ready) return;
  if (busy && !player.length) setButton("busy", "pensando");
  else if (player.playing) setButton("playing", "pausa");
  else if (player.length && signature() === spoken) setButton("ready", player.position >= player.duration - 0.01 ? "repetir" : "seguir");
  else setButton("ready", "hablar");
}

const signature = () => `${voice}|${speed.value}|${text.value.trim()}`;

// ───────── the model, in a worker ─────────

const worker = new Worker(new URL("../tts/worker.js", import.meta.url), { type: "module" });
worker.onmessage = ({ data }) => {
  if (data.type === "status") {
    const percent = Math.round(data.progress * 100);
    root.style.setProperty("--p", data.progress);
    loadLine.style.setProperty("--p", data.progress);
    go.style.setProperty("--p", data.progress);
    if (data.text === "model") {
      setStatus(`descargando el modelo ${percent} %`);
      goLabel.textContent = `cargando ${percent} %`;
    } else {
      setStatus("calentando la voz");
      goLabel.textContent = "casi";
    }
  } else if (data.type === "ready") {
    ready = true;
    loadLine.classList.add("done");
    setStatus("listo. escribe y pulsa hablar", "ready");
    mascot.set("happy", 1.1);
    refreshButton();
  } else if (data.type === "chunk" && data.id === request) {
    const first = !player.length;
    player.append(data.audio);
    waveDirty = true;
    wave.classList.add("has");
    if (first) {
      player.play(0);
      setStatus("hablando", "speaking");
    }
  } else if (data.type === "done" && data.id === request) {
    busy = false;
    player.finish();
    waveDirty = true;
    if (download.href.startsWith("blob:")) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(player.wav());
    download.hidden = false;
    speedup.textContent = `${decimal(data.seconds, 1)} s de voz en ${decimal(data.elapsed, 2)} s`;
    refreshButton();
  } else if (data.type === "error") {
    busy = false;
    mascot.set("error", 2.2);
    if (data.kind === "load") {
      setStatus("no pude cargar el modelo. recarga la página", "error");
      goLabel.textContent = "sin modelo";
    } else if (data.kind === "nothing") {
      setStatus("ahí no hay nada que sepa leer. solo hablo español", "error");
      refreshButton();
    } else {
      setStatus("algo falló al hablar. prueba otra vez", "error");
      refreshButton();
    }
  }
};
worker.onerror = () => {
  mascot.set("error");
  setStatus("este navegador no puede cargar el modelo", "error");
};
worker.postMessage({ type: "load" });

function generate(content, aside = false) {
  stopSample();
  player.context();                 // inside the click: lets the browser play sound
  player.reset();
  request += 1;
  busy = true;
  spoken = aside ? "" : signature();
  peaks = null;
  waveDirty = true;
  download.hidden = true;
  speedup.textContent = "";
  wave.classList.remove("has");
  mascot.set("thinking");
  setStatus("pensando");
  worker.postMessage({ type: "speak", id: request, text: content, voice, speed: Number(speed.value) });
  refreshButton();
}

function press() {
  if (!ready) return;
  if (player.playing) { player.pause(); return; }
  const content = text.value.trim() || text.placeholder;
  if (player.length && signature() === spoken) { stopSample(); player.play(); return; }
  if (busy) return;
  if (!text.value.trim()) { text.value = content; countCharacters(); }
  generate(content);
}

go.addEventListener("click", press);
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); press(); }
});

player.addEventListener("state", () => {
  if (player.playing) { mascot.set("speaking"); setStatus("hablando", "speaking"); }
  else if (!sample && mascot.state === "speaking") { mascot.set("idle"); setStatus("en pausa", "ready"); }
  refreshButton();
});
player.addEventListener("ended", () => {
  mascot.set("happy", 1.1);
  setStatus("listo", "ready");
  refreshButton();
});

// ───────── voices, speed, text ─────────

function chooseVoice(index, focus = false) {
  voice = index;
  keys.forEach((key, at) => {
    key.setAttribute("aria-checked", String(at === index));
    key.tabIndex = at === index ? 0 : -1;
  });
  if (focus) keys[index].focus();
  store.set("voice", index);
  refreshButton();
}
keys.forEach((key, index) => {
  key.addEventListener("click", () => chooseVoice(index));
  key.addEventListener("keydown", (event) => {
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (move) { event.preventDefault(); chooseVoice((index + move + keys.length) % keys.length, true); }
  });
});
chooseVoice(Math.min(3, Math.max(0, Number(store.get("voice")) || 0)));

function showSpeed() {
  speedValue.textContent = `${decimal(Number(speed.value), 2)}×`;
  refreshButton();
}
speed.value = store.get("speed") || "1";
speed.addEventListener("input", () => { showSpeed(); store.set("speed", speed.value); });
showSpeed();

function countCharacters() {
  $("count").textContent = `${text.value.length} / ${text.maxLength}`;
  refreshButton();
}
text.addEventListener("input", () => { countCharacters(); mascot.pointerAt = -1e9; mascot.blink = Math.max(mascot.blink, 0.01); });
text.addEventListener("focus", () => mascot.watch(text));
text.addEventListener("blur", () => mascot.watch(null));

let typing = 0;
document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    const phrase = EXAMPLES[Number(button.dataset.example)];
    const run = ++typing;
    mascot.watch(text);
    mascot.pointerAt = -1e9;
    let at = 0;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (function type() {
      if (run !== typing) return;
      at = calm ? phrase.length : Math.min(phrase.length, at + 3);
      text.value = phrase.slice(0, at);
      countCharacters();
      if (at < phrase.length) requestAnimationFrame(type);
      else if (document.activeElement !== text) mascot.watch(null);
    })();
  });
});

// ───────── waveform ─────────

function measure(bars) {
  if (peaks && peaksFor === player.length && peaks.length === bars) return peaks;
  const samples = player.all();
  peaks = new Float32Array(bars);
  const per = samples.length / bars;
  for (let bar = 0; bar < bars; bar++) {
    let top = 0;
    const end = Math.min(samples.length, Math.floor((bar + 1) * per));
    for (let i = Math.floor(bar * per); i < end; i += 8) top = Math.max(top, Math.abs(samples[i]));
    peaks[bar] = top;
  }
  peaksFor = player.length;
  return peaks;
}

function draw() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
  const pen = canvas.getContext("2d");
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
  pen.clearRect(0, 0, width, height);
  if (!player.length) return;
  const style = getComputedStyle(root);
  const ink = style.getPropertyValue("--ink").trim(), faint = style.getPropertyValue("--faint").trim();
  const bars = Math.max(8, Math.floor(width / 3));
  const values = measure(bars);
  const played = player.duration ? player.position / player.duration : 0;
  const middle = height / 2, tallest = height / 2 - 9;
  for (let bar = 0; bar < bars; bar++) {
    const size = Math.max(0.5, Math.min(1, values[bar] * 1.25) * tallest);
    pen.fillStyle = bar / bars < played ? ink : faint;
    pen.fillRect(bar * 3 + 1, middle - size, 1, size * 2);
  }
  pen.fillStyle = ink;
  pen.fillRect(Math.min(width - 1, Math.round(played * width)), 6, 1, height - 12);
}

function seek(event) {
  if (!player.length) return;
  const box = wave.getBoundingClientRect();
  const part = Math.min(0.999, Math.max(0, (event.clientX - box.left) / box.width));
  stopSample();
  player.play(part * player.duration);
}
wave.addEventListener("pointerdown", (event) => { wave.setPointerCapture(event.pointerId); seek(event); });
wave.addEventListener("pointermove", (event) => { if (event.buttons & 1 || event.pointerType === "touch" && wave.hasPointerCapture(event.pointerId)) seek(event); });
wave.addEventListener("keydown", (event) => {
  const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (move && player.length) { event.preventDefault(); player.play(Math.min(player.duration - 0.05, Math.max(0, player.position + move))); }
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); press(); }
});
new ResizeObserver(() => { waveDirty = true; }).observe(wave);

// ───────── samples: how it learns ─────────

const matrix = $("matrix");
const audio = new Audio();
audio.preload = "none";
let wired = false;

matrix.insertAdjacentHTML("beforeend", `<div class="head">pasos</div>` + VOICES.map((name) => `<div class="head">${name.toLowerCase()}</div>`).join(""));
STEPS.forEach(([folder, label, step], row) => {
  matrix.insertAdjacentHTML("beforeend",
    `<div class="step" style="--p:${step / 104000};--n:${row}"><b>${label}</b><i></i></div>` +
    VOICES.map((name) => `<button type="button" class="cell" data-src="samples/${folder}/${name}.mp3" aria-label="oír ${name} a los ${label} pasos"><span class="glyph"></span><span class="tag">oír</span></button>`).join(""));
});

function stopSample() {
  if (!sample) return;
  audio.pause();
  sample.classList.remove("on");
  sample.style.removeProperty("--played");
  sample = null;
}

matrix.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  if (cell === sample) { stopSample(); mascot.set("idle"); return; }
  stopSample();
  if (player.playing) player.pause();
  const context = player.context();
  if (!wired) {
    context.createMediaElementSource(audio).connect(player.analyser);     // so the mascot hears the samples too
    wired = true;
  }
  sample = cell;
  cell.classList.add("on");
  audio.src = cell.dataset.src;
  audio.play().catch(() => { stopSample(); mascot.set("error", 1.5); });
  mascot.set("speaking");
});
audio.addEventListener("ended", () => { stopSample(); mascot.set("happy", 1.1); });

new IntersectionObserver((entries, observer) => {
  if (entries.some((entry) => entry.isIntersecting)) { matrix.classList.add("seen"); observer.disconnect(); }
}, { threshold: 0.15 }).observe(matrix);

// ───────── theme ─────────

function paintTheme() {
  const dark = root.dataset.theme === "dark";
  $("theme-label").textContent = dark ? "día" : "noche";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#0f0e12" : "#f6f8f7";
  waveDirty = true;
}
$("theme").addEventListener("click", () => {
  const flip = () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    store.set("theme", root.dataset.theme);
    paintTheme();
    draw();
  };
  mascot.blink = 1;
  if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(flip);
  else flip();
});
paintTheme();

// ───────── every frame ─────────

let shownTime = "";
(function frame() {
  player.tick();
  mascot.level = player.playing || sample ? player.level() : 0;
  if (sample && audio.duration) sample.style.setProperty("--played", (audio.currentTime / audio.duration).toFixed(4));
  if (player.playing || waveDirty) { draw(); waveDirty = false; }
  const label = `${clock(player.position)} / ${clock(player.duration)}`;
  if (label !== shownTime) {
    timeLabel.textContent = shownTime = label;
    wave.setAttribute("aria-valuemax", Math.round(player.duration));
    wave.setAttribute("aria-valuenow", Math.round(player.position));
  }
  requestAnimationFrame(frame);
})();

document.querySelectorAll(".desk > .field, .desk > .row").forEach((element, index) => element.style.setProperty("--i", index));
countCharacters();
setTimeout(() => document.body.classList.add("in"), 60);
