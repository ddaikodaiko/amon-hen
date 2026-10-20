import { z } from "zod";
import { flagOf } from "../../geo/mid";
import { shipTypeLabel } from "../../geo/ship-type";
import { defineTool, iso, mmsiInput } from "./tool";

interface VesselRow {
  name: string | null;
  callsign: string | null;
  imo: number | null;
  ship_type: number | null;
  ais_class: "A" | "B";
  length_m: number | null;
  destination: string | null;
  updated_at: number;
}

export const getVessel = defineTool({
  name: "get_vessel",
  description:
    "What a vessel says about itself in its AIS static data: name, type, flag (from the MMSI), transponder " +
    "class, length and destination. Digitraffic only relays static data from class A transponders.",
  input: z.object({ mmsi: mmsiInput }),
  run({ mmsi }, { db }) {
    const v = db
      .query<VesselRow, [number]>(
        "SELECT name, callsign, imo, ship_type, ais_class, length_m, destination, updated_at FROM vessels WHERE mmsi = ?",
      )
      .get(mmsi);
    const flag = flagOf(mmsi);
    if (v === null) return { summary: `${mmsi} has never been seen in the region.`, data: { unknown: true, flag } };

    const hasStatic = v.name !== null || v.imo !== null || v.ship_type !== null;
    const type = shipTypeLabel(v.ship_type);
    const data = {
      name: v.name,
      type_label: type,
      flag,
      class: v.ais_class,
      imo: v.imo,
      callsign: v.callsign,
      length_m: v.length_m,
      destination: v.destination,
      last_static_at: hasStatic ? iso(v.updated_at) : null,
    };
    const who = [v.name ?? "unnamed", type, flag === null ? null : `${flag} flag`].filter((x) => x !== null).join(", ");
    const size = v.length_m === null ? "" : `, ${Math.round(v.length_m)} m`;
    const dest = v.destination === null ? "" : `, bound for ${v.destination}`;
    const summary = hasStatic
      ? `${mmsi}: ${who}, class ${v.ais_class}${size}${dest}.`
      : `${mmsi} has sent no static data (class ${v.ais_class})${flag === null ? "" : `; the MMSI is ${flag}'s`}.`;
    return { summary, data };
  },
});
