import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { protocol } from '../protocol';
import type { AnswerStatus, Encounter, Lang, Laterality, Patient, Region } from '../store/types';
import { LANGS } from '../store/types';
import { addComplaint, addNarrative, addProposals, decideProposal, logAiUsage, proposalConflict, setConsent, setHistoryField, setPatientLanguage, setSync, withdrawComplaint } from '../store/encounter';
import { HISTORY_CHOICE_FIELDS, HISTORY_LIST_FIELDS, HISTORY_TEXT_FIELDS, LOCAL_TASKS, MODIFIER_FIELDS } from '../store/historyFields';
import { evaluateEncounterComplaints } from '../engine/evaluate';
import { buildSummary, type EncounterSummary } from '../engine/summary';
import { permittedTargets } from '../ai/permitted';
import { runExtraction } from '../ai/orchestrator';
import { mockProvider } from '../ai/mockProvider';
import { httpProvider } from '../ai/httpProvider';
import { LANG_NAMES, nodeTitle } from '../i18n';
import { Card, Choice, Icon, Loc, Notice, PageHead, Pill, RadioGroup, Sheet, StatusButtons, fmtTime } from './common';
import { useApp, type Update } from './ctx';
import { AssessTab, complaintLabel } from './assess';
import { PlanTab, ReviewTab, SummaryTab } from './review';
import { FollowUpTab } from './followup';
import { ExportTab } from './exportsync';
import { SettingsBody, SyncPill } from './home';
import { STAGES, fill, itemsText, nextAction, normalizeSection, sectionLabelKey, sectionStatus, stageLabelKey, stageOf, stageSections, stageStatus, type Section, type Status } from './flow';

/** Text typed but not yet saved survives moving between sections (kept for this browser session only). */
export function useDraft(key: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => { try { return sessionStorage.getItem(key) ?? ''; } catch { return ''; } });
  return [v, (x: string) => { setV(x); try { if (x) sessionStorage.setItem(key, x); else sessionStorage.removeItem(key); } catch { /* convenience only */ } }];
}

/**
 * Keeps fixed and sticky chrome from covering content at any text size: the page reserves exactly
 * the bottom bar's real height, and the header stops sticking if it would take over a third of the screen.
 */
function useChromeSizing() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const bar = document.querySelector<HTMLElement>('.bottombar');
    const head = document.querySelector<HTMLElement>('.appbar');
    const apply = () => {
      if (bar) root.style.setProperty('--bottombar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
      if (head) head.classList.toggle('appbar-static', head.getBoundingClientRect().height > window.innerHeight * 0.34);
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (bar) ro?.observe(bar);
    if (head) ro?.observe(head);
    window.addEventListener('resize', apply);
    return () => { ro?.disconnect(); window.removeEventListener('resize', apply); root.style.removeProperty('--bottombar-h'); };
  }, []);
}

const STATUS_ICON: Record<Status, string> = { done: 'check', progress: '', attention: 'alert', todo: '' };
function StatusDot({ s }: { s: Status }) {
  return <span className={`stat ${s}`} aria-hidden="true">{STATUS_ICON[s] && <Icon name={STATUS_ICON[s]} size={14} />}</span>;
}
const statusKey = (s: Status) => (s === 'done' ? 'flow.done' : s === 'attention' ? 'flow.attention' : s === 'progress' ? 'home.inProgress' : 'flow.notStarted');

function SaveState({ enc }: { enc: Encounter }) {
  const { tr, store } = useApp();
  const save = store.saveState;
  if (save.status === 'error') return <Pill tone="danger" icon="alert">{tr('save.error')}</Pill>;
  const label = save.status === 'saving' ? tr('save.saving') : `${tr('save.saved')} · ${fmtTime(save.at ?? enc.updatedAt)}`;
  return <span className="savestate" role="status" aria-live="polite" title={label}><Icon name={save.status === 'saving' ? 'clock' : 'check'} size={15} /><span className="sv-time">{fmtTime(save.at ?? enc.updatedAt)}</span><span className="sr-only">{label}</span></span>;
}

function OverviewBody({ enc, summary, patient, section, go }: { enc: Encounter; summary: EncounterSummary; patient: Patient; section: Section; go: (path: string) => void }) {
  const { tr } = useApp();
  const current = stageOf(enc.type, section);
  return (
    <nav aria-label={tr('nav.overview')}>
      <p className="muted" style={{ margin: '0 4px 12px' }}>{patient.name} · {enc.type === 'followup' ? tr(`visit.${enc.visit}`) : tr('home.initial')}</p>
      {STAGES.map((st, i) => (
        <div key={st} className={`ov-stage ${st === current ? 'is-current' : ''}`}>
          <h3><span className="num">{i + 1}</span>{tr(stageLabelKey(enc.type, st))}</h3>
          <ul className="list ov-list">
            {stageSections(enc.type)[st].map((sec) => {
              const s = sectionStatus(enc, summary, sec);
              const count = sec === 'summary' ? summary.pending.length : 0;
              return (
                <li key={sec}>
                  <a className="ov-item" href={`#/enc/${enc.id}/${sec}`} aria-current={sec === section ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(`/enc/${enc.id}/${sec}`); }}>
                    <StatusDot s={s} />
                    <span className="body">
                      <span className="t">{tr(sectionLabelKey(sec))}</span>
                      <span className="s">{sec === section ? `${tr('flow.current')} · ` : ''}{count ? itemsText(count, tr) : tr(statusKey(s))}</span>
                    </span>
                    <Icon name="chevron-right" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="row" style={{ margin: '4px 4px 12px' }}><span className="muted">{tr('sync.status')}:</span><SyncPill state={enc.sync.state} /></div>
      <p className="faint" style={{ margin: '0 4px' }}>{tr('app.banner')}</p>
    </nav>
  );
}

export function EncounterScreen({ enc, patient, section: raw, focusNode, nav }: { enc: Encounter; patient: Patient; section?: string; focusNode?: string; nav: (p: string) => void }) {
  const { tr, store, actor, settings, lang, online } = useApp();
  const [overview, setOverview] = useState(false);
  const [langRole, setLangRole] = useState(false);
  const update: Update = (fn) => {
    const cur = store.get(enc.id);
    if (cur) void store.put(fn(cur));
  };
  const summary = useMemo(() => buildSummary(protocol, patient, enc), [enc, patient]);
  useChromeSizing();
  const section = normalizeSection(enc.type, raw);
  const stage = stageOf(enc.type, section);
  const stageIdx = STAGES.indexOf(stage);
  const sections = stageSections(enc.type)[stage];
  const go = (t: string) => nav(`/enc/${enc.id}/${t}`);
  const unacked = summary.alerts.filter((a) => !enc.alertAcks[a.key]).length;
  const assessSection: Section = enc.type === 'followup' ? 'followup' : 'assess';
  const next = nextAction(enc, summary, section);

  const runNext = () => {
    if (next.kind === 'go') go(next.to);
    else if (next.kind === 'markReady') { update((e) => setSync(e, actor, { ...e.sync, state: 'awaiting_review' })); go('review'); }
    else if (next.kind === 'home') nav('/');
  };
  // while a clinician still has a decision to record on this screen, the decision is the main action
  const quietNext = next.kind === 'home' || (section === 'review' && actor.role === 'clinician' && summary.complaints.some((c) => c.plan.status !== 'approved_demo_only'));
  const nextLabel = next.kind === 'go' ? (next.sectionLabel ? fill(tr('flow.continueTo'), { x: tr(next.labelKey) }) : tr(next.labelKey)) : next.kind === 'markReady' ? tr('sync.markReady') : next.kind === 'home' ? tr('flow.finish') : '';

  return (
    <>
      <header className="appbar">
        <div className="appbar-in">
          <div className="appbar-row">
            <button type="button" className="backbtn" onClick={() => nav('/')}><Icon name="chevron-left" size={22} />{tr('nav.patients')}</button>
            <div className="appbar-title" />
            {!online && <Pill tone="attn" icon="wifi-off"><span className="sr-only">{tr('app.offline')}</span></Pill>}
            <SaveState enc={enc} />
            <button type="button" className="chipbtn" onClick={() => setLangRole(true)} aria-label={`${tr('nav.langRole')}: ${LANG_NAMES[lang]}, ${tr(`app.role.${settings.role}`)}`}>
              <Icon name="globe" size={18} /><span lang={lang}>{LANG_NAMES[lang]}</span>
              <Icon name={settings.role === 'clinician' ? 'clinician' : 'user'} size={18} />
            </button>
          </div>
          <p className="who-line"><strong>{patient.name}</strong> <span>{patient.age ?? '?'} {tr('home.years')} · {enc.type === 'followup' ? tr(`visit.${enc.visit}`) : tr('home.initial')}</span></p>
          <ol className="stepper" aria-label={tr('nav.progress')}>
            {STAGES.map((st) => {
              const s = stageStatus(enc, summary, st);
              const cur = st === stage;
              return (
                <li key={st}>
                  <button type="button" className={`${s} ${cur ? 'current' : ''}`} aria-current={cur ? 'step' : undefined} onClick={() => go(stageSections(enc.type)[st][0])}>
                    <span className="barrow" aria-hidden="true">
                      <span className="bar" />
                      {s === 'done' && <Icon name="check" size={14} />}
                      {s === 'attention' && <Icon name="alert" size={14} />}
                    </span>
                    <span className="lab">
                      <span>{tr(stageLabelKey(enc.type, st))}</span>
                      <span className="sr-only"> · {tr(statusKey(s))}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      <div className="page">
        <div className="visit-layout">
          <aside className="only-wide">
            <OverviewBody enc={enc} summary={summary} patient={patient} section={section} go={(p) => nav(p)} />
          </aside>
          <main>
            <PageHead eyebrow={`${fill(tr('stage.stepOf'), { n: stageIdx + 1, total: STAGES.length })} · ${tr(stageLabelKey(enc.type, stage))}`} title={tr(sectionLabelKey(section))} />
            {sections.length > 1 && (
              <nav className="subnav" aria-label={tr(stageLabelKey(enc.type, stage))}>
                {sections.map((sec) => {
                  const s = sectionStatus(enc, summary, sec);
                  return (
                    <a key={sec} href={`#/enc/${enc.id}/${sec}`} aria-current={sec === section ? 'page' : undefined}>
                      {s === 'done' && <Icon name="check" size={15} />}
                      {s === 'attention' && <Icon name="alert" size={15} />}
                      {tr(sectionLabelKey(sec))}
                      {sec === 'summary' && summary.pending.length > 0 && <span className="n" aria-label={itemsText(summary.pending.length, tr)}>{summary.pending.length}</span>}
                    </a>
                  );
                })}
              </nav>
            )}
            {unacked > 0 && section !== assessSection && (
              <Notice tone="err" role="alert">
                <strong>{tr('alert.title')} ({unacked})</strong>
                <div className="mt-2"><button type="button" className="btn btn-danger" onClick={() => go(assessSection)}>{tr('alert.view')}</button></div>
              </Notice>
            )}
            {section === 'start' && <ConsentTab enc={enc} update={update} go={go} next={enc.type === 'followup' ? 'followup' : 'complaints'} />}
            {section === 'complaints' && <ComplaintsTab enc={enc} update={update} />}
            {section === 'history' && <HistoryTab enc={enc} patient={patient} update={update} />}
            {section === 'assess' && <AssessTab enc={enc} patient={patient} update={update} go={go} focusNode={focusNode} />}
            {section === 'followup' && <FollowUpTab enc={enc} patient={patient} update={update} />}
            {section === 'summary' && <SummaryTab enc={enc} summary={summary} go={go} />}
            {section === 'review' && <ReviewTab enc={enc} summary={summary} update={update} go={go} />}
            {section === 'plan' && <PlanTab enc={enc} summary={summary} go={go} />}
            {section === 'export' && <ExportTab enc={enc} summary={summary} update={update} />}
          </main>
        </div>
      </div>

      <div className="bottombar">
        <div className="bottombar-in">
          <button type="button" className="btn only-narrow" aria-label={tr('nav.overview')} onClick={() => setOverview(true)}><Icon name="list" />{tr('nav.overviewShort')}</button>
          {next.kind === 'hint' ? (
            <div className="hintbox" role="note"><Icon name="info" size={18} />{tr(next.key)}</div>
          ) : (
            <button type="button" className={`btn ${quietNext ? '' : 'btn-primary'}`} disabled={next.kind === 'markReady' && enc.consent?.status !== 'given'} onClick={runNext}>
              <span>{nextLabel}</span><Icon name="arrow-right" />
            </button>
          )}
        </div>
      </div>

      <Sheet open={overview} onClose={() => setOverview(false)} title={tr('nav.overview')}>
        {(sheetGo) => <OverviewBody enc={enc} summary={summary} patient={patient} section={section} go={sheetGo} />}
      </Sheet>
      <Sheet open={langRole} onClose={() => setLangRole(false)} title={tr('nav.langRole')}>
        {(sheetGo) => <SettingsBody onProtocol={() => sheetGo('/protocol')} />}
      </Sheet>
    </>
  );
}

/* ---------------- Intake: consent ---------------- */

function ConsentTab({ enc, update, go, next }: { enc: Encounter; update: Update; go: (t: string) => void; next: string }) {
  const { tr, actor } = useApp();
  const [by, setBy] = useState<'patient' | 'caregiver'>(enc.consent?.by ?? 'patient');
  return (
    <>
      <Card title={tr('consent.patientLang')}>
        <RadioGroup legend={tr('consent.patientLang')} hideLegend value={enc.patientLanguage} onChange={(l: Lang) => update((e) => setPatientLanguage(e, actor, l))} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], lang: l }))} />
      </Card>
      <Card title={tr('consent.title')}>
        <p style={{ fontSize: '1.0625rem' }}>{tr('consent.ask')}</p>
        <p className="faint">{tr('consent.noRecording')}</p>
        <div className="mt-4">
          <RadioGroup legend={tr('consent.by')} value={by} onChange={setBy} options={(['patient', 'caregiver'] as const).map((b) => ({ value: b, label: tr(`consent.${b}`) }))} />
        </div>
        <div className="choices mt-4" role="group" aria-label={tr('consent.title')}>
          <Choice pressed={enc.consent?.status === 'given'} onClick={() => { update((e) => setConsent(e, actor, 'given', by)); go(next); }}>{tr('consent.given')}</Choice>
          <Choice pressed={enc.consent?.status === 'declined'} onClick={() => update((e) => setConsent(e, actor, 'declined', by))}>{tr('consent.declined')}</Choice>
        </div>
        {enc.consent?.status === 'declined' && <Notice tone="warn" role="status">{tr('consent.blocked')}</Notice>}
        {enc.consent?.status === 'given' && <p className="faint mt-3"><Icon name="check" size={14} /> {tr(`consent.${enc.consent.by}`)} · {fmtTime(enc.consent.at)}</p>}
      </Card>
    </>
  );
}

/* ---------------- Intake: body-region selector ---------------- */

interface Zone { region: Region; side: Laterality; x: number; y: number; w: number; h: number; key: string }
// Front view: the patient's right side is drawn on the viewer's left.
const ZONES: Zone[] = [
  { key: 'neck', region: 'neck', side: 'central', x: 104, y: 60, w: 32, h: 34 },
  { key: 'low_back', region: 'low_back', side: 'central', x: 98, y: 164, w: 44, h: 30 },
  { key: 'hip-r', region: 'hip', side: 'right', x: 82, y: 200, w: 36, h: 34 },
  { key: 'hip-l', region: 'hip', side: 'left', x: 122, y: 200, w: 36, h: 34 },
  { key: 'knee-r', region: 'knee', side: 'right', x: 78, y: 296, w: 32, h: 40 },
  { key: 'knee-l', region: 'knee', side: 'left', x: 130, y: 296, w: 32, h: 40 },
];
const HALF = 'M120 62 L128 62 C129 70 131 76 138 80 C148 82 152 84 157 86 C170 91 178 100 180 116 C183 140 186 168 190 196 C191 206 190 214 184 216 C179 217 176 212 176 204 C173 180 170 150 164 124 C160 140 158 160 160 176 C162 190 168 202 168 214 C168 240 164 270 160 296 C158 312 158 324 158 336 C158 360 156 380 154 398 C154 406 160 410 164 414 L138 414 C136 408 136 402 136 396 C134 376 134 356 134 336 C134 322 133 310 132 298 C130 270 126 246 122 232 C121 230 120 230 120 230';

function BodyMap({ region, side, added, onPick }: { region: Region | null; side: Laterality | null; added: { region: Region; side: Laterality }[]; onPick: (r: Region, s: Laterality) => void }) {
  const { tr } = useApp();
  return (
    <div className="bodymap">
      <figure>
        <div className="row between" aria-hidden="true" style={{ fontSize: '0.8125rem', fontWeight: 650, color: 'var(--ink-2)', marginBottom: 4 }}>
          <span>← {tr('cmp.patientRight')}</span><span>{tr('cmp.patientLeft')} →</span>
        </div>
        <svg viewBox="40 8 160 360" role="group" aria-label={tr('cmp.figure')}>
          <defs>
            <linearGradient id="bm-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.86" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
            <mask id="bm-mask"><rect x="0" y="0" width="240" height="370" fill="url(#bm-fade)" /></mask>
          </defs>
          <g mask="url(#bm-mask)">
          <ellipse className="silhouette" cx="120" cy="38" rx="20" ry="24" />
          <path className="silhouette" d={`${HALF} Z`} style={{ stroke: 'none' }} />
          <path className="silhouette" d={`${HALF} Z`} transform="translate(240 0) scale(-1 1)" style={{ stroke: 'none' }} />
          <path d={HALF} fill="none" stroke="#c7c1b4" strokeWidth="1.25" />
          <path d={HALF} fill="none" stroke="#c7c1b4" strokeWidth="1.25" transform="translate(240 0) scale(-1 1)" />
          </g>
          {ZONES.map((z) => {
            const on = region === z.region && side === z.side;
            const isAdded = added.some((a) => a.region === z.region && a.side === z.side);
            const label = `${tr(`region.${z.region}`)} — ${tr(`side.${z.side}`)}`;
            return (
              <g key={z.key} className={`zone ${on ? 'on' : ''} ${isAdded ? 'added' : ''}`} tabIndex={0} role="button" aria-label={label} aria-pressed={on}
                onClick={() => onPick(z.region, z.side)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(z.region, z.side); } }}>
                <rect className="hit" x={z.x - 6} y={z.y - 6} width={z.w + 12} height={z.h + 12} />
                <rect className="shape" x={z.x} y={z.y} width={z.w} height={z.h} rx="10" />
                <path className="tick" d={`M${z.x + z.w / 2 - 6} ${z.y + z.h / 2} l4 4 l8 -8`} stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ fill: 'none' }} />
              </g>
            );
          })}
        </svg>
        <figcaption>{tr('cmp.frontView')}</figcaption>
      </figure>
    </div>
  );
}

const sidesFor = (r: Region): Laterality[] => (r === 'low_back' || r === 'neck' || r === 'back_unsure' ? ['central', 'left', 'right', 'both'] : ['left', 'right', 'both']);

function ComplaintsTab({ enc, update }: { enc: Encounter; update: Update }) {
  const { tr, actor, announce } = useApp();
  const [region, setRegion] = useState<Region | null>(null);
  const [side, setSide] = useState<Laterality | null>(null);
  const [words, setWords] = useDraft(`draft:${enc.id}:cmp-words`);
  const active = enc.complaints.filter((c) => !c.withdrawn);
  if (enc.consent?.status !== 'given') return <Notice tone="warn">{tr('consent.blocked')}</Notice>;
  const add = () => {
    if (!region || !side) return;
    update((e) => addComplaint(e, actor, region, side, words.trim() || undefined));
    announce(`${tr('app.add')}: ${tr(`region.${region}`)} — ${tr(`side.${side}`)}`);
    setRegion(null);
    setSide(null);
    setWords('');
  };
  return (
    <>
      <Card title={tr('cmp.title')}>
        <p>{tr('cmp.ask')}</p>
        <BodyMap region={region} side={side} added={active.map((c) => ({ region: c.region, side: c.laterality }))} onPick={(r, s) => { setRegion(r); setSide(s); }} />
        <RadioGroup legend={tr('cmp.orList')} variant="list" value={region} onChange={(r: Region) => { setRegion(r); if (side && !sidesFor(r).includes(side)) setSide(null); }} options={(['knee', 'hip', 'hip_knee_unsure', 'low_back', 'neck', 'back_unsure'] as Region[]).map((r) => ({ value: r, label: tr(`region.${r}`) }))} />
        <p className="faint mt-2">{tr('cmp.other')}</p>
        {region && (
          <div className="mt-4 fade-in">
            <RadioGroup legend={tr('side.title')} value={side} onChange={(s: Laterality) => setSide(s)} options={sidesFor(region).map((s) => ({ value: s, label: tr(`side.${s}`) }))} />
            <div className="field mt-4">
              <label htmlFor="cmp-words">{tr('cmp.patientWords')}</label>
              <textarea id="cmp-words" lang={enc.patientLanguage} value={words} onChange={(e) => setWords(e.target.value)} style={{ minHeight: 72 }} />
            </div>
            <button type="button" className={`btn btn-block ${active.length ? '' : 'btn-primary'}`} disabled={!side} onClick={add}><Icon name="plus" />{tr('app.add')}: {tr(`region.${region}`)}{side ? ` — ${tr(`side.${side}`)}` : ''}</button>
          </div>
        )}
      </Card>
      <Card title={tr('cmp.added')}>
        {active.length === 0 && <p className="faint">{tr('cmp.none')}</p>}
        <ul className="list">
          {active.map((c) => (
            <li key={c.id} className="lrow">
              <span className="body">
                <span className="t">{complaintLabel(c, tr)}</span>
                {c.origin && <span className="s"><Pill tone="switch">{tr('cmp.linked')}</Pill></span>}
                {c.patientWords && <span className="s" lang={enc.patientLanguage}>“{c.patientWords}”</span>}
              </span>
              <button type="button" className="btn btn-destructive-text" onClick={() => update((e) => withdrawComplaint(e, actor, c.id, 'removed by user'))}>{tr('cmp.withdraw')}</button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/* ---------------- Intake: history ---------------- */

function HistoryTab({ enc, patient, update }: { enc: Encounter; patient: Patient; update: Update }) {
  const { tr, actor, settings, store, lang, announce } = useApp();
  const [text, setText] = useDraft(`draft:${enc.id}:narrative`);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  if (enc.consent?.status !== 'given') return <Notice tone="warn">{tr('consent.blocked')}</Notice>;

  const saveNarrative = async (suggest: boolean) => {
    if (!text.trim()) return;
    const cur = store.get(enc.id)!;
    const { enc: withNarr, narrativeId } = addNarrative(cur, actor, text.trim(), enc.patientLanguage);
    await store.put(withNarr);
    setText('');
    announce(tr('save.saved'));
    if (!suggest || settings.aiMode === 'off') return;
    setBusy(true);
    setAiMsg(null);
    abort.current = new AbortController();
    const provider = settings.aiMode === 'mock' ? mockProvider : httpProvider;
    const evals = evaluateEncounterComplaints(protocol, withNarr.complaints, patient.age);
    const run = await runExtraction({ provider, encounter: withNarr, narrativeId, permitted: permittedTargets(protocol, withNarr, evals), getCurrent: () => store.get(enc.id), signal: abort.current.signal });
    setBusy(false);
    let latest = store.get(enc.id);
    if (!latest) return;
    if (run.status !== 'disabled' && run.status !== 'limit_reached') {
      latest = logAiUsage(latest, actor, { at: new Date().toISOString(), providerId: run.usage.providerId, model: run.usage.model, task: 'extract', ms: run.usage.ms, inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, outcome: run.status });
    }
    if (run.status === 'ok' && run.result) latest = addProposals(latest, actor, run.result.proposals);
    await store.put(latest);
    const rejected = run.result?.rejected.length ?? 0;
    setAiMsg(`${tr(`ai.status.${run.status}`)}${rejected ? ` ${rejected} ${tr('ai.rejected')}.` : ''}`);
  };

  const pending = enc.proposals.filter((p) => p.state === 'pending');
  return (
    <>
      <Card title={tr('hx.narrative')}>
        <p className="muted">{tr('hx.narrative.hint')}</p>
        <p className="faint">{tr('speech.note')}</p>
        <div className="field mt-3">
          <label className="sr-only" htmlFor="hx-story">{tr('hx.narrative')}</label>
          <textarea id="hx-story" lang={enc.patientLanguage} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => void saveNarrative(false)}><Icon name="check" />{tr('hx.narrative.save')}</button>
          {settings.aiMode !== 'off' && <button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => void saveNarrative(true)}>{tr('hx.narrative.save')} + {tr('hx.suggest')}</button>}
          {busy && <><span className="muted" role="status">{tr('ai.working')}</span><button type="button" className="btn btn-ghost" onClick={() => abort.current?.abort()}>{tr('ai.cancel')}</button></>}
        </div>
        <p className="faint mt-2">{tr(`hx.ai.${settings.aiMode}`)} · {tr('ai.calls')}: {enc.aiUsage.calls}</p>
        {aiMsg && <Notice tone="info" role="status">{aiMsg}</Notice>}
        {enc.narratives.length > 0 && (
          <ul className="list mt-3">
            {enc.narratives.map((n) => <li key={n.id} className="lrow"><span className="body"><span className="t" lang={n.lang}>“{n.text}”</span><span className="s">{LANG_NAMES[n.lang]} · {fmtTime(n.at)}</span></span></li>)}
          </ul>
        )}
      </Card>

      {pending.length > 0 && (
        <Card title={tr('hx.proposals')}>
          <div className="stack">
            {pending.map((p) => {
              const conflict = proposalConflict(enc, p.id);
              return (
                <div key={p.id} className={`notice ${p.urgentFlag ? 'err' : 'info'}`}>
                  <Icon name={p.urgentFlag ? 'alert' : 'info'} />
                  <div className="nbody">
                    {p.urgentFlag && <strong style={{ display: 'block' }}>{tr('hx.proposal.urgent')}</strong>}
                    {p.target.kind === 'safety_check' ? <Loc v={nodeTitle(protocol.nodes[p.target.nodeId], lang)} /> : tr(p.target.code)} → <strong>{tr(`st.${p.status}`)}</strong>{p.value ? ` (${p.value})` : ''}
                    <div className="faint">{tr('hx.proposal.from')}: “{p.quote}” · {p.providerId}</div>
                    {conflict && <div className="err">{tr('hx.proposal.conflict')}</div>}
                    <div className="row mt-2">
                      <button type="button" className="btn btn-primary" disabled={conflict} onClick={() => update((e) => decideProposal(e, actor, p.id, true))}>{tr('hx.proposal.accept')}</button>
                      <button type="button" className="btn" onClick={() => update((e) => decideProposal(e, actor, p.id, false))}>{tr('hx.proposal.reject')}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title={tr('hx.title')}>
        {HISTORY_TEXT_FIELDS.map((code) => <TextField key={code} code={code} enc={enc} update={update} />)}
        {HISTORY_LIST_FIELDS.map((code) => <ListField key={code} code={code} enc={enc} update={update} />)}
        {HISTORY_CHOICE_FIELDS.map((code) => <ChoiceField key={code} code={code} enc={enc} update={update} />)}
      </Card>
      <Card title={tr('hx.modifiers')}>
        {MODIFIER_FIELDS.map((code, i) => (
          <div key={code} className="measure" style={i === 0 ? { borderTop: 0, paddingTop: 0 } : undefined}>
            <span className="lbl" id={`mod-${code}`}>{tr(code)}</span>
            <div role="group" aria-labelledby={`mod-${code}`}>
              <StatusButtons options={['present', 'denied', 'unknown', 'declined', 'not_applicable']} presentTone={false} current={enc.history[code]?.status} onPick={(s, reason) => update((e) => setHistoryField(e, actor, code, s, { value: reason }))} />
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

function FieldState({ enc, code, update }: { enc: Encounter; code: string; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  const set = (s: AnswerStatus) => update((e) => setHistoryField(e, actor, code, s));
  const label = f ? (f.status === 'present' ? tr('st.answered') : f.status === 'denied' ? tr('st.none_reported') : tr(`st.${f.status}`)) : tr('st.not_asked');
  return (
    <div className="fieldstate">
      <Pill tone={f ? (f.status === 'present' || f.status === 'denied' ? 'ok' : 'attn') : 'todo'}>{label}</Pill>
      <div className="toggles">
        <button type="button" aria-pressed={f?.status === 'unknown'} onClick={() => set('unknown')}>{tr('st.unknown')}</button>
        <button type="button" aria-pressed={f?.status === 'declined'} onClick={() => set('declined')}>{tr('st.declined')}</button>
      </div>
    </div>
  );
}
function TextField({ code, enc, update }: { code: string; enc: Encounter; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  return (
    <div className="field measure">
      <label htmlFor={code}>{tr(code)}</label>
      <input id={code} type="text" lang={enc.patientLanguage} key={`${code}-${f?.at ?? ''}`} defaultValue={f?.status === 'present' ? f.value ?? '' : ''} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f?.value) update((x) => setHistoryField(x, actor, code, 'present', { value: v })); }} />
      <FieldState enc={enc} code={code} update={update} />
    </div>
  );
}
function ListField({ code, enc, update }: { code: string; enc: Encounter; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  return (
    <div className="field measure">
      <label htmlFor={code}>{tr(code)}</label>
      <span className="hint" id={`${code}-h`}>{tr('hx.listHint')}</span>
      <textarea id={code} aria-describedby={`${code}-h`} lang={enc.patientLanguage} style={{ minHeight: 72 }} key={`${code}-${f?.at ?? ''}`} defaultValue={f?.status === 'present' ? (f.items ?? []).join('\n') : ''} onBlur={(e) => { const items = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); if (items.length && items.join('|') !== (f?.items ?? []).join('|')) update((x) => setHistoryField(x, actor, code, 'present', { items })); }} />
      <div className="toggles mt-2"><button type="button" aria-pressed={f?.status === 'denied'} onClick={() => update((x) => setHistoryField(x, actor, code, 'denied'))}>{tr('st.none_reported')}</button></div>
      <FieldState enc={enc} code={code} update={update} />
    </div>
  );
}
function ChoiceField({ code, enc, update }: { code: string; enc: Encounter; update: Update }) {
  const { tr, actor } = useApp();
  const f = enc.history[code];
  const items = f?.status === 'present' ? f.items ?? [] : [];
  const [other, setOther] = useState('');
  const toggle = (k: string) => {
    const next = items.includes(k) ? items.filter((i) => i !== k) : [...items, k];
    update((x) => setHistoryField(x, actor, code, next.length ? 'present' : 'unknown', { items: next }));
  };
  return (
    <div className="field measure">
      <span className="lbl" id={`${code}-l`}>{tr(code)}</span>
      <span className="hint">{tr('hx.choicesHint')}</span>
      <div className="toggles" role="group" aria-labelledby={`${code}-l`}>
        {LOCAL_TASKS.map((k) => <button key={k} type="button" aria-pressed={items.includes(k)} onClick={() => toggle(k)}>{items.includes(k) && <Icon name="check" size={15} />}{tr(k)}</button>)}
        {items.filter((i) => !i.startsWith('task.')).map((i) => <button key={i} type="button" aria-pressed onClick={() => toggle(i)}><Icon name="check" size={15} />{i}</button>)}
      </div>
      <div className="inline-field mt-2">
        <input type="text" lang={enc.patientLanguage} aria-label={tr('task.other')} placeholder={tr('task.other')} value={other} onChange={(e) => setOther(e.target.value)} />
        <button type="button" className="btn" disabled={!other.trim()} onClick={() => { toggle(other.trim()); setOther(''); }}><Icon name="plus" />{tr('app.add')}</button>
      </div>
      <FieldState enc={enc} code={code} update={update} />
    </div>
  );
}

