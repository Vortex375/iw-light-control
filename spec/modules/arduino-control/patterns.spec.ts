import "jasmine"

import * as patterns from '../../../src/modules/arduino-control/patterns'
import { PROTO_CONSTANTS } from '../../../src/modules/arduino-control/light-proto'


describe("patterns", () => {
  it("should generate nothing by default", () => {
    const params = {}

    const pattern = patterns.makePattern(1, params)
    pattern.subscribe({
      next: () => fail("it generated something"),
      error: () => fail("failed")
    })
  })

  it("should create PATTERN_SIMPLE", () => {
    const params = {
      "value": {
        "r": 255,
        "g": 134,
        "b": 41,
        "w": 50
      },
      "correction": {
        "r": 255,
        "g": 224,
        "b": 140
      },
      "brightness": 0.1
    }
    const pattern = patterns.makePattern(42, params)
    let have = false
    pattern.subscribe({
      next: (frame) => {
        have = true
        expect(frame.memberAddress).toEqual(42)
        expect(frame.command).toEqual(PROTO_CONSTANTS.CMD_PATTERN_SIMPLE)
        expect(frame.flags).toBeUndefined()
        expect(frame.payload.length).toEqual(4)
        expect(frame.payloadOffset).toBeUndefined()
      },
      error: () => fail("failed"),
      complete: () => expect(have).toBe(true)
    })
  })

  it("should create PATTERN_LINEAR_GRADIENT", () => {
    const params = {
      pattern: "LINEAR_GRADIENT",
      size: 20,
      from: {
        "r": 0,
        "g": 0,
        "b": 0,
        "w": 0
      },
      to: {
        "r": 255,
        "g": 255,
        "b": 255,
        "w": 255
      }
    }
    const pattern = patterns.makePattern(42, params)
    let have = false
    pattern.subscribe({
      next: (frame) => {
        have = true
        expect(frame.memberAddress).toEqual(42)
        expect(frame.command).toEqual(PROTO_CONSTANTS.CMD_PATTERN_SIMPLE)
        expect(frame.flags).toBeUndefined()
        expect(frame.payload.length).toEqual(20 * 4)
        expect(frame.payloadOffset).toBeUndefined()
      },
      error: () => fail("failed"),
      complete: () => expect(have).toBe(true)
    })
  })
})