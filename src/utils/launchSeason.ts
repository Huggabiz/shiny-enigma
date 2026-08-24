// Launch-season parsing — converts retail season codes ("AW26",
// "SS27", "MS25", "AW 2026", lowercase variants, ...) into a
// comparative calendar date so products can be placed in time.
//
// Season → anchor date convention:
//   SS## — Spring/Summer, runs ~Feb–Jul  → 1 Feb 20##
//   MS## — Mid-season drop              → 1 May 20##
//   AW## — Autumn/Winter, runs ~Aug–Jan → 1 Aug 20##
//   Unknown prefix with a parseable year → 1 Jul 20## (mid-year)

const SEASON_MONTH: Record<string, number> = {
  SS: 1,  // February (0-indexed)
  MS: 4,  // May
  AW: 7,  // August
  FW: 7,  // Fall/Winter — treat as AW
  HS: 4,  // High summer / mid-season variants
};

/** Parse a launch-season string to its comparative anchor date.
 * Returns null when no year can be extracted. */
export function parseLaunchSeason(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;

  // Prefix letters + 2- or 4-digit year, tolerant of spaces/dashes:
  // "AW26", "SS 2027", "MS-25", also bare years "2026".
  const m = s.match(/^([A-Z]{0,3})[\s-]*((?:20)?\d{2})$/);
  if (!m) return null;
  const prefix = m[1];
  let year = parseInt(m[2], 10);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (year < 1990 || year > 2100) return null;

  const month = SEASON_MONTH[prefix] ?? 6; // unknown prefix → July
  return new Date(year, month, 1);
}

/** Age in fractional years from the launch anchor to now (negative =
 * launches in the future). Null when the season can't be parsed. */
export function launchAgeYears(raw: string | undefined | null, now: Date = new Date()): number | null {
  const d = parseLaunchSeason(raw);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}
