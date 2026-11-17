// The mascots: one soft creature per voice, each with its own shape and colour.
// Their eyes follow the pointer, they blink, and a mouth opens with the audio.
// Changing voice is a little scene: the current one crouches and hops out of
// the frame, the next one drops in from above, lands with a squash and a puff
// of dust, and opens its eyes.

export const CREATURES = [
  {
    name: "gota", voice: "F1", color: "#ff3d7f", light: "#ff9cc0", deep: "#c4135a",
    // a drop, leaning a little
    body: "M-4 -96C18 -80 86 -22 86 30C86 72 50 94 2 94C-48 94 -86 70 -86 26C-86 -24 -32 -78 -4 -96Z",
    eyes: [{ x: -22, y: 6, w: 15, h: 32, r: -10 }, { x: 18, y: 0, w: 15, h: 32, r: -10 }],
    mouth: { x: -2, y: 50, w: 24 }, gloss: { x: -44, y: -6, rx: 9, ry: 20, r: 28 }, reach: 7,
  },
  {
    name: "nube", voice: "F2", color: "#ff7a1a", light: "#ffc070", deep: "#d85500",
    // a cloud
    body: "M-66 8C-102 4 -100 -50 -62 -48C-58 -84 -12 -90 2 -62C18 -92 74 -82 70 -44C106 -42 108 10 80 18C98 54 60 88 20 76C0 96 -46 92 -56 64C-96 62 -100 14 -66 8Z",
    eyes: [{ x: -26, y: -16, w: 34, h: 13, r: 14 }, { x: 22, y: -8, w: 34, h: 13, r: 14 }],
    mouth: { x: -2, y: 30, w: 30 }, gloss: { x: -56, y: -30, rx: 14, ry: 7, r: -24 }, reach: 6,
  },
  {
    name: "pico", voice: "M1", color: "#1f7cff", light: "#7cb8ff", deep: "#0a52c4",
    // a soft triangle
    body: "M0 -94C13 -94 21 -82 31 -63L88 50C99 71 89 90 65 90L-65 90C-89 90 -99 71 -88 50L-31 -63C-21 -82 -13 -94 0 -94Z",
    eyes: [{ x: -15, y: 34, w: 12, h: 26, r: 0 }, { x: 15, y: 34, w: 12, h: 26, r: 0 }],
    mouth: { x: 0, y: 68, w: 18 }, gloss: { x: -20, y: -40, rx: 6, ry: 18, r: 28 }, reach: 5,
  },
  {
    name: "pan", voice: "M2", color: "#12b07a", light: "#6ee7b5", deep: "#08815a",
    // a bun
    body: "M-90 -8C-90 -66 -48 -80 0 -80C48 -80 90 -66 90 -8C90 56 60 84 0 84C-60 84 -90 56 -90 -8Z",
    eyes: [{ x: -28, y: -14, w: 22, h: 36, r: 0, round: 9 }, { x: 28, y: -14, w: 22, h: 36, r: 0, round: 9 }],
    mouth: { x: 0, y: 34, w: 32 }, gloss: { x: -56, y: -46, rx: 16, ry: 8, r: -18 }, reach: 8,
  },
];

const NS = "http://www.w3.org/2000/svg";
const FLOOR = 96;                                  // where the creatures stand
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = { in: (p) => p * p, out: (p) => 1 - (1 - p) * (1 - p) };

function node(name, attributes = {}, parent) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (parent) parent.appendChild(element);
  return element;
}

// A small picture of a creature (for the voice keys).
export function creatureIcon(index) {
  const c = CREATURES[index];
  const eyes = c.eyes.map((e) => `<rect x="${e.x - e.w / 2}" y="${e.y - e.h / 2}" width="${e.w}" height="${e.h}" rx="${e.round ?? Math.min(e.w, e.h) / 2}" transform="rotate(${e.r} ${e.x} ${e.y})" fill="#fff"/>`).join("");
  return `<svg class="key-mark" viewBox="-104 -104 208 208" aria-hidden="true"><path d="${c.body}" fill="${c.color}"/>${eyes}</svg>`;
}

const SVG = `
<svg class="voz" viewBox="-125 -125 250 250" role="img">
  <defs>
    ${CREATURES.map((c, i) => `
    <linearGradient id="voz-fill-${i}" x1="0" y1="-100" x2="0" y2="100" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${c.light}"/><stop offset=".45" stop-color="${c.color}"/><stop offset="1" stop-color="${c.deep}"/>
    </linearGradient>`).join("")}
    <radialGradient id="voz-sheen" gradientUnits="userSpaceOnUse" cx="-30" cy="-50" r="160">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g class="voz-back"></g>
  <g class="voz-actors"></g>
  <g class="voz-front"></g>
</svg>`;

class Actor {
  constructor(parent, index) {
    const c = CREATURES[index];
    this.index = index;
    this.c = c;
    this.root = node("g", {}, parent);
    this.shadow = node("ellipse", { class: "voz-shadow", cx: 0, cy: FLOOR + 6, rx: 70, ry: 7 }, this.root);
    this.mover = node("g", {}, this.root);
    this.squash = node("g", {}, this.mover);
    node("path", { d: c.body, fill: `url(#voz-fill-${index})` }, this.squash);
    node("path", { d: c.body, fill: "url(#voz-sheen)" }, this.squash);
    const g = c.gloss;
    node("ellipse", { cx: g.x, cy: g.y, rx: g.rx, ry: g.ry, fill: "#fff", opacity: ".55", transform: `rotate(${g.r} ${g.x} ${g.y})` }, this.squash);
    this.face = node("g", {}, this.squash);
    this.eyes = c.eyes.map((e) => {
      const eye = node("g", {}, this.face);
      node("rect", { x: -e.w / 2, y: -e.h / 2, width: e.w, height: e.h, rx: e.round ?? Math.min(e.w, e.h) / 2, fill: "#fff" }, eye);
      return eye;
    });
    this.mouth = node("rect", { class: "voz-mouth", fill: "#22061a" }, this.face);
    this.phase = "enter";
    this.t0 = performance.now() / 1000;
    this.dir = 1;
    this.landed = false;
  }

  remove() { this.root.remove(); }
}

export class Mascot {
  constructor(host, { onPoke, voice = 0 } = {}) {
    host.innerHTML = SVG;
    this.host = host;
    this.svg = host.querySelector("svg");
    this.actorsLayer = host.querySelector(".voz-actors");
    this.back = host.querySelector(".voz-back");
    this.front = host.querySelector(".voz-front");
    this.stage = host.closest(".vitrine") || host;
    this.actors = [];
    this.current = null;
    this.particles = [];
    this.waves = [];
    this.state = "idle";
    this.level = 0;                 // set by the page: loudness of the audio, 0..1
    this.heard = 0;
    this.gaze = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.pointerAt = -1e9;
    this.focus = null;
    this.blink = 0;
    this.nextBlink = 1.5;
    this.poke = 0;
    this.until = 0;
    this.wander = { x: 0, y: 0, at: 0 };
    this.calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.addEventListener("pointermove", (event) => this.follow(event.clientX, event.clientY), { passive: true });
    window.addEventListener("pointerdown", (event) => this.follow(event.clientX, event.clientY), { passive: true });
    // "click", not "pointerdown": phones only allow sound to start from a finished tap.
    this.svg.addEventListener("click", () => {
      this.poke = 1;
      this.blink = 1;
      if (onPoke) onPoke();
    });
    this.voice(voice);
    this.last = performance.now() / 1000;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // Switch to another creature: the current one hops out, the new one drops in.
  voice(index) {
    if (this.current && this.current.index === index && this.current.phase !== "exit") return;
    const now = performance.now() / 1000;
    const dir = this.current ? (index > this.current.index ? 1 : -1) : 1;
    if (this.current) {
      this.current.phase = "exit";
      this.current.t0 = now;
      this.current.dir = dir;
    }
    const actor = new Actor(this.actorsLayer, index);
    actor.dir = dir;
    actor.t0 = now + (this.current && !this.calm ? 0.2 : 0);
    actor.root.style.opacity = "0";
    this.actors.push(actor);
    this.current = actor;
    const c = CREATURES[index];
    this.svg.setAttribute("aria-label", `${c.name}, la voz ${c.voice.toLowerCase()}`);
    this.stage.style.setProperty("--tint", c.color);
    this.host.dataset.creature = c.name;
  }

  // "idle", "loading", "thinking", "speaking", "happy", "error"
  set(state, seconds = 0) {
    this.state = state;
    this.until = seconds ? performance.now() / 1000 + seconds : 0;
    this.host.dataset.state = state;
  }

  // Look at an element (the text field while the reader types), or null.
  watch(element) { this.focus = element; }

  follow(x, y) {
    this.pointerAt = performance.now() / 1000;
    this.aim(x, y);
  }

  aim(x, y) {
    const box = this.svg.getBoundingClientRect();
    const dx = x - (box.left + box.width / 2), dy = y - (box.top + box.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const reach = distance / (distance + box.width * 0.6);
    this.target.x = (dx / distance) * reach;
    this.target.y = (dy / distance) * reach;
  }

  // A burst of square crumbs at the creature's feet (landing, take-off).
  dust(color, x, count, spread) {
    if (this.calm) return;
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const size = 4 + Math.random() * 6;
      this.particles.push({
        el: node("rect", { width: size, height: size, fill: i % 3 ? color : "currentColor", class: "voz-crumb" }, this.front),
        x: x + side * (20 + Math.random() * 40), y: FLOOR - 2, size,
        vx: side * (60 + Math.random() * spread), vy: -(90 + Math.random() * 150), spin: (Math.random() - 0.5) * 720, r: 0, life: 0,
      });
    }
  }

  wave(color) {
    if (this.calm) return;
    this.waves.push({ el: node("ellipse", { cx: 0, cy: FLOOR + 6, fill: "none", stroke: color, "stroke-width": 2 }, this.back), life: 0 });
  }

  // How an actor stands at this moment of its entrance or exit.
  pose(actor, now) {
    const t = now - actor.t0;
    const pose = { x: 0, y: 0, sx: 1, sy: 1, r: 0, open: 1, alpha: 1, settled: false };
    if (this.calm) {
      if (actor.phase === "exit") { pose.alpha = clamp(1 - t / 0.2, 0, 1); pose.done = t > 0.2; }
      else { pose.alpha = clamp(t / 0.2, 0, 1); pose.settled = true; }
      return pose;
    }
    if (actor.phase === "exit") {
      const crouch = 0.12;
      if (t < crouch) {
        const p = t / crouch;
        pose.sy = 1 - 0.2 * p; pose.sx = 1 + 0.14 * p; pose.open = 1 - 0.6 * p;
      } else {
        if (!actor.launched) { actor.launched = true; this.dust(actor.c.color, 0, 5, 90); }
        const p = Math.min(1, (t - crouch) / 0.42);
        pose.x = -actor.dir * 300 * ease.in(p);
        pose.y = -150 * p + 110 * p * p;
        pose.sy = 1.18 - 0.1 * p; pose.sx = 0.88;
        pose.r = -actor.dir * 28 * p;
        pose.open = 0.4;
        pose.done = p >= 1;
      }
      return pose;
    }
    // entrance: fall in from above and a little to the side, land, wobble
    const fall = 0.42;
    if (t < 0) { pose.alpha = 0; return pose; }
    if (t < fall) {
      const p = t / fall;
      pose.y = -300 * (1 - ease.in(p));
      pose.x = actor.dir * 120 * (1 - ease.out(p));
      pose.sy = 1 + 0.2 * p; pose.sx = 1 - 0.12 * p;
      pose.r = actor.dir * 16 * (1 - p);
      pose.open = 0;
      return pose;
    }
    if (!actor.landed) {
      actor.landed = true;
      this.dust(actor.c.color, 0, 10, 160);
      this.wave(actor.c.color);
      this.blink = 0;
    }
    const u = t - fall;
    const wobble = Math.exp(-6.5 * u) * Math.cos(17 * u);
    pose.sy = 1 - 0.3 * wobble;
    pose.sx = 1 + 0.24 * wobble;
    pose.y = -16 * Math.exp(-7 * u) * Math.abs(Math.sin(11 * u + 0.4)) * (u > 0.08 ? 1 : 0);
    pose.open = clamp((u - 0.12) * 6, 0, 1);         // the eyes pop open just after landing
    pose.pop = clamp((u - 0.12) * 6, 0, 1);
    pose.settled = u > 1.1;
    return pose;
  }

  frame(ms) {
    const now = ms / 1000;
    const dt = Math.min(0.05, now - this.last);
    this.last = now;
    if (this.until && now > this.until) this.set("idle");
    const state = this.state;

    // Where to look.
    if (state === "loading") {
      this.target.x = Math.cos(now * 2.4) * 0.75;
      this.target.y = Math.sin(now * 2.4) * 0.6;
    } else if (state === "thinking") {
      this.target.x = -0.5 + Math.sin(now * 5) * 0.12;
      this.target.y = -0.6;
    } else if (state === "error") {
      this.target.x = Math.sin(now * 30) * 0.25 * Math.max(0, 1 - (now % 2));
      this.target.y = 0.2;
    } else if (now - this.pointerAt > 3.5) {
      if (this.focus) {
        const box = this.focus.getBoundingClientRect();
        this.aim(box.left + box.width * 0.35, box.top + Math.min(box.height, 120) / 2);
      } else {
        if (now > this.wander.at) this.wander = { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.5) * 0.7, at: now + 1.4 + Math.random() * 2.2 };
        this.target.x = this.wander.x;
        this.target.y = this.wander.y;
      }
    }
    const follow = 1 - Math.exp(-dt * (state === "idle" || state === "speaking" ? 9 : 6));
    this.gaze.x += (this.target.x - this.gaze.x) * follow;
    this.gaze.y += (this.target.y - this.gaze.y) * follow;

    this.nextBlink -= dt;
    if (this.nextBlink < 0) { this.blink = 1; this.nextBlink = 2 + Math.random() * 4; }
    this.blink = Math.max(0, this.blink - dt * 7);

    const loud = state === "speaking" ? this.level : 0;
    this.heard += (loud - this.heard) * (1 - Math.exp(-dt * (loud > this.heard ? 30 : 10)));
    this.poke = Math.max(0, this.poke - dt * 2.6);

    for (const actor of [...this.actors]) {
      const pose = this.pose(actor, now);
      if (pose.done) {
        actor.remove();
        this.actors.splice(this.actors.indexOf(actor), 1);
        continue;
      }
      this.draw(actor, pose, now, state);
    }

    this.particles = this.particles.filter((p) => {
      p.life += dt;
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y = Math.min(FLOOR + 4, p.y + p.vy * dt);
      if (p.y >= FLOOR + 4) { p.vx *= 0.8; p.vy *= -0.3; }
      p.r += p.spin * dt;
      const fade = clamp(1 - (p.life - 0.35) / 0.4, 0, 1);
      p.el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.r.toFixed(0)}) translate(${-p.size / 2} ${-p.size / 2})`);
      p.el.setAttribute("opacity", fade.toFixed(2));
      if (fade <= 0) { p.el.remove(); return false; }
      return true;
    });
    this.waves = this.waves.filter((w) => {
      w.life += dt;
      const p = w.life / 0.7;
      w.el.setAttribute("rx", (50 + 90 * ease.out(Math.min(1, p))).toFixed(1));
      w.el.setAttribute("ry", (5 + 9 * ease.out(Math.min(1, p))).toFixed(1));
      w.el.setAttribute("opacity", Math.max(0, 0.7 * (1 - p)).toFixed(2));
      if (p >= 1) { w.el.remove(); return false; }
      return true;
    });
    requestAnimationFrame(this.frame);
  }

  draw(actor, pose, now, state) {
    const c = actor.c;
    const active = actor === this.current && actor.phase !== "exit";
    let { x, y, sx, sy, r } = pose;
    let open = pose.open * (1 - Math.sin(Math.min(1, this.blink) * Math.PI) * 0.92);

    if (active && pose.open > 0.5) {
      // Life on top of the entrance: breathing, hops, pokes, talking.
      const breathe = this.calm ? 0 : Math.sin(now * 2.2 + actor.index) * 0.018;
      sy *= 1 + breathe; sx *= 1 - breathe;
      if (state === "happy" && !this.calm) {
        const hop = Math.abs(Math.sin(now * 8));
        y -= hop * 14;
        sy *= 1 + 0.06 * hop; sx *= 1 - 0.04 * hop;
        open = Math.min(open, 0.25);
      }
      if (state === "thinking") { open = Math.min(open, 0.6); r += Math.sin(now * 3) * 3; }
      if (state === "loading" && !this.calm) { r += Math.sin(now * 4) * 4; }
      if (state === "error") { x += Math.sin(now * 40) * 4 * Math.max(0, 1 - (now % 2)); open = Math.min(open, 0.5); }
      const talk = this.heard;
      sy *= 1 + talk * 0.06; sx *= 1 + talk * 0.03;
      if (!this.calm) y -= talk * 6 * (0.5 + 0.5 * Math.sin(now * 13));
      const squash = Math.sin(this.poke * Math.PI);
      sy *= 1 - squash * 0.16; sx *= 1 + squash * 0.14;
      r += this.gaze.x * 4;
    }

    actor.root.style.opacity = pose.alpha;
    actor.mover.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)} 0 ${FLOOR})`);
    actor.squash.setAttribute("transform", `translate(0 ${FLOOR}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(0 ${-FLOOR})`);
    // The shadow stays on the floor and shrinks as the creature rises.
    const lift = clamp(-y / 220, 0, 1);
    actor.shadow.setAttribute("transform", `translate(${(x * 0.9).toFixed(1)} 0) scale(${((1 - lift * 0.6) * sx).toFixed(3)} 1)`);
    actor.shadow.setAttribute("opacity", ((1 - lift) * 0.16 * pose.alpha).toFixed(3));

    const gx = active ? this.gaze.x : 0, gy = active ? this.gaze.y : 0;
    actor.face.setAttribute("transform", `translate(${(gx * c.reach * 1.6).toFixed(2)} ${(gy * c.reach * 1.3).toFixed(2)})`);
    const pop = pose.pop === undefined ? 1 : 0.6 + 0.4 * pose.pop + Math.sin(pose.pop * Math.PI) * 0.25;
    c.eyes.forEach((e, i) => {
      const turn = state === "error" && active ? (i ? -30 : 30) : 0;
      const ex = e.x + gx * c.reach, ey = e.y + gy * c.reach * 0.7 + (state === "happy" && active ? -3 : 0);
      actor.eyes[i].setAttribute("transform",
        `translate(${ex.toFixed(2)} ${ey.toFixed(2)}) rotate(${e.r + turn}) scale(${pop.toFixed(3)} ${(Math.max(0.06, open) * pop).toFixed(3)})`);
    });

    // The mouth: hidden at rest, opens with the sound, a small grin when happy.
    const m = c.mouth;
    let width = m.w * 0.5, height = 0, alpha = 0;
    if (active && state === "speaking") {
      const talk = this.heard;
      height = 3 + talk * 30 * (0.7 + 0.3 * Math.sin(now * 21 + actor.index));
      width = m.w * (0.7 + 0.5 * talk);
      alpha = clamp(talk * 10, 0, 1);
    } else if (active && state === "happy") {
      height = 8; width = m.w * 0.9; alpha = 1;
    }
    height = clamp(height, 0, 30);
    actor.mouth.setAttribute("x", (m.x - width / 2).toFixed(2));
    actor.mouth.setAttribute("y", (m.y - height / 2).toFixed(2));
    actor.mouth.setAttribute("width", width.toFixed(2));
    actor.mouth.setAttribute("height", height.toFixed(2));
    actor.mouth.setAttribute("rx", (Math.min(width, height) / 2).toFixed(2));
    actor.mouth.setAttribute("opacity", alpha.toFixed(2));
  }
}
