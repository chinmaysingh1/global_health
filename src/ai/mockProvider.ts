// MOCK provider: a small deterministic keyword matcher for English, Hindi and Marathi
// (including code-switched text). It exists so the workflow and tests run offline with no
// paid account. It is NOT a language model and says nothing about live AI quality.
import type { AiProvider, ExtractRequest, PermittedTarget, RawFact } from './types';

interface Concept {
  id: string;
  /** matched against the permitted target's English label to find the safety check */
  targetLabel?: RegExp;
  historyCode?: string;
  patterns: RegExp[];
  temporalGuard?: boolean; // skip when the clause places the event in the remote past
}

const CONCEPTS: Concept[] = [
  { id: 'injury', targetLabel: /fracture|broken bone/i, temporalGuard: true, patterns: [/\b(fell|fall|accident|twisted)\b/i, /गिर/, /दुर्घटना/, /पडल/, /पडली/, /अपघात/, /मुरगळ/] },
  { id: 'fever', targetLabel: /infection|meningitis/i, patterns: [/\bfever\b/i, /बुखार/, /ताप/] },
  { id: 'bladder', targetLabel: /cauda equina|coming from the (lower )?back|referred/i, patterns: [/\b(bladder|urine|saddle)\b/i, /पेशाब/, /मूत्र/, /लघवी/] },
  { id: 'weight_loss', targetLabel: /tumour|cancer/i, patterns: [/\b(weight loss|lost weight|losing weight)\b/i, /वजन कम/, /वजन कमी/, /वज़न कम/] },
  { id: 'cancer', targetLabel: /tumour|cancer/i, patterns: [/\bcancer\b/i, /कैंसर/, /कर्करोग/, /कॅन्सर/] },
  { id: 'chest_pain', targetLabel: /heart/i, patterns: [/\bchest pain\b/i, /सीने में दर्द/, /छाती में दर्द/, /छातीत दुख/] },
  { id: 'calf_swelling', targetLabel: /blood clot/i, patterns: [/\b(calf swelling|swollen calf|calf is swollen)\b/i, /पिंडली में सूजन/, /पोटरी सुज/, /पोटरीला सूज/] },
  { id: 'weakness', targetLabel: /nerve damage|cord compression/i, patterns: [/\b(getting weaker|foot drop)\b/i, /कमज़ोरी बढ़/, /कमजोरी बढ़/, /अशक्तपणा वाढ/] },
  { id: 'diabetes', historyCode: 'mod.diabetes', patterns: [/\b(diabetes|diabetic|sugar)\b/i, /मधुमेह/, /शुगर/] },
  { id: 'pregnancy', historyCode: 'mod.pregnancy', patterns: [/\bpregnan/i, /गर्भवती/, /गरोदर/] },
  { id: 'allergy', historyCode: 'hx.allergies', patterns: [/\ballerg/i, /एलर्जी/, /ॲलर्जी/, /अ‍ॅलर्जी/] },
];

const DURATION = [
  /\b\d+\s*(?:day|week|month|year)s?\b/i,
  /\d+\s*(?:दिनों|दिन|हफ्तों|हफ्ते|हफ़्ते|सप्ताह|महीनों|महीने|साल)/,
  /\d+\s*(?:दिवसांपासून|दिवस|आठवड्यांपासून|आठवडे|आठवडा|महिन्यांपासून|महिने|महिना|वर्षांपासून|वर्षे|वर्ष)/,
];
const NEGATION = [/\b(no|not|never|without|denies|didn't|don't|hasn't|haven't|doesn't)\b/i, /नहीं|नही|बिना/, /नाही|नाहीं|नव्हत/];
const REMOTE_PAST = [/\b(years? ago|last year|long ago)\b/i, /पिछले साल|साल पहले|सालों पहले/, /गेल्या वर्षी|वर्षांपूर्वी|वर्षापूर्वी/];
const OTHER_PERSON = [/\b(mother|father|husband|wife|brother|sister|son|daughter|neighbou?r)\b/i, /माँ|मां|पिता|पति|पत्नी|भाई|बहन|बेटे|बेटी/, /आई|वडील|नवरा|बायको|भाऊ|बहीण|मुलगा|मुलगी/];
const CLAUSE_SPLIT = /[,.;।!?\n]|\bbut\b|लेकिन|मगर|पण|परंतु/i;

function clauses(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let pos = 0;
  let rest = text;
  while (rest.length) {
    const m = rest.match(CLAUSE_SPLIT);
    if (!m || m.index === undefined) {
      out.push({ start: pos, text: rest });
      break;
    }
    out.push({ start: pos, text: rest.slice(0, m.index) });
    pos += m.index + m[0].length;
    rest = rest.slice(m.index + m[0].length);
  }
  return out.filter((c) => c.text.trim().length);
}
const any = (res: RegExp[], s: string) => res.some((r) => r.test(s));

export function mockExtract(req: ExtractRequest): { facts: RawFact[] } {
  const facts: RawFact[] = [];
  const safety = req.permitted.filter((p) => p.kind === 'safety_check');
  const history = new Set(req.permitted.filter((p) => p.kind === 'history_field').map((p) => p.id));
  for (const c of clauses(req.narrative)) {
    const negated = any(NEGATION, c.text);
    const otherPerson = any(OTHER_PERSON, c.text);
    for (const concept of CONCEPTS) {
      const m = concept.patterns.map((p) => c.text.match(p)).find(Boolean);
      if (!m || m.index === undefined) continue;
      if (otherPerson) continue; // experiencer is someone else
      if (concept.temporalGuard && any(REMOTE_PAST, c.text)) continue;
      const quote = c.text.trim();
      const start = c.start + c.text.indexOf(quote);
      if (concept.targetLabel) {
        if (negated) continue; // a mock can never clear a safety check
        for (const t of safety.filter((p: PermittedTarget) => concept.targetLabel!.test(p.label))) {
          facts.push({ target_kind: 'safety_check', target_id: t.id, complaint_id: t.complaintId ?? null, status: 'present', value: null, quote, start });
        }
      } else if (concept.historyCode && history.has(concept.historyCode)) {
        facts.push({ target_kind: 'history_field', target_id: concept.historyCode, status: negated ? 'denied' : 'present', value: null, quote, start });
      }
    }
    if (history.has('hx.onset_duration')) {
      const d = DURATION.map((p) => c.text.match(p)).find(Boolean);
      if (d && d.index !== undefined && !otherPerson && !facts.some((f) => f.target_id === 'hx.onset_duration')) {
        facts.push({ target_kind: 'history_field', target_id: 'hx.onset_duration', status: 'present', value: d[0], quote: d[0], start: c.start + d.index });
      }
    }
  }
  return { facts };
}

export const mockProvider: AiProvider = {
  id: 'mock-keyword-v1',
  label: 'MOCK keyword matcher (not a language model)',
  isMock: true,
  async extract(req) {
    return { ok: true, data: mockExtract(req), usage: { model: 'mock-keyword-v1', inputTokens: 0, outputTokens: 0 } };
  },
  async draftNote(req) {
    return { ok: true, data: { text: `[MOCK DRAFT — produced by a rule-based stub, not a language model]\n${req.factLines.join('\n')}` }, usage: { model: 'mock-keyword-v1' } };
  },
};
