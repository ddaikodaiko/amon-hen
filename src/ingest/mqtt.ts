// The subset of MQTT 3.1.1 that Vigía needs: connect, subscribe at QoS 0, receive PUBLISH, ping.

export const CONNACK = 2;
export const PUBLISH = 3;
export const SUBACK = 9;
export const PINGRESP = 13;

export const PINGREQ = new Uint8Array([0xc0, 0x00]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function utf8(s: string): number[] {
  const bytes = encoder.encode(s);
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

export function encodeRemainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

function packet(header: number, body: number[]): Uint8Array {
  return new Uint8Array([header, ...encodeRemainingLength(body.length), ...body]);
}

/** Protocol level 4 (3.1.1), clean session, no credentials. */
export function connectPacket(clientId: string, keepAliveS: number): Uint8Array {
  return packet(0x10, [...utf8("MQTT"), 0x04, 0x02, keepAliveS >> 8, keepAliveS & 0xff, ...utf8(clientId)]);
}

export function subscribePacket(packetId: number, topics: readonly string[]): Uint8Array {
  return packet(0x82, [packetId >> 8, packetId & 0xff, ...topics.flatMap((t) => [...utf8(t), 0x00])]);
}

export interface Packet {
  type: number;
  flags: number;
  body: Uint8Array;
}

export function decodePublish(p: Packet): { topic: string; payload: Uint8Array } {
  const topicLength = ((p.body[0] ?? 0) << 8) | (p.body[1] ?? 0);
  const topic = decoder.decode(p.body.subarray(2, 2 + topicLength));
  const qos = (p.flags >> 1) & 0x03;
  // QoS 1 and 2 carry a packet id after the topic.
  return { topic, payload: p.body.subarray(2 + topicLength + (qos > 0 ? 2 : 0)) };
}

/** Splits a byte stream into packets: one WebSocket message may hold part of a packet, or several. */
export class PacketReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Packet[] {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    this.buf = joined;

    const packets: Packet[] = [];
    for (;;) {
      const header = this.buf[0];
      if (header === undefined) break;
      let length = 0;
      let multiplier = 1;
      let i = 1;
      let complete = false;
      while (i < this.buf.length && i <= 4) {
        const byte = this.buf[i++] ?? 0;
        length += (byte & 0x7f) * multiplier;
        multiplier *= 128;
        if ((byte & 0x80) === 0) {
          complete = true;
          break;
        }
      }
      if (!complete) {
        if (i > 4) throw new Error("malformed MQTT remaining length");
        break;
      }
      if (this.buf.length < i + length) break;
      packets.push({ type: header >> 4, flags: header & 0x0f, body: this.buf.slice(i, i + length) });
      this.buf = this.buf.slice(i + length);
    }
    return packets;
  }
}
