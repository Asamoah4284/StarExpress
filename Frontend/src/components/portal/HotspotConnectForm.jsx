import * as React from "react"
import { Check, Copy, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  buildHotspotAuthorizeUrl,
  clearPersistedPortalParams,
} from "@/lib/captivePortalParams.js"

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

  const onSubmit = (e) => {
    e.preventDefault()
    const pin = code.trim()
    if (!pin) {
      setError("Enter your WiFi code.")
      return
    }
    const built = buildHotspotAuthorizeUrl(loginUrl, pin, { orig_url: origUrl })
    const fallback =
      authorizeUrl && pin === String(defaultCode || "").trim() ? String(authorizeUrl).trim() : ""
    const target = built || fallback
    if (!target) {
      setError(
        "Join this venue's WiFi first, then tap Connect. If you are already on WiFi, enter this code on the hotspot login page.",
      )
      console.error("[buy] connect wifi missing login_url", { hasCode: true })
      return
    }
    setError(null)
    console.log("[buy] connect wifi", {
      hasLoginUrl: Boolean(String(loginUrl || "").trim()),
      usingFallback: !built && Boolean(fallback),
    })
    clearPersistedPortalParams()
    window.location.assign(target)
  }

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
      <Button type="submit" className="h-12 w-full text-base">
        <Wifi className="size-5" aria-hidden />
        Connect to WiFi
      </Button>
      <p className="text-muted-foreground text-sm">
        {String(loginUrl || "").trim() || String(authorizeUrl || "").trim()
          ? "Tap Connect to go online. You can also copy this code and share it."
          : "Enter the code, then tap Connect. If Connect is unavailable, type the code on the hotspot login page."}
      </p>
      <p className="text-muted-foreground text-sm">
        Having Issues? Call this number 0202343065/0542343069
      </p>
    </form>
  )
}
