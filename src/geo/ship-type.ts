// AIS ship and cargo type (ITU-R M.1371, table 53) → a readable label. The second digit of the
// 20-99 ranges is the hazard category, which the label leaves out.
const EXACT: Record<number, string> = {
  30: "fishing",
  31: "towing",
  32: "towing, long or wide",
  33: "dredging or underwater operations",
  34: "diving operations",
  35: "military operations",
  36: "sailing",
  37: "pleasure craft",
  50: "pilot vessel",
  51: "search and rescue",
  52: "tug",
  53: "port tender",
  54: "anti-pollution",
  55: "law enforcement",
  58: "medical transport",
  59: "noncombatant ship",
};
const BY_TENS: Record<number, string> = {
  2: "wing in ground",
  4: "high-speed craft",
  6: "passenger",
  7: "cargo",
  8: "tanker",
  9: "other",
};

export function shipTypeLabel(code: number | null): string | null {
  if (code === null) return null;
  return EXACT[code] ?? BY_TENS[Math.floor(code / 10)] ?? null;
}
