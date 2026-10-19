// Packets only a broker sends, to drive the client in tests.
import { encodeRemainingLength } from "../../src/ingest/mqtt";

const encoder = new TextEncoder();

export function publishPacket(topic: string, payload: string, qos: 0 | 1 = 0): Uint8Array {
  const t = encoder.encode(topic);
  const body = [t.length >> 8, t.length & 0xff, ...t, ...(qos > 0 ? [0x00, 0x07] : []), ...encoder.encode(payload)];
  return new Uint8Array([0x30 | (qos << 1), ...encodeRemainingLength(body.length), ...body]);
}

export function connackPacket(code = 0): Uint8Array {
  return new Uint8Array([0x20, 0x02, 0x00, code]);
}

export function subackPacket(packetId: number, codes: number[]): Uint8Array {
  return new Uint8Array([0x90, 2 + codes.length, packetId >> 8, packetId & 0xff, ...codes]);
}
