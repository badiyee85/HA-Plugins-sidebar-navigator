// Starts the real Hermes gateway handlers in a throwaway HERMES_HOME and exposes
// `call(method, params)`. Tests that need it call `startGateway()`; when no
// Hermes checkout is available they get `null` and skip with a clear reason.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = process.env.HERMES_AGENT_DIR || path.join(homedir(), '.hermes', 'hermes-agent')

// The checkout's own venv can be stale relative to its code, so prefer an
// interpreter that can actually import what the gateway needs. HERMES_AGENT_PYTHON
// overrides the search.
function canRunGateway(python) {
  // The real check: import the gateway the way the bridge will, in a scratch home.
  const scratch = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'ha-nav-probe-'))
  const code = `import sys; sys.path.insert(0, ${JSON.stringify(AGENT_DIR)}); import hermes_state, ${'tui_' + 'gateway'}.server`
  try {
    return spawnSync(python, ['-c', code], {
      env: { ...process.env, HERMES_HOME: scratch, HERMES_DISABLE_LAZY_INSTALLS: '1' }, stdio: 'ignore', timeout: 90000
    }).status === 0
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function findPython() {
  if (process.env.HERMES_AGENT_PYTHON) return process.env.HERMES_AGENT_PYTHON
  const candidates = [path.join(AGENT_DIR, 'venv', 'bin', 'python')]
  const installs = path.join(homedir(), '.hermes', 'installs')
  if (existsSync(installs)) {
    for (const install of readdirSync(installs)) {
      const envs = path.join(installs, install, 'environments')
      if (!existsSync(envs)) continue
      for (const env of readdirSync(envs)) candidates.push(path.join(envs, env, 'venv', 'bin', 'python'))
    }
  }
  return candidates.find(py => existsSync(py) && canRunGateway(py)) || null
}

let cachedPython
const getPython = () => (cachedPython === undefined ? (cachedPython = findPython()) : cachedPython)

export function liveBackendAvailable() {
  return existsSync(path.join(AGENT_DIR, 'tui_gateway', 'server.py')) && Boolean(getPython())
}

export async function startGateway() {
  if (!liveBackendAvailable()) return null
  const home = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'ha-nav-live-'))
  const child = spawn(getPython(), [path.join(HERE, 'gateway_bridge.py')], {
    env: { ...process.env, HERMES_HOME: home, HERMES_AGENT_DIR: AGENT_DIR, HERMES_DISABLE_LAZY_INSTALLS: '1', PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const pending = new Map()
  let nextId = 0
  createInterface({ input: child.stdout }).on('line', line => {
    let msg
    try { msg = JSON.parse(line) } catch { return }
    pending.get(msg.id)?.(msg.response)
    pending.delete(msg.id)
  })
  child.on('exit', code => {
    for (const settle of pending.values()) settle({ error: { message: `gateway bridge exited (${code}): ${stderr.slice(-600)}` } })
    pending.clear()
  })

  const raw = (method, params = {}, timeoutMs = 30000) => new Promise(resolve => {
    const id = ++nextId
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ error: { code: -2, message: `gateway bridge timed out on ${method} after ${timeoutMs}ms. stderr: ${stderr.slice(-800)}` } })
    }, timeoutMs)
    pending.set(id, response => { clearTimeout(timer); resolve(response) })
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })

  return {
    home,
    raw,
    // Behaves like the Desktop's host.request: resolves the result, rejects with the backend's message.
    async call(method, params = {}) {
      const response = await raw(method, params)
      if (response?.error) throw new Error(response.error.message || `RPC ${method} failed`)
      return response?.result
    },
    seed: spec => raw('__seed__', spec),
    async stop() {
      child.stdin.end()
      child.kill()
      rmSync(home, { recursive: true, force: true })
    }
  }
}
