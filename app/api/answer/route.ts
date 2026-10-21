import { answerQuestion } from '../../../lib/agent'
import { withSessionRoute } from '../../../lib/route-auth'

export const maxDuration = 800

export const POST = withSessionRoute(async (request, { host }) => {
  let body: { qid?: unknown; answers?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  const qid = typeof body?.qid === 'number' ? body.qid : NaN
  const answers = body?.answers
  if (!Number.isFinite(qid) || !answers || typeof answers !== 'object' || Array.isArray(answers) ||
      !Object.values(answers).every((value) => typeof value === 'string')) {
    return Response.json({ error: 'invalid answer' }, { status: 400 })
  }
  return Response.json({ ok: await answerQuestion(host, qid, answers as Record<string, string>) })
})
