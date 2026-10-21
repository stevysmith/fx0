import { createSessionEventStream } from '../../../lib/event-stream'
import { followChat, renewTurnCredential } from '../../../lib/agent'
import { withSessionRoute } from '../../../lib/route-auth'

export const maxDuration = 800
// A stream left open by a suspended tab or a dropped network otherwise runs until
// maxDuration and fails with a runtime timeout. Ending it well before then keeps
// that cost short; a connected client resumes from its last seq within a second.
const STREAM_LIFETIME_MS = 300_000

export const GET = withSessionRoute(async (request, { id: sessionId, host }) => {
  const requestedAfter = Number(new URL(request.url).searchParams.get('after') ?? 0)
  const lastEventId = Number(request.headers.get('last-event-id') ?? 0)
  const afterSeq = Math.max(
    Number.isFinite(requestedAfter) ? requestedAfter : 0,
    Number.isFinite(lastEventId) ? lastEventId : 0,
  )
  // Best effort; the token a turn already holds keeps working until it expires.
  void renewTurnCredential(host).catch(() => {})
  const stream = createSessionEventStream(sessionId, {
    afterSeq,
    maxLifetimeMs: STREAM_LIFETIME_MS,
    // An open chat keeps its transcript following libfx, including a turn whose
    // prompt route ended or crashed.
    wake: () => void followChat(host),
  })
  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})
