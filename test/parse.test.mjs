import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse, shortIf, cleanName } from "../js/parse.js";

const sample = readFileSync(new URL("../samples/office.txt", import.meta.url), "utf8");

test("interface names", () => {
  assert.equal(shortIf("GigabitEthernet1/0/24"), "Gi1/0/24");
  assert.equal(shortIf("TenGigabitEthernet1/1/1"), "Te1/1/1");
  assert.equal(shortIf("gi1/0/1"), "Gi1/0/1");
  assert.equal(shortIf("ether2"), "ether2");
  assert.equal(shortIf("eth0"), "eth0");
  assert.equal(shortIf("Port 1"), "Port 1");
  assert.equal(shortIf("Ethernet 1/49"), "Eth1/49");
});

test("device names", () => {
  assert.equal(cleanName("core-sw01.lab.local"), "core-sw01");
  assert.equal(cleanName("SEP001122334455(abc)"), "SEP001122334455");
  assert.equal(cleanName("10.1.1.1"), "10.1.1.1");
});

test("sample topology", () => {
  const g = parse(sample);
  const names = g.devices.map(d => d.id).sort();
  assert.deepEqual(names, ["AP-RECEPTION", "SEP00EB1A2B3C4D", "acc-sw02", "acc-sw03", "cctv-nvr01", "core-sw01", "edge-rtr01", "mt-backup-link"]);
  const kind = Object.fromEntries(g.devices.map(d => [d.id, d.kind]));
  assert.equal(kind["edge-rtr01"], "router");
  assert.equal(kind["acc-sw02"], "switch");
  assert.equal(kind["AP-RECEPTION"], "ap");
  assert.equal(kind["SEP00EB1A2B3C4D"], "phone");
  assert.equal(kind["mt-backup-link"], "router");
  // both sides of core<->sw02 merged: 2 links not 4
  const coreSw02 = g.links.filter(l => [l.a, l.b].sort().join() === "acc-sw02,core-sw01");
  assert.equal(coreSw02.length, 2);
  assert.ok(coreSw02.every(l => l.seenBy.length === 2));
  // phone port has a space in it
  const phone = g.links.find(l => l.a === "SEP00EB1A2B3C4D" || l.b === "SEP00EB1A2B3C4D");
  assert.ok([phone.aIf, phone.bIf].includes("Port 1"));
  // lldp: MAC port id replaced by port description
  const nvr = g.links.find(l => l.a === "cctv-nvr01" || l.b === "cctv-nvr01");
  assert.ok([nvr.aIf, nvr.bIf].includes("eth0"));
});

test("issues", () => {
  const { issues } = parse(sample);
  const text = issues.map(i => i.text).join("\n");
  assert.match(text, /Native VLAN mismatch.*core-sw01.*99.*1|Native VLAN mismatch.*acc-sw03.*1.*99/);
  assert.match(text, /Duplex mismatch/);
  assert.match(text, /core-sw01 sees acc-sw03 on Gi1\/0\/2, but acc-sw03 doesn't report it back/);
  assert.match(text, /2 links between acc-sw02 and core-sw01/);
});
