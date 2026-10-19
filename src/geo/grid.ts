import { REGION, type Region } from "../config";

/** Regular 0.025° grid over the region (research.md, R6). Cell id = row * ncols + col. */
export const CELL_DEG = 0.025;

export interface Bounds {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export class Grid {
  readonly nrows: number;
  readonly ncols: number;

  constructor(
    private readonly region: Region = REGION,
    readonly size = CELL_DEG,
  ) {
    this.nrows = Math.round((region.lat_max - region.lat_min) / size);
    this.ncols = Math.round((region.lon_max - region.lon_min) / size);
  }

  get cellCount(): number {
    return this.nrows * this.ncols;
  }

  /** Null outside the region. The region is half-open: [min, max). */
  cellId(lat: number, lon: number): number | null {
    // The epsilon keeps points that sit exactly on a cell edge (e.g. 59.225) in the cell above.
    const row = Math.floor((lat - this.region.lat_min) / this.size + 1e-9);
    const col = Math.floor((lon - this.region.lon_min) / this.size + 1e-9);
    if (row < 0 || row >= this.nrows || col < 0 || col >= this.ncols) return null;
    return row * this.ncols + col;
  }

  cellBounds(id: number): Bounds {
    const row = Math.floor(id / this.ncols);
    const col = id % this.ncols;
    // Rounded so that edges come out as 60.15, not 60.150000000000006.
    const at = (origin: number, i: number) => Math.round((origin + i * this.size) * 1e9) / 1e9;
    return {
      latMin: at(this.region.lat_min, row),
      latMax: at(this.region.lat_min, row + 1),
      lonMin: at(this.region.lon_min, col),
      lonMax: at(this.region.lon_min, col + 1),
    };
  }

  /** The up to 8 cells around this one, inside the grid. */
  neighbors(id: number): number[] {
    const row = Math.floor(id / this.ncols);
    const col = id % this.ncols;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < this.nrows && c >= 0 && c < this.ncols) out.push(r * this.ncols + c);
      }
    }
    return out;
  }
}
