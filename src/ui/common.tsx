import { useState, type ReactNode } from 'react';
import type { AnswerStatus } from '../store/types';
import type { LocalizedText } from '../i18n';
import type { Alert } from '../engine/evaluate';
import { protocol } from '../protocol';
import { nodeTitle } from '../i18n';
import { useApp } from './ctx';

export function Loc({ v }: { v: LocalizedText }) {
  const { tr } = useApp();
  return (
    <>
      {v.text}
      {v.fallback && <span className="badge untr">{tr('app.untranslated')}</span>}
      {v.draft && <span className="badge draft">{tr('app.draftTranslation')}</span>}
    </>
  );
}

/** English source instructions. When the UI language is not English this is marked, never hidden. */
export function Source({ label, text }: { label: string; text?: string }) {
  const { tr, lang } = useApp();
  if (!text) return null;
  return (
    <div>
      <div className="kicker">
        {label}
        {lang !== 'en' && <span className="badge untr">{tr('app.untranslated')}</span>}
      </div>
      <div className="src" lang="en">{text}</div>
    </div>
  );
}

export function Card({ children, className = '', title }: { children: ReactNode; className?: string; title?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

const REASON_STATUSES: AnswerStatus[] = ['unknown', 'declined', 'not_performed'];

/** Buttons for the non-collapsible answer states. A reason is required for unknown/declined/not performed. */
export function StatusButtons({
  options,
  onPick,
  current,
  reasons,
}: {
  options: AnswerStatus[];
  onPick: (status: AnswerStatus, reason?: string) => void;
  current?: AnswerStatus;
  reasons?: string[]; // i18n keys offered as quick reasons for not_performed
}) {
  const { tr } = useApp();
  const [pending, setPending] = useState<AnswerStatus | null>(null);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(false);
  return (
    <div className="stack">
      {options.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={current === s && !pending}
          className={s === 'present' ? 'danger' : ''}
          onClick={() => {
            if (REASON_STATUSES.includes(s)) {
              setPending(s);
              setReason('');
              setErr(false);
            } else onPick(s);
          }}
        >
          {tr(`st.${s}`)}
        </button>
      ))}
      {pending && (
        <div className="notice warn">
          <label htmlFor="reason-input">{tr('app.reason')} — {tr(`st.${pending}`)}</label>
          {pending === 'not_performed' && reasons && (
            <div className="rowwrap">
              {reasons.map((r) => (
                <button key={r} type="button" className="small" onClick={() => setReason(tr(r))}>{tr(r)}</button>
              ))}
            </div>
          )}
          <input id="reason-input" type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          {err && <div className="err" role="alert">{tr('app.reason.required')}</div>}
          <div className="rowwrap" style={{ marginTop: 8 }}>
            <button type="button" className="primary" onClick={() => { if (!reason.trim()) return setErr(true); onPick(pending, reason.trim()); setPending(null); }}>{tr('app.save')}</button>
            <button type="button" onClick={() => setPending(null)}>{tr('app.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AlertCard({ alert, acked, onAck }: { alert: Alert; acked?: { by: { name: string }; at: string }; onAck?: () => void }) {
  const { tr, lang } = useApp();
  const check = alert.checkId ? protocol.nodes[alert.checkId] : null;
  return (
    <section className={`card alert ${alert.urgency}`} role="alert" aria-live="assertive">
      <div className="kicker">{tr('alert.title')}</div>
      <h2>
        <span className={`chip ${alert.urgency}`}>{tr(`alert.${alert.urgency}`)}</span>
        {check && <Loc v={nodeTitle(check, lang)} />}
      </h2>
      {alert.late && <div className="chip warn">{tr('alert.late')}</div>}
      <Source label={`${tr('alert.action')} · ${alert.headline}`} text={alert.actionText} />
      <p><strong>{tr('alert.exercise')}:</strong> {tr(`alert.ex.${alert.exerciseRestriction}`)}</p>
      {acked ? (
        <p className="muted">{tr('alert.acked')}: {acked.by.name} · {new Date(acked.at).toLocaleString()}</p>
      ) : onAck ? (
        <button type="button" className="danger primary" onClick={onAck}>{tr('alert.ack')}</button>
      ) : null}
    </section>
  );
}

export function ReasonForm({ label, onSubmit, children, disabled }: { label: string; onSubmit: (reason: string) => void; children?: ReactNode; disabled?: boolean }) {
  const { tr } = useApp();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(false);
  return (
    <div className="notice info">
      {children}
      <label>{tr('app.reason')}
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {err && <div className="err" role="alert">{tr('app.reason.required')}</div>}
      <button type="button" className="primary" disabled={disabled} onClick={() => { if (!reason.trim()) return setErr(true); onSubmit(reason.trim()); setReason(''); setErr(false); }}>{label}</button>
    </div>
  );
}

export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
