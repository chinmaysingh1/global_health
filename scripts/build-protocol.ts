// Reproducible import: frozen source pack + reviewed overlay -> compiled protocol + ledger.
//   npm run protocol:build [-- --pack <dir>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSourcePack } from '../src/protocol/sourcePack';
import { compileProtocol, type Overlay } from '../src/protocol/compile';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argPack = process.argv.indexOf('--pack');
const packDir = argPack > -1 ? resolve(process.argv[argPack + 1]) : join(root, 'CHW_MSK_Claude_Source_Pack');

const pack = loadSourcePack(packDir);
for (const b of pack.boards) {
  if (!b.rawShaVerified) throw new Error(`Raw XML hash mismatch for ${b.board}; refusing to build from an unverified snapshot.`);
}
const overlay = JSON.parse(readFileSync(join(root, 'protocol/overlay/overlay.json'), 'utf8')) as Overlay;
const { protocol, ledger, issues } = compileProtocol(pack, overlay);

const out = (rel: string, data: unknown) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 1) + '\n');
};
// Stable snapshot of the source graph for diffing future board revisions.
out('protocol/generated/source-graph.json', {
  snapshotDate: pack.snapshotDate,
  boards: pack.boards,
  nodes: pack.nodes.map((n) => ({ id: `${n.board}:${n.nodeId}`, section: n.sectionName, textSha: n.textSha, title: n.text.split('\n')[0] })),
  edges: pack.edges.map((e) => ({ id: `${e.board}:${e.connectorId}`, from: e.from, to: e.to, label: e.label, storedIn: e.storedIn })),
});
out('protocol/compiled/protocol.json', protocol);
out('protocol/compiled/ledger.json', ledger);
out('protocol/compiled/issues.json', issues);

const count = (f: (l: (typeof ledger)[number]) => boolean) => ledger.filter(f).length;
console.log(`snapshot ${pack.snapshotDate}; protocol ${protocol.protocolVersion}`);
for (const b of pack.boards) {
  console.log(
    `${b.board}: nodes ${count((l) => l.board === b.board && l.elementType === 'node')}/${pack.manifestCounts[b.board].shape_nodes}, ` +
      `connectors ${count((l) => l.board === b.board && l.elementType === 'connector')}/${pack.manifestCounts[b.board].connectors}`,
  );
}
for (const c of ['implemented', 'supporting_reference', 'duplicate', 'blocked'] as const) {
  console.log(`  ${c}: ${count((l) => l.classification === c)}`);
}
console.log(`protocol nodes: ${Object.keys(protocol.nodes).length}; structural findings: ${issues.length}`);
