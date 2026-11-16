// Compares two source-graph snapshots so a new board revision can be reviewed as a diff
// instead of being recopied by hand.
//   npm run protocol:diff -- <old source-graph.json> [new source-graph.json]
// To snapshot a new pack without touching the committed protocol:
//   cp protocol/generated/source-graph.json /tmp/old.json
//   npm run protocol:build -- --pack <new pack dir>     (then inspect and decide)
//   npm run protocol:diff -- /tmp/old.json
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Graph {
  snapshotDate: string;
  boards: { board: string; rawSha256: string }[];
  nodes: { id: string; section: string; textSha: string; title: string }[];
  edges: { id: string; from: string; to: string; label: string; storedIn: string }[];
}

export function diffGraphs(a: Graph, b: Graph) {
  const an = new Map(a.nodes.map((n) => [n.id, n]));
  const bn = new Map(b.nodes.map((n) => [n.id, n]));
  const ae = new Map(a.edges.map((e) => [e.id, e]));
  const be = new Map(b.edges.map((e) => [e.id, e]));
  return {
    snapshot: { from: a.snapshotDate, to: b.snapshotDate },
    boardsChanged: b.boards.filter((x) => a.boards.find((y) => y.board === x.board)?.rawSha256 !== x.rawSha256).map((x) => x.board),
    nodesAdded: [...bn.values()].filter((n) => !an.has(n.id)).map((n) => `${n.id}  ${n.title}`),
    nodesRemoved: [...an.values()].filter((n) => !bn.has(n.id)).map((n) => `${n.id}  ${n.title}`),
    nodesTextChanged: [...bn.values()].filter((n) => an.has(n.id) && an.get(n.id)!.textSha !== n.textSha).map((n) => `${n.id}  ${n.title}`),
    nodesMoved: [...bn.values()].filter((n) => an.has(n.id) && an.get(n.id)!.section !== n.section).map((n) => `${n.id}  ${an.get(n.id)!.section} -> ${n.section}`),
    edgesAdded: [...be.values()].filter((e) => !ae.has(e.id)).map((e) => `${e.id}  ${e.label || `${e.from}>${e.to}`}`),
    edgesRemoved: [...ae.values()].filter((e) => !be.has(e.id)).map((e) => `${e.id}  ${e.label || `${e.from}>${e.to}`}`),
    edgesRewired: [...be.values()].filter((e) => ae.has(e.id) && (ae.get(e.id)!.from !== e.from || ae.get(e.id)!.to !== e.to || ae.get(e.id)!.label !== e.label)).map((e) => `${e.id}  ${ae.get(e.id)!.label} -> ${e.label}`),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [oldPath, newPath = join(root, 'protocol/generated/source-graph.json')] = process.argv.slice(2);
  if (!oldPath) {
    console.error('usage: npm run protocol:diff -- <old source-graph.json> [new source-graph.json]');
    process.exit(2);
  }
  const d = diffGraphs(JSON.parse(readFileSync(oldPath, 'utf8')), JSON.parse(readFileSync(newPath, 'utf8')));
  let changes = 0;
  console.log(`snapshot ${d.snapshot.from} -> ${d.snapshot.to}; boards with a different raw hash: ${d.boardsChanged.join(', ') || 'none'}`);
  for (const [k, v] of Object.entries(d)) {
    if (!Array.isArray(v) || k === 'boardsChanged') continue;
    changes += v.length;
    console.log(`${k}: ${v.length}`);
    for (const line of v.slice(0, 50)) console.log(`  ${line}`);
  }
  console.log(changes ? `\n${changes} change(s). Every changed node needs its ledger row and overlay entries re-reviewed before the protocol version is bumped.` : '\nNo differences.');
}
