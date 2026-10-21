import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STACKTREE_API, forgetLink, linkMessage, loadLink, makePasscode, readActivity, saveLink, sendPrivately, StacktreeError,
  takeDown, updatePrivately,
} from '../lib/stacktree.ts'

function stacktree(replies) {
  const requests = []
  const send = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null })
    const reply = replies.shift()
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { send, requests }
}

const published = {
  id: 'site_1',
  url: 'https://stacktr.ee/p/tok/',
  claim_token: 'claim_1',
  keep_url: 'https://stacktr.ee/keep/tok?c=claim_1',
  expires_at_iso: '2026-10-22T15:42:00Z',
}
const link = {
  id: 'site_1', url: published.url, passcode: 'abcd2345', claimToken: 'claim_1',
  keepUrl: published.keep_url, expiresAt: published.expires_at_iso, revision: 2,
}

test('a passcode is eight characters a person can read out loud', () => {
  for (let i = 0; i < 200; i++) assert.match(makePasscode(), /^[a-hjkmnp-z2-9]{8}$/)
  // Bytes past the last whole run of the alphabet are drawn again, not folded in.
  const draws = [[255, 254, 248, 0, 1, 2, 3, 30], [31, 247, 100, 0, 0, 0, 0, 0]]
  assert.equal(makePasscode(() => draws.shift()), 'abcd9a9h')
})

test('sending publishes the design without an account, behind the passcode', async () => {
  const { send, requests } = stacktree([{ status: 201, body: published }])
  const sent = await sendPrivately({ html: '<p>hi</p>', revision: 2, passcode: 'abcd2345', idempotencyKey: 'key-1' }, send)
  assert.deepEqual(sent, link)
  assert.equal(requests[0].url, `${STACKTREE_API}/sites`)
  assert.equal(requests[0].method, 'POST')
  assert.equal(requests[0].headers['idempotency-key'], 'key-1')
  assert.equal(requests[0].headers.authorization, undefined)
  assert.deepEqual(requests[0].body, { html: '<p>hi</p>', password: 'abcd2345', agent: 'fx0' })
})

test('a refused publish says what Stacktree said', async () => {
  const limit = stacktree([{ status: 429, body: { error: 'anonymous rate limit exceeded — sign up for a free account to continue' } }])
  await assert.rejects(sendPrivately({ html: 'x', revision: 1 }, limit.send), { message: /rate limit/ })
  // A publish refused for the network it came from is not a link that has gone.
  const blocked = stacktree([{ status: 403, body: { error: 'anonymous uploads require a direct client connection' } }])
  await assert.rejects(sendPrivately({ html: 'x', revision: 1 }, blocked.send), (error) => error instanceof StacktreeError && !error.gone)
  const offline = stacktree([new TypeError('fetch failed')])
  await assert.rejects(sendPrivately({ html: 'x', revision: 1 }, offline.send), { message: /Unable to reach Stacktree/ })
})

test('updating keeps the link and passcode and authenticates with the claim token', async () => {
  const { send, requests } = stacktree([{ body: { ...published, expires_at_iso: '2026-10-22T15:42:00Z' } }])
  const updated = await updatePrivately(link, '<p>v3</p>', 3, send)
  assert.deepEqual(updated, { ...link, revision: 3 })
  assert.equal(requests[0].url, `${STACKTREE_API}/sites/site_1`)
  assert.equal(requests[0].method, 'PUT')
  assert.equal(requests[0].headers.authorization, 'Claim claim_1')
  assert.deepEqual(requests[0].body, { html: '<p>v3</p>' })
})

test('a link that was kept, expired or taken down is reported as gone', async () => {
  for (const [status, error] of [[401, 'nope'], [403, 'nope'], [404, 'nope'], [410, 'nope'], [409, 'site_deleted'], [409, 'site_merged']]) {
    const { send } = stacktree([{ status, body: { error } }])
    await assert.rejects(updatePrivately(link, 'x', 3, send), (refused) => refused instanceof StacktreeError && refused.gone)
  }
})

test('activity says whether the client opened it and left comments', async () => {
  const { send, requests } = stacktree([
    { body: { state: 'live', opened: false, first_opened_at: null, comments: { open: 0, total: 0 }, expires_at_iso: published.expires_at_iso } },
    { body: { state: 'live', opened: true, first_opened_at: '2026-10-21T16:00:00Z', comments: { open: 2, total: 2 }, expires_at_iso: published.expires_at_iso } },
    { body: { state: 'expired', opened: true, first_opened_at: '2026-10-21T16:00:00Z', comments: { open: 0, total: 0 }, expires_at_iso: null } },
  ])
  assert.deepEqual(await readActivity(link, send), { live: true, openedAt: null, comments: 0, expiresAt: published.expires_at_iso })
  assert.deepEqual(await readActivity(link, send), { live: true, openedAt: '2026-10-21T16:00:00Z', comments: 2, expiresAt: published.expires_at_iso })
  assert.equal((await readActivity(link, send)).live, false)
  assert.equal(requests[0].url, `${STACKTREE_API}/sites/site_1/activity`)
  assert.equal(requests[0].headers.authorization, 'Claim claim_1')
})

test('taking down a link that is already gone succeeds', async () => {
  const { send, requests } = stacktree([{ status: 200, body: {} }, { status: 404, body: {} }, { status: 500, body: {} }])
  await takeDown(link, send)
  await takeDown(link, send)
  await assert.rejects(takeDown(link, send))
  assert.equal(requests[0].method, 'DELETE')
  assert.equal(requests[0].headers.authorization, 'Claim claim_1')
})

test('the message for the client carries the link and the passcode', () => {
  assert.equal(linkMessage(link), 'https://stacktr.ee/p/tok/\nPasscode: abcd2345')
})

test('each chat remembers its link in this browser until it expires', (t) => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  t.after(() => { delete globalThis.localStorage })
  saveLink('chat-1', link)
  assert.deepEqual(loadLink('chat-1', Date.parse('2026-10-22T15:00:00Z')), link)
  assert.equal(loadLink('chat-2'), null)
  assert.equal(loadLink('chat-1', Date.parse('2026-10-22T15:42:00Z')), null)
  assert.equal(store.size, 0, 'an expired link is forgotten')
  saveLink('chat-1', link)
  forgetLink('chat-1')
  assert.equal(loadLink('chat-1', 0), null)
  store.set('fx0:stacktree:chat-3', '{not json')
  assert.equal(loadLink('chat-3'), null)
})
