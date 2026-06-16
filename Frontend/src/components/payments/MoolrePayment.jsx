import * as React from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

/**
 * Moolre hosted checkout viewport — matches their embed (sidebar, form, footer).
 * @see https://docs.moolre.com — Generate Payment Link / embed
 */
const MOOLRE_VIEWPORT_WIDTH = 760
const MOOLRE_VIEWPORT_HEIGHT = 540
/** Crop empty top padding inside the Moolre embed page */
const MOOLRE_FRAME_OFFSET_Y = 72

/**
 * @param {{
 *   open: boolean
 *   authorizationUrl: string | null
 *   callbackUrl: string | null
 *   paymentReference: string | null
 *   onCancel: () => void
 *   onSuccess: (payload: { reference: string, externalref: string }) => void
 *   onManualConfirm?: () => void
 *   manualConfirming?: boolean
 *   manualMessage?: string
 * }} props
 */
export function MoolrePayment({
  open,
  authorizationUrl,
  callbackUrl,
  paymentReference,
  onCancel,
  onSuccess,
  onManualConfirm,
  manualConfirming = false,
  manualMessage = "After approving the MoMo prompt on your phone, continue here.",
}) {
  const iframeRef = React.useRef(/** @type {HTMLIFrameElement | null} */ (null))
  const successFiredRef = React.useRef(false)
  const [confirming, setConfirming] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      successFiredRef.current = false
      setConfirming(false)
    }
  }, [open])

  const extractRef = React.useCallback(
    (url) => {
      try {
        const urlObj = new URL(url)
        return (
          urlObj.searchParams.get("reference") ||
          urlObj.searchParams.get("externalref") ||
          urlObj.searchParams.get("ref") ||
          paymentReference ||
          ""
        )
      } catch {
        const m = url.match(/[?&](?:reference|externalref|ref)=([^&]+)/i)
        return (m && decodeURIComponent(m[1])) || paymentReference || ""
      }
    },
    [paymentReference],
  )

  const isSuccessUrl = React.useCallback(
    (url) => {
      if (!url) return false
      const lower = url.toLowerCase()

      if (callbackUrl) {
        const callbackBase = callbackUrl.split("?")[0].split("#")[0].toLowerCase()
        if (lower.includes(callbackBase)) return true
      }

      return (
        lower.includes("agent-payment-success") ||
        lower.includes("/api/moolre/payment-success") ||
        lower.includes("payment-success") ||
        lower.includes("/success") ||
        lower.includes("?success=") ||
        lower.includes("&success=true")
      )
    },
    [callbackUrl],
  )

  const handlePaymentDetected = React.useCallback(
    (url) => {
      if (successFiredRef.current) return
      successFiredRef.current = true
      const ref = extractRef(url)
      setConfirming(true)
      onSuccess({ reference: ref, externalref: ref })
    },
    [extractRef, onSuccess],
  )

  const handleIframeLoad = React.useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const url = iframe.contentWindow?.location?.href
      if (url && isSuccessUrl(url)) {
        handlePaymentDetected(url)
      }
    } catch {
      // Cross-origin while on Moolre — wait for redirect or postMessage from success page
    }
  }, [handlePaymentDetected, isSuccessUrl])

  React.useEffect(() => {
    if (!open) return

    const onMessage = (/** @type {MessageEvent} */ event) => {
      const data = event.data
      if (!data || typeof data !== "object") return
      if (data.type !== "moolre-payment-success") return

      const ref =
        (typeof data.reference === "string" && data.reference) ||
        (typeof data.externalref === "string" && data.externalref) ||
        paymentReference ||
        ""
      handlePaymentDetected(ref ? `?reference=${encodeURIComponent(ref)}` : "")
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [open, handlePaymentDetected, paymentReference])

  const handleCancel = () => {
    successFiredRef.current = false
    setConfirming(false)
    onCancel()
  }

  if (!authorizationUrl) return null

  const frameWidth = `min(${MOOLRE_VIEWPORT_WIDTH}px, calc(100vw - 2rem))`
  const frameHeight = `min(${MOOLRE_VIEWPORT_HEIGHT}px, 86dvh)`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !confirming && handleCancel()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[#e4e7ec]/92 supports-backdrop-filter:backdrop-blur-[2px]"
        className="top-[4vh] left-[50%] max-w-none translate-x-[-50%] translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-[#eef0f3] p-0 shadow-none ring-0 outline-none data-open:zoom-in-100 data-closed:zoom-out-100 sm:max-w-none"
        style={{ width: frameWidth, height: frameHeight }}
      >
        <DialogTitle className="sr-only">MoMo payment</DialogTitle>
        <div className="relative h-full w-full overflow-hidden bg-[#eef0f3]">
          <iframe
            ref={iframeRef}
            title="Moolre payment"
            src={authorizationUrl}
            className="block w-full border-0 bg-[#eef0f3]"
            style={{
              height: `calc(100% + ${MOOLRE_FRAME_OFFSET_Y}px)`,
              marginTop: `-${MOOLRE_FRAME_OFFSET_Y}px`,
            }}
            onLoad={handleIframeLoad}
            allow="payment *"
          />
          {confirming ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#eef0f3]/95 px-6 text-center">
              <Loader2 className="size-10 animate-spin text-[#1a2b4a]" aria-hidden />
              <p className="text-sm font-medium text-[#1a1a1a]">Confirming payment…</p>
            </div>
          ) : null}
          {onManualConfirm ? (
            <div className="absolute inset-x-3 bottom-3 rounded-xl border border-black/10 bg-white/95 p-3 text-center shadow-lg">
              <p className="mb-2 text-xs font-medium text-[#1a1a1a]">{manualMessage}</p>
              <button
                type="button"
                className="inline-flex w-full items-center justify-center rounded-md bg-[#13294b] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                disabled={manualConfirming}
                onClick={onManualConfirm}
              >
                {manualConfirming ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    Checking payment…
                  </>
                ) : (
                  "I have approved payment - Show my voucher"
                )}
              </button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
