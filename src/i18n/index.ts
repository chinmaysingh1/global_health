// Localization: stable keys, three languages only (English, Hindi, Marathi).
import type { Lang } from '../store/types';
import type { Option, ProtocolNode } from '../protocol/schema';
import { UI } from './ui';
import { PROTOCOL_TEXT } from './protocolText';

const IDX: Record<Lang, number> = { en: 0, hi: 1, mr: 2 };
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', mr: 'मराठी' };

/** UI string. A missing key is shown as the key itself so it is obvious, never silently replaced. */
export function t(key: string, lang: Lang): string {
  const row = UI[key];
  if (!row) return `⟦${key}⟧`;
  return row[IDX[lang]] || `⟦${key}:${lang}⟧`;
}
export const hasKey = (key: string) => !!UI[key];

export interface LocalizedText {
  text: string;
  /** true => no translation exists; the English source is being shown and must be marked. */
  fallback: boolean;
  /** true => translation exists but is an unreviewed draft. */
  draft: boolean;
}

function localized(id: string, sourceEnglish: string, lang: Lang): LocalizedText {
  if (lang === 'en') return { text: sourceEnglish, fallback: false, draft: false };
  const row = PROTOCOL_TEXT[id];
  if (!row) return { text: sourceEnglish, fallback: true, draft: false };
  return { text: row[lang === 'hi' ? 0 : 1], fallback: false, draft: true };
}

/** Node title without its short code prefix ("K3 · "). */
export const plainTitle = (n: ProtocolNode) => n.title.replace(/^[A-Z0-9-]+ · /, '');
export const nodeTitle = (n: ProtocolNode, lang: Lang): LocalizedText => localized(n.id, plainTitle(n), lang);
export function optionLabel(o: Option, lang: Lang): LocalizedText {
  if (!o.source) return { text: t(o.label, lang), fallback: false, draft: lang !== 'en' }; // synthesized option: label is a UI key
  return localized(o.id, o.label, lang);
}

export function translationCoverage(nodes: ProtocolNode[]): { titles: number; titlesTranslated: number; options: number; optionsTranslated: number } {
  let titles = 0, titlesTranslated = 0, options = 0, optionsTranslated = 0;
  for (const n of nodes) {
    if ((n as any).reference) continue;
    titles++;
    if (PROTOCOL_TEXT[n.id]) titlesTranslated++;
    for (const o of n.options) {
      if (!o.source) continue;
      options++;
      if (PROTOCOL_TEXT[o.id]) optionsTranslated++;
    }
  }
  return { titles, titlesTranslated, options, optionsTranslated };
}
