import * as React from "react"
import { Check, Copy, Phone, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  buildHotspotAuthorizeUrl,
  clearPersistedPortalParams,
} from "@/lib/captivePortalParams.js"

const SUPPORT_PHONES = [
  { label: "0202343065", tel: "+233202343065" },
  { label: "0542343069", tel: "+233542343069" },
]

function submitToGateway(target) {
  try {
    const form = document.createElement("form")
    form.method = "GET"
    form.action = target
    form.style.display = "none"
    document.body.appendChild(form)
    form.submit()
  } catch {
    window.location.href = target
  }
}

/**
 * Code field + Connect: submits the voucher as both username and password to the AP login_url.
 * @param {{
 *   defaultCode?: string
 *   loginUrl?: string
 *   origUrl?: string
 *   authorizeUrl?: string
 * }} props
 */
export function HotspotConnectForm({
  defaultCode = "",
  loginUrl = "",
  origUrl = "",
  authorizeUrl = "",
}) {
  const fieldId = React.useId()
  const [code, setCode] = React.useState(defaultCode)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [connecting, setConnecting] = React.useState(false)
  const inputId = `wifi-code-${fieldId}`

  React.useEffect(() => {
    setCode(defaultCode)
  }, [defaultCode])

  const copy = async () => {
    const pin = code.trim()
    if (!pin) return
    try {
      await navigator.clipboard.writeText(pin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const doConnect = (targetUrl) => {
    setConnecting(true)
    setError(null)
    clearPersistedPortalParams()
    submitToGateway(targetUrl)
  }

  const onSubmit = (e) => {
    e.preventDefault()
    const pin = code.trim()
    if (!pin) {
      setError("Enter your WiFi code before connecting.")
      return
    }
    const built = buildHotspotAuthorizeUrl(loginUrl, pin, { orig_url: origUrl })
    const fallback =
      authorizeUrl && pin === String(defaultCode || "").trim() ? String(authorizeUrl).trim() : ""
    const target = built || fallback
    if (!target) {
      setError(
        "Hotspot gateway address was not detected. Make sure you are connected to the venue WiFi. You can also try connecting via the default gateway below.",
      )
      console.warn("[buy] connect wifi missing login_url", { pinLength: pin.length })
      return
    }
    doConnect(target)
  }

  const onTryDefaultGateway = (gatewayIp = "192.168.1.1") => {
    const pin = code.trim()
    if (!pin) {
      setError("Enter your WiFi code first.")
      return
    }
    const url = buildHotspotAuthorizeUrl(`http://${gatewayIp}:8880/gwn/login`, pin, { orig_url: origUrl })
    doConnect(url)
  }

  const hasDetectedGateway = Boolean(String(loginUrl || "").trim() || String(authorizeUrl || "").trim())

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor={inputId}>WiFi code</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            name="username"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              if (error) setError(null)
            }}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 font-mono text-lg tracking-[0.18em]"
            placeholder="Enter code"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="size-12 shrink-0"
            onClick={() => void copy()}
            title="Copy code"
          >
            {copied ? (
              <Check className="size-5 text-emerald-500" aria-hidden />
            ) : (
              <Copy className="size-5" aria-hidden />
            )}
            <span className="sr-only">Copy code</span>
          </Button>
        </div>
      </div>
      {error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={connecting} className="h-12 w-full text-base">
        <Wifi className="size-5" aria-hidden />
        {connecting ? "Connecting to WiFi…" : "Connect to WiFi"}
      </Button>

      {!hasDetectedGateway ? (
        <div className="rounded-lg border border-amber-300/40 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <p>
            <strong>Note:</strong> This page was opened without hotspot redirect parameters. If you are already connected to the venue WiFi, you can try connecting via the default Grandstream gateway:
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onTryDefaultGateway("192.168.1.1")}
              className="text-xs h-8"
            >
              Connect via 192.168.1.1
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onTryDefaultGateway("192.168.88.1")}
              className="text-xs h-8"
            >
              Connect via 192.168.88.1
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Tap Connect to go online. You can also copy this code and share it.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Having issues? Call support:</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUPPORT_PHONES.map((phone) => (
            <Button key={phone.tel} type="button" variant="outline" className="h-11 w-full" asChild>
              <a href={`tel:${phone.tel}`}>
                <Phone className="size-4" aria-hidden />
                Call {phone.label}
              </a>
            </Button>
          ))}
        </div>
      </div>
    </form>
  )
}
