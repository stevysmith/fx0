'use client'

import { useRef, useState } from 'react'
import { AuthRouteError, fetchUi } from './auth-ui'
import { IconCheck, IconCopy, IconShare } from './geist-icons'
import { linkItem, usePrivateLink } from './private-link'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { fastClick } from '../lib/fast-click'

// "Landing page for a coffee roaster" → landing-page-for-a-coffee-roaster.html
function designFileName(title: string | null | undefined): string {
  const slug = (title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
  return `${slug || 'design'}.html`
}

type Notice = { tone: 'status' | 'error'; text: string }

export const DROP_URL = 'https://vercel.com/drop'

// Copies, downloads, hands to Vercel Drop or sends privately with Stacktree the design
// the preview shows: a past version when one is pinned (`revision`), else the latest
// (`latest`, which also keys the cached HTML).
export default function DesignExport({
  sessionId,
  revision,
  latest,
  title,
  onNotice,
}: {
  sessionId: string
  revision: number | null
  latest: number
  title: string | null | undefined
  onNotice: (notice: Notice) => void
}) {
  const [open, setOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const cached = useRef<{ key: string; html: Promise<string> } | null>(null)
  const key = `${sessionId}:${revision ?? `latest-${latest}`}`

  // Read when the menu opens, so Copy can write in the same click.
  function load(): Promise<string> {
    if (cached.current?.key !== key) {
      const query = new URLSearchParams({ session: sessionId })
      if (revision != null) query.set('revision', String(revision))
      const html = fetchUi(`/api/artifact?${query}`).then((response) => {
        if (!response.ok) throw new Error(`design request failed: ${response.status}`)
        return response.text()
      })
      const entry = { key, html }
      cached.current = entry
      html.catch(() => { if (cached.current === entry) cached.current = null })
    }
    return cached.current!.html
  }

  const shown = revision ?? latest
  const privateLink = usePrivateLink({ sessionId, shown, load, onNotice })
  const privateItem = linkItem(privateLink.link, privateLink.activity, shown)

  async function copy() {
    setOpen(false)
    const html = load()
    try {
      // Safari allows a clipboard write only inside the click, so a pending read goes
      // in as a promise; elsewhere the text is written once it is here.
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/plain': html.then((text) => new Blob([text], { type: 'text/plain' })) }),
        ])
      } else {
        await navigator.clipboard.writeText(await html)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      onNotice({ tone: 'status', text: 'Copied the design HTML.' })
    } catch (error) {
      if (error instanceof AuthRouteError) return
      onNotice({ tone: 'error', text: 'Unable to copy the design. Try again.' })
    }
  }

  async function download(fileName = designFileName(title), saved = `Downloaded ${fileName}.`) {
    setOpen(false)
    try {
      const html = await load()
      // Octet-stream, so the browser saves the file and never renders the design on
      // this origin.
      const url = URL.createObjectURL(new Blob([html], { type: 'application/octet-stream' }))
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      onNotice({ tone: 'status', text: saved })
    } catch (error) {
      if (error instanceof AuthRouteError) return
      onNotice({ tone: 'error', text: 'Unable to download the design. Try again.' })
    }
  }

  // Vercel Drop deploys files dropped onto its page and takes none from another site,
  // so this hands over the file: Drop opens first, inside the click, where a popup is
  // allowed, then the design saves as index.html, which Drop serves at the root.
  function publishWithDrop() {
    window.open(DROP_URL, '_blank', 'noopener,noreferrer')
    void download('index.html', 'Downloaded index.html. Drag it into Vercel Drop to publish it.')
  }

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void load().catch(() => {})
      }}
    >
      {/* The tooltip would cover the open menu. */}
      <Tooltip open={tipOpen && !open} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={revision != null ? 'copy, download or publish this version' : 'copy, download or publish the design'}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                if (!open) void load().catch(() => {})
                setOpen(!open)
              }}
              onClick={(event) => {
                if (event.detail !== 0) event.preventDefault()
              }}
            >
              {/* Share, not download: the menu also copies and publishes. */}
              {copied ? <IconCheck size={16} /> : <IconShare size={16} />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{revision != null ? 'copy, download or publish this version' : 'copy, download or publish HTML'}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-52 p-1">
        <button
          type="button"
          {...fastClick(() => void copy())}
          className="flex min-h-8 w-full items-center gap-2 px-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        >
          <IconCopy size={14} className="shrink-0 text-muted-foreground" />
          copy HTML
        </button>
        <button
          type="button"
          {...fastClick(() => void download())}
          className="flex min-h-8 w-full items-center gap-2 px-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        >
          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11v2.5h11V11" />
          </svg>
          download HTML
        </button>
        <button
          type="button"
          // A plain click, not fastClick: only the click grants a touch or pen tap the
          // user activation window.open needs; pointer-down would let a blocker stop Drop.
          onClick={publishWithDrop}
          className="flex min-h-8 w-full items-center gap-2 px-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        >
          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted-foreground" fill="currentColor" aria-hidden="true">
            <path d="M8 2.5 14.5 13.5h-13z" />
          </svg>
          publish with Drop
        </button>
        <button
          type="button"
          // A plain click, not fastClick: the dialog it opens would take the click that
          // follows pointer-down as a click outside, and close.
          onClick={() => {
            setOpen(false)
            privateLink.act()
          }}
          className="flex min-h-8 w-full items-start gap-2 px-2.5 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
        >
          <svg viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
          <span className="min-w-0">
            {privateItem.label}
            <span className="block truncate text-xs text-muted-foreground">{privateItem.detail}</span>
          </span>
        </button>
      </PopoverContent>
      {/* Portalled to the body: only its state lives in the menu. */}
      {privateLink.dialog}
    </Popover>
  )
}
