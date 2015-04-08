var express = require('express')
var request = require('request')
var morgan = require('morgan')
var Agent = require('agentkeepalive')
var net = require('net')

var totalClientsStarted = 0
var totalClientsEnded = 0
var numberOfTotalClientsToDo = 200
var readDelay = 1
var useKeepaliveAgent = false
var debug = false

var proxyServer
var bottomServer
var proxyServerPort

var bufferOf20Megabytes = new Buffer(20 * 1024 * 1024)
var bottomExpress = express()
bottomExpress.use(morgan('combined'))
bottomExpress.get('/', function (req, res, next) {
  res.send(bufferOf20Megabytes)
})
bottomServer = bottomExpress.listen(0, function () {
  var bottomServerPrefix = 'http://localhost:' + bottomServer.address().port
  console.log('bottom listening at', bottomServerPrefix)
  startProxyServerAndClients(bottomServerPrefix)
})

function startProxyServerAndClients(bottomServerPrefix) {
  var proxyExpress = express()
  proxyExpress.use(morgan('combined'))
  proxyExpress.use(proxy(bottomServerPrefix))
  proxyServer = proxyExpress.listen(0, function () {
    proxyServerPort = proxyServer.address().port
    console.log('proxy listening at', proxyServerPort)
    startClient(proxyServerPort)
  })
}

var proxyCounter = 0
var keepaliveAgent = new Agent({keepAliveMsecs: 60000})

function proxy(targetPrefix) {
  return function (req, res, next) {
    var targetUrl = targetPrefix + req.url
    var proxyId = proxyCounter++
    if (debug) console.log("", proxyId, 'proxystart')
    req.pipe(request({
      url: targetUrl,
      qs: req.query,
      method: req.method,
      agent: useKeepaliveAgent ? keepaliveAgent : undefined
    }, function (error, response, body) {
      if (debug) console.log("", proxyId, 'proxyend')
      if (error) {
        console.error("Proxy error: " + JSON.stringify(error) + " trying " + req.method + " " + targetUrl)
        next(error)
      }
    })).pipe(res)
  }
}

var outgoingDataString = 'GET / HTTP/1.0\nconnection: close\n\n'
var clientCounter = 0

function startClient(serverPort) {
  ++totalClientsStarted
  var clientId = clientCounter++
  var iHaveEnded = false
  var receivedData = 0
  var socket = net.createConnection(serverPort, '127.0.0.1')
  socket.on('error', function (err) {
    console.error('socket error', err)
    process.exit(1)
  })
  socket.on('timeout', function () {
    console.error(clientId + ': timed out')
    socket.destroy()
  })
  socket.on('data', function (buffer) {
    receivedData += buffer.length
    if (debug) console.log(clientId + ': read', buffer.length)
    if (Math.random() < 0.5) {
      socket.pause()
      if (debug) console.log(clientId + ': pausing ')
      setTimeout(function () {
        if (debug) console.log(clientId + ': resuming ')
        socket.resume()
      }, readDelay)
    } else {
      if (!iHaveEnded) {
        if (debug) console.log(clientId + ': ending after reading', receivedData)
        iHaveEnded = true
        socket.end()
      } else {
        if (debug) console.log(clientId + ': already ended abruptly')
      }
    }
  })
  socket.on('end', function () {
    if (receivedData === 0) { console.error('Client socket', clientId, 'never received data!') }
    if (debug) console.log(clientId + ': ' + 'now ended')
    if (totalClientsStarted < numberOfTotalClientsToDo) {
      startClient(serverPort)
    }
    if (++totalClientsEnded === numberOfTotalClientsToDo) {
      bottomServer.close()
      proxyServer.close()
      console.log('Done ', totalClientsStarted, totalClientsEnded, numberOfTotalClientsToDo)
    }
  })
  socket.on('connect', function () {
    socket.write(outgoingDataString, 'utf-8')
  })
}