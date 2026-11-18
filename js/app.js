import { parse } from "./parse.js";
import { layout } from "./layout.js";

const NS = "http://www.w3.org/2000/svg";
const $ = (s) => document.querySelector(s);
const svg = $("#map");
const input = $("#input");

let graph = null;
let pos = new Map();
let view = { x: -400, y: -100, w: 800, h: 600 };
let els = { nodes: new Map(), links: [] };
let selected = null;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc */ } },
};

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// ---- device glyphs, drawn around (0,0) ----
function glyph(kind, g) {
  const add = (tag, a, cls = "glyph") => el(tag, { class: cls, ...a }, g);
  const line = (d) => add("path", { d }, "glyph-line");
  switch (kind) {
    case "router":
      add("circle", { r: 20 });
      line("M-11 -11 L-4 -4 M-11 -11 h5 M-11 -11 v5  M11 11 L4 4 M11 11 h-5 M11 11 v-5  M11 -11 L4 -4 M11 -11 h-5 M11 -11 v5  M-11 11 L-4 4 M-11 11 h5 M-11 11 v-5");
      break;
    case "switch":
      add("rect", { x: -26, y: -15, width: 52, height: 30, rx: 4 });
      line("M-17 -5 h22 m-4 -4 l4 4 l-4 4  M17 5 h-22 m4 -4 l-4 4 l4 4");
      break;
    case "firewall":
      add("rect", { x: -20, y: -18, width: 40, height: 36, rx: 3 });
      line("M-20 -6 h40 M-20 6 h40 M-6 -18 v12 M8 -6 v12 M-6 6 v12");
      break;
    case "ap":
      add("circle", { r: 15 });
      line("M-8 -1 a11 11 0 0 1 16 0 M-4.5 3 a6 6 0 0 1 9 0");
      add("circle", { cy: 7, r: 1.8, fill: "#fff" }, "glyph-dot");
      break;
    case "phone":
      add("rect", { x: -13, y: -15, width: 26, height: 30, rx: 4 });
      line("M-7 -9 h14 v7 h-14 z M-6 4 h2 M-1 4 h2 M4 4 h2 M-6 9 h2 M-1 9 h2 M4 9 h2");
      break;
    case "host":
      add("rect", { x: -18, y: -14, width: 36, height: 24, rx: 3 });
      add("rect", { x: -8, y: 12, width: 16, height: 4, rx: 1 });
      break;
    default:
      add("rect", { x: -16, y: -16, width: 32, height: 32, rx: 8 });
      el("text", { "text-anchor": "middle", y: 6, fill: "#fff", "font-size": 18, "font-weight": 700 }, g).textContent = "?";
  }
}

function tape(parent, text) {
  const g = el("g", { class: "tape" }, parent);
  const w = text.length * 6.4 + 8;
  el("rect", { x: -w / 2, y: -8, width: w, height: 16, rx: 1.5 }, g);
  el("text", { "text-anchor": "middle", y: 3.8 }, g).textContent = text;
  return g;
}

function linkClass(l) {
  const sev = graph.issues.filter(i => i.link === l.id).map(i => i.severity);
  if (sev.includes("high")) return "link bad";
  if (sev.includes("medium")) return "link warn";
  return "link";
}

function render() {
  svg.innerHTML = "";
  els = { nodes: new Map(), links: [] };
  if (!graph || !graph.devices.length) {
    const t = el("text", { x: 0, y: 0, "text-anchor": "middle", fill: "#56656E", "font-size": 16 }, svg);
    t.textContent = "Paste neighbour output on the left and press Draw map.";
    view = { x: -300, y: -200, w: 600, h: 400 };
    applyView();
    return;
  }
  const gl = el("g", {}, svg);
  const gt = el("g", {}, svg);
  const gn = el("g", {}, svg);

  for (const l of graph.links) {
    const path = el("path", { class: linkClass(l) }, gl);
    const ta = tape(gt, l.aIf), tb = tape(gt, l.bIf);
    els.links.push({ l, path, ta, tb });
  }

  for (const d of graph.devices) {
    const g = el("g", { class: "node" + (d.kind === "unknown" && !d.pasted ? " ghost" : ""), tabindex: 0 }, gn);
    g.dataset.id = d.id;
    el("circle", { class: "halo", r: 32, fill: "none" }, g);
    glyph(d.kind, g);
    el("text", { class: "name", y: 38, "text-anchor": "middle" }, g).textContent = d.id;
    if (d.ip) el("text", { class: "sub", y: 52, "text-anchor": "middle" }, g).textContent = d.ip;
    els.nodes.set(d.id, g);
  }
  update();
}

// curve parallel links apart so they don't sit on top of each other
function offsets() {
  const groups = new Map();
  for (const x of els.links) {
    const k = [x.l.a, x.l.b].sort().join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }
  const out = new Map();
  for (const g of groups.values()) {
    g.forEach((x, i) => out.set(x, (i - (g.length - 1) / 2) * 34));
  }
  return out;
}

function update() {
  for (const [id, g] of els.nodes) {
    const p = pos.get(id);
    g.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    g.classList.toggle("sel", id === selected);
  }
  const off = offsets();
  for (const x of els.links) {
    const a = pos.get(x.l.a), b = pos.get(x.l.b);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const o = off.get(x);
    const cx = (a.x + b.x) / 2 + nx * o * 2, cy = (a.y + b.y) / 2 + ny * o * 2;
    x.path.setAttribute("d", `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`);
    x.geom = { a, b, cx, cy, len };
  }
  placeTapes();
}

// Greedy label placement: each tape starts a little way out from its
// device and slides further along the cable until it doesn't overlap a
// device, a device name, or a tape that's already placed.
function placeTapes() {
  const boxes = [];
  for (const [id, p] of pos) {
    boxes.push({ x: p.x - 30, y: p.y - 24, w: 60, h: 48 });              // glyph
    const name = graph.devices.find(d => d.id === id);
    const w = Math.max(id.length * 8, (name?.ip || "").length * 6.6) + 6;
    boxes.push({ x: p.x - w / 2, y: p.y + 25, w, h: 32 });                // name + ip
  }
  const hit = (r) => boxes.some(b => r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h);

  const ends = [];
  for (const x of els.links) {
    ends.push({ x, tape: x.ta, text: x.l.aIf, from: "a" });
    ends.push({ x, tape: x.tb, text: x.l.bIf, from: "b" });
  }
  for (const e of ends) {
    const { a, b, cx, cy, len } = e.x.geom;
    const at = (t) => {
      const u = 1 - t;
      return [u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y];
    };
    const me = e.from === "a" ? a : b, other = e.from === "a" ? b : a;
    // cables leaving downwards have to clear the device name first
    const down = (other.y - me.y) / len > 0.3;
    const w = e.text.length * 6.4 + 8;
    let chosen = null;
    for (let d = down ? 74 : 44; d < len / 2; d += 14) {
      const t = d / len;
      const [px, py] = at(e.from === "a" ? t : 1 - t);
      const r = { x: px - w / 2, y: py - 8, w, h: 16 };
      if (!hit(r)) { chosen = [px, py, r]; break; }
      if (!chosen) chosen = [px, py, r];   // fallback: first spot, even if it overlaps
    }
    if (!chosen) {
      const [px, py] = at(e.from === "a" ? .35 : .65);
      chosen = [px, py, { x: px - w / 2, y: py - 8, w, h: 16 }];
    }
    boxes.push(chosen[2]);
    e.tape.setAttribute("transform", `translate(${chosen[0].toFixed(1)},${chosen[1].toFixed(1)})`);
  }
}

function applyView() {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
}

function fit() {
  if (!graph || !graph.devices.length) return;
  const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y);
  const pad = 90;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad + 20;
  const r = svg.clientWidth / Math.max(svg.clientHeight, 1);
  let w = maxX - minX, h = maxY - minY;
  if (w / h < r) w = h * r; else h = w / r;
  view = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
  applyView();
}

function toSvg(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: view.x + (clientX - r.left) / r.width * view.w, y: view.y + (clientY - r.top) / r.height * view.h };
}

// ---- interaction ----
let drag = null;
const pointers = new Map();

svg.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const node = e.target.closest(".node");
  svg.setPointerCapture(e.pointerId);
  if (pointers.size === 2) { drag = { pinch: true, d: dist(), view: { ...view } }; return; }
  if (node) {
    const p = pos.get(node.dataset.id);
    const s = toSvg(e.clientX, e.clientY);
    drag = { node: node.dataset.id, dx: p.x - s.x, dy: p.y - s.y, moved: false };
  } else {
    drag = { pan: true, sx: e.clientX, sy: e.clientY, view: { ...view }, moved: false };
    svg.classList.add("panning");
  }
});
svg.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag) return;
  if (drag.pinch && pointers.size === 2) {
    const k = drag.d / dist();
    view = { ...drag.view, w: drag.view.w * k, h: drag.view.h * k,
      x: drag.view.x + drag.view.w * (1 - k) / 2, y: drag.view.y + drag.view.h * (1 - k) / 2 };
    applyView();
  } else if (drag.node) {
    const s = toSvg(e.clientX, e.clientY);
    const p = pos.get(drag.node);
    p.x = s.x + drag.dx; p.y = s.y + drag.dy; p.pinned = true;
    drag.moved = true;
    update();
  } else if (drag.pan) {
    const r = svg.getBoundingClientRect();
    view.x = drag.view.x - (e.clientX - drag.sx) / r.width * view.w;
    view.y = drag.view.y - (e.clientY - drag.sy) / r.height * view.h;
    drag.moved = drag.moved || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4;
    applyView();
  }
});
function endDrag(e) {
  pointers.delete(e.pointerId);
  if (drag && drag.node && !drag.moved) select(drag.node);
  else if (drag && drag.pan && !drag.moved) select(null);
  drag = null;
  svg.classList.remove("panning");
}
svg.addEventListener("pointerup", endDrag);
svg.addEventListener("pointercancel", endDrag);
function dist() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  const k = Math.exp(e.deltaY * .0015);
  const s = toSvg(e.clientX, e.clientY);
  view = { x: s.x - (s.x - view.x) * k, y: s.y - (s.y - view.y) * k, w: view.w * k, h: view.h * k };
  applyView();
}, { passive: false });

svg.addEventListener("keydown", (e) => {
  const n = e.target.closest?.(".node");
  if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(n.dataset.id); }
});

function select(id) {
  selected = id;
  update();
  const card = $("#card");
  if (!id) { card.hidden = true; return; }
  const d = graph.devices.find(x => x.id === id);
  const ls = graph.links.filter(l => l.a === id || l.b === id);
  const rows = [["Type", d.kind], ["Platform", d.platform || "unknown"], ["IP", d.ip || "unknown"],
    ["Output pasted", d.pasted ? "yes" : "no, only seen by neighbours"]];
  card.innerHTML = `<h3>${esc(id)}</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <ul>${ls.map(l => l.a === id ? `<li>${esc(l.aIf)} → ${esc(l.b)} ${esc(l.bIf)}</li>` : `<li>${esc(l.bIf)} → ${esc(l.a)} ${esc(l.aIf)}</li>`).join("")}</ul>`;
  card.hidden = false;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderIssues() {
  const ul = $("#issues");
  if (!graph || !graph.devices.length) { ul.innerHTML = ""; return; }
  if (!graph.issues.length) { ul.innerHTML = `<li class="none">Nothing odd found.</li>`; return; }
  ul.innerHTML = graph.issues.map((i, n) =>
    `<li class="${i.severity}"><button type="button" data-n="${n}">${esc(i.text)}</button></li>`).join("");
}
$("#issues").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-n]");
  if (!b) return;
  const issue = graph.issues[b.dataset.n];
  document.querySelectorAll(".issues button").forEach(x => x.classList.toggle("on", x === b));
  for (const x of els.links) x.path.classList.toggle("hl", x.l.id === issue.link);
});

function draw({ keep = true } = {}) {
  graph = parse(input.value);
  const prev = keep ? pos : new Map();
  if (!keep) for (const p of pos.values()) p.pinned = false;
  pos = layout(graph, new Map([...prev].filter(([k]) => graph.devices.some(d => d.id === k))));
  selected = null;
  $("#card").hidden = true;
  render();
  fit();
  renderIssues();
  const pasted = graph.devices.filter(d => d.pasted).length;
  $("#stats").textContent = graph.devices.length
    ? `${graph.devices.length} devices, ${graph.links.length} links, output from ${pasted} device${pasted === 1 ? "" : "s"}.`
    : (input.value.trim() ? "Couldn't find any CDP or LLDP neighbour entries in that." : "");
  store.set("topoviz.input", input.value);
}

// ---- exports ----
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#dl-svg").addEventListener("click", () => {
  if (!graph) return;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", NS);
  const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } })
    .filter(t => /^(\.link|\.tape|\.node|:root)/.test(t)).join("\n");
  const st = document.createElementNS(NS, "style");
  st.textContent = css;
  clone.insertBefore(st, clone.firstChild);
  download("topology.svg", new XMLSerializer().serializeToString(clone), "image/svg+xml");
});
$("#dl-dot").addEventListener("click", () => {
  if (!graph) return;
  const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const shape = { router: "circle", switch: "box", firewall: "box3d", ap: "ellipse", phone: "note", host: "component" };
  const lines = ["graph topology {", "  rankdir=TB;", "  node [fontname=\"Helvetica\"];"];
  for (const d of graph.devices) lines.push(`  ${q(d.id)} [shape=${shape[d.kind] || "box"}, tooltip=${q(d.platform)}];`);
  for (const l of graph.links) lines.push(`  ${q(l.a)} -- ${q(l.b)} [taillabel=${q(l.aIf)}, headlabel=${q(l.bIf)}, fontsize=9];`);
  lines.push("}");
  download("topology.dot", lines.join("\n"), "text/vnd.graphviz");
});

$("#draw").addEventListener("click", () => draw());
$("#relayout").addEventListener("click", () => draw({ keep: false }));
$("#fit").addEventListener("click", fit);
$("#clear").addEventListener("click", () => { input.value = ""; draw({ keep: false }); input.focus(); });
$("#load-sample").addEventListener("click", loadSample);
input.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") draw(); });
window.addEventListener("resize", fit);

async function loadSample() {
  try {
    input.value = await (await fetch("samples/office.txt")).text();
  } catch {
    input.value = "";
  }
  draw({ keep: false });
}

const saved = store.get("topoviz.input");
if (saved && saved.trim()) { input.value = saved; draw(); }
else loadSample();
