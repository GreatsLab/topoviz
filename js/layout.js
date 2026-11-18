// Layered force layout.
//
// Plain force-directed graphs of networks look like spilled spaghetti.
// Network diagrams are read top to bottom: edge -> core -> access -> stuff
// plugged in. So: pick a root (router / firewall, else the busiest box), BFS
// to get each device's tier, pin y to the tier, let forces sort out x.
// Deterministic (seeded) so the same paste gives the same picture.

const TIER_GAP = 150;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function tiers(devices, links) {
  const adj = new Map(devices.map(d => [d.id, new Set()]));
  for (const l of links) { adj.get(l.a).add(l.b); adj.get(l.b).add(l.a); }
  const rank = { firewall: 0, router: 1, switch: 2, unknown: 3, ap: 4, host: 4, phone: 4 };

  const tier = new Map();
  const remaining = new Set(devices.map(d => d.id));
  // one BFS per connected component; components share tiers and get
  // pushed apart sideways by the repulsion

  while (remaining.size) {
    const cands = devices.filter(d => remaining.has(d.id));
    cands.sort((a, b) => rank[a.kind] - rank[b.kind] || adj.get(b.id).size - adj.get(a.id).size || a.id.localeCompare(b.id));
    const root = cands[0].id;
    const q = [root];
    tier.set(root, 0);
    remaining.delete(root);
    while (q.length) {
      const u = q.shift();
      for (const v of [...adj.get(u)].sort()) {
        if (!remaining.has(v)) continue;
        remaining.delete(v);
        tier.set(v, tier.get(u) + 1);
        q.push(v);
      }
    }
  }
  return tier;
}

export function layout(graph, prev = new Map()) {
  const { devices, links } = graph;
  const tier = tiers(devices, links);
  const rand = rng(hash(devices.map(d => d.id).sort().join()));

  const byTier = new Map();
  for (const d of devices) {
    const t = tier.get(d.id) ?? 0;
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(d);
  }

  const pos = new Map();
  for (const [t, ds] of byTier) {
    ds.sort((a, b) => a.id.localeCompare(b.id));
    ds.forEach((d, i) => {
      const p = prev.get(d.id);
      pos.set(d.id, p ? { ...p } : { x: (i - (ds.length - 1) / 2) * 160 + (rand() - .5) * 20, y: t * TIER_GAP, vx: 0, vy: 0 });
    });
  }
  const fixed = new Set([...prev.keys()].filter(k => prev.get(k).pinned));

  const N = devices.length;
  for (let it = 0; it < 400; it++) {
    const alpha = 1 - it / 400;
    // repulsion (n^2 is fine, nobody pastes 2000 devices into a text box)
    for (let i = 0; i < N; i++) {
      const a = pos.get(devices[i].id);
      for (let j = i + 1; j < N; j++) {
        const b = pos.get(devices[j].id);
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = rand() - .5; dy = rand() - .5; d2 = 1; }
        const f = 9000 / d2 * alpha;
        const d = Math.sqrt(d2);
        a.vx -= dx / d * f; a.vy -= dy / d * f * .2;
        b.vx += dx / d * f; b.vy += dy / d * f * .2;
      }
    }
    // springs along links, mostly horizontal pull (vertical is the tier's job)
    for (const l of links) {
      const a = pos.get(l.a), b = pos.get(l.b);
      const dx = b.x - a.x;
      a.vx += dx * .02 * alpha;
      b.vx -= dx * .02 * alpha;
    }
    for (const d of devices) {
      const p = pos.get(d.id);
      if (fixed.has(d.id)) { p.vx = p.vy = 0; continue; }
      const ty = (tier.get(d.id) ?? 0) * TIER_GAP;
      p.vy += (ty - p.y) * .15;
      p.vx += -p.x * .002;           // weak pull to centre so components don't drift off
      p.x += p.vx; p.y += p.vy;
      p.vx *= .6; p.vy *= .6;
    }
  }
  for (const [k, p] of pos) { if (fixed.has(k)) p.pinned = true; }
  return pos;
}
