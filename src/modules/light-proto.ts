const PACKET_SIZE = 12
const START_MARKER = Buffer.from([0x00, 0x55, 0xAA, 0xFF])

const PROTO_ADDR_BROADCAST     = 255
const PROTO_CMD_NOOP           = 0
const PROTO_CMD_PATTERN_SIMPLE = 1
const PROTO_CMD_ROTATE         = 2
const PROTO_MOD_NONE           = 0
const PROTO_MOD_FADE           = (1 << 4)
const PROTO_FLAG_REPEAT        = 1
const PROTO_FLAG_LONG_PAYLOAD  = (1 << 7)

export interface Color {
  r: number,
  g: number,
  b: number,
  w: number
}

export function patternSimple(memberAddress: number, color: Color, fade: boolean = false) : Buffer {
  const buf = Buffer.alloc(PACKET_SIZE)
  START_MARKER.copy(buf)

  let off = START_MARKER.length
  off = this.buf.writeUInt8(memberAddress, off)
  off = this.buf.writeUInt8(PROTO_CMD_PATTERN_SIMPLE, off)
  let flags = 0
  if (fade) {
    flags |= PROTO_FLAG_REPEAT
  }
  off = this.buf.writeUInt8(flags, off) /* FLAG_REPEAT */
  off = this.buf.writeUInt8(color.w, off)
  off = this.buf.writeUInt8(color.b, off)
  off = this.buf.writeUInt8(color.g, off)
  off = this.buf.writeUInt8(color.r, off)

  const checksum = memberAddress
  ^ (PROTO_CMD_PATTERN_SIMPLE)
  ^ flags
  ^ color.w
  ^ color.b
  ^ color.g
  ^ color.r

  this.buf.writeUInt8(checksum, off)

  return buf
}

export function longPayloadHeader(memberAddress: number, length: number, offset: number = 0, repeat = false) : Buffer {
  const buf = Buffer.alloc(PACKET_SIZE)
  START_MARKER.copy(buf)

  let off = START_MARKER.length
  off = this.buf.writeUInt8(memberAddress, off)
  off = this.buf.writeUInt8(PROTO_CMD_PATTERN_SIMPLE, off)
  let flags = PROTO_FLAG_LONG_PAYLOAD
  if (repeat) {
    flags |= PROTO_FLAG_REPEAT
  }
  off = this.buf.writeUInt8(flags, off) /* FLAG_REPEAT */
  off = this.buf.writeUInt16LE(length, off)
  off = this.buf.writeUInt16LE(offset, off)

  const checksum = memberAddress
  ^ (PROTO_CMD_PATTERN_SIMPLE)
  ^ flags
  ^ length
  ^ offset

  this.buf.writeUInt8(checksum, off)

  return buf
}