import { cancelCurrent } from '../../../lib/agent'
import { withSessionRoute } from '../../../lib/route-auth'

export const maxDuration = 800

export const POST = withSessionRoute(async (_request, { host }) => {
  return Response.json({ cancelled: await cancelCurrent(host) })
})
