import * as logging from "iw-base/dist/lib/logging"
import * as proto from "./light-proto"
import onecolor = require("onecolor")

import { Observable } from "rxjs"
import { Pattern } from "./arduino-control";

const log = logging.getLogger("ArduinoControl", "Patterns")

type PatternFunction = (memberAddress: number, params: any) => Observable<proto.Frame>

type LoopFunction = (timeDiff: number) => proto.Frame

export const PATTERNS = {
  "SIMPLE":  patternSimple,
  // "LINEAR_GRADIENT": patternLinearGradient
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
  let command = proto.PROTO_CONSTANTS.CMD_PATTERN_SIMPLE
  if (params.fade) {
    command |= proto.PROTO_CONSTANTS.MOD_FADE
  }
  const frame: proto.Frame = {
    memberAddress: memberAddress,
    command: command,
    payload: proto.makeColorValueRGBW(calculateColor(
      params.value,
      params.correction,
      params.brightness
    ))
  }
  return singleObservable(frame)
}

// function patternLinearGradient(memberAddress: number, params: any) : Observable<proto.Frame> {

// }

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
  let loopTimer = undefined
  return new Observable(function(subscriber) {
    subscriber.next(initialFrame)
    let now = process.hrtime()
    loopTimer = setInterval(() => {
      const diff = process.hrtime(now)
      const nextFrame = loop(diff[0] + diff[1] / 1e9)
      subscriber.next(nextFrame)
      now = process.hrtime()
    }, 1000 / fps)

    return function() {
      clearInterval(loopTimer)
    }
  })
}