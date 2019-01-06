export const PROTO_CONSTANTS = {
  /** size of protocol header in bytes */
  HEADER_SIZE        : 12,
  /** marks beginning of frame */
  START_MARKER       : Buffer.from([0x00, 0x55, 0xAA, 0xFF]),
  /** broadcast member address */
  ADDR_BROADCAST     : 255,

  /** no-op command*/
  CMD_NOOP           : 0,
  /** apply solid color */
  CMD_PATTERN_SIMPLE : 1,
  /** shift buffer contents by offset */
  CMD_ROTATE         : 2,
  
  /** apply directly */
  MOD_NONE           : 0,
  /** fade to target color */
  MOD_FADE           : (1 << 4),
  
  /** repeat pattern from offset until end of buffer */
  FLAG_REPEAT        : 1,
  /** header is followed by long payload */
  FLAG_LONG_PAYLOAD  : (1 << 7),
}

export interface Color {
  r: number,
  g: number,
  b: number,
  w: number
}

export interface Frame {
  memberAddress: number,
  command: number,
  flags?: number,
  payload: Buffer,
  payloadOffset?: number
}

export function makeColorValueRGBW(color: Color): Buffer {
  const buf = Buffer.allocUnsafe(4)
  buf.writeUInt8(color.w, 0)
  buf.writeUInt8(color.b, 1)
  buf.writeUInt8(color.g, 2)
  buf.writeUInt8(color.r, 3)
  return buf
}

export function parseColorValueRGBW(value: Buffer, offset = 0): Color {
  return {
    r: value.readUInt8(offset + 3),
    g: value.readUInt8(offset + 2),
    b: value.readUInt8(offset + 1),
    w: value.readUInt8(offset)
  }
}

export function makeFrame(frame: Frame): Buffer {
  const buf = Buffer.allocUnsafe(PROTO_CONSTANTS.HEADER_SIZE)
  PROTO_CONSTANTS.START_MARKER.copy(buf)
  let off = PROTO_CONSTANTS.START_MARKER.length
  off = buf.writeUInt8(frame.memberAddress, off)
  off = buf.writeUInt8(frame.command, off)
  let flags = frame.flags || 0
  if (frame.payload.length > 4 || frame.payloadOffset !== undefined) {
    flags |= PROTO_CONSTANTS.FLAG_LONG_PAYLOAD
    const offset = frame.payloadOffset || 0
    off = buf.writeUInt8(frame.flags, off)
    off = buf.writeUInt16LE(frame.payload.length, off)
    off = buf.writeUInt16LE(offset, off)
    const checksum = frame.memberAddress
      ^ frame.command
      ^ flags
      ^ (frame.payload.length & 0xFF)
      ^ ((frame.payload.length >> 8) & 0xFF)
      ^ (offset & 0xFF)
      ^ ((offset >> 8) & 0xFF)
    buf.writeUInt8(checksum, off)

    const packet = Buffer.allocUnsafe(PROTO_CONSTANTS.HEADER_SIZE + frame.payload.length)
    buf.copy(packet, 0, 0, PROTO_CONSTANTS.HEADER_SIZE)
    frame.payload.copy(packet, PROTO_CONSTANTS.HEADER_SIZE, 0, frame.payload.length)
    return packet
  } else {
    flags &= ~PROTO_CONSTANTS.FLAG_LONG_PAYLOAD
    off = buf.writeUInt8(frame.flags, off)
    let payload: Buffer
    if (frame.payload.length < 4) {
      payload = Buffer.alloc(4)
      frame.payload.copy(payload, 0, 0, frame.payload.length)
    } else {
      payload = frame.payload
    }
    payload.copy(buf, off, 0, 4)
    off += 4
    const checksum = frame.memberAddress
      ^ frame.command
      ^ flags
      ^ payload.readUInt8(0)
      ^ payload.readUInt8(1)
      ^ payload.readUInt8(2)
      ^ payload.readUInt8(3)
    buf.writeUInt8(checksum, off)
    return buf
  }
}


export function parseFrame(data: Buffer, verifyChecksum = true): Frame {
  if (data.length < PROTO_CONSTANTS.HEADER_SIZE) {
    throw new Error("data has invalid length, expected 12 byte header")
  }

  const memberAddress = data.readUInt8(4)
  const command = data.readUInt8(5)
  const flags = data.readUInt8(6)
  
  let payload: Buffer, payloadOffset: number
  if (flags & PROTO_CONSTANTS.FLAG_LONG_PAYLOAD) {
    const payloadLength = data.readUInt16LE(7)
    payloadOffset = data.readUInt16LE(9)
    if (data.length < payloadLength + PROTO_CONSTANTS.HEADER_SIZE) {
      throw new Error("data has invalid length, expected " + payloadLength + " bytes payload")
    }
    payload = Buffer.allocUnsafe(payloadLength)
    data.copy(payload, 0, 12, payload.length)
  } else {
    payloadOffset = undefined
    payload = Buffer.allocUnsafe(4)
    data.copy(payload, 0, 7, 11)
  }
  
  if (verifyChecksum) {
    const checksum = data.readUInt8(4)
      ^ data.readUInt8(5)
      ^ data.readUInt8(6)
      ^ data.readUInt8(7)
      ^ data.readUInt8(8)
      ^ data.readUInt8(9)
      ^ data.readUInt8(10)
    if (checksum !== data.readUInt8(11)) {
      throw new Error("data has invalid checksum")
    }
  }

  return {
    memberAddress: memberAddress,
    command: command,
    flags: flags,
    payload: payload,
    payloadOffset: payloadOffset
  }
}

// export function patternSimple(memberAddress: number, color: Color, fade: boolean = false) : Buffer {
//   const buf = Buffer.alloc(HEADER_SIZE)
//   PROTO_CONSTANTS.START_MARKER.copy(buf)

//   let off = PROTO_CONSTANTS.START_MARKER.length
//   off = buf.writeUInt8(memberAddress, off)
//   off = buf.writeUInt8(PROTO_CONSTANTS.CMD_PATTERN_SIMPLE, off)
//   let flags = 0
//   if (fade) {
//     flags |= PROTO_CONSTANTS.FLAG_REPEAT
//   }
//   off = buf.writeUInt8(flags, off)
//   off = buf.writeUInt8(color.w, off)
//   off = buf.writeUInt8(color.b, off)
//   off = buf.writeUInt8(color.g, off)
//   off = buf.writeUInt8(color.r, off)

//   const checksum = memberAddress
//       ^ (PROTO_CONSTANTS.CMD_PATTERN_SIMPLE)
//       ^ flags
//       ^ color.w
//       ^ color.b
//       ^ color.g
//       ^ color.r

//   buf.writeUInt8(checksum, off)

//   return buf
// }

// export function longPayloadHeader(memberAddress: number, length: number, offset: number = 0, repeat = false) : Buffer {
//   const buf = Buffer.alloc(HEADER_SIZE)
//   PROTO_CONSTANTS.START_MARKER.copy(buf)

//   let off = PROTO_CONSTANTS.START_MARKER.length
//   off = buf.writeUInt8(memberAddress, off)
//   off = buf.writeUInt8(PROTO_CONSTANTS.CMD_PATTERN_SIMPLE, off)
//   let flags = PROTO_CONSTANTS.FLAG_LONG_PAYLOAD
//   if (repeat) {
//     flags |= PROTO_CONSTANTS.FLAG_REPEAT
//   }
//   off = buf.writeUInt8(flags, off)
//   off = buf.writeUInt16LE(length, off)
//   off = buf.writeUInt16LE(offset, off)

//   const checksum = memberAddress
//       ^ (PROTO_CONSTANTS.CMD_PATTERN_SIMPLE)
//       ^ flags
//       ^ (length & 0xFF)
//       ^ ((length >> 8) & 0xFF)
//       ^ (offset & 0xFF)
//       ^ ((offset >> 8) & 0xFF)

//   buf.writeUInt8(checksum, off)

//   return buf
// }