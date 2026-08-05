// Route-level tests for the fleet killswitch endpoints in routes/fleet.ts.
//
// The tmux-gated collaborators (agent-process, main-agent, fleet-transfer,
// agent-desired-state) are vi.mock'd so this stays host-runnable on Windows and
// never drives real tmux. The STATE module (fleet-pause) is REAL, with STORE_DIR
// redirected to a temp dir via the config mock -- so pause(soft)/pause-state/
// resume exercise the true persistence path, and pause(hard) is checked to call
// the mocked stop primitives without touching the box.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type http from 'node:http'

const STORE_DIR = mkdtempSync(join(tmpdir(), 'fleet-pause-route-'))
vi.mock('../config.js', () => ({ STORE_DIR }))

const stopAgentProcess = vi.fn<(name: string) => { ok: boolean }>(() => ({ ok: true }))
vi.mock('../web/agent-process.js', () => ({ stopAgentProcess }))

const getDesiredAgents = vi.fn<() => Set<string>>(() => new Set<string>())
vi.mock('../web/agent-desired-state.js', () => ({ getDesiredAgents }))

vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'test-channels' }))

// resolveFromPath('tmux') would throw on a host without tmux (Windows CI); stub
// it so the hard-mode kill path reaches the (mocked) execFileSync.
vi.mock('../platform.js', () => ({ resolveFromPath: (_bin: string) => '/usr/bin/tmux' }))

// fleet-transfer is unused by the killswitch paths but is imported by fleet.ts;
// stub it so we don't pull vault / crypto into the host test.
vi.mock('../web/fleet-transfer.js', () => ({
  exportFleet: vi.fn(),
  importFleet: vi.fn(),
  MIN_VAULT_PASSWORD_LEN: 8,
  UserFacingError: class extends Error {},
}))

// Keep hard-mode's main-session kill from actually spawning tmux.
const execFileSync = vi.fn()
vi.mock('node:child_process', () => ({ execFileSync }))

const { tryHandleFleet } = await import('../web/routes/fleet.js')
const { isFleetPaused } = await import('../web/fleet-pause.js')

function fakeReq(body?: unknown): http.IncomingMessage {
  const req = new EventEmitter() as unknown as http.IncomingMessage
  queueMicrotask(() => {
    if (body !== undefined) (req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)))
    ;(req as unknown as EventEmitter).emit('end')
  })
  return req
}
function fakeRes(): { res: http.ServerResponse; status: () => number; body: () => unknown } {
  let status = 0
  let written = ''
  const res = {
    writeHead: (code: number) => { status = code },
    end: (chunk?: string) => { written = chunk ?? '' },
  } as unknown as http.ServerResponse
  return { res, status: () => status, body: () => JSON.parse(written || '{}') }
}

beforeEach(() => {
  stopAgentProcess.mockClear()
  getDesiredAgents.mockClear().mockReturnValue(new Set<string>())
  execFileSync.mockClear()
  try { rmSync(join(STORE_DIR, 'fleet-paused.json'), { force: true }) } catch { /* ignore */ }
})

afterAll(() => {
  try { rmSync(STORE_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('killswitch routes', () => {
  it('GET /api/fleet/pause-state defaults to unpaused', async () => {
    const { res, status, body } = fakeRes()
    const ok = await tryHandleFleet({
      req: fakeReq(), res, path: '/api/fleet/pause-state', method: 'GET',
      url: new URL('http://x/api/fleet/pause-state'),
    })
    expect(ok).toBe(true)
    expect(status()).toBe(200)
    expect(body()).toEqual({ paused: false })
  })

  it('POST /api/fleet/pause (soft) sets state and does NOT stop anything', async () => {
    getDesiredAgents.mockReturnValue(new Set(['worker-a']))
    const { res, status, body } = fakeRes()
    await tryHandleFleet({
      req: fakeReq({ mode: 'soft' }), res, path: '/api/fleet/pause', method: 'POST',
      url: new URL('http://x/api/fleet/pause'),
    })
    expect(status()).toBe(200)
    expect((body() as { paused: boolean; mode: string }).mode).toBe('soft')
    expect(isFleetPaused()).toBe(true)
    expect(stopAgentProcess).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('POST /api/fleet/pause default mode is soft when body omits it', async () => {
    const { res, body } = fakeRes()
    await tryHandleFleet({
      req: fakeReq({}), res, path: '/api/fleet/pause', method: 'POST',
      url: new URL('http://x/api/fleet/pause'),
    })
    expect((body() as { mode: string }).mode).toBe('soft')
    expect(stopAgentProcess).not.toHaveBeenCalled()
  })

  it('POST /api/fleet/pause rejects an invalid mode with 400', async () => {
    const { res, status } = fakeRes()
    await tryHandleFleet({
      req: fakeReq({ mode: 'nuke' }), res, path: '/api/fleet/pause', method: 'POST',
      url: new URL('http://x/api/fleet/pause'),
    })
    expect(status()).toBe(400)
    expect(isFleetPaused()).toBe(false)
  })

  it('POST /api/fleet/pause (hard) stops each desired agent AND kills the main session', async () => {
    getDesiredAgents.mockReturnValue(new Set(['worker-a', 'worker-b']))
    const { res, status, body } = fakeRes()
    await tryHandleFleet({
      req: fakeReq({ mode: 'hard' }), res, path: '/api/fleet/pause', method: 'POST',
      url: new URL('http://x/api/fleet/pause'),
    })
    expect(status()).toBe(200)
    expect((body() as { mode: string }).mode).toBe('hard')
    expect(isFleetPaused()).toBe(true)
    expect(stopAgentProcess).toHaveBeenCalledTimes(2)
    expect(stopAgentProcess).toHaveBeenCalledWith('worker-a')
    expect(stopAgentProcess).toHaveBeenCalledWith('worker-b')
    // main session killed via tmux kill-session
    expect(execFileSync).toHaveBeenCalledTimes(1)
    const args = execFileSync.mock.calls[0][1] as string[]
    expect(args).toEqual(['kill-session', '-t', 'test-channels'])
  })

  it('POST /api/fleet/resume clears the pause', async () => {
    const { res: r1, body: b1 } = fakeRes()
    await tryHandleFleet({
      req: fakeReq({ mode: 'hard' }), res: r1, path: '/api/fleet/pause', method: 'POST',
      url: new URL('http://x/api/fleet/pause'),
    })
    expect((b1() as { paused: boolean }).paused).toBe(true)

    const { res, status, body } = fakeRes()
    const ok = await tryHandleFleet({
      req: fakeReq(), res, path: '/api/fleet/resume', method: 'POST',
      url: new URL('http://x/api/fleet/resume'),
    })
    expect(ok).toBe(true)
    expect(status()).toBe(200)
    expect(body()).toEqual({ paused: false })
    expect(isFleetPaused()).toBe(false)
  })

  it('returns false for an unrelated path', async () => {
    const { res } = fakeRes()
    const ok = await tryHandleFleet({
      req: fakeReq(), res, path: '/api/other', method: 'GET',
      url: new URL('http://x/api/other'),
    })
    expect(ok).toBe(false)
  })
})
