import * as React from "react"
import { createPortal } from "react-dom"
import { Loader2, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

/**
 * Moolre hosted checkout viewport — matches their embed (sidebar, form, footer).
 * @see https://docs.moolre.com — Generate Payment Link / embed
 */
const MOOLRE_VIEWPORT_WIDTH = 760
const MOOLRE_VIEWPORT_HEIGHT = 720
/** Crop empty top padding inside the Moolre embed page (desktop only). */
const MOOLRE_FRAME_OFFSET_Y = 72
const MOBILE_MAX_WIDTH = 767
/**
 * Moolre's checkout only lays out correctly at desktop width — its standalone mobile page
 * collapses the form. On phones we render it at this logical width and scale it down to fit,
 * so the full working desktop layout (number, provider, confirm) shows on a small screen.
 */
const MOBILE_LOGICAL_WIDTH = 760
/** Tall enough for the full POS form (amount, phone, network, pay) plus footer. */
const MOBILE_LOGICAL_HEIGHT = 980

function useViewport() {
  const read = () => {
    if (typeof window === "undefined") {
      return { width: 390, height: 700 }
    }
    const vv = window.visualViewport
    return {
      width: Math.round(vv?.width ?? window.innerWidth),
      height: Math.round(vv?.height ?? window.innerHeight),
    }
  }
  const [viewport, setViewport] = React.useState(read)
  React.useEffect(() => {
    const onResize = () => setViewport(read())
    onResize()
    window.addEventListener("resize", onResize)
    window.addEventListener("orientationchange", onResize)
    window.visualViewport?.addEventListener("resize", onResize)
    window.visualViewport?.addEventListener("scroll", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("orientationchange", onResize)
      window.visualViewport?.removeEventListener("resize", onResize)
      window.visualViewport?.removeEventListener("scroll", onResize)
    }
  }, [])
  return viewport
}

/**
 * @param {{
 *   open: boolean
 *   authorizationUrl: string | null
 *   callbackUrl: string | null
 *   paymentReference: string | null
 *   onCancel: () => void
 *   onSuccess: (payload: { reference: string, externalref: string }) => void
 *   mode?: "captive" | "agent"
 * }} props
 */
export function MoolrePayment({
  open,
  authorizationUrl,
  callbackUrl,
  paymentReference,
  onCancel,
  onSuccess,
  // mode kept for call-site clarity; both flows render the same way.
  mode = "agent",
}) {
  const iframeRef = React.useRef(/** @type {HTMLIFrameElement | null} */ (null))
  const successFiredRef = React.useRef(false)
  const [confirming, setConfirming] = React.useState(false)
  const viewport = useViewport()
  const isMobile = viewport.width <= MOBILE_MAX_WIDTH
  void mode

  React.useEffect(() => {
    if (!open) {
      successFiredRef.current = false
      setConfirming(false)
    }
  }, [open])

  // Keep the page behind the fullscreen mobile checkout from scrolling.
  React.useEffect(() => {
    if (!open || !isMobile) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, isMobile])

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
        lower.includes("portal-payment-success") ||
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

  // Phones: fullscreen overlay, desktop POS layout scaled to the screen width.
  if (isMobile) {
    if (!open || typeof document === "undefined") return null

    const headerH = 52
    const availableW = Math.max(280, viewport.width)
    const availableH = Math.max(320, viewport.height - headerH)
    const scale = Math.min(1, availableW / MOBILE_LOGICAL_WIDTH)
    const scaledHeight = MOBILE_LOGICAL_HEIGHT * scale

    return createPortal(
      <div
        className="fixed inset-0 z-[200] flex flex-col bg-[#eef0f3]"
        style={{
          width: "100vw",
          height: "100dvh",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="MoMo payment"
      >
        <div
          className="flex shrink-0 items-center justify-between border-b border-[#d8dce3] bg-[#eef0f3] px-3"
          style={{ minHeight: headerH }}
        >
          <span className="text-base font-semibold text-[#1a1a1a]">MoMo payment</span>
          {!confirming ? (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-3 text-sm font-medium text-[#475467] active:bg-black/5"
            >
              <X className="size-5" aria-hidden />
              Cancel
            </button>
          ) : null}
        </div>

        <div
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain bg-[#eef0f3]"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div
            className="relative mx-auto"
            style={{
              width: availableW,
              height: Math.max(scaledHeight, availableH),
            }}
          >
            <iframe
              ref={iframeRef}
              title="Moolre payment"
              src={authorizationUrl}
              className="absolute left-0 top-0 origin-top-left border-0 bg-white"
              style={{
                width: `${MOBILE_LOGICAL_WIDTH}px`,
                height: `${MOBILE_LOGICAL_HEIGHT}px`,
                transform: `scale(${scale})`,
              }}
              onLoad={handleIframeLoad}
              allow="payment *"
            />
          </div>
        </div>

        {confirming ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#eef0f3]/95 px-6 text-center">
            <Loader2 className="size-10 animate-spin text-[#1a2b4a]" aria-hidden />
            <p className="text-sm font-medium text-[#1a1a1a]">Confirming payment…</p>
          </div>
        ) : null}
      </div>,
      document.body,
    )
  }

  const frameWidth = `min(${MOOLRE_VIEWPORT_WIDTH}px, calc(100vw - 2rem))`
  const frameHeight = `min(${MOOLRE_VIEWPORT_HEIGHT}px, 94dvh)`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !confirming && handleCancel()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[#e4e7ec]/92 supports-backdrop-filter:backdrop-blur-[2px]"
        className="top-[3vh] left-[50%] max-w-none translate-x-[-50%] translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-[#eef0f3] p-0 shadow-none ring-0 outline-none data-open:zoom-in-100 data-closed:zoom-out-100 sm:max-w-none"
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
