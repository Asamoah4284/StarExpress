import * as React from "react"
import { Link } from "react-router-dom"
import { Loader2, Satellite } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getDefaultAppName } from "@/lib/env.js"
import { retrievePortalVouchers } from "@/lib/portalApi.js"

function isValidPhone(phone) {
  const trimmed = phone.replace(/\s+/g, " ")
  const digits = trimmed.replace(/\D/g, "")
  return trimmed.length >= 7 && trimmed.length <= 32 && digits.length >= 7
}

export default function CaptiveRetrieveVoucher() {
  const appName = getDefaultAppName()
  const [phone, setPhone] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(/** @type {string | null} */ (null))
  const [vouchers, setVouchers] = React.useState(
    /** @type {{ voucherCode: string, packageName: string, date: string }[]} */ ([]),
  )
  const [emptyMessage, setEmptyMessage] = React.useState("")

  React.useEffect(() => {
    document.title = "Retrieve voucher"
  }, [])

  const handleSubmit = async (e /** @type {React.FormEvent} */) => {
    e.preventDefault()
    if (!isValidPhone(phone)) {
      setError("Enter a valid phone number (at least 7 digits).")
      return
    }
    setError(null)
    setEmptyMessage("")
    setVouchers([])
    setLoading(true)
    const result = await retrievePortalVouchers(phone.trim())
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setVouchers(result.vouchers)
    if (result.vouchers.length === 0) {
      setEmptyMessage(
        result.message ||
          "No vouchers found for this number. If you just paid, wait a moment and try again.",
      )
    }
  }

  return (
    <div className="text-foreground relative flex min-h-svh flex-col bg-canvas px-4 py-8 dark:bg-background">
      <div className="relative z-10 mx-auto w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="bg-primary/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-xl">
            <Satellite className="text-primary size-6" aria-hidden />
          </div>
          <p className="text-primary text-xs font-semibold uppercase tracking-widest">{appName}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Retrieve voucher</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Enter the phone number you used when paying to see your recent voucher codes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your phone number</CardTitle>
            <CardDescription>We show up to your 3 most recent purchases.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
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
              </div>
              {error ? (
                <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm">
                  {error}
                </div>
              ) : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                    Looking up…
                  </>
                ) : (
                  "Find my vouchers"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {emptyMessage ? (
          <p className="text-muted-foreground mt-4 text-center text-sm">{emptyMessage}</p>
        ) : null}

        {vouchers.length > 0 ? (
          <div className="mt-4 space-y-3">
            {vouchers.map((v, i) => (
              <Card key={`${v.voucherCode}-${i}`}>
                <CardContent className="p-4">
                  <p className="font-mono text-lg font-bold">{v.voucherCode}</p>
                  <p className="text-muted-foreground text-sm">
                    {v.packageName}
                    {v.date ? ` · ${v.date}` : ""}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        <p className="text-muted-foreground mt-8 text-center text-sm">
          Need a new package?{" "}
          <Link to="/buy" className="text-primary font-medium underline-offset-4 hover:underline">
            Buy WiFi access
          </Link>
        </p>
      </div>
    </div>
  )
}
