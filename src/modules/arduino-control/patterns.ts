import * as logging from "iw-base/dist/lib/logging"
import * as proto from "./light-proto"
import onecolor = require("onecolor")

import { Observable, EMPTY } from "rxjs"
import * as _ from "lodash"

const log = logging.getLogger("ArduinoControl", "Patterns")

type PatternFunction = (memberAddress: number, params: any) => Observable<proto.Frame>
type LoopFunction = (timeDiff: number) => proto.Frame[]

export const PATTERNS = {
  "SIMPLE":  patternSimple,
  "LINEAR_GRADIENT": patternLinearGradient,
  "RAINBOW": patternRainbow
}

const DEFAULT_FPS = 30

export function makePattern(memberAddress: number, params: any): Observable<proto.Frame> {
  let pattern: PatternFunction = params.pattern ? PATTERNS[params.pattern] : PATTERNS.SIMPLE
  if ( ! pattern) {
    log.warn({pattern: params.pattern}, `unknown pattern: ${params.pattern}`)
    pattern = PATTERNS.SIMPLE
  }

  return pattern(memberAddress, params)
}

function patternSimple(memberAddress: number, params: any) : Observable<proto.Frame> {
  /* validate */
  if ( ! params.value) {
    return EMPTY
  }

  let command = proto.PROTO_CONSTANTS.CMD_PATTERN_SIMPLE
  if (params.fade) {
    command |= proto.PROTO_CONSTANTS.MOD_FADE
  }
  return singleObservable({
    memberAddress: memberAddress,
    command: command,
    payload: proto.makeColorValueRGBW(calculateColor(
      params.value,
      params.correction,
      params.brightness
    ))
  })
}

function patternLinearGradient(memberAddress: number, params: any): Observable<proto.Frame> {
  /* validate */
  if ( ! params.from || ! params.to || ! params.size) {
    return EMPTY
  }

  const from = calculateColor(params.from, params.correction, params.brightness)
  const to = calculateColor(params.to, params.correction, params.brightness)
  const gradient = [from]
  for (let i = 1; i < params.size - 1; i++) {
    const color = {
      r: from.r + (to.r - from.r) * (i / params.size),
      g: from.g + (to.g - from.g) * (i / params.size),
      b: from.b + (to.b - from.b) * (i / params.size),
      w: from.w + (to.w - from.w) * (i / params.size)
    }
    gradient.push(color)
  }
  gradient.push(to)
  const buffers = _.map(gradient, proto.makeColorValueRGBW)
  const payload = Buffer.concat(buffers)

  return singleObservable({
    memberAddress: memberAddress,
    command: proto.PROTO_CONSTANTS.CMD_PATTERN_SIMPLE,
    payload: payload
  })
}

function patternRainbow(memberAddress: number, params: any): Observable<proto.Frame> {
  if ( ! _.isFinite(params.size)) {
    return EMPTY
  }

  const buf = Buffer.alloc(params.size)
  const frame: proto.Frame = {
    memberAddress: memberAddress,
    command: proto.PROTO_CONSTANTS.CMD_PATTERN_SIMPLE,
    flags: proto.PROTO_CONSTANTS.FLAG_REPEAT,
    payload: buf
  }

  function loop(shift: number) {
    let off = 0
    let color = onecolor([ 'HSV', 0, 1, 1, 1 ])
    for (let i = 0; i < params.size; i++) {
      let c = color.hue(((i + shift) % params.size) / params.size)
      let val = proto.makeColorValueRGBW(calculateColor(c, params.correction, params.brightness))
      val.copy(buf, off, 0, val.length)
      off += val.length
    }
  }

  /* make initial frame */
  let currentShift = 0
  loop(currentShift);

  return animationObservable(frame, (timeDiff) => {
    currentShift = ((currentShift + Math.floor(timeDiff * 16)) % params.size)
    loop(currentShift)
    return [frame]
  })
}

function calculateColor(color: proto.Color, correction?: proto.Color, brightness?: number): proto.Color {
  const ret = {r: color.r, g: color.g, b: color.b, w: color.w}
  if (correction !== undefined) {
    ret.r *= correction.r / 255
    ret.g *= correction.g / 255
    ret.b *= correction.b / 255
  }
  if (brightness !== undefined) {
    let hsv = onecolor([ret.r, ret.g, ret.b, 255 /* useless alpha channel */])
    hsv = hsv.value(brightness)
    ret.r = hsv.red() * 255
    ret.g = hsv.green() * 255
    ret.b = hsv.blue() * 255
    ret.w *= brightness
  }

  return ret
}

function singleObservable(frame: proto.Frame): Observable<proto.Frame> {
  return new Observable(function (subscriber) {
    subscriber.next(frame)
    subscriber.complete()
  })
}

function animationObservable(initialFrame: proto.Frame, loop: LoopFunction, fps = DEFAULT_FPS): Observable<proto.Frame> {
  return new Observable(function(subscriber) {
    subscriber.next(initialFrame)
    let now = process.hrtime()
    const loopTimer = setInterval(() => {
      const diff = process.hrtime(now)
      const nextFrame = loop(diff[0] + diff[1] / 1e9)
      _.forEach(nextFrame, f => subscriber.next(f))
      now = process.hrtime()
    }, 1000 / fps)

    return function() {
      clearInterval(loopTimer)
    }
  })
}