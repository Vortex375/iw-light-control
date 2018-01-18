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

/// <reference types="deepstream.io-client-js" />

import { DeepstreamClient } from "iw-base/dist/modules/deepstream-client"
import { UdpDiscovery } from "iw-base/dist/modules/udp-discovery"

import onecolor = require("onecolor")

/* Test script for direct pixel access via channel */

const RECORD_PATH = "light-control/zone/1"
const CHANNEL_PATH = "channel-test2"
const NUMPIXELS = 240

const client = new DeepstreamClient()
const discovery = new UdpDiscovery(client)
discovery.start()

let channel = client.openChannel(CHANNEL_PATH)
channel.on("open", () => {
  loop(0)
})

let buf = Buffer.alloc(NUMPIXELS * 3 /* 4 for RGBW */)
function loop(shift) {
  // console.log("loop", shift)
  let off = 0
  let color = onecolor([ 'HSV', 0, 1, 1, 1 ])
  for (let i = 0; i < NUMPIXELS; i++) {
    let c = color.hue(((i + shift) % 255) / 255)
    off = buf.writeUInt8(c.red() * 255, off)
    off = buf.writeUInt8(c.green() * 255, off)
    off = buf.writeUInt8(c.blue() * 255, off)
    // off = buf.writeUInt8(0, off) /* for RGBW only */
  }
  if (channel.isOpen()) {
    channel.send(buf)
    setTimeout(() => loop((shift + 2) % 255), 32)
  }
}

let record = undefined
client.on("connected", () => {
  record = client.getRecord(RECORD_PATH)
  record.set("channel", CHANNEL_PATH)
})

process.on("SIGINT", () => {
  if (record) {
    record.set("channel", undefined)
  }
  process.nextTick(() => process.exit(0))
})