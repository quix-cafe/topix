import { spawn, execFile } from 'node:child_process'

const HASH_CHUNK_SIZE = 1024 * 1024

export function hashFiles(filepaths) {
  if (filepaths.length === 0) return Promise.resolve({})
  return new Promise((resolve, reject) => {
    const script = `
import xxhash, json, sys
chunk = ${HASH_CHUNK_SIZE}
result = {}
for p in json.loads(sys.stdin.read()):
    try:
        with open(p, 'rb') as f:
            result[p] = xxhash.xxh3_64(f.read(chunk)).hexdigest()
    except Exception:
        pass
print(json.dumps(result))
`
    const child = spawn('python', ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', d => out += d)
    child.stdin.write(JSON.stringify(filepaths))
    child.stdin.end()
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('hash batch failed'))
      try { resolve(JSON.parse(out)) } catch (e) { reject(e) }
    })
  })
}

export function hashTextFile(filepath) {
  return new Promise((resolve) => {
    execFile('python', ['-c',
      `import xxhash; f=open(${JSON.stringify(filepath)},"r",encoding="utf-8"); print(xxhash.xxh3_64(f.read().encode("utf-8")).hexdigest())`
    ], (err, stdout) => {
      if (err) return resolve(null)
      resolve(stdout.trim())
    })
  })
}
