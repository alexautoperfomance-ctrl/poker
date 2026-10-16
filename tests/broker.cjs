// Локальный MQTT-over-WebSocket брокер для e2e + запись всего трафика (сниффер)
const aedes = require('aedes')(); const { WebSocketServer, createWebSocketStream } = require('ws'); const fs = require('fs');
const log = fs.createWriteStream(process.env.WIRE || '/tmp/wire.log');
aedes.on('publish', (p, c) => { if (c) log.write(p.topic + ' ' + p.payload.toString() + '\n'); });
const wss = new WebSocketServer({ port: +process.env.PORT || 9883, handleProtocols: () => 'mqtt' });
wss.on('connection', ws => aedes.handle(createWebSocketStream(ws)));
console.log('broker up');
