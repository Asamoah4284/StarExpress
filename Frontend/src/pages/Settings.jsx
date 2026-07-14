import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/context/AuthContext.jsx"
import { APP_SETTINGS_QUERY_KEY, useAppSettings } from "@/hooks/useAppSettings.js"
import { fetchFinanceLocations, updateAppSettings, updateAppSettingsCommission, updateFinanceLocation } from "@/lib/api.js"
import { getDefaultAppName, getDefaultCompanyName, getSalesAgentCommissionRate } from "@/lib/env.js"
import { readImageFileAsDataUrl } from "@/lib/readImageFile.js"

function rateToPercentInput(rate) {
  const pct = rate * 100
  const rounded = Math.round(pct * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/**
 * Normalize a save response into the full settings cache shape so no mutation
 * accidentally drops a field that another card owns.
 */
function settingsFromResponse(r) {
  return {
    salesAgentCommissionRate: r.salesAgentCommissionRate,
    appName: r.appName,
    companyName: r.companyName,
    companyLogoUrl: r.companyLogoUrl ?? null,
    alertPhone: r.alertPhone ?? "",
    purchaseAlertsEnabled: r.purchaseAlertsEnabled ?? true,
    promosVisible: r.promosVisible ?? true,
  }
}

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const settingsQuery = useAppSettings()

  const [appName, setAppName] = React.useState(getDefaultAppName())
  const [companyName, setCompanyName] = React.useState(getDefaultCompanyName())
  const [companyLogoUrl, setCompanyLogoUrl] = React.useState(/** @type {string | null} */ (null))
  const [logoError, setLogoError] = React.useState(/** @type {string | null} */ (null))
  const [commissionPercent, setCommissionPercent] = React.useState(() =>
    rateToPercentInput(getSalesAgentCommissionRate()),
  )
  const [commissionMessage, setCommissionMessage] = React.useState(/** @type {{ type: "ok" | "err", text: string } | null} */ (null))
  const [profileMessage, setProfileMessage] = React.useState(/** @type {{ type: "ok" | "err", text: string } | null} */ (null))
  const [alertPhone, setAlertPhone] = React.useState("")
  const [purchaseAlertsEnabled, setPurchaseAlertsEnabled] = React.useState(true)
  const [alertsMessage, setAlertsMessage] = React.useState(/** @type {{ type: "ok" | "err", text: string } | null} */ (null))
  const [promosVisible, setPromosVisible] = React.useState(true)
  const [promosMessage, setPromosMessage] = React.useState(/** @type {{ type: "ok" | "err", text: string } | null} */ (null))
  const [hostelRates, setHostelRates] = React.useState(/** @type {Record<string, string>} */ ({}))
  const [lightBillAmounts, setLightBillAmounts] = React.useState(/** @type {Record<string, string>} */ ({}))
  const [hostelMessage, setHostelMessage] = React.useState(/** @type {{ type: "ok" | "err", text: string } | null} */ (null))
  const [savingHostelId, setSavingHostelId] = React.useState(/** @type {string | null} */ (null))

  const financeLocationsQuery = useQuery({
    queryKey: ["financeLocations", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchFinanceLocations(token)
      if (!result.ok) throw new Error(result.error || "Failed to load locations.")
      return result.locations
    },
    enabled: Boolean(token),
  })

  React.useEffect(() => {
    const locs = financeLocationsQuery.data
    if (!locs?.length) return
    setHostelRates((prev) => {
      const next = { ...prev }
      for (const loc of locs) {
        if (next[loc.id] === undefined) {
          next[loc.id] = String(loc.commissionRate ?? 20)
        }
      }
      return next
    })
    setLightBillAmounts((prev) => {
      const next = { ...prev }
      for (const loc of locs) {
        if (next[loc.id] === undefined) {
          next[loc.id] = String(loc.lightBillAmount ?? 50)
        }
      }
      return next
    })
  }, [financeLocationsQuery.data])

  const loadedRate = settingsQuery.data?.salesAgentCommissionRate
  const loadedAppName = settingsQuery.data?.appName
  const loadedCompanyName = settingsQuery.data?.companyName
  const loadedCompanyLogoUrl = settingsQuery.data?.companyLogoUrl
  const loadedAlertPhone = settingsQuery.data?.alertPhone
  const loadedPurchaseAlertsEnabled = settingsQuery.data?.purchaseAlertsEnabled
  const loadedPromosVisible = settingsQuery.data?.promosVisible

  React.useEffect(() => {
    if (typeof loadedRate === "number" && Number.isFinite(loadedRate)) {
      setCommissionPercent(rateToPercentInput(loadedRate))
    }
  }, [loadedRate])

  React.useEffect(() => {
    if (typeof loadedAppName === "string" && loadedAppName.trim()) {
      setAppName(loadedAppName.trim())
    }
  }, [loadedAppName])

  React.useEffect(() => {
    if (typeof loadedCompanyName === "string" && loadedCompanyName.trim()) {
      setCompanyName(loadedCompanyName.trim())
    }
  }, [loadedCompanyName])

  React.useEffect(() => {
    if (typeof loadedCompanyLogoUrl === "string" && loadedCompanyLogoUrl.trim()) {
      setCompanyLogoUrl(loadedCompanyLogoUrl.trim())
    } else if (loadedCompanyLogoUrl === null) {
      setCompanyLogoUrl(null)
    }
  }, [loadedCompanyLogoUrl])

  React.useEffect(() => {
    if (typeof loadedAlertPhone === "string") {
      setAlertPhone(loadedAlertPhone)
    }
  }, [loadedAlertPhone])

  React.useEffect(() => {
    if (typeof loadedPurchaseAlertsEnabled === "boolean") {
      setPurchaseAlertsEnabled(loadedPurchaseAlertsEnabled)
    }
  }, [loadedPurchaseAlertsEnabled])

  React.useEffect(() => {
    if (typeof loadedPromosVisible === "boolean") {
      setPromosVisible(loadedPromosVisible)
    }
  }, [loadedPromosVisible])

  const saveCommissionMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const pct = Number.parseFloat(commissionPercent.trim())
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error("Enter a commission between 0 and 100.")
      }
      const r = await updateAppSettingsCommission(token, { salesAgentCommissionPercent: pct })
      if (!r.ok) throw new Error(r.error || "Failed to save commission")
      return settingsFromResponse(r)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData([APP_SETTINGS_QUERY_KEY, token], settings)
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setCommissionPercent(rateToPercentInput(settings.salesAgentCommissionRate))
      const label = `${Math.round(settings.salesAgentCommissionRate * 1000) / 10}%`
      setCommissionMessage({ type: "ok", text: `Sales agent commission saved (${label}).` })
    },
    onError: (err) => {
      setCommissionMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not save commission.",
      })
    },
  })

  const onLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError(null)
    try {
      const dataUrl = await readImageFileAsDataUrl(file)
      setCompanyLogoUrl(dataUrl)
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Could not read logo file.")
    }
  }

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const name = appName.trim()
      const company = companyName.trim()
      if (!name) throw new Error("App name cannot be empty.")
      if (!company) throw new Error("Company name cannot be empty.")
      const r = await updateAppSettings(token, {
        appName: name,
        companyName: company,
        companyLogoUrl,
      })
      if (!r.ok) throw new Error(r.error || "Failed to save company profile")
      return settingsFromResponse(r)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData([APP_SETTINGS_QUERY_KEY, token], settings)
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setAppName(settings.appName)
      setCompanyName(settings.companyName)
      setCompanyLogoUrl(settings.companyLogoUrl ?? null)
      setProfileMessage({ type: "ok", text: "Profile saved. Logo appears in the sidebar." })
    },
    onError: (err) => {
      setProfileMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not save company profile.",
      })
    },
  })

  const saveAlertsMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const trimmed = alertPhone.trim()
      if (purchaseAlertsEnabled && !trimmed) {
        throw new Error("Enter a phone number to receive alerts, or turn alerts off.")
      }
      const r = await updateAppSettings(token, {
        alertPhone: trimmed,
        purchaseAlertsEnabled,
      })
      if (!r.ok) throw new Error(r.error || "Failed to save purchase alerts")
      return settingsFromResponse(r)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData([APP_SETTINGS_QUERY_KEY, token], settings)
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setAlertPhone(settings.alertPhone ?? "")
      setPurchaseAlertsEnabled(settings.purchaseAlertsEnabled ?? true)
      setAlertsMessage({
        type: "ok",
        text: settings.purchaseAlertsEnabled
          ? "Purchase alerts saved. You'll be texted when a buyer pays but gets no voucher, or a voucher SMS fails."
          : "Purchase alerts saved (currently turned off).",
      })
    },
    onError: (err) => {
      setAlertsMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not save purchase alerts.",
      })
    },
  })

  const savePromoVisibilityMutation = useMutation({
    mutationFn: async (/** @type {boolean} */ next) => {
      if (!token) throw new Error("Not signed in")
      const r = await updateAppSettings(token, { promosVisible: next })
      if (!r.ok) throw new Error(r.error || "Failed to save promo visibility")
      return settingsFromResponse(r)
    },
    onSuccess: (settings) => {
      queryClient.setQueryData([APP_SETTINGS_QUERY_KEY, token], settings)
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setPromosVisible(settings.promosVisible ?? true)
      setPromosMessage({
        type: "ok",
        text: settings.promosVisible
          ? "Promos are now visible to customers on the buy page (per-location promos must also be on)."
          : "Promos are hidden from customers everywhere.",
      })
    },
    onError: (err, next) => {
      setPromosVisible(!next)
      setPromosMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not save promo visibility.",
      })
    },
  })

  const onSaveCommission = (e) => {
    e.preventDefault()
    setCommissionMessage(null)
    saveCommissionMutation.mutate()
  }

  const onSaveAlerts = (e) => {
    e.preventDefault()
    setAlertsMessage(null)
    saveAlertsMutation.mutate()
  }

  const onSaveProfile = (e) => {
    e.preventDefault()
    setProfileMessage(null)
    saveProfileMutation.mutate()
  }

  const isDark = theme === "dark"
  const effectiveRate =
    typeof loadedRate === "number" ? loadedRate : getSalesAgentCommissionRate()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Company profile, sales agent commission, and appearance."
      />

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Sales agent commission</CardTitle>
          <CardDescription>
            Percentage of each completed sale paid to sales agents. Used on the agent dashboard for
            commission totals and trends. Currently{" "}
            <span className="text-foreground font-medium">
              {Math.round(effectiveRate * 1000) / 10}%
            </span>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSaveCommission} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="commission-percent">Commission (%)</Label>
              <Input
                id="commission-percent"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.1}
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                disabled={settingsQuery.isLoading || saveCommissionMutation.isPending}
                aria-describedby="commission-hint"
              />
              <p id="commission-hint" className="text-muted-foreground text-xs">
                Example: 20 means agents earn 20% of completed sale amount.
              </p>
            </div>
            <Button type="submit" disabled={saveCommissionMutation.isPending || settingsQuery.isLoading}>
              {saveCommissionMutation.isPending ? "Saving…" : "Save commission"}
            </Button>
          </form>
          {commissionMessage ? (
            <p
              className={
                commissionMessage.type === "ok"
                  ? "mt-3 text-sm text-emerald-600 dark:text-emerald-400"
                  : "mt-3 text-sm text-destructive"
              }
              role="status"
            >
              {commissionMessage.text}
            </p>
          ) : null}
          {settingsQuery.isError ? (
            <p className="text-destructive mt-3 text-sm" role="alert">
              Could not load saved commission. Showing default until the API is available.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Weekly deductions</CardTitle>
          <CardDescription>
            For each location’s weekly gross: <span className="text-foreground font-medium">10% tithe</span>, then that
            location’s light bill (default GH₵ 50; Outdoor is GH₵ 0). Hostel manager fee is taken from what remains.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="bg-muted/40 border-border/70 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Tithe</p>
              <p className="text-muted-foreground text-xs">Of location gross revenue</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums">10%</p>
          </div>
          <div className="bg-muted/40 border-border/70 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Light bill</p>
              <p className="text-muted-foreground text-xs">Per location / week (Outdoor = 0)</p>
            </div>
            <p className="text-2xl font-semibold tabular-nums">GH₵ 50</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Hostel fees by location</CardTitle>
          <CardDescription>
            Manager fee is % of the remainder after tithe and light bill (default 20%). Set light bill to 0 where it
            should not apply (e.g. Outdoor).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {financeLocationsQuery.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading locations…</p>
          ) : financeLocationsQuery.isError ? (
            <p className="text-destructive text-sm" role="alert">
              {financeLocationsQuery.error instanceof Error
                ? financeLocationsQuery.error.message
                : "Could not load locations."}
            </p>
          ) : (
            (financeLocationsQuery.data ?? []).map((loc) => (
              <div
                key={loc.id}
                className="border-border/70 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{loc.name}</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`light-bill-${loc.id}`} className="text-xs">
                      Light bill (GH₵)
                    </Label>
                    <Input
                      id={`light-bill-${loc.id}`}
                      type="number"
                      min={0}
                      step={1}
                      className="w-28"
                      value={lightBillAmounts[loc.id] ?? String(loc.lightBillAmount ?? 50)}
                      onChange={(e) =>
                        setLightBillAmounts((prev) => ({ ...prev, [loc.id]: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`hostel-rate-${loc.id}`} className="text-xs">
                      Fee of remainder (%)
                    </Label>
                    <Input
                      id={`hostel-rate-${loc.id}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      className="w-28"
                      value={hostelRates[loc.id] ?? String(loc.commissionRate ?? 20)}
                      onChange={(e) =>
                        setHostelRates((prev) => ({ ...prev, [loc.id]: e.target.value }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingHostelId === loc.id}
                    onClick={async () => {
                      if (!token) return
                      setSavingHostelId(loc.id)
                      setHostelMessage(null)
                      const rawFee = hostelRates[loc.id] ?? String(loc.commissionRate ?? 20)
                      const pct = Number(rawFee)
                      const rawLight = lightBillAmounts[loc.id] ?? String(loc.lightBillAmount ?? 50)
                      const light = Number(rawLight)
                      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
                        setSavingHostelId(null)
                        setHostelMessage({ type: "err", text: "Enter a fee between 0 and 100." })
                        return
                      }
                      if (!Number.isFinite(light) || light < 0) {
                        setSavingHostelId(null)
                        setHostelMessage({ type: "err", text: "Enter a light bill of 0 or more." })
                        return
                      }
                      const result = await updateFinanceLocation(token, loc.id, {
                        commissionRate: pct,
                        lightBillAmount: light,
                      })
                      setSavingHostelId(null)
                      if (!result.ok) {
                        setHostelMessage({ type: "err", text: result.error || "Could not save." })
                        return
                      }
                      queryClient.invalidateQueries({ queryKey: ["financeLocations"] })
                      queryClient.invalidateQueries({ queryKey: ["financeSummary"] })
                      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
                      setHostelMessage({ type: "ok", text: `Saved fees for ${loc.name}.` })
                    }}
                  >
                    {savingHostelId === loc.id ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ))
          )}
          {hostelMessage ? (
            <p
              className={
                hostelMessage.type === "ok"
                  ? "text-sm text-emerald-600 dark:text-emerald-400"
                  : "text-sm text-destructive"
              }
              role="status"
            >
              {hostelMessage.text}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Company</CardTitle>
          <CardDescription>
            App name and logo appear in the sidebar profile area; company name is used in exports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="app-name">App name</Label>
              <Input
                id="app-name"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                disabled={settingsQuery.isLoading || saveProfileMutation.isPending}
                placeholder="Starexpress"
              />
              <p className="text-muted-foreground text-xs">Shown in the sidebar, breadcrumbs, and sign-in pages.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Company name</Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                disabled={settingsQuery.isLoading || saveProfileMutation.isPending}
                placeholder="Starexpress Admin"
              />
              <p className="text-muted-foreground text-xs">Included in CSV exports.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-logo">Logo</Label>
              <Input
                id="company-logo"
                type="file"
                accept="image/*"
                onChange={onLogo}
                disabled={settingsQuery.isLoading || saveProfileMutation.isPending}
              />
              <p className="text-muted-foreground text-xs">
                Shown in the sidebar profile section. PNG, JPEG, GIF, WebP, or SVG under 400 KB.
              </p>
              {companyLogoUrl ? (
                <img
                  src={companyLogoUrl}
                  alt="Company logo preview"
                  className="mt-2 max-h-20 w-auto max-w-full rounded-md border border-border/80 object-contain"
                />
              ) : null}
              {logoError ? (
                <p className="text-destructive text-xs" role="alert">
                  {logoError}
                </p>
              ) : null}
              {companyLogoUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-8 px-0"
                  onClick={() => {
                    setCompanyLogoUrl(null)
                    setLogoError(null)
                  }}
                >
                  Remove logo
                </Button>
              ) : null}
            </div>
            <Button type="submit" disabled={saveProfileMutation.isPending || settingsQuery.isLoading}>
              {saveProfileMutation.isPending ? "Saving…" : "Save profile"}
            </Button>
            {profileMessage ? (
              <p
                className={
                  profileMessage.type === "ok"
                    ? "text-sm text-emerald-600 dark:text-emerald-400"
                    : "text-sm text-destructive"
                }
                role="status"
              >
                {profileMessage.text}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Purchase alerts</CardTitle>
          <CardDescription>
            Get a text when a customer on the public buy page pays but no voucher can be issued, or
            when a voucher is created but the confirmation SMS to the customer fails. Helps you catch
            and refund stuck purchases quickly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSaveAlerts} className="space-y-4">
            <div className="border-border/70 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Send me failure alerts</p>
                <p className="text-muted-foreground text-xs">Turn off to stop all purchase alert texts.</p>
              </div>
              <Switch
                checked={purchaseAlertsEnabled}
                onCheckedChange={setPurchaseAlertsEnabled}
                aria-label="Toggle purchase alerts"
                disabled={settingsQuery.isLoading || saveAlertsMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alert-phone">Alert phone number</Label>
              <Input
                id="alert-phone"
                type="tel"
                inputMode="tel"
                value={alertPhone}
                onChange={(e) => setAlertPhone(e.target.value)}
                disabled={settingsQuery.isLoading || saveAlertsMutation.isPending || !purchaseAlertsEnabled}
                placeholder="e.g. 0541234567"
                aria-describedby="alert-phone-hint"
              />
              <p id="alert-phone-hint" className="text-muted-foreground text-xs">
                Your own number (owner/admin). Separate multiple numbers with commas. Standard SMS rates apply.
              </p>
            </div>
            <Button type="submit" disabled={saveAlertsMutation.isPending || settingsQuery.isLoading}>
              {saveAlertsMutation.isPending ? "Saving…" : "Save alerts"}
            </Button>
            {alertsMessage ? (
              <p
                className={
                  alertsMessage.type === "ok"
                    ? "text-sm text-emerald-600 dark:text-emerald-400"
                    : "text-sm text-destructive"
                }
                role="status"
              >
                {alertsMessage.text}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Promotions</CardTitle>
          <CardDescription>
            Master switch for promo codes on the public buy page. When on, each location shows its
            promo only if you also turn that location's promo on under <strong>Upload vouchers</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="border-border/70 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Show promos to customers</p>
              <p className="text-muted-foreground text-xs">Turn off to hide every promo from buyers at once.</p>
            </div>
            <Switch
              checked={promosVisible}
              onCheckedChange={(v) => {
                setPromosMessage(null)
                setPromosVisible(v)
                savePromoVisibilityMutation.mutate(v)
              }}
              aria-label="Toggle promo visibility for customers"
              disabled={settingsQuery.isLoading || savePromoVisibilityMutation.isPending}
            />
          </div>
          {promosMessage ? (
            <p
              className={
                promosMessage.type === "ok"
                  ? "text-sm text-emerald-600 dark:text-emerald-400"
                  : "text-sm text-destructive"
              }
              role="status"
            >
              {promosMessage.text}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Toggle between light and dark themes.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Dark mode</p>
            <p className="text-muted-foreground text-xs">Applies the `.dark` class to the document root.</p>
          </div>
          <Switch
            checked={isDark}
            onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
            aria-label="Toggle dark mode"
          />
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Plan</CardTitle>
          <CardDescription>Mock subscription details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Plan:</span> Business
          </p>
          <p>
            <span className="text-muted-foreground">Seats:</span> 25
          </p>
          <p>
            <span className="text-muted-foreground">Renews:</span> 2026-12-01
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
