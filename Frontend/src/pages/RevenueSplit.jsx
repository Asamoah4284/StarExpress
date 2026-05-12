import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RevenueSplitBarChart } from "@/components/charts/RevenueSplitBarChart.jsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { sales } from "@/data/sales.js"
import { locations } from "@/data/locations.js"
import {
  filterSalesByLocation,
  getCompletedRevenueByPackageType,
  getSalesByLocation,
} from "@/lib/aggregations.js"

export default function RevenueSplit() {
  const [locationId, setLocationId] = React.useState("all")
  const filtered = React.useMemo(() => filterSalesByLocation(sales, locationId), [locationId])

  const revenueSplit = React.useMemo(() => {
    if (locationId === "all") {
      return getSalesByLocation(filtered, locations)
        .map(({ name, total }) => ({ name, revenue: total }))
        .sort((a, b) => b.revenue - a.revenue)
    }
    return getCompletedRevenueByPackageType(filtered)
  }, [locationId, filtered])

  const splitTitle =
    locationId === "all" ? "By outlet (completed GH₵)" : "By package type (completed GH₵)"
  const chartHeight = React.useMemo(
    () => Math.min(520, Math.max(240, 72 + revenueSplit.length * 52)),
    [revenueSplit.length],
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Revenue split"
        description="Completed revenue share by outlet (all locations) or by package type (single outlet). Mock data only."
      >
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Location</span>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-full border-border bg-card shadow-none sm:w-[220px]">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PageHeader>

      <Card className="border-border bg-card shadow-none ring-1 ring-border">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base font-semibold tracking-tight">Split chart</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            {locationId === "all"
              ? "Horizontal bars show each outlet’s share of completed revenue in the current dataset."
              : "Horizontal bars show each package type’s share of completed revenue for the selected outlet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <h2 className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wider">{splitTitle}</h2>
          <div className="border-border/60 bg-muted/25 rounded-lg border p-3 sm:p-4 dark:bg-muted/15">
            <RevenueSplitBarChart data={revenueSplit} height={chartHeight} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
