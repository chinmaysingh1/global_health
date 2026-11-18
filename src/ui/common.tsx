import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AnswerStatus } from '../store/types';
import type { LocalizedText } from '../i18n';
import type { Alert } from '../engine/evaluate';
import { protocol } from '../protocol';
import { nodeTitle } from '../i18n';
import { useApp } from './ctx';

/* ---------- icons: one 24px grid, 1.8 stroke, round joins ---------- */
const PATHS: Record<string, ReactNode> = {
  'chevron-left': <path d="M15 18l-6-6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <><path d="M12 3.8L2.8 19.6h18.4L12 3.8z" /><path d="M12 10v4.2" /><path d="M12 17.2h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.8h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  device: <><rect x="7" y="2.8" width="10" height="18.4" rx="2.2" /><path d="M11 17.6h2" /></>,
  'cloud-up': <><path d="M7.5 18.5H6.8a4.2 4.2 0 01-.6-8.4 6 6 0 0111.5-.6 4.5 4.5 0 01.3 9h-1.3" /><path d="M12 12.5v8" /><path d="M9 15.3l3-3 3 3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a13.5 13.5 0 010 18" /><path d="M12 3a13.5 13.5 0 000 18" /></>,
  user: <><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0115 0" /></>,
  clinician: <><circle cx="9.5" cy="8" r="3.6" /><path d="M2.8 20.5a6.8 6.8 0 0113.4 0" /><path d="M15.8 11.2l2 2 3.8-4" /></>,
  sliders: <><path d="M4 7h9" /><path d="M17 7h3" /><circle cx="15" cy="7" r="2" /><path d="M4 17h3" /><path d="M11 17h9" /><circle cx="9" cy="17" r="2" /></>,
  list: <><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4.5 6h.01" /><path d="M4.5 12h.01" /><path d="M4.5 18h.01" /></>,
  x: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  edit: <><path d="M4 20h4L19.2 8.8a2 2 0 000-2.8l-1.2-1.2a2 2 0 00-2.8 0L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  'arrow-right': <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  shield: <><path d="M12 3l7.5 3v5.6c0 4.8-3.2 8-7.5 9.4-4.3-1.4-7.5-4.6-7.5-9.4V6L12 3z" /><path d="M9 12l2 2 4-4" /></>,
  file: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5" /></>,
  'wifi-off': <><path d="M3 3l18 18" /><path d="M8.6 16.4a4.8 4.8 0 016.8 0" /><path d="M5.2 13a9.6 9.6 0 015-2.6" /><path d="M18.8 13a9.6 9.6 0 00-2.2-1.6" /><path d="M12 20h.01" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4.5h6V7" /></>,
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V7.5a4 4 0 018 0V11" /></>,
  download: <><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M5 20h14" /></>,
  printer: <><path d="M7 9V3.5h10V9" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v6.5H7z" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" /></>,
  flag: <><path d="M5.5 21V4" /><path d="M5.5 4.5h11l-2 4 2 4h-11" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  refresh: <><path d="M20 11a8 8 0 10-2.4 5.7" /><path d="M20 4.5V11h-6.5" /></>,
};
export function Icon({ name, size = 20, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title} focusable="false">
      {PATHS[name] ?? null}
    </svg>
  );
}
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <circle cx="12" cy="4.6" r="2.4" />
      <path d="M7.3 8.6h9.4l-1.5 7h-1.6l-.6 6.4h-2l-.6-6.4H8.8z" />
    </svg>
  );
}

/* ---------- translated text with its review markers ---------- */
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
    <div className="srcblock">
      <span className="eyebrow">
        {label}
        {lang !== 'en' && <span className="badge untr">{tr('app.untranslated')}</span>}
      </span>
      <p className="src" lang="en">{text}</p>
    </div>
  );
}

export function Card({ children, className = '', title, eyebrow, actions, id }: { children: ReactNode; className?: string; title?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className={`card ${className}`} id={id}>
      {(title || actions) && (
        <div className="card-h">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h2>{title}</h2>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({ eyebrow, title, lede, children }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pagehead">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1 tabIndex={-1} data-page-title>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}

const NOTICE_ICON: Record<string, string> = { warn: 'alert', err: 'alert', info: 'info', ok: 'check' };
export function Notice({ tone = 'info', children, role }: { tone?: 'warn' | 'err' | 'info' | 'ok'; children: ReactNode; role?: 'alert' | 'status' | 'note' }) {
  return (
    <div className={`notice ${tone}`} role={role}>
      <Icon name={NOTICE_ICON[tone]} />
      <div className="nbody">{children}</div>
    </div>
  );
}

export function Pill({ tone = '', icon, children }: { tone?: string; icon?: string; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{icon && <Icon name={icon} size={14} />}{children}</span>;
}

/** Brief lock after a recording tap so a double tap cannot submit twice or answer the next question. */
export function useTapLock(ms = 650): [boolean, (fn: () => void) => void] {
  const [locked, setLocked] = useState(false);
  const t = useRef<number | null>(null);
  useEffect(() => () => { if (t.current) window.clearTimeout(t.current); }, []);
  return [
    locked,
    (fn) => {
      if (locked) return;
      setLocked(true);
      fn();
      t.current = window.setTimeout(() => setLocked(false), ms);
    },
  ];
}

/** An answer that is recorded when tapped. All options share one neutral style. */
export function Choice({ pressed, onClick, children, disabled, tone, secondary, lang }: { pressed?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; tone?: 'present'; secondary?: boolean; lang?: string }) {
  return (
    <button type="button" className={`choice ${tone === 'present' ? 'is-present' : ''} ${secondary ? 'secondary' : ''}`} aria-pressed={!!pressed} disabled={disabled} onClick={onClick} lang={lang}>
      <span className="ind" aria-hidden="true"><Icon name="check" size={14} /></span>
      <span className="txt">{children}</span>
    </button>
  );
}

/* ---------- selection controls with native radios (arrow keys, labels, grouping for free) ---------- */
export function RadioGroup<T extends string>({ legend, options, value, onChange, variant = 'seg', hideLegend, name }: { legend: string; options: { value: T; label: ReactNode; lang?: string }[]; value: T | null | undefined; onChange: (v: T) => void; variant?: 'seg' | 'list'; hideLegend?: boolean; name?: string }) {
  const auto = useId();
  const n = name ?? `rg-${auto}`;
  return (
    <fieldset className="radiogroup">
      <legend className={hideLegend ? 'sr-only' : undefined}>{legend}</legend>
      <div className={variant === 'seg' ? 'seg' : 'radiolist'}>
        {options.map((o) => (
          <label key={o.value} lang={o.lang}>
            <input type="radio" name={n} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {variant === 'list' && <span className="ind" aria-hidden="true" />}
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const REASON_STATUSES: AnswerStatus[] = ['unknown', 'declined', 'not_performed'];

/** The non-collapsible answer states. A reason is required for unknown, declined and not performed. */
export function StatusButtons({
  options,
  onPick,
  current,
  reasons,
  presentTone = true,
  compact = false,
}: {
  options: AnswerStatus[];
  onPick: (status: AnswerStatus, reason?: string) => void;
  current?: AnswerStatus;
  reasons?: string[]; // i18n keys offered as quick reasons for not_performed
  presentTone?: boolean;
  /** Inline quiet buttons instead of full-width choices (used beside measurement fields). */
  compact?: boolean;
}) {
  const { tr } = useApp();
  const [pending, setPending] = useState<AnswerStatus | null>(null);
  const [locked, lock] = useTapLock();
  const main = options.filter((s) => !REASON_STATUSES.includes(s) && s !== 'not_applicable');
  const sub = options.filter((s) => REASON_STATUSES.includes(s) || s === 'not_applicable');
  const pick = (s: AnswerStatus) => {
    if (REASON_STATUSES.includes(s)) setPending(s);
    else lock(() => { setPending(null); onPick(s); });
  };
  const btn = (s: AnswerStatus, secondary: boolean) => (
    <Choice key={s} pressed={(current === s && !pending) || pending === s} tone={s === 'present' && presentTone ? 'present' : undefined} secondary={secondary} disabled={locked} onClick={() => pick(s)}>
      {tr(`st.${s}`)}
    </Choice>
  );
  if (compact) {
    return (
      <div>
        <div className="toggles">
          {options.map((s) => <button key={s} type="button" aria-pressed={(current === s && !pending) || pending === s} disabled={locked} onClick={() => pick(s)}>{tr(`st.${s}`)}</button>)}
        </div>
        {pending && <ReasonPanel status={pending} reasons={pending === 'not_performed' ? reasons : undefined} onCancel={() => setPending(null)} onSave={(r) => lock(() => { onPick(pending, r); setPending(null); })} />}
      </div>
    );
  }
  return (
    <div>
      {main.length > 0 && <div className="choices">{main.map((s) => btn(s, false))}</div>}
      {sub.length > 0 && (
        <div className={main.length ? 'choices-sub' : ''}>
          {main.length > 0 && <span className="eyebrow">{tr('as.cantAnswer')}</span>}
          <div className="choices">{sub.map((s) => btn(s, main.length > 0))}</div>
        </div>
      )}
      {pending && (
        <ReasonPanel
          status={pending}
          reasons={pending === 'not_performed' ? reasons : undefined}
          onCancel={() => setPending(null)}
          onSave={(r) => lock(() => { onPick(pending, r); setPending(null); })}
        />
      )}
    </div>
  );
}

function ReasonPanel({ status, reasons, onSave, onCancel }: { status: AnswerStatus; reasons?: string[]; onSave: (reason: string) => void; onCancel: () => void }) {
  const { tr } = useApp();
  const id = useId();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [status]);
  const save = () => { if (!reason.trim()) { setErr(true); input.current?.focus(); return; } onSave(reason.trim()); };
  return (
    <div className="reasonbox fade-in">
      <label className="lbl" htmlFor={`${id}-r`}>{tr('app.reason')} · {tr(`st.${status}`)}</label>
      {reasons && (
        <div className="quick" role="group" aria-label={tr('app.reason')}>
          {reasons.map((r) => <button key={r} type="button" aria-pressed={reason === tr(r)} onClick={() => { setReason(tr(r)); setErr(false); }}>{tr(r)}</button>)}
        </div>
      )}
      <input ref={input} id={`${id}-r`} type="text" value={reason} aria-invalid={err || undefined} aria-describedby={err ? `${id}-e` : undefined} onChange={(e) => { setReason(e.target.value); if (e.target.value.trim()) setErr(false); }} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      {err && <div id={`${id}-e`} className="err" role="alert">{tr('app.reason.required')}</div>}
      <div className="row mt-3">
        <button type="button" className="btn btn-primary" onClick={save}>{tr('app.save')}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{tr('app.cancel')}</button>
      </div>
    </div>
  );
}

const URGENCY_ICON: Record<string, string> = { emergency: 'alert', urgent: 'alert', soon: 'clock', refer: 'flag', switch: 'arrow-right' };
export function AlertCard({ alert, acked, onAck }: { alert: Alert; acked?: { by: { name: string }; at: string }; onAck?: () => void }) {
  const { tr, lang } = useApp();
  const check = alert.checkId ? protocol.nodes[alert.checkId] : null;
  return (
    <section className={`alertcard ${alert.urgency}`} role="alert">
      <div className="ahead">
        <Icon name={URGENCY_ICON[alert.urgency] ?? 'alert'} size={26} />
        <div>
          <div className="row">
            <Pill tone={`solid-${alert.urgency}`}>{tr(`alert.${alert.urgency}`)}</Pill>
            {alert.late && <Pill tone="attn">{tr('alert.late')}</Pill>}
          </div>
          <h2>{check ? <Loc v={nodeTitle(check, lang)} /> : tr('alert.title')}</h2>
        </div>
      </div>
      <div className="abody">
        <Source label={`${tr('alert.action')} · ${alert.headline}`} text={alert.actionText} />
        <p><strong>{tr('alert.exercise')}:</strong> {tr(`alert.ex.${alert.exerciseRestriction}`)}</p>
        {acked ? (
          <p className="acked"><Icon name="check" size={16} />{tr('alert.acked')}: {acked.by.name} · {new Date(acked.at).toLocaleString()}</p>
        ) : onAck ? (
          <button type="button" className="btn btn-danger btn-block mt-3" onClick={onAck}>{tr('alert.ack')}</button>
        ) : null}
      </div>
    </section>
  );
}

export function ReasonForm({ label, onSubmit, children, disabled }: { label: string; onSubmit: (reason: string) => void; children?: ReactNode; disabled?: boolean }) {
  const { tr } = useApp();
  const id = useId();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(false);
  return (
    <div className="card flat tight">
      {children}
      <div className="field">
        <label htmlFor={`${id}-r`}>{tr('app.reason')}</label>
        <input id={`${id}-r`} type="text" value={reason} aria-invalid={err || undefined} aria-describedby={err ? `${id}-e` : undefined} onChange={(e) => { setReason(e.target.value); if (e.target.value.trim()) setErr(false); }} />
        {err && <div id={`${id}-e`} className="err" role="alert">{tr('app.reason.required')}</div>}
      </div>
      <button type="button" className="btn btn-primary btn-block" disabled={disabled} onClick={() => { if (!reason.trim()) return setErr(true); onSubmit(reason.trim()); setReason(''); setErr(false); }}>{label}</button>
    </div>
  );
}

/* ---------- sheet: native modal dialog, closes on Back (Android), Escape and the Close button ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode | ((go: (path: string) => void) => ReactNode) }) {
  const { tr } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const pushed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      if (!d.open) {
        opener.current = document.activeElement;
        try { d.showModal(); } catch { d.setAttribute('open', ''); }
        // a history entry so the system Back gesture closes the sheet instead of leaving the visit
        window.history.pushState({ sheet: true }, '');
        pushed.current = true;
      }
      const onPop = () => { pushed.current = false; closeRef.current(); };
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }
    if (d.open) {
      d.close();
      if (pushed.current) { pushed.current = false; window.history.back(); }
      (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    }
  }, [open]);
  /** Navigate from inside the sheet: replaces the sheet's history entry so Back returns to the previous screen. */
  const go = (path: string) => {
    pushed.current = false;
    opener.current = null;
    window.location.replace(`#${path}`);
    closeRef.current();
  };
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="sheet-h">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn-ghost" onClick={onClose}><Icon name="x" />{tr('nav.close')}</button>
      </div>
      <div className="sheet-b">{open && (typeof children === 'function' ? children(go) : children)}</div>
    </dialog>
  );
}

export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const initials = (name: string) => name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
