/*
  iw - Intelligent Wiring for Home Automation and other uses.
  Copyright (C) 2017 Benjamin Schmitz

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import { IwDeepstreamClient } from "iw-base/modules/deepstream-client"
import { UdpDiscovery } from "iw-base/modules/udp-discovery"

import onecolor = require("onecolor")
import { disconnect } from "cluster"

/* Test script for direct pixel access via channel */

const RECORD_PATH = "light-control/zone/0"
const CHANNEL_PATH = "channel-test2"
const NUMPIXELS = 240

const COLOR_CORRECTION_8MM = {
  r: 255,
  g: 224,
  b: 140
}

const UNCORRECTED_COLOR = {
  r: 255,
  g: 255,
  b: 255
}

const client = new IwDeepstreamClient()
const discovery = new UdpDiscovery(client)
discovery.start()

let channel = client.openChannel(CHANNEL_PATH)
channel.on("open", () => {
  loop(0)
})

let buf = Buffer.alloc(8)
// let buf = Buffer.alloc(NUMPIXELS * 3 /* 4 for RGBW */)
function loop(shift) {
  // console.log("loop", shift)
  // let off = 0
  // let color = onecolor([ 'HSV', 0, 1, 1, 1 ])
  // for (let i = 0; i < NUMPIXELS; i++) {
  //   let c = color.hue(((i + shift) % 255) / 255)
  //   off = buf.writeUInt8(c.red() * UNCORRECTED_COLOR.r, off)
  //   off = buf.writeUInt8(c.green() * UNCORRECTED_COLOR.g, off)
  //   off = buf.writeUInt8(c.blue() * UNCORRECTED_COLOR.b, off)
  //   // off = buf.writeUInt8(0, off) /* for RGBW only */
  // }

  // buf.fill(0)
  // let off = shift * 3
  // buf.writeUInt8(255, off)
  // buf.writeUInt8(255, off + 1)
  // buf.writeUInt8(255, off + 2)

  buf.writeUInt16LE(shift * 3, 0)
  buf.writeUInt8(0, 2)
  buf.writeUInt8(0, 3)
  buf.writeUInt8(0, 4)
  buf.writeUInt8(255, 5)
  buf.writeUInt8(255, 6)
  buf.writeUInt8(255, 7)

  if (channel.isOpen()) {
    channel.send(buf)
    setTimeout(() => loop((shift + 1) % NUMPIXELS), 32)
  }
}

let records = []
client.on("connected", () => {
  records.push(client.getRecord(RECORD_PATH))
  records.push(client.getRecord('light-control/zone/1'))
  records.forEach(r => r.set("channel", CHANNEL_PATH))
})

process.on("SIGINT", () => {
  records.forEach(r => r.set("channel", undefined))
  //process.nextTick(() => process.exit(0))
  discovery.stop()
  setTimeout(() => {
    client.stop()
    process.exit(0)
  }, 500)
})
