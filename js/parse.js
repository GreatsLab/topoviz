// Parse `show cdp neighbors detail` and `show lldp neighbors detail`
// output into devices + links.
//
// You can paste output from many devices into one box. Each chunk is
// tied to the device whose prompt appears above it ("core-sw01#show cdp ...").
// If there's no prompt, the chunk is assigned to "local".

const IF_ABBR = [
  [/^TwentyFiveGigE/i, "Twe"], [/^HundredGigE/i, "Hu"], [/^FortyGigabitEthernet/i, "Fo"],
  [/^TenGigabitEthernet/i, "Te"], [/^TwoGigabitEthernet/i, "Tw"], [/^FiveGigabitEthernet/i, "Fi"],
  [/^GigabitEthernet/i, "Gi"], [/^FastEthernet/i, "Fa"], [/^Ethernet/i, "Eth"],
  [/^Port-channel/i, "Po"], [/^Serial/i, "Se"], [/^Loopback/i, "Lo"],
  [/^mgmt/i, "mgmt"],
];

export function shortIf(name) {
  if (!name) return "";
  let n = name.trim();
  for (const [re, ab] of IF_ABBR) {
    // "GigabitEthernet 1/0/1" shows up too (NX-OS, some LLDP), drop the space
    if (re.test(n)) return n.replace(re, ab).replace(/^(\w+?)\s+(?=\d)/, "$1");
  }
  // already short (gi1/0/1, Te1/1/1) - fix the case of the Cisco prefixes only.
  // Leave things like "eth0" or "Port 1" alone, they're not Cisco names.
  const m = n.match(/^([A-Za-z]+)(\d+\/.*)$/);
  if (m) {
    const known = { gi: "Gi", fa: "Fa", te: "Te", eth: "Eth", po: "Po", fo: "Fo", hu: "Hu", tw: "Tw", twe: "Twe", se: "Se" };
    const k = known[m[1].toLowerCase()];
    if (k) return k + m[2];
  }
  return n;
}

export function cleanName(id) {
  if (!id) return "";
  let s = id.trim();
  // IP phones / some switches put the serial in brackets: "SEP0011223344(abc)"
  s = s.replace(/\(.*\)$/, "");
  // drop domain: core-sw01.lagos.corp -> core-sw01. Keep it if it looks like an IP.
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) s = s.split(".")[0];
  return s;
}

function kindFrom(platform = "", caps = "") {
  const p = platform.toLowerCase();
  const c = caps.toLowerCase();
  if (/phone|^sep|cp-\d/.test(p) || /phone/.test(c)) return "phone";
  if (/air-|ap\d|aironet|catalyst 91\d\d|c91\d\dax|access point/.test(p) || /wlan/.test(c)) return "ap";
  if (/asa|firepower|fortigate|palo|fpr/.test(p)) return "firewall";
  if (/routeros|mikrotik|vyos|edgeos|junos.*(mx|srx)/.test(p)) return "router";
  if (/router/.test(c) && !/switch/.test(c)) return "router";
  if (/isr|asr|csr|cisco \d{4}\b|c8\d{3}/.test(p)) return "router";
  if (/switch/.test(c) || /ws-c|c9[2-5]\d{2}|nexus|n\dk/.test(p)) return "switch";
  if (/router/.test(c)) return "router";
  if (/host|station/.test(c)) return "host";
  return "unknown";
}

const PROMPT = /^([A-Za-z0-9._\-]+)[#>]\s*(sh(ow)?\s+(cdp|lldp)\s+ne\S*\s+det\S*)/i;

function field(block, re) {
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

function parseCdpBlock(block) {
  const id = field(block, /Device ID:\s*(\S+)/i);
  if (!id) return null;
  const ip = field(block, /IP(?:v4)? address:\s*([\d.]+)/i);
  const platLine = field(block, /Platform:\s*([^\n]*)/i);
  const [platform, caps] = platLine.split(/,\s*Capabilities:\s*/i);
  const localIf = field(block, /Interface:\s*([^,\n]+)/i);
  // to end of line: IP phones report "Port 1" with a space
  const remoteIf = field(block, /Port ID \(outgoing port\):\s*([^\n]+)/i);
  const nativeVlan = field(block, /Native VLAN:\s*(\d+)/i);
  const duplex = field(block, /Duplex:\s*(\S+)/i);
  const version = field(block, /Version\s*:?\s*\n?([^\n]*Version[^\n]*)/i);
  return {
    proto: "cdp", remote: cleanName(id), remoteRaw: id, ip,
    platform: (platform || "").replace(/^cisco\s+/i, "").trim(),
    caps: (caps || "").trim(), localIf: shortIf(localIf), remoteIf: shortIf(remoteIf),
    nativeVlan: nativeVlan ? Number(nativeVlan) : null, duplex: duplex.toLowerCase() || null,
    version,
  };
}

function parseLldpBlock(block) {
  const sys = field(block, /System Name:\s*(\S+)/i);
  const chassis = field(block, /Chassis id:\s*(\S+)/i);
  const name = sys || chassis;
  if (!name) return null;
  const localIf = field(block, /Local Intf:\s*(\S+)/i);
  // "Port id: Gi0/1" - but some vendors put a MAC here and the name in Port Description
  let remoteIf = field(block, /Port id:\s*(\S+)/i);
  const portDesc = field(block, /Port Description:\s*([^\n]+)/i);
  if (/^([0-9a-f]{4}\.){2}[0-9a-f]{4}$|^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(remoteIf) && portDesc) remoteIf = portDesc;
  const caps = field(block, /System Capabilities:\s*([^\n]*)/i);
  const enabled = field(block, /Enabled Capabilities:\s*([^\n]*)/i);
  const desc = field(block, /System Description:\s*\n?\s*([^\n]+)/i);
  const ip = field(block, /IP(?:v4)?(?: address)?:\s*([\d.]+)/i);
  const capMap = { B: "Switch", R: "Router", W: "WLAN", T: "Phone", S: "Station", P: "Repeater" };
  const capsWords = (enabled || caps).split(/[,\s]+/).map(c => capMap[c] || c).join(" ");
  return {
    proto: "lldp", remote: cleanName(name), remoteRaw: name, ip,
    platform: desc.slice(0, 60), caps: capsWords,
    localIf: shortIf(localIf), remoteIf: shortIf(remoteIf),
    nativeVlan: null, duplex: null, version: desc,
  };
}

export function parse(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  // split into per-device chunks by prompt
  const chunks = [];
  let cur = { host: null, lines: [] };
  for (const line of lines) {
    const m = line.match(PROMPT);
    if (m) {
      if (cur.lines.length) chunks.push(cur);
      cur = { host: cleanName(m[1]), lines: [] };
      continue;
    }
    cur.lines.push(line);
  }
  if (cur.lines.length) chunks.push(cur);

  const neighbours = [];
  for (const ch of chunks) {
    const body = ch.lines.join("\n");
    const host = ch.host || "local";
    let blocks;
    if (/Device ID:/i.test(body)) {
      blocks = body.split(/^-{5,}\s*$/m).map(parseCdpBlock);
    } else if (/Local Intf:/i.test(body)) {
      blocks = body.split(/^-{5,}\s*$/m).map(parseLldpBlock);
    } else {
      continue;
    }
    for (const b of blocks) if (b) neighbours.push({ host, ...b });
  }
  return build(neighbours, chunks.map(c => c.host).filter(Boolean));
}

// turn the neighbour list into a graph, merging the A->B and B->A views
export function build(neighbours, pastedHosts = []) {
  const devices = new Map();
  const dev = (name) => {
    if (!devices.has(name)) devices.set(name, { id: name, kind: "unknown", platform: "", ip: "", pasted: false });
    return devices.get(name);
  };
  for (const h of pastedHosts) dev(h).pasted = true;

  const links = new Map();
  const key = (a, ai, b, bi) => (a < b || (a === b && ai < bi)) ? `${a}|${ai}|${b}|${bi}` : `${b}|${bi}|${a}|${ai}`;

  for (const n of neighbours) {
    dev(n.host);
    const r = dev(n.remote);
    if (n.platform && !r.platform) r.platform = n.platform;
    if (n.ip && !r.ip) r.ip = n.ip;
    const k = kindFrom(n.platform, n.caps);
    if (k !== "unknown" && r.kind === "unknown") r.kind = k;

    const id = key(n.host, n.localIf, n.remote, n.remoteIf);
    let l = links.get(id);
    if (!l) {
      const [a, ai, b, bi] = id.split("|");
      l = { id, a, aIf: ai, b, bIf: bi, seenBy: new Set(), info: {} };
      links.set(id, l);
    }
    l.seenBy.add(n.host);
    l.info[n.host] = { nativeVlan: n.nativeVlan, duplex: n.duplex, proto: n.proto };
  }

  const linkList = [...links.values()].map(l => ({ ...l, seenBy: [...l.seenBy] }));
  return { devices: [...devices.values()], links: linkList, issues: findIssues([...devices.values()], linkList) };
}

export function findIssues(devices, links) {
  const issues = [];
  const pasted = new Set(devices.filter(d => d.pasted).map(d => d.id));

  for (const l of links) {
    const ia = l.info[l.a], ib = l.info[l.b];
    const where = `${l.a} ${l.aIf} ↔ ${l.b} ${l.bIf}`;
    if (ia && ib) {
      if (ia.nativeVlan != null && ib.nativeVlan != null && ia.nativeVlan !== ib.nativeVlan) {
        issues.push({ severity: "high", link: l.id, text: `Native VLAN mismatch on ${where}: ${l.a} says ${ia.nativeVlan}, ${l.b} says ${ib.nativeVlan}` });
      }
      if (ia.duplex && ib.duplex && ia.duplex !== ib.duplex) {
        issues.push({ severity: "high", link: l.id, text: `Duplex mismatch on ${where}: ${ia.duplex} vs ${ib.duplex}` });
      }
    } else {
      // only one side reported it. If we have output from the other side too,
      // that side isn't running CDP/LLDP on that port - worth knowing.
      const silent = ia ? l.b : l.a;
      const seer = ia ? l.a : l.b;
      const silentIf = ia ? l.bIf : l.aIf;
      const seerIf = ia ? l.aIf : l.bIf;
      if (pasted.has(silent)) {
        issues.push({ severity: "medium", link: l.id, text: `${seer} sees ${silent} on ${seerIf}, but ${silent} doesn't report it back. CDP/LLDP is probably disabled on ${silent} ${silentIf}` });
      }
    }
  }

  // parallel links between the same pair that aren't port-channels
  const pairs = new Map();
  for (const l of links) {
    const p = [l.a, l.b].sort().join("|");
    if (!pairs.has(p)) pairs.set(p, []);
    pairs.get(p).push(l);
  }
  for (const [p, ls] of pairs) {
    if (ls.length > 1 && !ls.every(l => /^Po/.test(l.aIf))) {
      const [a, b] = p.split("|");
      issues.push({ severity: "low", link: ls[0].id, text: `${ls.length} links between ${a} and ${b} (${ls.map(l => l.aIf + "/" + l.bIf).join(", ")}). If they aren't in a port-channel, STP is blocking all but one` });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return issues.sort((x, y) => order[x.severity] - order[y.severity]);
}
