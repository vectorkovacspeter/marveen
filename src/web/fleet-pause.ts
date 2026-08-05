import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from '../config.js'
import { logger } from '../logger.js'
import { atomicWriteFileSync } from './atomic-write.js'

// Runtime fleet killswitch state.
//
// The fleet (main channels session + sub-agents) are `claude` CLI sessions the
// heartbeat / message-router drive; they burn Claude tokens even when idle.
// RESPAWN_ENABLED=0 is a *boot-time* off switch -- this file is the *runtime*
// one. Two levels:
//   soft = block new dispatch + respawns; let in-flight agents finish.
//   hard = soft + the route also stops the running sessions right away.
// The mode is recorded so the dashboard can show which level is active; the
// gates (reconcile / message-router tick) only care about isFleetPaused().
//
// Persisted to store/fleet-paused.json via atomicWriteFileSync so a crash
// mid-write can never leave a half-written file that freezes (or un-freezes)
// the fleet by accident.
//
// FAIL-OPEN: a missing OR corrupt OR paused:false file all read as "running".
// A read error must never accidentally freeze the fleet -- the safe default is
// to keep working, so any doubt resolves to unpaused.
const STORE_PATH = join(STORE_DIR, 'fleet-paused.json')

export type FleetPauseMode = 'soft' | 'hard'

/** On-disk / in-memory shape while paused. */
export interface FleetPausedState {
  paused: true
  mode: FleetPauseMode
  at: string
  by?: string
}

/** What callers see: either the full paused record or a bare unpaused marker. */
export type FleetPauseState = FleetPausedState | { paused: false }

function readState(): FleetPauseState {
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { paused?: unknown }).paused === true &&
      ((parsed as { mode?: unknown }).mode === 'soft' || (parsed as { mode?: unknown }).mode === 'hard')
    ) {
      const p = parsed as { mode: FleetPauseMode; at?: unknown; by?: unknown }
      return {
        paused: true,
        mode: p.mode,
        at: typeof p.at === 'string' ? p.at : '',
        ...(typeof p.by === 'string' ? { by: p.by } : {}),
      }
    }
  } catch {
    // Missing or corrupt file -> fail open (unpaused).
  }
  return { paused: false }
}

/** True only when the fleet is currently paused (either level). */
export function isFleetPaused(): boolean {
  return readState().paused === true
}

/** Full state for the dashboard: the paused record, or `{ paused: false }`. */
export function getFleetPauseState(): FleetPauseState {
  return readState()
}

/** Persist a paused state at the given level; returns the new state. */
export function setFleetPause(mode: FleetPauseMode, by?: string): FleetPausedState {
  const state: FleetPausedState = {
    paused: true,
    mode,
    at: new Date().toISOString(),
    ...(by ? { by } : {}),
  }
  atomicWriteFileSync(STORE_PATH, JSON.stringify(state, null, 2))
  logger.warn({ mode, by }, 'Fleet paused (killswitch engaged)')
  return state
}

/** Clear the pause -- delete the state file so the fleet reads as running. */
export function clearFleetPause(): void {
  try {
    rmSync(STORE_PATH, { force: true })
  } catch (err) {
    logger.error({ err }, 'Failed to clear fleet-paused.json')
  }
  logger.info('Fleet resumed (killswitch cleared)')
}
