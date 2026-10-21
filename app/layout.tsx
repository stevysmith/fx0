import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { ThemeProvider } from '../components/theme-provider'
import { TooltipProvider } from '../components/ui/tooltip'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'https://fx0.stacktr.ee'),
  title: 'fx0',
  description: 'A web-native fx design agent running on libfx',
  openGraph: {
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#090909' },
  ],
}

// The layout is static; saved pane widths apply while the HTML parses, and a chat
// URL hides the new-draft shell until that chat streams in.
const PANES = `try{var c=document.cookie,r=document.documentElement,g=function(n){var m=c.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?m[1]:''},w=function(n,f,a,b){var v=Number(g(n));return v>0?Math.min(Math.max(v,a),b):f},s=w('fx0-sidebar-width',240,224,320),a=w('fx0-agent-width',420,320,640),sc=g('fx0-sidebar-collapsed')==='1';r.style.setProperty('--sidebar-width',(sc?0:s)+'px');r.style.setProperty('--sidebar-expanded-width',s+'px');r.style.setProperty('--agent-width',(g('fx0-agent-collapsed')==='1'?0:a)+'px');r.style.setProperty('--agent-expanded-width',a+'px');if(sc)r.classList.add('sidebar-collapsed');if(/[?&]s=[^&]/.test(location.search))r.classList.add('chat-url');if(g('fx0-signed-in')!=='1')r.classList.add('guest')}catch(e){}`

export const ensureStatic = 'shell'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: PANES }} />
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
