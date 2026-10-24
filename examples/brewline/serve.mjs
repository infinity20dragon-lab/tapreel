// Serves the demo app on http://localhost:4322
import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const file = fileURLToPath(new URL('./app/index.html', import.meta.url))
http.createServer((_, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(file)) }).listen(4322, () => console.log('Brewline on http://localhost:4322'))
