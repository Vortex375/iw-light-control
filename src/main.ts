/* Light control script */

import { ArduinoControl } from "./modules/arduino-control"
import { IwDeepstreamClient } from "iw-base/modules/deepstream-client"
import { UdpDiscovery } from "iw-base/modules/udp-discovery"

import minimist = require("minimist")

const argv = minimist(process.argv.slice(2))

const client = new IwDeepstreamClient()
const discovery = new UdpDiscovery(client)

discovery.start({
  clientConfig: {
    friendlyName: "light-control"
  },
  requestPort: 6031
})

const control1 = new ArduinoControl(client)
client.on("connected", () => {
  control1.start({
    port: 0,
    dsPath: "light-control/devices/Living Room",
    globalPath: "light-control/global",
    memberAddress: 1
  })
})
