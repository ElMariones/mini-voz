// Voz, the mascot: a glass ball with two square eyes and a little equaliser
// for a mouth. Its eyes follow the pointer; its mouth moves with the audio.
// It is the only round, coloured thing on the page.

const SVG = `
<svg class="voz" viewBox="-125 -125 250 250" role="img" aria-label="Voz, la mascota de mini voz">
  <defs>
    <radialGradient id="voz-body" gradientUnits="userSpaceOnUse" cx="-42" cy="-58" r="205">
      <stop offset="0" stop-color="#fff0a8"/><stop offset=".2" stop-color="#ffc233"/>
      <stop offset=".46" stop-color="#ff6a3d"/><stop offset=".72" stop-color="#ec1f8f"/>
      <stop offset="1" stop-color="#5b1fd8"/>
    </radialGradient>
    <radialGradient id="voz-shade" gradientUnits="userSpaceOnUse" cx="-20" cy="-30" r="150">
      <stop offset=".55" stop-color="#2a0050" stop-opacity="0"/><stop offset="1" stop-color="#2a0050" stop-opacity=".5"/>
    </radialGradient>
    <linearGradient id="voz-gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="voz-glow" gradientUnits="userSpaceOnUse" cx="30" cy="62" r="70">
      <stop offset="0" stop-color="#ff9ad5" stop-opacity=".55"/><stop offset="1" stop-color="#ff9ad5" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g class="voz-body">
    <circle r="100" fill="url(#voz-body)"/>
    <circle r="100" fill="url(#voz-shade)"/>
    <circle r="100" fill="url(#voz-glow)"/>
    <g class="voz-face">
      <g class="voz-eye" data-x="-27"><rect x="-10" y="-19" width="20" height="38"/><rect class="voz-glint" x="3" y="-15" width="5" height="5"/></g>
      <g class="voz-eye" data-x="27"><rect x="-10" y="-19" width="20" height="38"/><rect class="voz-glint" x="3" y="-15" width="5" height="5"/></g>
      <g class="voz-mouth" transform="translate(0 46)">
        <rect x="-20.5" width="5"/><rect x="-11.5" width="5"/><rect x="-2.5" width="5"/><rect x="6.5" width="5"/><rect x="15.5" width="5"/>
      </g>
    </g>
    <ellipse class="voz-gloss" cx="-36" cy="-56" rx="46" ry="24" transform="rotate(-30 -36 -56)" fill="url(#voz-gloss)"/>
    <circle r="99.25" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.5"/>
  </g>
</svg>`;

const SHAPE = [0.55, 0.85, 1, 0.8, 0.5];        // how much each mouth bar moves
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class Mascot {
  constructor(host, { onPoke } = {}) {
    host.innerHTML = SVG;
    this.host = host;
    this.svg = host.querySelector("svg");
    this.body = host.querySelector(".voz-body");
    this.face = host.querySelector(".voz-face");
    this.eyes = [...host.querySelectorAll(".voz-eye")];
    this.glints = [...host.querySelectorAll(".voz-glint")];
    this.bars = [...host.querySelectorAll(".voz-mouth rect")];
    this.gloss = host.querySelector(".voz-gloss");
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
    this.calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.addEventListener("pointermove", (event) => this.follow(event.clientX, event.clientY), { passive: true });
    window.addEventListener("pointerdown", (event) => this.follow(event.clientX, event.clientY), { passive: true });
    // "click", not "pointerdown": phones only allow sound to start from a finished tap.
    this.svg.addEventListener("click", () => {
      this.poke = 1;
      this.blink = 1;
      if (onPoke) onPoke();
    });
    this.wander = { x: 0, y: 0, at: 0 };
    this.frame = this.frame.bind(this);
    this.last = performance.now() / 1000;
    requestAnimationFrame(this.frame);
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
    const reach = distance / (distance + box.width * 0.6);     // far away: full turn; close: small
    this.target.x = (dx / distance) * reach;
    this.target.y = (dy / distance) * reach;
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
        if (now > this.wander.at) {
          this.wander = { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.5) * 0.7, at: now + 1.4 + Math.random() * 2.2 };
        }
        this.target.x = this.wander.x;
        this.target.y = this.wander.y;
      }
    }
    const ease = 1 - Math.exp(-dt * (state === "idle" || state === "speaking" ? 9 : 6));
    this.gaze.x += (this.target.x - this.gaze.x) * ease;
    this.gaze.y += (this.target.y - this.gaze.y) * ease;

    // Blinking.
    this.nextBlink -= dt;
    if (this.nextBlink < 0) {
      this.blink = 1;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    let open = 1 - Math.sin(Math.min(1, this.blink) * Math.PI) * 0.92;
    if (state === "happy") open = 0.22;
    if (state === "thinking") open = Math.min(open, 0.62);

    // Loudness, smoothed: quick to rise, slower to fall.
    const loud = state === "speaking" ? this.level : 0;
    this.heard += (loud - this.heard) * (1 - Math.exp(-dt * (loud > this.heard ? 30 : 10)));

    this.poke = Math.max(0, this.poke - dt * 2.6);
    const squash = Math.sin(this.poke * Math.PI) * 0.09;
    const calm = this.calm;
    const float = calm ? 0 : Math.sin(now * 1.5) * 4 + (state === "happy" ? -Math.abs(Math.sin(now * 9)) * 9 : 0);
    const pulse = 1 + this.heard * 0.035;
    const gx = this.gaze.x, gy = this.gaze.y;

    this.body.setAttribute("transform",
      `translate(0 ${float.toFixed(2)}) rotate(${(gx * 5).toFixed(2)}) scale(${(pulse * (1 + squash)).toFixed(4)} ${(pulse * (1 - squash)).toFixed(4)})`);
    this.face.setAttribute("transform", `translate(${(gx * 17).toFixed(2)} ${(gy * 15).toFixed(2)})`);
    this.eyes.forEach((eye, index) => {
      const x = Number(eye.dataset.x) + gx * 5;
      const y = -6 + gy * 4 + (state === "happy" ? -4 : 0);
      const turn = state === "error" ? (index ? -45 : 45) : 0;
      eye.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${turn}) scale(1 ${open.toFixed(3)})`);
    });
    this.glints.forEach((glint) => glint.setAttribute("transform", `translate(${(-gx * 2.5).toFixed(2)} ${(-gy * 2.5).toFixed(2)})`));
    this.gloss.setAttribute("opacity", (0.6 - gy * 0.12).toFixed(3));

    // The mouth: a dotted line at rest, an equaliser when there is sound.
    this.bars.forEach((bar, index) => {
      let height = 3;
      if (state === "speaking") {
        height = 3 + this.heard * 34 * SHAPE[index] * (0.65 + 0.35 * Math.sin(now * 23 + index * 1.9));
      } else if (state === "loading" || state === "thinking") {
        height = 3 + (calm ? 0 : 5 * (0.5 + 0.5 * Math.sin(now * 7 - index * 0.9)));
      } else if (state === "happy") {
        height = 4 + SHAPE[index] * 7;
      }
      height = clamp(height, 3, 34);
      bar.setAttribute("height", height.toFixed(2));
      bar.setAttribute("y", (state === "happy" ? 0 : -height / 2).toFixed(2));
    });
    requestAnimationFrame(this.frame);
  }
}
