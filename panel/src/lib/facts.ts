import type { CaseContext } from "./api";
import { NAV_STATUS, placeText } from "./format";

// What the data says about a silence, as key facts a newcomer can read: a label, a value, and a
// note on what it usually means. Only facts, no verdict: the labelling view shows them too, and
// the verdict is the AI analyst's (and the labeller's) to give.

export interface Fact {
  label: string;
  value: string;
  note: string;
  /** "notable" leans towards the ship going quiet itself; "calm" towards a reception problem. */
  tone: "notable" | "calm" | "neutral";
}

interface Gap {
  start: { lat: number; lon: number };
  nav_status_start: number | null;
}

/** East of here the gulf narrows towards St Petersburg, far from the Finnish receivers. */
const RUSSIAN_END_LON = 28;

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function factsOf(g: Gap, x: CaseContext): Fact[] {
  const facts: Fact[] = [];

  const far = g.start.lon >= RUSSIAN_END_LON;
  facts.push({
    label: "Where it went silent",
    value: placeText(x.near_start),
    note: far
      ? "The Russian end of the gulf is far from the Finnish receivers that feed this data, so ships there are often missed."
      : "In the part of the gulf the Finnish receivers usually cover.",
    tone: far ? "calm" : "neutral",
  });

  if (x.moved_km === null) {
    facts.push({ label: "Movement while silent", value: "Not back yet", note: "It has not been heard from since.", tone: "neutral" });
  } else if (x.moved_km < 0.5) {
    facts.push({
      label: "Movement while silent",
      value: "Stayed put",
      note: "It came back where it went quiet: it was lying still, so there was little to hide.",
      tone: "calm",
    });
  } else {
    const fast = (x.implied_kn ?? 0) >= 2;
    facts.push({
      label: "Movement while silent",
      value: `${x.moved_km} km${x.implied_kn === null ? "" : ` · ${x.implied_kn} kn`}`,
      note: fast
        ? `It kept sailing while silent: it came back ${x.moved_km} km away, at about ${x.implied_kn} knots in a straight line.`
        : `It drifted ${x.moved_km} km while silent.`,
      tone: fast ? "notable" : "neutral",
    });
  }

  const nav = g.nav_status_start === null ? null : NAV_STATUS[g.nav_status_start];
  if (nav !== undefined && nav !== null) {
    const still = g.nav_status_start === 1 || g.nav_status_start === 5;
    facts.push({
      label: "What it said it was doing",
      value: nav.charAt(0).toUpperCase() + nav.slice(1),
      note:
        (still
          ? "Ships at anchor or moored only report every few minutes, and some switch off in port. "
          : "A ship under way reports every few seconds, so a long silence stands out more. ") +
        (x.speed_before_kn === null ? "" : `Its last message gave ${x.speed_before_kn.toFixed(1)} knots.`),
      tone: still ? "calm" : "neutral",
    });
  }

  const cov = x.coverage;
  if (cov === null || cov.ratio === null || !cov.enough_data) {
    facts.push({
      label: "Receiver coverage there",
      value: "Not enough traffic",
      note: "Too few ships pass that spot at that hour to know how well the receivers hear it.",
      tone: "neutral",
    });
  } else {
    const good = cov.ratio >= 0.8;
    const poor = cov.ratio < 0.5;
    facts.push({
      label: "Receiver coverage there",
      value: `${pct(cov.ratio)} heard`,
      note: good
        ? "Receivers hear ships well there at that hour: a silence there is unusual."
        : poor
          ? "Receivers often miss ships there at that hour: silences there are common."
          : "Receivers hear most ships there, but not all.",
      tone: good ? "notable" : poor ? "calm" : "neutral",
    });
  }

  const n = x.nearby;
  if (n.total === 0) {
    facts.push({
      label: "Ships around it",
      value: "None",
      note: `No other ship within ${n.radius_km} km to compare with.`,
      tone: "neutral",
    });
  } else {
    const share = n.kept_reporting / n.total;
    facts.push({
      label: "Ships around it",
      value: `${n.kept_reporting} of ${n.total} kept transmitting`,
      note:
        share >= 0.7
          ? `Most ships within ${n.radius_km} km kept transmitting, so reception was working there.`
          : share <= 0.3
            ? `Most ships within ${n.radius_km} km went quiet too: probably a reception problem, not this ship.`
            : `Ships within ${n.radius_km} km were mixed: some kept transmitting, some went quiet.`,
      tone: share >= 0.7 ? "notable" : share <= 0.3 ? "calm" : "neutral",
    });
  }

  facts.push({
    label: "Its record",
    value: x.other_silences_total === 0 ? "First silence" : `${x.other_silences_total + 1} silences`,
    note:
      x.other_silences_total === 0
        ? "The first time we have seen this ship go silent."
        : `It has gone silent ${x.other_silences_total} other ${x.other_silences_total === 1 ? "time" : "times"} in our recording.`,
    tone: x.other_silences_total >= 2 ? "notable" : "neutral",
  });

  return facts;
}
