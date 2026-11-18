import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "../js/parse.js";
import { layout, tiers } from "../js/layout.js";

const g = parse(readFileSync(new URL("../samples/office.txt", import.meta.url), "utf8"));

test("router on top, endpoints at the bottom", () => {
  const t = tiers(g.devices, g.links);
  assert.equal(t.get("edge-rtr01"), 0);
  assert.equal(t.get("core-sw01"), 1);
  assert.equal(t.get("SEP00EB1A2B3C4D"), 3);
});

test("same input, same picture", () => {
  const a = layout(g), b = layout(g);
  for (const [k, p] of a) assert.deepEqual([p.x, p.y], [b.get(k).x, b.get(k).y]);
});

test("no two devices in a row overlap", () => {
  const pos = layout(g);
  const ps = [...pos.values()];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++)
      if (Math.abs(ps[i].y - ps[j].y) < 40) assert.ok(Math.abs(ps[i].x - ps[j].x) >= 150, "overlap");
});
