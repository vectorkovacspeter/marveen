// Unit tests for the fleet killswitch STATE module (src/web/fleet-pause.ts).
//
// STORE_DIR is redirected to a throwaway temp dir via a vi.mock of ../config.js
// so the test never touches the real store/ and is fully host-runnable (no tmux
// / agent-process import chain). The atomic-write + fs paths are exercised for
// real against the temp dir -- this proves the on-disk persistence contract and
// the fail-open (missing / corrupt file => unpaused) behavior.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const STORE_DIR = mkdtempSync(join(tmpdir(), 'fleet-pause-test-'))
const STORE_PATH = join(STORE_DIR, 'fleet-paused.json')

vi.mock('../config.js', () => ({ STORE_DIR }))

const { isFleetPaused, getFleetPauseState, setFleetPause, clearFleetPause } =
  await import('../web/fleet-pause.js')

beforeEach(() => {
  // Reset to a clean (unpaused) slate before every case.
  try { rmSync(STORE_PATH, { force: true }) } catch { /* ignore */ }
})

afterAll(() => {
  try { rmSync(STORE_DIR, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('fleet-pause state module', () => {
  it('defaults to unpaused when no state file exists', () => {
    expect(isFleetPaused()).toBe(false)
    expect(getFleetPauseState()).toEqual({ paused: false })
  })

  it('setFleetPause(soft) persists and reports paused', () => {
    const state = setFleetPause('soft', 'tester')
    expect(state.paused).toBe(true)
    expect(state.mode).toBe('soft')
    expect(state.by).toBe('tester')
    expect(typeof state.at).toBe('string')
    expect(existsSync(STORE_PATH)).toBe(true)

    expect(isFleetPaused()).toBe(true)
    const read = getFleetPauseState()
    expect(read).toMatchObject({ paused: true, mode: 'soft', by: 'tester' })
  })

  it('setFleetPause(hard) persists mode=hard', () => {
    setFleetPause('hard')
    expect(isFleetPaused()).toBe(true)
    const read = getFleetPauseState() as { paused: true; mode: string }
    expect(read.mode).toBe('hard')
  })

  it('clearFleetPause returns to unpaused', () => {
    setFleetPause('hard', 'x')
    expect(isFleetPaused()).toBe(true)
    clearFleetPause()
    expect(isFleetPaused()).toBe(false)
    expect(getFleetPauseState()).toEqual({ paused: false })
  })

  it('fail-open: a corrupt state file reads as unpaused', () => {
    writeFileSync(STORE_PATH, '{ this is not json ')
    expect(isFleetPaused()).toBe(false)
    expect(getFleetPauseState()).toEqual({ paused: false })
  })

  it('fail-open: a well-formed file with paused=false reads as unpaused', () => {
    writeFileSync(STORE_PATH, JSON.stringify({ paused: false, mode: 'soft', at: 'x' }))
    expect(isFleetPaused()).toBe(false)
    expect(getFleetPauseState()).toEqual({ paused: false })
  })
})
