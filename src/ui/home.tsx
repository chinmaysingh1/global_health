import { useEffect, useState } from 'react';
import { protocol } from '../protocol';
import { DEMO_PATIENTS } from '../store/fixtures';
import { LANGS, type Complaint, type Encounter, type Lang, type Patient } from '../store/types';
import { createEncounter, createFollowUp } from '../store/encounter';
import { buildSummary, type EncounterSummary } from '../engine/summary';
import { fetchAiStatus, type AiServerStatus } from '../ai/httpProvider';
import { STANDALONE } from '../platform';
import { LANG_NAMES } from '../i18n';
import { BrandMark, Icon, Notice, Pill, RadioGroup, Sheet, fmtTime, initials } from './common';
import { useApp } from './ctx';
import { itemsText, sectionStatus, type Section } from './flow';

function carriedFrom(patient: Patient, prev: Encounter): Record<string, Complaint['fromPrevious']> {
  const s = buildSummary(protocol, patient, prev);
  const out: Record<string, Complaint['fromPrevious']> = {};
  for (const c of s.complaints) {
    const approved = c.plan.status === 'approved_demo_only';
    out[c.complaint.id] = {
      pathway: c.ev.pathway ?? undefined,
      diagnosisId: approved ? c.plan.diagnosis?.id : undefined,
      doseLevel: approved ? c.plan.doseLevel ?? undefined : undefined,
      exerciseGroups: approved ? c.plan.exerciseGroups.map((g) => g.id) : undefined,
    };
  }
  return out;
}

/** The section a returning user most likely wants: the first one that still needs work. */
export function resumeSection(enc: Encounter, s: EncounterSummary): Section {
  const order: Section[] = enc.type === 'followup' ? ['start', 'followup', 'summary', 'review'] : ['start', 'complaints', 'assess', 'summary', 'review'];
  return order.find((x) => sectionStatus(enc, s, x) !== 'done') ?? (enc.type === 'followup' ? 'export' : 'plan');
}

export function SyncPill({ state }: { state: Encounter['sync']['state'] }) {
  const { tr } = useApp();
  const map: Record<string, [string, string]> = {
    saved_on_device: ['', 'device'],
    awaiting_review: ['attn', 'clock'],
    queued_for_sync: ['progress', 'cloud-up'],
    received_by_server: ['ok', 'check'],
    sync_conflict: ['danger', 'alert'],
    auth_expired: ['danger', 'lock'],
    sync_failed: ['danger', 'alert'],
  };
  const [tone, icon] = map[state] ?? ['', 'device'];
  return <Pill tone={tone} icon={icon}>{tr(`sync.${state}`)}</Pill>;
}

function VisitStatus({ enc, s }: { enc: Encounter; s: EncounterSummary }) {
  const { tr } = useApp();
  const unacked = s.alerts.filter((a) => !enc.alertAcks[a.key]).length;
  const approved = s.complaints.length > 0 && s.complaints.every((c) => c.plan.status === 'approved_demo_only');
  return (
    <>
      {unacked > 0 && <Pill tone="emergency" icon="alert">{tr('alert.title')}</Pill>}
      {approved ? <Pill tone="ok" icon="check">{tr('home.planApproved')}</Pill>
        : s.pending.length > 0 ? <Pill tone="progress">{itemsText(s.pending.length, tr)}</Pill>
        : s.complaints.length === 0 ? <Pill tone="progress">{tr('home.inProgress')}</Pill>
        : <Pill tone="ok" icon="check">{tr('home.noOpen')}</Pill>}
      <SyncPill state={enc.sync.state} />
    </>
  );
}

export function SettingsBody({ onProtocol }: { onProtocol?: () => void }) {
  const { tr, settings, set, lang } = useApp();
  const [ai, setAi] = useState<AiServerStatus | null>(null);
  useEffect(() => { void fetchAiStatus().then(setAi); }, []);
  return (
    <div className="stack-lg">
      <div>
        <RadioGroup legend={tr('set.appLang')} value={lang} onChange={(l: Lang) => set({ lang: l })} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], lang: l }))} />
        <p className="faint mt-2">{tr('set.appLangNote')}</p>
      </div>
      <div>
        <RadioGroup legend={tr('app.role')} variant="list" value={settings.role} onChange={(r) => set({ role: r })} options={(['chw', 'clinician'] as const).map((r) => ({ value: r, label: tr(`app.role.${r}`) }))} />
        <p className="faint mt-2">{tr('app.role.note')}</p>
        {settings.role === 'chw' && (
          <label className="check"><input type="checkbox" checked={settings.kit} onChange={(e) => set({ kit: e.target.checked })} />{tr('app.kit')}</label>
        )}
      </div>
      <div>
        <RadioGroup
          legend={tr('ai.title')}
          variant="list"
          value={settings.aiMode}
          onChange={(m) => set({ aiMode: m })}
          options={[
            { value: 'off' as const, label: tr('ai.off') },
            { value: 'mock' as const, label: tr('ai.mock') },
            ...(ai?.enabled ? [{ value: 'server' as const, label: `${tr('ai.server')} (${ai.model})` }] : []),
          ]}
        />
        {!ai?.enabled && <p className="faint mt-2">{tr('ai.server')}: {tr('ai.serverDisabled')}</p>}
      </div>
      <div>
        <h3 className="section-title" style={{ margin: '0 0 8px' }}>{tr('set.storage')}</h3>
        <p className="muted">{tr('app.storageNote')}</p>
        {STANDALONE && <Notice tone="warn">{tr('app.standalone')}</Notice>}
      </div>
      <div>
        <h3 className="section-title" style={{ margin: '0 0 8px' }}>{tr('set.evaluation')}</h3>
        <p className="muted">{tr('app.banner')}</p>
        {onProtocol && <button type="button" className="btn btn-block mt-3" onClick={onProtocol}><Icon name="file" />{tr('app.protocol')}</button>}
      </div>
    </div>
  );
}

export function Home({ nav }: { nav: (p: string) => void }) {
  const { tr, settings, set, actor, store, lang, online } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const all = store.all();
  const start = (p: Patient) => {
    const enc = createEncounter(p, actor, protocol.protocolVersion);
    void store.put(enc).then(() => nav(`/enc/${enc.id}/start`));
  };
  const followUp = (p: Patient, prev: Encounter, visit: 'week1' | 'week4' | 'week12') => {
    const enc = createFollowUp(protocol, p, actor, prev, visit, carriedFrom(p, prev));
    void store.put(enc).then(() => nav(`/enc/${enc.id}/start`));
  };
  return (
    <>
      <header className="appbar">
        <div className="appbar-in">
          <div className="appbar-row">
            <div className="brand">
              <span className="brand-mark"><BrandMark /></span>
              <div style={{ minWidth: 0 }}>
                <h1>{tr('app.title')}</h1>
                <p>{tr('app.evalShort')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(true)}><Icon name="sliders" />{tr('nav.settings')}</button>
          </div>
        </div>
      </header>
      <main className="page no-bar">
        <div className="pagehead">
          <h1 tabIndex={-1} data-page-title>{tr('nav.patients')}</h1>
          <p className="lede">{tr('home.subtitle')}</p>
        </div>

        <div className="stack home-controls" style={{ marginBottom: 20 }}>
          <RadioGroup legend={tr('set.appLang')} value={lang} onChange={(l: Lang) => set({ lang: l })} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l], lang: l }))} />
          <div className="row between">
            <button type="button" className="chipbtn" onClick={() => setSettingsOpen(true)}>
              <Icon name={settings.role === 'clinician' ? 'clinician' : 'user'} size={18} />
              <span className="sub">{tr('nav.workingAs')}:</span> {tr(`app.role.${settings.role}`)}
            </button>
            {!online && <Pill tone="attn" icon="wifi-off">{tr('app.offline')}</Pill>}
          </div>
          <Notice tone="info" role="note">{tr('app.banner')}{STANDALONE && <><br />{tr('app.standalone')}</>}</Notice>
        </div>

        <h2 className="section-title">{tr('home.patients')}</h2>
        <div className="ptlist">
          {DEMO_PATIENTS.map((p) => {
            const encs = all.filter((e) => e.patientId === p.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            return (
              <section key={p.id} className="card ptcard" aria-labelledby={`pt-${p.id}`}>
                <div className="pthead">
                  <span className="avatar" aria-hidden="true">{initials(p.name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <h3 id={`pt-${p.id}`}>{p.name}</h3>
                    <div className="ptmeta">{p.age ?? '?'} {tr('home.years')} · {p.sex} · {p.village} · {tr('home.speaks')} <span lang={p.preferredLanguage}>{LANG_NAMES[p.preferredLanguage]}</span></div>
                    <div className="ptnote" lang="en">{p.demoNote}</div>
                  </div>
                </div>
                <div className="ptbody">
                  {encs.length === 0 && <p className="faint" style={{ marginBottom: 12 }}>{tr('home.newHint')}</p>}
                  {encs.map((e) => {
                    const s = buildSummary(protocol, p, e);
                    return (
                      <div key={e.id} className="visit">
                        <div className="visit-h">
                          <strong>{e.type === 'followup' ? tr(`visit.${e.visit}`) : tr('home.initial')}</strong>
                          <span className="faint">{tr('home.updated')} {new Date(e.updatedAt).toLocaleDateString()} {fmtTime(e.updatedAt)}</span>
                        </div>
                        <div className="pills"><VisitStatus enc={e} s={s} /></div>
                        <div className="visit-actions">
                          <button type="button" className="btn btn-primary btn-block" onClick={() => nav(`/enc/${e.id}/${resumeSection(e, s)}`)}>
                            {tr('home.continue')}<Icon name="arrow-right" />
                          </button>
                          {e.type === 'initial' && (
                            <div>
                              <span className="eyebrow mt-2">{tr('home.startFollowup')}</span>
                              <div className="fu-row">
                                {(['week1', 'week4', 'week12'] as const).map((v) => <button key={v} type="button" className="btn" onClick={() => followUp(p, e, v)}>{tr(`visit.${v}`)}</button>)}
                              </div>
                            </div>
                          )}
                          <button type="button" className="btn btn-destructive-text" style={{ justifySelf: 'start' }} onClick={() => { if (window.confirm(tr('home.deleteConfirm'))) void store.remove(e.id); }}>
                            <Icon name="trash" size={18} />{tr('home.delete')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button type="button" className={`btn btn-block ${encs.length ? '' : 'btn-primary'}`} onClick={() => start(p)}>
                    <Icon name="plus" />{encs.length ? tr('home.new') : tr('home.startFirst')}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </main>
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={tr('set.title')}>
        {(go) => <SettingsBody onProtocol={() => go('/protocol')} />}
      </Sheet>
    </>
  );
}
