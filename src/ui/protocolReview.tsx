// Review tool: provenance, coverage, proposed amendments, structural findings, translation
// status. Technical detail lives here, away from the CHW flow.
import { useEffect, useMemo, useState } from 'react';
import { protocol, isReference } from '../protocol';
import type { LedgerEntry } from '../protocol/schema';
import { validateGraph } from '../engine/validateGraph';
import { translationCoverage } from '../i18n';
import { UI } from '../i18n/ui';
import { Card, Icon } from './common';
import { useApp } from './ctx';

export function ProtocolReview({ nav }: { nav: (p: string) => void }) {
  const { tr } = useApp();
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    void import('../../protocol/compiled/ledger.json').then((m) => setLedger(m.default as LedgerEntry[]));
    void import('../../protocol/compiled/issues.json').then((m) => setIssues(m.default as string[]));
  }, []);
  const graph = useMemo(() => validateGraph(protocol), []);
  const cov = useMemo(() => translationCoverage(Object.values(protocol.nodes)), []);
  const nodes = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return Object.values(protocol.nodes).filter((n) => (n.source.code ?? '').toLowerCase() === s || n.sourceText.toLowerCase().includes(s)).slice(0, 25);
  }, [q]);
  const count = (f: (l: LedgerEntry) => boolean) => (ledger ?? []).filter(f).length;
  return (
    <>
      <header className="appbar">
        <div className="appbar-in">
          <div className="appbar-row">
            <button type="button" className="backbtn" onClick={() => nav('/')}><Icon name="chevron-left" size={22} />{tr('nav.patients')}</button>
          </div>
        </div>
      </header>
      <main className="page no-bar">
        <div className="pagehead"><span className="eyebrow">{tr('set.evaluation')}</span><h1 tabIndex={-1} data-page-title>{tr('pr.title')}</h1><p className="lede">{tr('app.banner')}</p></div>
        <div lang="en">
        <Card title={tr('pr.coverage')}>
          <p>Protocol <code>{protocol.protocolVersion}</code> · snapshot {protocol.snapshotDate} · clinical approval: <strong>none</strong> · source revision: not provided (live freshness unverified)</p>
          {protocol.sources.map((s) => <p key={s.board} className="muted">{s.board}: file <code>{s.fileKey}</code> · sha256 <code>{s.rawSha256.slice(0, 16)}…</code></p>)}
          {ledger && (
            <div className="table-wrap"><table>
              <thead><tr><th>Board</th><th>Nodes</th><th>Connectors</th><th>Implemented</th><th>Reference</th><th>Blocked</th></tr></thead>
              <tbody>
                {(['spine', 'hip_knee'] as const).map((b) => (
                  <tr key={b}><td>{b}</td><td>{count((l) => l.board === b && l.elementType === 'node')}</td><td>{count((l) => l.board === b && l.elementType === 'connector')}</td><td>{count((l) => l.board === b && l.classification === 'implemented')}</td><td>{count((l) => l.board === b && l.classification === 'supporting_reference')}</td><td>{count((l) => l.board === b && l.classification === 'blocked')}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="muted">"Implemented" means the source element is represented and executed as drawn. It does not mean the content is clinically correct or approved. Every node carries review status <code>source_draft_unreviewed</code>.</p>
        </Card>
        <Card title={tr('pr.amendments')}>
          {protocol.amendments.map((a) => (
            <details key={a.id} className="disclose">
              <summary>{a.id} · {a.status}<Icon name="chevron-down" /></summary>
              <p><strong>Issue.</strong> {a.issue}</p>
              <p><strong>Proposal.</strong> {a.proposal}</p>
              <p className="muted">Targets: {a.targets.join(', ')} · Implemented as: {a.implementedAs} · Status: {a.status}</p>
            </details>
          ))}
        </Card>
        <Card title={tr('pr.findings')}>
          <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
          <p>Cycles in the executable graph ({graph.cycles.length}):</p>
          <ul>{graph.cycles.map((c, i) => <li key={i}>{c.map((id) => id.split(':')[1]).join(' → ')}</li>)}</ul>
          <p className="muted">Missing endpoints: {graph.missingEndpoints.length} · Unreachable executable nodes: {graph.unreachable.length} · Cross-pathway edges: {graph.crossPathway.length} · Terminal nodes: {graph.terminals.length}</p>
        </Card>
        <Card title={tr('pr.translations')}>
          <p>UI strings: {Object.keys(UI).length} keys in English, Hindi and Marathi. Hindi and Marathi are <strong>machine-authored drafts, not reviewed</strong>.</p>
          <p>Protocol titles with a draft Hindi/Marathi translation: {cov.titlesTranslated} of {cov.titles}. Answer options: {cov.optionsTranslated} of {cov.options}.</p>
          <p className="muted">Untranslated clinical instructions are shown in the English source with a visible marker. No translation has been reviewed by a translator or clinician.</p>
        </Card>
        <Card title={tr('pr.nodes')}>
          <div className="field">
            <label htmlFor="q">{tr('pr.search')}</label>
            <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {nodes.map((n) => (
            <details key={n.id} className="disclose">
              <summary><span>{n.source.code ?? n.id} · {n.kind}{isReference(n) ? ' (reference)' : ''} · {n.title.slice(0, 60)}</span><Icon name="chevron-down" /></summary>
              <p className="muted">{n.id} · Figma node {n.source.nodeId} in file {n.source.fileKey} · {n.reviewStatus}{n.capabilities.length ? ` · needs: ${n.capabilities.join(', ')}` : ''}</p>
              <div className="src">{n.sourceText}</div>
              {n.outcome && <p className="muted">Policy: {JSON.stringify({ urgency: n.outcome.urgency, timing: n.outcome.timing, continues: n.outcome.assessmentMayContinue, exercise: n.outcome.exerciseRestriction, basis: n.outcome.policyBasis })}</p>}
            </details>
          ))}
        </Card>
        </div>
      </main>
    </>
  );
}
