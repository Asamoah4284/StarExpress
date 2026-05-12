import * as React from "react"
import { useTheme } from "next-themes"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export default function Settings() {
  const { theme, setTheme } = useTheme()
  const [company, setCompany] = React.useState("StarExpress Admin")
  const [logoPreview, setLogoPreview] = React.useState(null)

  React.useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview)
    }
  }, [logoPreview])

  const onLogo = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
  }

  const isDark = theme === "dark"

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Company profile and appearance (UI only)." />

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Company</CardTitle>
          <CardDescription>Displayed in the top bar and exports.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Company name</Label>
            <Input id="company-name" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-logo">Logo upload (preview only)</Label>
            <Input id="company-logo" type="file" accept="image/*" onChange={onLogo} />
            {logoPreview ? (
              <img src={logoPreview} alt="Logo preview" className="mt-2 h-16 w-auto rounded-md border border-border/80" />
            ) : null}
          </div>
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
          <Switch checked={isDark} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} aria-label="Toggle dark mode" />
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
