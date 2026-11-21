export interface ValuePart {
  text: string;
  unit?: boolean;
}

/**
 * Splits a display string into big numerals and small units: "59 bpm" -> 59 + bpm,
 * "23.6 km" -> 23.6 + km, "7:45" (h:mm) -> 7 h 45 m. Anything unparseable is returned as-is.
 */
export function splitValue(value: string, hm = false): ValuePart[] {
  const t = value.trim();
  const dur = /^(\d+):(\d{2})$/.exec(t);
  if (hm && dur) {
    return [{ text: dur[1] ?? '' }, { text: 'h', unit: true }, { text: ` ${dur[2] ?? ''}` }, { text: 'm', unit: true }];
  }
  const m = /^(-?\d[\d,]*(?:\.\d+)?)\s*([A-Za-z%°/]+)?$/.exec(t);
  if (!m) return [{ text: value }];
  return m[2] ? [{ text: m[1] ?? '' }, { text: ` ${m[2]}`, unit: true }] : [{ text: m[1] ?? '' }];
}
