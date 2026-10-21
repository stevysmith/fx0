'use client'

import { useEffect, useRef, useState } from 'react'
import { AuthRouteError } from './auth-ui'
import { IconCheck, IconCopy } from './geist-icons'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import {
  forgetLink, linkMessage, loadLink, readActivity, saveLink, sendPrivately, StacktreeError, takeDown, updatePrivately,
  type LinkActivity, type PrivateLink,
} from '../lib/stacktree'

type Phase =
  | { name: 'closed' }
  | { name: 'working'; text: string }
  | { name: 'ready'; updated: boolean }
  | { name: 'error'; title: string; text: string; action: string; retry: 'send' | 'update' }

// How often an open dialog asks Stacktree whether the link has been opened.
const ACTIVITY_MS = 20_000

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })

function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return relativeTime.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relativeTime.format(-hours, 'hour')
  return relativeTime.format(-Math.floor(hours / 24), 'day')
}

function until(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

function comments(count: number): string {
  return `${count} comment${count === 1 ? '' : 's'}`
}

// The menu item, in the share menu's width: what it does, then what the client has done.
export function linkItem(link: PrivateLink | null, activity: LinkActivity | null, shown: number): { label: string; detail: string } {
  if (!link) return { label: 'send privately', detail: 'with Stacktree' }
  if (link.revision !== shown) return { label: 'send new version', detail: 'same private link' }
  const detail = !activity ? 'with Stacktree'
    : activity.comments ? `${comments(activity.comments)} waiting`
    : activity.openedAt ? `opened ${timeAgo(activity.openedAt)}`
    : 'not opened yet'
  return { label: 'private link', detail }
}

// One private link per chat. It shows the design version that was sent until the next
// update, which keeps the same link and passcode.
export function usePrivateLink({
  sessionId,
  shown,
  load,
  onNotice,
}: {
  sessionId: string
  shown: number
  load: () => Promise<string>
  onNotice: (notice: { tone: 'status' | 'error'; text: string }) => void
}) {
  const [link, setLink] = useState<PrivateLink | null>(null)
  const [activity, setActivity] = useState<LinkActivity | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'closed' })
  const current = useRef<PrivateLink | null>(null)
  const opened = useRef(false)
  // Kept across a retry, so a publish whose answer was lost replays instead of making
  // a second page.
  const idempotencyKey = useRef<string | null>(null)

  function remember(next: PrivateLink | null) {
    current.current = next
    setLink(next)
    if (next) saveLink(sessionId, next)
    else forgetLink(sessionId)
  }

  function show(next: Phase) {
    // A dialog the user closed while the request ran stays closed.
    if (next.name !== 'closed' && next.name !== 'working' && !opened.current) return
    setPhase(next)
  }

  async function refresh(of = current.current) {
    if (!of) return
    try {
      const next = await readActivity(of)
      if (current.current?.id !== of.id) return
      if (!next.live) ended('It expired or was taken down.')
      else setActivity(next)
    } catch (error) {
      if (error instanceof StacktreeError && error.gone && current.current?.id === of.id) ended(error.message)
    }
  }

  // The link stopped working: the menu offers a new one, and an open dialog says so.
  function ended(text: string) {
    remember(null)
    setActivity(null)
    setPhase((now) => now.name === 'ready' ? { name: 'error', title: 'This link has ended', text, action: 'Send a new link', retry: 'send' } : now)
  }

  useEffect(() => {
    const stored = loadLink(sessionId)
    current.current = stored
    setLink(stored)
    setActivity(null)
    void refresh(stored)
  }, [sessionId])

  useEffect(() => {
    if (phase.name !== 'ready') return
    const timer = setInterval(() => void refresh(), ACTIVITY_MS)
    return () => clearInterval(timer)
  }, [phase.name])

  async function send() {
    opened.current = true
    setPhase({ name: 'working', text: 'Creating a private link…' })
    try {
      const html = await load()
      idempotencyKey.current ??= crypto.randomUUID()
      const next = await sendPrivately({ html, revision: shown, idempotencyKey: idempotencyKey.current })
      idempotencyKey.current = null
      remember(next)
      setActivity({ live: true, openedAt: null, comments: 0, expiresAt: next.expiresAt })
      show({ name: 'ready', updated: false })
    } catch (error) {
      fail(error, 'send')
    }
  }

  async function update(of: PrivateLink) {
    opened.current = true
    setPhase({ name: 'working', text: 'Updating the link…' })
    try {
      const html = await load()
      remember(await updatePrivately(of, html, shown))
      show({ name: 'ready', updated: true })
    } catch (error) {
      if (error instanceof StacktreeError && error.gone) {
        remember(null)
        setActivity(null)
        show({ name: 'error', title: 'This link has ended', text: error.message, action: 'Send a new link', retry: 'send' })
        return
      }
      fail(error, 'update')
    }
  }

  function fail(error: unknown, retry: 'send' | 'update') {
    if (error instanceof AuthRouteError) {
      close()
      return
    }
    show({
      name: 'error',
      title: retry === 'send' ? 'The link was not sent' : 'The link was not updated',
      text: error instanceof StacktreeError ? error.message : 'Unable to read the design. Try again.',
      action: 'Try again',
      retry,
    })
  }

  function close() {
    opened.current = false
    setPhase({ name: 'closed' })
  }

  // The menu's one action: send a first link, bring an existing one up to the version
  // on screen, or show it.
  function act() {
    const existing = current.current
    if (!existing) return void send()
    if (existing.revision !== shown) return void update(existing)
    opened.current = true
    setPhase({ name: 'ready', updated: false })
    void refresh(existing)
  }

  async function remove() {
    const existing = current.current
    if (!existing) return
    try {
      await takeDown(existing)
      remember(null)
      setActivity(null)
      close()
      onNotice({ tone: 'status', text: 'Took the private link down.' })
    } catch (error) {
      onNotice({ tone: 'error', text: error instanceof StacktreeError ? error.message : 'Unable to take the link down. Try again.' })
    }
  }

  const dialog = (
    <PrivateLinkDialog
      phase={phase}
      link={link}
      activity={activity}
      onRetry={(retry) => (retry === 'update' && current.current ? void update(current.current) : void send())}
      onTakeDown={() => void remove()}
      onClose={close}
    />
  )
  return { link, activity, act, dialog }
}

function CopyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex min-w-0 items-center gap-2 border bg-secondary py-1 pl-3 pr-1">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${mono ? 'font-mono' : ''}`} title={value}>{value}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`copy ${label.toLowerCase()}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }, () => {})
        }}
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </Button>
    </div>
  )
}

function PrivateLinkDialog({
  phase,
  link,
  activity,
  onRetry,
  onTakeDown,
  onClose,
}: {
  phase: Phase
  link: PrivateLink | null
  activity: LinkActivity | null
  onRetry: (retry: 'send' | 'update') => void
  onTakeDown: () => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { if (phase.name !== 'ready') setConfirming(false) }, [phase.name])

  const ready = phase.name === 'ready' && link
  const expiresAt = activity?.expiresAt ?? link?.expiresAt ?? null
  return (
    <Dialog open={phase.name !== 'closed'} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-lg font-medium">
          {phase.name === 'error' ? phase.title : ready && phase.updated ? 'Link updated' : 'Private link'}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {phase.name === 'working' ? phase.text
            : phase.name === 'error' ? phase.text
            : ready && phase.updated ? 'Same link and passcode. Your client sees this version the next time they open it.'
            : 'Stacktree hosts this design at a private link. Your client needs the link and the passcode to open it.'}
        </DialogDescription>

        {ready && (
          <>
            <div className="mt-4 grid gap-2">
              <CopyRow label="Link" value={link.url} />
              <CopyRow label="Passcode" value={link.passcode} mono />
            </div>
            <Button
              className="mt-3 w-full"
              onClick={() => {
                void navigator.clipboard.writeText(linkMessage(link)).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }, () => {})
              }}
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              {copied ? 'Copied' : 'Copy link and passcode'}
            </Button>
            <p className="mt-4 text-sm" aria-live="polite">
              {!activity ? 'Checking whether it has been opened…'
                : activity.openedAt ? `Opened ${timeAgo(activity.openedAt)}.` : 'Not opened yet.'}
              {activity?.comments ? ` ${comments(activity.comments)} waiting.` : ''}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {expiresAt ? `Works until ${until(expiresAt)}. ` : ''}
              {link.keepUrl && (
                <a
                  href={link.keepUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  {activity?.comments ? 'Keep it to read the comments' : 'Keep it longer'}
                </a>
              )}
            </p>
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {phase.name === 'error' && (
            <Button onClick={() => onRetry(phase.retry)}>{phase.action}</Button>
          )}
          {ready && (
            <Button
              variant={confirming ? 'destructive' : 'ghost'}
              size="sm"
              onClick={() => (confirming ? onTakeDown() : setConfirming(true))}
            >
              {confirming ? 'Confirm take down' : 'Take down'}
            </Button>
          )}
          <Button
            variant={phase.name === 'error' ? 'outline' : 'secondary'}
            className="ml-auto"
            onClick={onClose}
          >
            {phase.name === 'error' ? 'Cancel' : 'Done'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
