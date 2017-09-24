/* Light control script */

import {ArduinoControl} from "./modules/arduino-control"
import {DeepstreamClient} from "iw-base/dist/modules/deepstream-client"
import {UdpDiscovery} from "iw-base/dist/modules/udp-discovery"

import minimist = require("minimist")

const argv = minimist(process.argv.slice(2))

const client = new DeepstreamClient("light-control")
const discovery = new UdpDiscovery()

client.on("connected", () => discovery.pause())
client.on("disconnected", () => discovery.resume())
discovery.on("discovered", (addr) => {
  discovery.pause()
  client.connect(`${addr.address}:${addr.port}`)
})

discovery.start(6021)

const control1 = new ArduinoControl(client)
control1.start(0, "light-control/zone/0", 1)
