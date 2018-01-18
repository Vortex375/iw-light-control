/* Serial Port Interface to Light Control Arduino Device */

/// <reference types="deepstream.io-client-js" />

import * as logging from "iw-base/dist/lib/logging"
import { Service, State } from "iw-base/dist/lib/registry"
import { DeepstreamClient } from "iw-base/dist/modules/deepstream-client"

import { Color, patternSimple, longPayloadHeader } from "./light-proto"

import * as async from "async"
import * as _ from "lodash"
import * as SerialPort from "serialport"
const ReadLine: any /* TODO: broken typedef */ = SerialPort.parsers.Readline
import onecolor = require("onecolor")

import util = require("util")

const log = logging.getLogger("ArduinoControl")

const SERVICE_TYPE = "arduino-control"
const BAUD_RATE = 115200
const DEVICE_NAME = "/dev/ttyUSB%d"

export enum Pattern {
  PATTERN_SIMPLE
}

export enum Transition {
  APPLY_INSTANT
}

export interface ArduinoControlConfig {
  port: number | string,
  dsPath: string,
  memberAddress: number
}

export class ArduinoControl extends Service {

  private memberAddress: number
  private port: SerialPort
  private ready: boolean = false
  /* the next buffer to be written by doWrite() */
  private buf: Buffer
  private longPayload: Buffer

  private writeInProgress: boolean
  private writePending: boolean

  private channelName: string
  private channel: any /* uws signature not available */

  constructor(private readonly ds: DeepstreamClient) {
    super(SERVICE_TYPE)
  }

  start(config: ArduinoControlConfig) {
    if (typeof config.port === "string") {
      this.setupPort(config.port)
    } else {
      /* TODO: broken typedef */
      (<any> SerialPort).list((err, ports) => {
        if (err) {
          log.error({err: err, path: config.port}, "error listing serial ports")
          this.setState(State.ERROR, "error listing serial ports")
          return
        }

        const comName = util.format(DEVICE_NAME, config.port)

        for (const p of ports) {
          if (p.comName === comName) {
            this.setupPort(p.comName)
            break
          }
        }
        if ( ! this.port) {
          this.setState(State.ERROR, "port does not exist: " + config.port)
        }
      })
    }

    this.memberAddress = config.memberAddress

    this.ds.subscribe(config.dsPath, (d) => this.update(d), undefined, true)

    return Promise.resolve()
  }

  stop() {
    if (this.port) {
      this.port.close()
    }
    this.ready = false
    this.setState(State.INACTIVE, "Serial port closed")

    return Promise.resolve()
  }

  setupPort(path: string) {
    const parser = new ReadLine()
    this.port = new SerialPort(path, {
      baudRate: BAUD_RATE
    }, err => {
      if (err) {
        log.error({err: err, path: path}, "error opening serial port")
        this.setState(State.ERROR, "error opening serial port")
        return
      }
      this.setState(State.OK, "ready")
    })
    this.port.on("error", (err) => {
      log.error({err: err}, "serial port error")
      this.stop()
    })

    this.port.pipe(parser)
    parser.on("data", (data) => {
      this.ready = true
      log.debug("Serialport Message: " + data)
      if (this.writePending) {
        this.doWrite()
      }
    })
  }

  update(data) {
    if (this.channel && ! data.channel) {
      this.channel.close()
      log.info(`channel ${this.channelName} closed`)
      this.channel = undefined
      this.channelName = undefined
    }

    if (data.channel !== this.channelName) {
      if (this.channel) {
        this.channel.close()
      }
      this.channelName = data.channel
      this.channel = this.ds.openChannel(this.channelName)
      log.info(`opened channel ${this.channelName}`)

      this.channel.on("error", (err) => {
        log.error({err: err}, "channel error")
      })
      this.channel.on("message", (msg) => {
        if ( ! msg.byteLength) {
          log.warn("message received on channel was not TypedArray instance")
          return
        }
        /* assume offset 0 and repeat */
        log.debug({len: msg.byteLength}, "write LONG_PAYLOAD")
        this.buf = longPayloadHeader(this.memberAddress, msg.byteLength, 0, true)
        this.longPayload = Buffer.from(msg)

        this.doWrite()
      })

    } else if (data.value) {
      /* assume PATTERN_SIMPLE and APPLY_INSTANT */
      const color = this.calculateColor(data.value, data.correction, data.brightness)
      log.debug({color: color}, "write PATTERN_SIMPLE")
      this.buf = patternSimple(this.memberAddress, color)
      this.longPayload = undefined

      this.doWrite()
    }
  }

  calculateColor(color: Color, correction?: Color, brightness?: number): Color {
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

  doWrite() {
    if ( ! this.ready || this.writeInProgress) {
      this.writePending = true
      return
    }

    if ( ! this.buf) {
      return
    }

    this.writePending = false
    this.writeInProgress = true
    this.setState(State.BUSY, "writing to port")
    log.debug("writing: " + this.buf.toString("hex"))
    async.series([
      (cb) => this.port.write(this.buf, cb),
      (cb) => this.longPayload ? this.port.write(this.longPayload, cb) : cb(),
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
