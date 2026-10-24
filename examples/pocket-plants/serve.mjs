// Serves the demo app on http://localhost:4321
import http from 'node:http'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const file = fileURLToPath(new URL('./app/index.html', import.meta.url))
http.createServer((_, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(file)) }).listen(4321, () => console.log('Pocket Plants on http://localhost:4321'))
