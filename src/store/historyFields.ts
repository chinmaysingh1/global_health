// Language-independent history field and option codes (display strings live in src/i18n).
export const HISTORY_TEXT_FIELDS = ['hx.onset_duration', 'hx.onset_mode', 'hx.aggravating', 'hx.easing', 'hx.previous_episodes', 'hx.occupation', 'hx.beliefs_mood_sleep'] as const;
export const HISTORY_LIST_FIELDS = ['hx.medications', 'hx.allergies', 'hx.comorbidities'] as const;
export const HISTORY_CHOICE_FIELDS = ['hx.functional_limits', 'hx.goals'] as const;
/** Safety modifiers from the boards (not stops; they change who signs off). */
export const MODIFIER_FIELDS = ['mod.exertional_symptoms', 'mod.bp_uncontrolled', 'mod.diabetes', 'mod.pregnancy', 'mod.osteoporosis', 'mod.falls'] as const;
/** Local tasks named on the boards. Offered as choices, never assumed. */
export const LOCAL_TASKS = [
  'task.floor_sitting', 'task.rising_from_floor', 'task.squatting_toilet', 'task.stairs', 'task.kneeling_prayer',
  'task.carrying_water', 'task.head_loads', 'task.field_work', 'task.sweeping_washing', 'task.two_wheeler',
  'task.lifting_child', 'task.footwear', 'task.bus_tractor', 'task.sewing_computer', 'task.sleeping',
] as const;
export const ALL_HISTORY_CODES: string[] = [...HISTORY_TEXT_FIELDS, ...HISTORY_LIST_FIELDS, ...HISTORY_CHOICE_FIELDS, ...MODIFIER_FIELDS];
