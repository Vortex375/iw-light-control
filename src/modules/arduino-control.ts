/* MongoDB Query RPC Provider */

/// <reference types="deepstream.io-client-js" />

import * as logging from "iw-base/dist/lib/logging"
import {Service, State, registerFactory} from "iw-base/dist/lib/registry"
import {DeepstreamClient} from "iw-base/dist/modules/deepstream-client"

import * as async from "async"
import * as _ from "lodash"
import * as SerialPort from "serialport"
import onecolor = require("onecolor")


import util = require("util")

const log = logging.getLogger("ArduinoControl")

const SERVICE_TYPE = "arduino-control"
const BAUD_RATE = 19200
const DEVICE_NAME = "/dev/ttyUSB%d"
const SYNC_HEADER = Buffer.from([0x00, 0x55, 0xAA, 0xFF])

export enum Pattern {
  PATTERN_SINGLE
}

export enum Transition {
  APPLY_INSTANT
}

export interface Color {
  r: number,
  g: number,
  b: number,
  w: number
}

export class ArduinoControl extends Service {

  private port: SerialPort
  private ready: boolean = false
  private readonly buf: Buffer

  private writeInProgress: boolean
  private writePending: boolean

  constructor(private readonly ds: DeepstreamClient) {
    super(SERVICE_TYPE)
    this.buf = Buffer.allocUnsafe(SYNC_HEADER.length + 4)
    SYNC_HEADER.copy(this.buf)
  }

  start(port: number | string, dsPath: string) {
    if (typeof port === "string") {
      this.setupPort(port)
    } else {
      SerialPort.list((err, ports) => {
        if (err) {
          log.error({err: err, path: port}, "error listing serial ports")
          this.setState(State.ERROR, "error listing serial ports")
          return
        }

        const comName = util.format(DEVICE_NAME, port)

        for (const p of ports) {
          if (p.comName === comName) {
            this.setupPort(p.comName)
            break
          }
        }
        if ( ! this.port) {
          this.setState(State.ERROR, "port does not exist: " + port)
        }
      })
    }

    this.ds.subscribe(dsPath, (d) => this.update(d), undefined, true)
  }

  stop() {
    if (this.port) {
      this.port.close()
    }
    this.ready = false
    this.setState(State.INACTIVE, "Serial port closed")
  }

  setupPort(path: string) {
    this.port = new SerialPort(path, {
      baudRate: BAUD_RATE,
      parser: SerialPort.parsers.readline("\n")
    }, err => {
      if (err) {
        log.error({err: err, path: path}, "error opening serial port")
        this.setState(State.ERROR, "error opening serial port")
        return
      }
      this.setState(State.OK, "ready")
      this.ready = true
    })
    this.port.on("error", (err) => {
      log.error({err: err}, "serial port error")
      this.stop()
    })

    this.port.on("data", (data) => log.debug("Serialport Message: " + data))
  }

  update(data) {
    /* assume PATTERN_SINGLE and APPLY_INSTANT */
    const color = this.calculateColor(data.value, data.correction, data.brightness)
    this.writePatternSingle(color)
  }

  calculateColor(color: Color, correction?: Color, brightness?: number): Color {
    const ret = {r: color.r, g: color.g, b: color.b, w: color.w}
    if (correction !== undefined) {
      ret.r *= correction.r / 255
      ret.g *= correction.g / 255
      ret.b *= correction.b / 255
    }
    if (brightness !== undefined) {
      let hsl = onecolor([ret.r, ret.g, ret.b, 255 /* useless alpha channel */])
      hsl = hsl.lightness(brightness)
      ret.r = hsl.red()
      ret.g = hsl.green()
      ret.b = hsl.blue()
      ret.w *= brightness
    }

    return ret
  }

  writePatternSingle(c: Color) {
    let off = SYNC_HEADER.length
    off = this.buf.writeUInt8(c.w, off)
    off = this.buf.writeUInt8(c.b, off)
    off = this.buf.writeUInt8(c.g, off)
    off = this.buf.writeUInt8(c.r, off)

    this.doWrite()
  }

  doWrite() {
    if ( ! this.ready || this.writeInProgress) {
      this.writePending = true
      return
    }

    this.writePending = false
    this.writeInProgress = true
    log.debug("writing: " + this.buf.toString("hex"))
    async.series([
      (cb) => this.port.write(this.buf, cb),
      (cb) => this.port.drain(cb),
    ], (err) => {
      this.writeInProgress = false
      if (err) {
        log.error({err: err}, "Error writing to serial port")
        this.setState(State.ERROR, "Error writing to serial port")
      } else {
        this.setState(State.OK, "Write ok")
        if (this.writePending) {
          process.nextTick(() => this.doWrite())
        }
      }
    })
  }
}
