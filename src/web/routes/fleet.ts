import { execFileSync } from 'node:child_process'
import { logger } from '../../logger.js'
import { resolveFromPath } from '../../platform.js'
import { readBody, json } from '../http-helpers.js'
import { exportFleet, importFleet, MIN_VAULT_PASSWORD_LEN, UserFacingError, type ExportedFleet } from '../fleet-transfer.js'
import { getFleetPauseState, setFleetPause, clearFleetPause, type FleetPauseMode } from '../fleet-pause.js'
import { getDesiredAgents } from '../agent-desired-state.js'
import { stopAgentProcess } from '../agent-process.js'
import { MAIN_CHANNELS_SESSION } from '../main-agent.js'
import type { RouteContext } from './types.js'

// Hard-mode killswitch: stop the running fleet right now. There is no exported
// "stop the main channels session" primitive that does NOT respawn
// (hardRestartMarveenChannels RESPAWNS), so the main session is killed directly
// with the same tmux kill-session invocation agent-process.stopAgentProcess uses
// for sub-agents. Everything is best-effort: a failure here must never throw out
// of the route -- the paused STATE is already persisted and is what stops the
// respawn/tick loops.
function stopFleetNow(by?: string): void {
  for (const name of getDesiredAgents()) {
    try {
      stopAgentProcess(name)
    } catch (err) {
      logger.warn({ err, agent: name }, 'Killswitch hard: stopAgentProcess threw')
    }
  }
  try {
    const tmux = resolveFromPath('tmux')
    execFileSync(tmux, ['kill-session', '-t', MAIN_CHANNELS_SESSION], { timeout: 5000, stdio: ['ignore', 'ignore', 'pipe'] })
    logger.warn({ session: MAIN_CHANNELS_SESSION, by }, 'Killswitch hard: main channels session killed')
  } catch (err) {
    // No session to kill (already down) or tmux unavailable -- both are fine.
    logger.warn({ err, session: MAIN_CHANNELS_SESSION }, 'Killswitch hard: main channels kill-session failed (may already be down)')
  }
}

export async function tryHandleFleet(ctx: RouteContext): Promise<boolean> {
  const { req, res, path, method } = ctx

  const HANDLED_PATHS = new Set([
    '/api/fleet/export',
    '/api/fleet/import',
    '/api/fleet/pause-state',
    '/api/fleet/pause',
    '/api/fleet/resume',
  ])
  if (!HANDLED_PATHS.has(path)) return false

  if (path === '/api/fleet/pause-state' && method === 'GET') {
    json(res, getFleetPauseState())
    return true
  }

  if (path === '/api/fleet/pause' && method === 'POST') {
    let mode: FleetPauseMode = 'soft'
    try {
      const buf = await readBody(req)
      const raw = buf.toString().trim()
      if (raw.length > 0) {
        const body = JSON.parse(raw) as { mode?: unknown }
        if (body.mode !== undefined) {
          if (body.mode !== 'soft' && body.mode !== 'hard') {
            json(res, { error: "mode kötelezően 'soft' vagy 'hard'." }, 400)
            return true
          }
          mode = body.mode
        }
      }
    } catch (err: any) {
      json(res, { error: `Kérés olvasási hiba: ${err.message}` }, 400)
      return true
    }

    const by = ctx.auth?.user
    const state = setFleetPause(mode, by)
    if (mode === 'hard') stopFleetNow(by)
    json(res, state)
    return true
  }

  if (path === '/api/fleet/resume' && method === 'POST') {
    clearFleetPause()
    // No exported reconcile-kick exists; clearing the flag is enough -- the
    // periodic channel-monitor loop re-runs reconcileDesiredAgents() and brings
    // the desired agents back on its next pass.
    json(res, getFleetPauseState())
    return true
  }


  // H1: vault password via header, not query string (avoids access-log / proxy-log / browser-history leakage)
  const vaultPassword = req.headers['x-vault-password'] as string | undefined

  if (path === '/api/fleet/export' && method === 'GET') {
    if (vaultPassword !== undefined && vaultPassword.length < MIN_VAULT_PASSWORD_LEN) {
      json(res, { error: `X-Vault-Password must be at least ${MIN_VAULT_PASSWORD_LEN} characters.` }, 400)
      return true
    }
    try {
      const exported: ExportedFleet = exportFleet({ vaultPassword: vaultPassword || undefined })
      const buf = Buffer.from(exported.data)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="fleet-export-${exported.exportedAt.slice(0, 10)}.json"`,
        'Content-Length': buf.byteLength,
      })
      res.end(buf)
    } catch (err: any) {
      if (err instanceof UserFacingError) {
        json(res, { error: err.message }, 400)
      } else {
        logger.error({ err: err.message }, 'Fleet export failed')
        json(res, { error: `Export hiba: ${err.message}` }, 500)
      }
    }
    return true
  }

  if (path === '/api/fleet/import' && method === 'POST') {
    const apply = ctx.url.searchParams.get('apply') === 'true'

    // M1: check vault password length for import side too
    if (vaultPassword !== undefined && vaultPassword.length < MIN_VAULT_PASSWORD_LEN) {
      json(res, { error: `X-Vault-Password must be at least ${MIN_VAULT_PASSWORD_LEN} characters.` }, 400)
      return true
    }

    let rawBody: string
    try {
      const buf = await readBody(req)
      rawBody = buf.toString()
    } catch (err: any) {
      json(res, { error: `Kérés olvasási hiba: ${err.message}` }, 400)
      return true
    }

    // importFleet handles JSON parse (and encrypted blob detection) internally
    try {
      const result = importFleet(rawBody, { vaultPassword: vaultPassword || undefined, apply })
      if ('dryRun' in result && result.errors.length > 0) {
        json(res, result, 400)
      } else {
        json(res, result, 200)
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Fleet import failed')
      json(res, { error: `Import hiba: ${err.message}` }, 500)
    }
    return true
  }

  return false
}
