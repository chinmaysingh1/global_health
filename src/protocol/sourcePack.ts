// Node-only loader for the frozen FigJam source snapshot (CHW_MSK_Claude_Source_Pack).
// Reads the manifest, every section file and the complete connector index, and verifies
// the raw XML hashes recorded in the manifest. Used by the build script and by tests.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Board } from './schema';

export interface SourceNode {
  board: Board;
  fileKey: string;
  nodeId: string;
  sectionId: string;
  sectionName: string;
  shape: string;
  text: string;
  textSha: string;
}
export interface SourceEdge {
  board: Board;
  fileKey: string;
  connectorId: string;
  from: string;
  to: string;
  label: string;
  storedIn: string; // section id, or 'page'
}
export interface SourceSection {
  board: Board;
  id: string;
  name: string;
  path: string;
}
export interface SourcePack {
  snapshotDate: string;
  boards: { board: Board; fileKey: string; rawSha256: string; rawShaVerified: boolean; url: string }[];
  sections: SourceSection[];
  nodes: SourceNode[];
  edges: SourceEdge[];
  manifestCounts: Record<string, { sections: number; shape_nodes: number; connectors: number }>;
}

const unescape = (s: string) =>
  s
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export function loadSourcePack(packDir: string): SourcePack {
  const manifest = JSON.parse(readFileSync(join(packDir, 'sources/manifest.json'), 'utf8'));
  const pack: SourcePack = {
    snapshotDate: manifest.snapshot_date,
    boards: [],
    sections: [],
    nodes: [],
    edges: [],
    manifestCounts: {},
  };
  for (const b of manifest.boards) {
    const board = b.name as Board;
    const raw = readFileSync(join(packDir, b.raw_path));
    pack.boards.push({
      board,
      fileKey: b.file_key,
      rawSha256: b.raw_sha256,
      rawShaVerified: sha(raw) === b.raw_sha256,
      url: b.url,
    });
    pack.manifestCounts[board] = b.counts;
    const seenConnectors = new Map<string, SourceEdge>();
    const addEdge = (e: any, storedIn: string) => {
      const a = e.attributes;
      const prev = seenConnectors.get(a.id);
      if (prev) {
        if (prev.storedIn === 'index' && storedIn !== 'index') prev.storedIn = storedIn;
        return;
      }
      const edge: SourceEdge = {
        board,
        fileKey: b.file_key,
        connectorId: a.id,
        from: a.connectorStart,
        to: a.connectorEnd,
        label: unescape(e.text ?? ''),
        storedIn,
      };
      seenConnectors.set(a.id, edge);
      pack.edges.push(edge);
    };
    for (const s of b.sections) {
      pack.sections.push({ board, id: s.id, name: s.name, path: s.path });
      const sec = JSON.parse(readFileSync(join(packDir, s.path), 'utf8'));
      for (const e of sec.elements) {
        if (e.type === 'connector') addEdge(e, s.id);
        else {
          const text = unescape(e.text ?? '').trim();
          pack.nodes.push({
            board,
            fileKey: b.file_key,
            nodeId: e.attributes.id,
            sectionId: s.id,
            sectionName: s.name,
            shape: e.attributes.name ?? '',
            text,
            textSha: sha(text).slice(0, 16),
          });
        }
      }
    }
    const page = JSON.parse(readFileSync(join(packDir, b.page_level_connectors), 'utf8'));
    for (const e of page.elements) addEdge(e, 'page');
    // The complete index duplicates edges; it is used only to detect anything missed above.
    const index = JSON.parse(readFileSync(join(packDir, b.all_connectors), 'utf8'));
    for (const e of index.elements) addEdge(e, 'index');
  }
  return pack;
}
