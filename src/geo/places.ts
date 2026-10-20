import { bearingDeg, distanceNm } from "./haversine";

// Where a point is, in words: the nearest of the gulf's ports, towns and islands. Coordinates are
// approximate (to a kilometre or so): enough to say "4 km SW of Kronstadt", not to navigate.

export type Country = "FI" | "EE" | "RU";

export interface Place {
  name: string;
  country: Country;
  lat: number;
  lon: number;
}

export const PLACES: readonly Place[] = [
  { name: "Hanko", country: "FI", lat: 59.823, lon: 22.95 },
  { name: "Inkoo", country: "FI", lat: 60.045, lon: 24.005 },
  { name: "Porkkala", country: "FI", lat: 59.985, lon: 24.43 },
  { name: "Helsinki", country: "FI", lat: 60.16, lon: 24.955 },
  { name: "Vuosaari harbour", country: "FI", lat: 60.207, lon: 25.19 },
  { name: "Sköldvik oil port", country: "FI", lat: 60.305, lon: 25.545 },
  { name: "Loviisa", country: "FI", lat: 60.43, lon: 26.24 },
  { name: "Kotka", country: "FI", lat: 60.466, lon: 26.946 },
  { name: "Hamina", country: "FI", lat: 60.569, lon: 27.198 },
  { name: "Paldiski", country: "EE", lat: 59.35, lon: 24.055 },
  { name: "Tallinn", country: "EE", lat: 59.445, lon: 24.76 },
  { name: "Muuga harbour", country: "EE", lat: 59.495, lon: 24.96 },
  { name: "Naissaar island", country: "EE", lat: 59.565, lon: 24.525 },
  { name: "Kunda", country: "EE", lat: 59.52, lon: 26.535 },
  { name: "Sillamäe", country: "EE", lat: 59.4, lon: 27.76 },
  { name: "Narva-Jõesuu", country: "EE", lat: 59.46, lon: 28.04 },
  { name: "Gogland island", country: "RU", lat: 60.07, lon: 26.98 },
  { name: "Bolshoy Tyuters island", country: "RU", lat: 59.85, lon: 27.2 },
  { name: "Moshchny island", country: "RU", lat: 59.96, lon: 28.07 },
  { name: "Seskar island", country: "RU", lat: 60.03, lon: 28.38 },
  { name: "Ust-Luga", country: "RU", lat: 59.675, lon: 28.395 },
  { name: "Sosnovy Bor", country: "RU", lat: 59.9, lon: 29.085 },
  { name: "Kronstadt", country: "RU", lat: 59.995, lon: 29.77 },
  { name: "St Petersburg port", country: "RU", lat: 59.9, lon: 30.23 },
  { name: "Primorsk", country: "RU", lat: 60.355, lon: 28.62 },
  { name: "Vysotsk", country: "RU", lat: 60.625, lon: 28.57 },
  { name: "Vyborg", country: "RU", lat: 60.71, lon: 28.745 },
];

const KM_PER_NM = 1.852;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export interface Near {
  name: string;
  country: Country;
  /** Straight-line distance from the place, rounded to the kilometre. */
  km: number;
  /** Which way the point lies from the place; null when it is within 2 km of it. */
  dir: (typeof COMPASS)[number] | null;
}

export function nearestPlace(lat: number, lon: number): Near {
  let best = PLACES[0]!;
  let bestNm = Number.POSITIVE_INFINITY;
  for (const p of PLACES) {
    const nm = distanceNm(p, { lat, lon });
    if (nm < bestNm) [best, bestNm] = [p, nm];
  }
  const km = Math.round(bestNm * KM_PER_NM);
  return {
    name: best.name,
    country: best.country,
    km,
    dir: km < 2 ? null : COMPASS[Math.round(bearingDeg(best, { lat, lon }) / 45) % 8]!,
  };
}
