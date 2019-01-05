/* Serial Port Interface to Light Control Arduino Device */

/// <reference types="deepstream.io-client-js" />

import * as logging from "iw-base/dist/lib/logging"
import { Service, State } from "iw-base/dist/lib/registry"
import { DeepstreamClient, Channel } from "iw-base/dist/modules/deepstream-client"

import * as proto from "./light-proto"
import { makePattern, PATTERNS } from "./patterns"

import * as async from "async"
import * as _ from "lodash"
import * as SerialPort from "serialport"
const ReadLine: any /* TODO: broken typedef */ = SerialPort.parsers.Readline
import onecolor = require("onecolor")

import util = require("util")

const log = logging.getLogger("ArduinoControl")

const SERVICE_TYPE = "arduino-control"
const DEFAULT_BAUD_RATE = 250000
const DEVICE_NAME = "/dev/ttyUSB%d"
const INTERFRAME_PAUSE = 8 /* ms */

export enum Pattern {
  PATTERN_SIMPLE
}

export enum Transition {
  APPLY_INSTANT
}

export interface ArduinoControlConfig {
  port: number | string,
  dsPath: string,
  memberAddress: number,
  baudRate?: number
}

export class ArduinoControl extends Service {

  private memberAddress: number
  private port: SerialPort
  private ready: boolean = false
  /* the next frame to be written by doWrite() */
  private nextFrame: proto.Frame

  private writeInProgress: boolean
  private writePending: boolean

  private channelName: string
  private channel: Channel

  constructor(private readonly ds: DeepstreamClient) {
    super(SERVICE_TYPE)
  }

  start(config: ArduinoControlConfig) {
    if (typeof config.port === "string") {
      this.setupPort(config.port, config.baudRate || DEFAULT_BAUD_RATE)
    } else {
      /* TODO: broken typedef */
      (<any> SerialPort).list((err, ports) => {
        if (err) {
          log.error({err: err, path: config.port}, "error listing serial ports")
          this.setState(State.ERROR, "error listing serial ports")
          return
        }
        log.debug({ports: ports}, "serial port listing")

        const comName = util.format(DEVICE_NAME, config.port)

        for (const p of ports) {
          if (p.comName === comName) {
            this.setupPort(p.comName, config.baudRate || DEFAULT_BAUD_RATE)
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

  setupPort(path: string, baudRate: number) {
    const parser = new ReadLine()
    this.port = new SerialPort(path, {
      baudRate: baudRate
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

    if (data.channel && data.channel !== this.channelName) {
      if (this.channel) {
        this.channel.close()
      }
      this.channelName = data.channel
      this.channel = this.ds.openChannel(this.channelName)
      log.info(`opened channel ${this.channelName}`)

      this.channel.on("message", (msg : ArrayBuffer)  => {
        if ( ! msg.byteLength) {
          log.warn("message received on channel was not TypedArray instance")
          return
        }
        if (msg.byteLength < 2) {
          log.warn("invalid message received on buffer: missing offset")
          return
        }
        /* assume repeat and PATTERN_SIMPLE */
        const offset = Buffer.from(msg).readUInt16LE(0)
        this.nextFrame = {
          memberAddress: this.memberAddress,
          command: proto.PROTO_CONSTANTS.CMD_PATTERN_SIMPLE,
          flags: proto.PROTO_CONSTANTS.FLAG_REPEAT,
          payload: Buffer.from(msg, 2), /* skip offset */
          payloadOffset: offset
        }
        log.debug({len: msg.byteLength - 2, offset: offset}, "write long payload")
        this.doWrite()
      })

    } else if (data.value) {
      /* assume PATTERN_SIMPLE and APPLY_INSTANT */
      PATTERNS.SIMPLE(this.memberAddress, data).subscribe((frame) => {
        this.nextFrame = frame
        log.debug("write PATTERN_SIMPLE")
        this.doWrite()
      })
    }
  }

  doWrite() {
    if ( ! this.ready || this.writeInProgress) {
      this.writePending = true
      return
    }

    if ( ! this.nextFrame) {
      return
    }

    this.writePending = false
    this.writeInProgress = true
    this.setState(State.BUSY, "writing to port")
    const buf = proto.makeFrame(this.nextFrame)
    log.debug("writing header: " + buf.toString("hex", 0, 12))
    async.series([
      (cb) => this.port.write(buf, cb),
      (cb) => this.port.drain(cb),
      /* wait for arduino to process frame, 
       * before clear to send the next one */
      (cb) => setTimeout(cb, INTERFRAME_PAUSE)
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
