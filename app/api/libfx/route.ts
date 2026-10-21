import { agent } from '../../../lib/agent'

// Each delivery runs a turn until this deadline, and the next invocation runs
// the rest.
export const maxDuration = 800

// Vercel Queues delivers here the turns no request runs itself (the trigger is
// in vercel.json): the rest of a turn that outlasted its prompt request, and a
// prompt's backstop when that request died.
//
// The trigger also keeps this route private: it has no public URL, so only
// Vercel's queue can call it. That matters because the handler acts on the
// delivery it is given (the bundled queue client runs libfx before the broker
// confirms the receipt). tests/core.test.mjs fails if the trigger goes away.
export const POST = agent().wakeHandler()
