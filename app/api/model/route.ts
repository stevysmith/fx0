import { getSessionGenerationOptions, setSessionGeneration } from '../../../lib/agent'

import { withSessionRoute } from '../../../lib/route-auth'

import { log } from '../../../lib/session'

export const maxDuration = 800

// One route for the session's shared generation settings; each field is independent.
export const GET = withSessionRoute(async (_request, { host }) => {
  return Response.json(await getSessionGenerationOptions(host))
})

export const POST = withSessionRoute(async (request, { host }) => {
  let body: { model?: unknown; effort?: unknown; fast?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'body must be an object' }, { status: 400 })
  }
  if (body.fast !== undefined && typeof body.fast !== 'boolean') {
    return Response.json({ error: 'fast must be a boolean' }, { status: 400 })
  }
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
  const change = {
    model: body.model === undefined ? undefined : text(body.model),
    effort: body.effort === undefined ? undefined : text(body.effort),
    fast: body.fast as boolean | undefined,
  }
  if (change.model !== undefined || change.effort !== undefined || change.fast !== undefined) {
    const result = await setSessionGeneration(host, change)
    if (!result.ok) { log(host.id, 'generation:rejected', { error: result.error }); return Response.json(result, { status: 409 }) }
  }
  return Response.json({ ok: true, ...(await getSessionGenerationOptions(host)) })
})
