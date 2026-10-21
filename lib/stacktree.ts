// Sends a design to Stacktree as a private link behind a passcode, from the browser,
// with no account. POST /sites without an Authorization header publishes a page that
// lives 24 hours and answers with its claim token, which then updates the page in
// place, reads whether it has been opened and takes it down. The calls are documented
// at https://api.stacktr.ee/openapi.json. NEXT_PUBLIC_STACKTREE_API points them at
// another Stacktree, such as one running locally.
export const STACKTREE_API = process.env.NEXT_PUBLIC_STACKTREE_API || 'https://api.stacktr.ee'

// Eight characters a person can read out loud: no 0/o or 1/l/i.
const PASSCODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const PASSCODE_LENGTH = 8

export function makePasscode(random: (count: number) => ArrayLike<number> = (count) => crypto.getRandomValues(new Uint8Array(count))): string {
  // Bytes at or above the largest multiple of the alphabet are drawn again, so every
  // character is equally likely.
  const limit = 256 - (256 % PASSCODE_ALPHABET.length)
  let passcode = ''
  while (passcode.length < PASSCODE_LENGTH) {
    for (const byte of Array.from(random(PASSCODE_LENGTH))) {
      if (byte < limit && passcode.length < PASSCODE_LENGTH) passcode += PASSCODE_ALPHABET[byte % PASSCODE_ALPHABET.length]
    }
  }
  return passcode
}

export type PrivateLink = {
  id: string
  url: string
  passcode: string
  // Updates, reads and takes down the page until it is kept in a Stacktree account.
  claimToken: string
  // Stacktree's page for keeping this one past its 24 hours. It is the key to the
  // page, so it is for the sender, never the client.
  keepUrl: string | null
  expiresAt: string | null
  // The design version the link shows.
  revision: number
}

export type LinkActivity = {
  live: boolean
  openedAt: string | null
  comments: number
  expiresAt: string | null
}

export class StacktreeError extends Error {
  // The link can no longer be changed from here: it expired, was taken down, or was
  // kept in an account, which retires its claim token.
  readonly gone: boolean
  constructor(message: string, gone = false) {
    super(message)
    this.gone = gone
  }
}

type Send = typeof fetch

async function call(send: Send, path: string, init: RequestInit): Promise<{ response: Response; body: Record<string, unknown> | null }> {
  let response: Response
  try {
    response = await send(`${STACKTREE_API}${path}`, init)
  } catch {
    throw new StacktreeError('Unable to reach Stacktree. Check your connection and try again.')
  }
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  return { response, body }
}

// Stacktree explains a refusal in `message` or `error`, for example the 20 pages a day
// it publishes without an account from one network.
function refusal(response: Response, body: Record<string, unknown> | null, fallback: string, existing = true): StacktreeError {
  // A page that stopped serving answers 409 site_deleted, one folded into another 409
  // site_merged, and a retired claim token 401 or 403.
  const gone = [401, 403, 404, 410].includes(response.status) || body?.error === 'site_deleted' || body?.error === 'site_merged'
  if (existing && gone) return new StacktreeError('This link expired, was taken down or was kept in a Stacktree account, so fx0 can no longer change it.', true)
  const reason = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : null
  return new StacktreeError(reason ?? `${fallback} (${response.status}).`)
}

function claim(link: PrivateLink): Record<string, string> {
  return { authorization: `Claim ${link.claimToken}` }
}

export async function sendPrivately(
  { html, revision, passcode = makePasscode(), idempotencyKey = crypto.randomUUID() }: { html: string; revision: number; passcode?: string; idempotencyKey?: string },
  send: Send = fetch,
): Promise<PrivateLink> {
  const { response, body } = await call(send, '/sites', {
    method: 'POST',
    // A retried click replays the first publish instead of making a second page.
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ html, password: passcode, agent: 'fx0' }),
  })
  if (!response.ok || typeof body?.id !== 'string' || typeof body.url !== 'string' || typeof body.claim_token !== 'string') {
    throw refusal(response, body, 'Stacktree could not publish the design', false)
  }
  return {
    id: body.id,
    url: body.url,
    passcode,
    claimToken: body.claim_token,
    keepUrl: typeof body.keep_url === 'string' ? body.keep_url : null,
    expiresAt: typeof body.expires_at_iso === 'string' ? body.expires_at_iso : null,
    revision,
  }
}

// Replaces what the link shows. The link, its passcode and its expiry stay the same.
export async function updatePrivately(link: PrivateLink, html: string, revision: number, send: Send = fetch): Promise<PrivateLink> {
  const { response, body } = await call(send, `/sites/${encodeURIComponent(link.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...claim(link) },
    body: JSON.stringify({ html }),
  })
  if (!response.ok) throw refusal(response, body, 'Stacktree could not update the link')
  return { ...link, revision, expiresAt: typeof body?.expires_at_iso === 'string' ? body.expires_at_iso : link.expiresAt }
}

export async function readActivity(link: PrivateLink, send: Send = fetch): Promise<LinkActivity> {
  const { response, body } = await call(send, `/sites/${encodeURIComponent(link.id)}/activity`, { headers: claim(link) })
  if (!response.ok || !body) throw refusal(response, body, 'Stacktree could not say whether the link was opened')
  const comments = body.comments as { open?: unknown } | null
  return {
    live: body.state === 'live',
    openedAt: body.opened === true && typeof body.first_opened_at === 'string' ? body.first_opened_at : null,
    comments: typeof comments?.open === 'number' ? comments.open : 0,
    expiresAt: typeof body.expires_at_iso === 'string' ? body.expires_at_iso : link.expiresAt,
  }
}

export async function takeDown(link: PrivateLink, send: Send = fetch): Promise<void> {
  const { response, body } = await call(send, `/sites/${encodeURIComponent(link.id)}`, { method: 'DELETE', headers: claim(link) })
  // A link that is already gone is as taken down as it gets.
  if (!response.ok && ![404, 410].includes(response.status)) throw refusal(response, body, 'Stacktree could not take the link down')
}

// What to paste to the client.
export function linkMessage(link: Pick<PrivateLink, 'url' | 'passcode'>): string {
  return `${link.url}\nPasscode: ${link.passcode}`
}

// One link per chat, in this browser only, like the claim token it holds.
const storageKey = (sessionId: string) => `fx0:stacktree:${sessionId}`

export function loadLink(sessionId: string, now = Date.now()): PrivateLink | null {
  try {
    const link = JSON.parse(localStorage.getItem(storageKey(sessionId)) ?? 'null') as PrivateLink | null
    if (!link?.id || !link.claimToken) return null
    if (link.expiresAt && Date.parse(link.expiresAt) <= now) {
      forgetLink(sessionId)
      return null
    }
    return link
  } catch {
    return null
  }
}

export function saveLink(sessionId: string, link: PrivateLink): void {
  try { localStorage.setItem(storageKey(sessionId), JSON.stringify(link)) } catch {}
}

export function forgetLink(sessionId: string): void {
  try { localStorage.removeItem(storageKey(sessionId)) } catch {}
}
