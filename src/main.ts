/* Light control script */

import { ArduinoControl } from "./modules/arduino-control"
import { DeepstreamClient } from "iw-base/dist/modules/deepstream-client"
import { UdpDiscovery } from "iw-base/dist/modules/udp-discovery"

import minimist = require("minimist")

const argv = minimist(process.argv.slice(2))

const client = new DeepstreamClient()
const discovery = new UdpDiscovery(client)

discovery.start({
  clientConfig: {
    friendlyName: "light-control"
  }
})

const control1 = new ArduinoControl(client)
control1.start({
  port: 0,
  dsPath: "light-control/zone/1",
  memberAddress: 1
})
