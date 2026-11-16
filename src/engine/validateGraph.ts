// Static checks over the compiled protocol graph: missing endpoints, reachability,
// terminals, cycles and cross-pathway references.
import type { Pathway, Protocol, ProtocolNode } from '../protocol/schema';

export interface GraphReport {
  missingEndpoints: string[];
  unreachable: string[]; // executable nodes not reachable from any entry point
  terminals: { id: string; kind: string }[];
  cycles: string[][];
  crossPathway: { from: string; to: string }[];
  optionsWithoutBranch: string[];
}

export function successors(node: ProtocolNode, protocol: Protocol): string[] {
  const out: string[] = [];
  if (node.next) out.push(node.next);
  if (node.yes) out.push(node.yes);
  if (node.no) out.push(node.no);
  for (const o of node.options) if (o.next) out.push(o.next);
  for (const g of node.exerciseGroups) out.push(g);
  for (const r of node.related ?? []) out.push(r);
  const routing = (node as any).ageRouting;
  if (routing) out.push(routing.gte, routing.lt);
  if (node.kind === 'diagnosis' && node.workingDiagnosis && node.pathway) out.push(protocol.pathways[node.pathway].measureStart);
  if (node.outcome) for (const g of node.outcome.gatedNext) out.push(g);
  return out;
}

export function validateGraph(protocol: Protocol): GraphReport {
  const nodes = protocol.nodes;
  const exec = Object.values(nodes).filter((n) => !(n as any).reference);
  const report: GraphReport = { missingEndpoints: [], unreachable: [], terminals: [], cycles: [], crossPathway: [], optionsWithoutBranch: [] };

  for (const n of exec) {
    for (const s of successors(n, protocol)) if (!nodes[s]) report.missingEndpoints.push(`${n.id} -> ${s}`);
    for (const o of n.options) {
      for (const r of o.redirect) if (!nodes[r]) report.missingEndpoints.push(`${o.id} ~> ${r}`);
      if (!o.next && !o.redirect.length && n.kind !== 'followup_question') report.optionsWithoutBranch.push(o.id);
    }
  }

  const reached = new Set<string>();
  const stack = [protocol.triage.hip_knee.start, protocol.triage.spine.start];
  // switch targets are entered through pathway headers
  for (const p of Object.values(protocol.pathways)) stack.push(p.header);
  while (stack.length) {
    const id = stack.pop()!;
    if (reached.has(id) || !nodes[id]) continue;
    reached.add(id);
    const n = nodes[id];
    for (const s of successors(n, protocol)) stack.push(s);
    for (const o of n.options) for (const r of o.redirect) stack.push(r);
  }
  for (const n of exec) {
    if (!reached.has(n.id)) report.unreachable.push(n.id);
    if (successors(n, protocol).length === 0 && n.options.length === 0) report.terminals.push({ id: n.id, kind: n.kind });
    for (const s of successors(n, protocol)) {
      const t = nodes[s];
      if (t && n.pathway && t.pathway && n.pathway !== t.pathway) report.crossPathway.push({ from: n.id, to: s });
    }
  }

  // cycles via DFS over node successors (answer redirects excluded: they halt by design)
  const color = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const seenCycle = new Set<string>();
  const dfs = (id: string) => {
    color.set(id, 1);
    path.push(id);
    for (const s of nodes[id] ? successors(nodes[id], protocol) : []) {
      if (!nodes[s]) continue;
      const c = color.get(s) ?? 0;
      if (c === 0) dfs(s);
      else if (c === 1) {
        const cyc = path.slice(path.indexOf(s));
        const key = [...cyc].sort().join('|');
        if (!seenCycle.has(key)) {
          seenCycle.add(key);
          report.cycles.push(cyc);
        }
      }
    }
    path.pop();
    color.set(id, 2);
  };
  for (const n of exec) if (!color.get(n.id)) dfs(n.id);
  return report;
}

export function pathwayOf(protocol: Protocol, nodeId: string): Pathway | null {
  return protocol.nodes[nodeId]?.pathway ?? null;
}
