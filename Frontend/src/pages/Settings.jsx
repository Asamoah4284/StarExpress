import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/context/AuthContext.jsx"
import { APP_SETTINGS_QUERY_KEY, useAppSettings } from "@/hooks/useAppSettings.js"
import { updateAppSettings, updateAppSettingsCommission } from "@/lib/api.js"
import { getDefaultAppName, getDefaultCompanyName, getSalesAgentCommissionRate } from "@/lib/env.js"
import { readImageFileAsDataUrl } from "@/lib/readImageFile.js"

function rateToPercentInput(rate) {
  const pct = rate * 100
  const rounded = Math.round(pct * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
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

  const loadedRate = settingsQuery.data?.salesAgentCommissionRate
  const loadedAppName = settingsQuery.data?.appName
  const loadedCompanyName = settingsQuery.data?.companyName
  const loadedCompanyLogoUrl = settingsQuery.data?.companyLogoUrl

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

  const saveCommissionMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const pct = Number.parseFloat(commissionPercent.trim())
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error("Enter a commission between 0 and 100.")
      }
      const r = await updateAppSettingsCommission(token, { salesAgentCommissionPercent: pct })
      if (!r.ok) throw new Error(r.error || "Failed to save commission")
      return {
        salesAgentCommissionRate: r.salesAgentCommissionRate,
        appName: r.appName,
        companyName: r.companyName,
        companyLogoUrl: r.companyLogoUrl ?? null,
      }
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
      return {
        salesAgentCommissionRate: r.salesAgentCommissionRate,
        appName: r.appName,
        companyName: r.companyName,
        companyLogoUrl: r.companyLogoUrl ?? null,
      }
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

  const onSaveCommission = (e) => {
    e.preventDefault()
    setCommissionMessage(null)
    saveCommissionMutation.mutate()
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
