import { useEffect, useState } from 'react'
import type { Snapshot } from './room'

function statusLine(snap: Snapshot): string {
  if (snap.status === 'connecting') return 'Connecting…'
  if (snap.status === 'offline') return "Couldn't reach the matchmaker, so it's just you for now."
  if (snap.role === 'guest') return "You're in! Anyone with this link can join too."
  if (snap.people > 1) return `${snap.people} people in this room. Swipes show up for everyone.`
  return 'Send this to whoever you want to play with.'
}

export function SharePopup({ snap, url, onClose }: { snap: Snapshot; url: string; onClose: () => void }) {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    import('qrcode')
      .then((QRCode) =>
        QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#2b2140', light: '#fffaf0' } }),
      )
      .then((svg) => alive && setQr(svg))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url])

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Ask me anything', text: 'Come swipe cards with me!', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Share sheet dismissed, or clipboard blocked. Nothing to do.
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="popup share"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="share-title">Play together</p>
        <p className="popup-note">{statusLine(snap)}</p>
        {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
        <p className="room-code">
          room <b>{snap.seed}</b>
        </p>
        <div className="popup-buttons">
          <button type="button" className="btn ghost" onClick={onClose}>
            close
          </button>
          <button type="button" className="btn" onClick={share} autoFocus>
            {copied ? 'copied!' : 'share link'}
          </button>
        </div>
      </div>
    </div>
  )
}
