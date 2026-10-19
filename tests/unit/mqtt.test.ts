import { describe, expect, test } from "bun:test";
import {
  connectPacket,
  decodePublish,
  encodeRemainingLength,
  PacketReader,
  PUBLISH,
  subscribePacket,
} from "../../src/ingest/mqtt";
import { connackPacket, publishPacket } from "../fixtures/mqtt";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("encoding", () => {
  test("remaining length uses 7 bits per byte", () => {
    expect([0, 127, 128, 16_383, 2_097_151].map(encodeRemainingLength)).toEqual([
      [0x00],
      [0x7f],
      [0x80, 0x01],
      [0xff, 0x7f],
      [0xff, 0xff, 0x7f],
    ]);
  });

  test("CONNECT: MQTT 3.1.1, clean session, keep-alive and client id", () => {
    expect([...connectPacket("c", 60)]).toEqual([0x10, 13, 0, 4, 77, 81, 84, 84, 4, 2, 0, 60, 0, 1, 99]);
  });

  test("SUBSCRIBE: packet id and each topic at QoS 0", () => {
    expect([...subscribePacket(1, ["a/b"])]).toEqual([0x82, 8, 0, 1, 0, 3, 97, 47, 98, 0]);
  });
});

describe("PacketReader", () => {
  test("joins a packet split across two frames", () => {
    const pub = publishPacket("vessels-v2/230713000/location", '{"lat":60.1}');
    const reader = new PacketReader();
    expect(reader.push(pub.subarray(0, 5))).toEqual([]);
    const [p] = reader.push(pub.subarray(5));
    expect(p?.type).toBe(PUBLISH);
    const { topic, payload } = decodePublish(p!);
    expect(topic).toBe("vessels-v2/230713000/location");
    expect(text(payload)).toBe('{"lat":60.1}');
  });

  test("splits several packets in one frame, with a multi-byte length", () => {
    const big = "x".repeat(300);
    const frame = new Uint8Array([...connackPacket(), ...publishPacket("t", big)]);
    const packets = new PacketReader().push(frame);
    expect(packets.map((p) => p.type)).toEqual([2, PUBLISH]);
    expect(text(decodePublish(packets[1]!).payload)).toBe(big);
  });

  test("skips the packet id of a QoS 1 PUBLISH", () => {
    const [p] = new PacketReader().push(publishPacket("t", "{}", 1));
    expect(text(decodePublish(p!).payload)).toBe("{}");
  });

  test("rejects a remaining length longer than 4 bytes", () => {
    expect(() => new PacketReader().push(new Uint8Array([0x30, 0xff, 0xff, 0xff, 0xff, 0x01]))).toThrow();
  });
});
