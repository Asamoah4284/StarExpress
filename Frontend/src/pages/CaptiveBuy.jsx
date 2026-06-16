import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronLeft, ChevronRight, Loader2, Satellite, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MoolrePayment } from "@/components/payments/MoolrePayment.jsx"
import { getDefaultAppName } from "@/lib/env.js"
import {
  completePortalPaymentWithRetry,
  fetchPortalLocations,
  fetchPortalPackages,
  fetchPortalPaymentStatus,
  initializePortalPayment,
} from "@/lib/portalApi.js"
import { cn, formatCedis } from "@/lib/utils"

function formatPackagePrice(priceGHS) {
  const formatted = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceGHS)
  return formatted
}

function isValidPhone(phone) {
  const trimmed = phone.replace(/\s+/g, " ")
  const digits = trimmed.replace(/\D/g, "")
  return trimmed.length >= 7 && trimmed.length <= 32 && digits.length >= 7
}

const PACKAGES_PER_PAGE = 4

export default function CaptiveBuy() {
  const appName = getDefaultAppName()
  const navigate = useNavigate()
  const [step, setStep] = React.useState(1)
  const [locations, setLocations] = React.useState(/** @type {{ locationId: string, name: string }[]} */ ([]))
  const [packages, setPackages] = React.useState(
    /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string, remaining: number }[]} */ ([]),
  )
  const [locationId, setLocationId] = React.useState("")
  const [locationName, setLocationName] = React.useState("")
  const [selectedPackage, setSelectedPackage] = React.useState(
    /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string } | null} */ (null),
  )
  const [phone, setPhone] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [loadingPackages, setLoadingPackages] = React.useState(false)
  const [paying, setPaying] = React.useState(false)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [packagePage, setPackagePage] = React.useState(0)
  const [showMoolre, setShowMoolre] = React.useState(false)
  const [moolreAuthUrl, setMoolreAuthUrl] = React.useState(/** @type {string | null} */ (null))
  const [moolreReference, setMoolreReference] = React.useState(/** @type {string | null} */ (null))
  const [moolreCallbackUrl, setMoolreCallbackUrl] = React.useState(/** @type {string | null} */ (null))
  const [checkingPayment, setCheckingPayment] = React.useState(false)
  const [paymentNotice, setPaymentNotice] = React.useState("")

  const packagePageCount = Math.max(1, Math.ceil(packages.length / PACKAGES_PER_PAGE))
  const visiblePackages = packages.slice(
    packagePage * PACKAGES_PER_PAGE,
    packagePage * PACKAGES_PER_PAGE + PACKAGES_PER_PAGE,
  )

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const result = await fetchPortalLocations()
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        setLocations([])
      } else {
        setLocations(result.locations)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const goToPaymentSuccess = React.useCallback(
    (ref) => {
      setShowMoolre(false)
      navigate(`/portal-payment-success?externalref=${encodeURIComponent(ref)}`)
    },
    [navigate],
  )

  const confirmPortalPayment = React.useCallback(
    async (ref = moolreReference) => {
      if (!ref || checkingPayment) return
      setCheckingPayment(true)
      setPaymentNotice("")
      const result = await completePortalPaymentWithRetry(ref)
      if (result.ok) {
        goToPaymentSuccess(ref)
        return
      }
      setPaymentNotice(result.error || "Payment is not confirmed yet. If you approved it, try again in a moment.")
      setCheckingPayment(false)
    },
    [checkingPayment, goToPaymentSuccess, moolreReference],
  )

  // While the Moolre POS iframe is open, poll our backend so the customer gets their code the
  // moment the payment is confirmed (via webhook or our own status check) — even if Moolre's POS
  // page is stuck on "processing" or shows a transaction-timeout dialog.
  React.useEffect(() => {
    if (!showMoolre || !moolreReference) return
    let cancelled = false
    const check = async () => {
      const status = await fetchPortalPaymentStatus(moolreReference)
      if (cancelled) return
      if (status.ok && status.ready) {
        goToPaymentSuccess(moolreReference)
      }
    }
    void check()
    const id = setInterval(() => void check(), 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [goToPaymentSuccess, showMoolre, moolreReference])

  const handleLocationContinue = async () => {
    if (!locationId) {
      setError("Please select a WiFi location.")
      return
    }
    setError(null)
    setLoadingPackages(true)
    const result = await fetchPortalPackages(locationId)
    setLoadingPackages(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setLocationName(result.locationName)
    setPackages(result.packages)
    setSelectedPackage(null)
    setPackagePage(0)
    if (result.packages.length === 0) {
      setError("No packages available at this location. Try another location.")
      return
    }
    setStep(2)
  }

  const handlePackageSelect = (
    pkg /** @type {{ packageId: string, name: string, priceGHS: number, dataLimit: string }} */,
  ) => {
    setSelectedPackage(pkg)
    setError(null)
    setStep(3)
  }

  const handlePay = async (e /** @type {React.FormEvent} */) => {
    e.preventDefault()
    if (!selectedPackage || !locationId) return
    if (!isValidPhone(phone)) {
      setError("Enter a valid phone number (at least 7 digits).")
      return
    }
    setError(null)
    setPaying(true)
    const result = await initializePortalPayment({
      locationId,
      packageId: selectedPackage.packageId,
      customerPhone: phone.trim(),
    })
    if (!result.ok) {
      setPaying(false)
      setError(result.error)
      return
    }
    setMoolreAuthUrl(result.authorizationUrl)
    setMoolreReference(result.paymentReference)
    setMoolreCallbackUrl(result.redirectUrl || null)
    setPaymentNotice("")
    setShowMoolre(true)
    setPaying(false)
  }

  const handleMoolreSuccess = (
    response /** @type {{ reference?: string, externalref?: string }} */,
  ) => {
    const ref = response?.reference || response?.externalref || moolreReference
    if (!ref) {
      setError("Payment could not be confirmed. Use Retrieve voucher with your phone number.")
      return
    }
    goToPaymentSuccess(ref)
  }

  const handleMoolreCancel = () => {
    setShowMoolre(false)
    setMoolreAuthUrl(null)
    setMoolreReference(null)
    setMoolreCallbackUrl(null)
    setCheckingPayment(false)
    setPaymentNotice("")
    setPaying(false)
  }

  return (
    <div className="text-foreground relative flex min-h-svh flex-col bg-canvas px-4 py-6 dark:bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="bg-primary/10 absolute -left-[20%] top-[-10%] h-[min(70vh,480px)] w-[min(80vw,480px)] rounded-full blur-[90px]" />
        <div className="bg-primary/8 absolute -right-[15%] bottom-[-15%] h-[min(60vh,400px)] w-[min(70vw,400px)] rounded-full blur-[80px]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="bg-primary/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-xl">
            <Satellite className="text-primary size-6" aria-hidden />
          </div>
          <p className="text-primary text-xs font-semibold uppercase tracking-widest">{appName}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Buy WiFi access</h1>
          <p className="text-muted-foreground mt-1 text-sm">Select your location, choose a package, and pay with MoMo.</p>
        </div>

        <div className="mb-4 flex justify-center gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 w-10 rounded-full ${step >= n ? "bg-primary" : "bg-muted"}`}
              aria-hidden
            />
          ))}
        </div>

        {error ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-lg border px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="text-primary size-8 animate-spin" aria-label="Loading" />
          </div>
        ) : null}

        {!loading && step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Step 1 — WiFi location</CardTitle>
              <CardDescription>Where are you connecting from?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {locations.length === 0 ? (
                <p className="text-muted-foreground text-sm">No locations with vouchers available right now.</p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger id="location" className="w-full">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.locationId} value={loc.locationId}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                className="w-full"
                disabled={!locationId || loadingPackages}
                onClick={() => void handleLocationContinue()}
              >
                {loadingPackages ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    Loading packages…
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && step === 2 ? (
          <Card className="overflow-hidden">
            <CardHeader className="border-border/60 border-b pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-lg">Step 2 — Choose a package</CardTitle>
                  <CardDescription className="mt-1 truncate">{locationName}</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    setStep(1)
                    setPackagePage(0)
                    setError(null)
                  }}
                >
                  Change location
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-border divide-y">
                {visiblePackages.map((pkg) => (
                  <li key={pkg.packageId}>
                    <button
                      type="button"
                      onClick={() => handlePackageSelect(pkg)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                        "hover:bg-primary/5 active:bg-primary/10",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                      )}
                    >
                      <div
                        className="bg-primary/10 text-primary flex shrink-0 flex-col items-center justify-center rounded-lg px-2.5 py-2 min-w-[4.5rem]"
                        aria-hidden
                      >
                        <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">GH₵</span>
                        <span className="text-lg font-bold leading-none tabular-nums">
                          {formatPackagePrice(pkg.priceGHS)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">{pkg.name}</p>
                        {pkg.dataLimit ? (
                          <p className="text-muted-foreground mt-0.5 text-xs">{pkg.dataLimit}</p>
                        ) : null}
                      </div>
                      <ChevronRight className="text-muted-foreground size-5 shrink-0 opacity-60" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-border/60 flex items-center justify-between gap-2 border-t px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={packagePage === 0}
                  onClick={() => setPackagePage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  Previous
                </Button>
                <span className="text-muted-foreground text-xs tabular-nums">
                  Page {packagePage + 1} of {packagePageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={packagePage >= packagePageCount - 1}
                  onClick={() => setPackagePage((p) => Math.min(packagePageCount - 1, p + 1))}
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!loading && step === 3 && selectedPackage ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Step 3 — Pay with MoMo</CardTitle>
              <CardDescription>
                {selectedPackage.name} at {locationName} — {formatCedis(selectedPackage.priceGHS)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={(e) => void handlePay(e)}>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="e.g. 024 123 4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                  <p className="text-muted-foreground text-xs">Your voucher code will be sent to this number by SMS.</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(2)}>
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={paying}>
                    {paying ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                        Starting payment…
                      </>
                    ) : (
                      <>
                        <Wifi className="mr-2 size-4" aria-hidden />
                        Pay with MoMo
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-muted-foreground mt-8 text-center text-sm">
          Didn&apos;t get your code?{" "}
          <Link to="/retrieve-voucher" className="text-primary font-medium underline-offset-4 hover:underline">
            Retrieve voucher
          </Link>
        </p>
      </div>

      <MoolrePayment
        open={showMoolre}
        authorizationUrl={moolreAuthUrl}
        callbackUrl={moolreCallbackUrl}
        paymentReference={moolreReference}
        onCancel={handleMoolreCancel}
        onSuccess={handleMoolreSuccess}
        onManualConfirm={() => void confirmPortalPayment()}
        manualConfirming={checkingPayment}
        manualMessage={
          paymentNotice ||
          "Approve the MoMo prompt on your phone, then tap below. You do not need Moolre's status button."
        }
      />
    </div>
  )
}
