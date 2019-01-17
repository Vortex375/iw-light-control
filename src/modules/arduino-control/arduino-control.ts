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

const EMPTY_BUFFER = Buffer.alloc(proto.PROTO_CONSTANTS.HEADER_SIZE)

export enum Pattern {
  PATTERN_SIMPLE
}

export enum Transition {
  APPLY_INSTANT
}

export interface ArduinoControlConfig {
  port: number | string,
  dsPath: string,
  globalPath: string,
  memberAddress: number,
  baudRate?: number
}

export class ArduinoControl extends Service {

  private memberAddress: number
  private port: SerialPort
  private ready: boolean = false
  /* the next frame to be written by doWrite() */
  private nextFrame: proto.Frame
  private nextFrameNative: Buffer

  private writeInProgress: boolean
  private writePending: boolean

  private channelName: string
  private channel: Channel
  private globalSettings: any
  private data: any

  /* work around node.js (serialport library?) bug */
  private dummyTimer: any

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

    this.ds.subscribe(config.dsPath, (d) => {
      this.data = d
      this.update()
    }, undefined, true)
    this.ds.subscribe(config.globalPath, (d) => {
      this.globalSettings = d
      this.update()
    }, undefined, true)

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
      baudRate: baudRate,
      highWaterMark: 1024
    }, err => {
      if (err) {
        log.error({err: err, path: path}, "error opening serial port")
        this.setState(State.ERROR, "error opening serial port")
        return
      }
      this.setState(State.BUSY, "setting up")
    })
    this.port.on("error", (err) => {
      log.error({err: err}, "serial port error")
      this.stop()
    })

    this.port.pipe(parser)
    parser.on("data", (data) => {
      log.debug("Serialport Message: " + data)
      this.ready = true
      this.resetDummyTimer()
      this.setState(State.OK, "ready")
      if (this.writePending) {
        this.doWrite()
      }
    })

    this.setDummyTimer()
  }

  update() {
    if ( ! this.data) {
      return
    }
    const data = _.clone(this.data)
    /* apply global brightness */
    if (_.isNumber(data.brightness)) {
      let globalBrightness: number
      if ( ! this.globalSettings || ! _.isNumber(this.globalSettings.brightness)) {
        globalBrightness = 1
      } else {
        globalBrightness = this.globalSettings.brightness
      }
      data.brightness *= globalBrightness
    }

    /* channel was closed */
    if (this.channel && ! data.channel) {
      this.channel.close()
      log.info(`channel ${this.channelName} closed`)
      this.channel = undefined
      this.channelName = undefined
    }

    /* open channel for direct write */
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
        if (msg.byteLength < 12) {
          log.warn("invalid message received on buffer: missing header")
          return
        }
        log.debug({len: msg.byteLength}, "write long payload")
        this.queueWriteNative(Buffer.from(msg))
        this.doWrite()
      })

    /* create color pattern */
    } else {
      makePattern(this.memberAddress, data).subscribe((frame) => {
        log.debug("write", data.pattern || "PATTERN_SIMPLE")
        this.queueWrite(frame)
      })
    }
  }

  setDummyTimer() {
    /* work around a bug in node.js or the serialport library
     * for some reason events from the serial port are not processed
     * unless we manually spin the even loop like so */
    this.resetDummyTimer()
    this.dummyTimer = setInterval(() => {}, 1)
  }

  resetDummyTimer() {
    if (this.dummyTimer !== undefined) {
      clearInterval(this.dummyTimer)
    }
    this.dummyTimer = undefined
  }

  queueWrite(frame: proto.Frame) {
    if (this.nextFrame !== undefined) {
      log.warn("dropping frame")
    }
    this.nextFrame = frame
    this.nextFrameNative = undefined
    this.doWrite()
  }

  queueWriteNative(frame: Buffer) {
    if (this.nextFrameNative !== undefined) {
      log.warn("dropping frame")
    }
    this.nextFrameNative = frame
    this.nextFrame = undefined
    this.doWrite()
  }

  doWrite() {
    if ( ! this.ready || this.writeInProgress) {
      this.writePending = true
      return
    }

    if ( ! this.nextFrame && ! this.nextFrameNative) {
      return
    }

    this.writePending = false
    this.writeInProgress = true
    this.setState(State.BUSY, "writing to port")
    let buf: Buffer
    if (this.nextFrameNative) {
      buf = this.nextFrameNative
    } else {
      buf = proto.makeFrame(this.nextFrame)
    }
    this.nextFrameNative = undefined
    this.nextFrame = undefined
    log.debug("writing header: " + buf.toString("hex", 0, 12))
    this.setDummyTimer()
    async.series([
      (cb) => {
        this.port.write(buf)
        let free = this.port.write(EMPTY_BUFFER)
        log.debug({len: buf.length, free: free }, "wrote", buf.length, "bytes")
        if ( ! free) {
          /* drain first before writing again */
          this.port.once("drain", cb)
        } else {
          setImmediate(cb)
        }
      },
    ], (err) => {
      this.resetDummyTimer()
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
