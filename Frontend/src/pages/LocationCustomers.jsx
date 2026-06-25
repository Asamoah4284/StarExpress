import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  MessageSquare,
  Phone,
  Search,
  Send,
  Trophy,
  Users,
} from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { fetchCustomers, sendCustomersSms } from "@/lib/api.js"
import { findAgentStoreLocation } from "@/lib/agentLocation.js"
import { formatGhanaPhoneDisplayLocal, formatGhanaPhoneLocal } from "@/lib/ghanaPhone.js"
import { ROLE_ADMIN, ROLE_SALES_AGENT } from "@/lib/roles.js"
import { cn, formatCedis } from "@/lib/utils"

const NUMBERS_PER_PAGE = 10
const ALL_LOCATIONS = "all"
const MAX_SMS_LENGTH = 480

export default function LocationCustomers() {
  const { token, user } = useAuth()
  const queryClient = useQueryClient()
  const catalog = useCatalog()
  const locations = catalog.data?.locations ?? []
  const isAdmin = user?.role === ROLE_ADMIN
  const isSalesAgent = user?.role === ROLE_SALES_AGENT
  const agentStore = React.useMemo(() => findAgentStoreLocation(locations, user), [locations, user])

  const [scopeSelect, setScopeSelect] = React.useState(ALL_LOCATIONS)
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(0)

  // SMS composer
  const [smsOpen, setSmsOpen] = React.useState(false)
  const [smsTarget, setSmsTarget] = React.useState(/** @type {string | null} */ (null))
  // For a broadcast: which location to send to ("all" or a specific id). Admins can change
  // this in the dialog without touching the page filter.
  const [broadcastTarget, setBroadcastTarget] = React.useState(ALL_LOCATIONS)
  const [smsMessage, setSmsMessage] = React.useState("")
  const [smsResult, setSmsResult] = React.useState(
    /** @type {{ total: number, sent: number, failed: number } | null} */ (null),
  )
  const [smsError, setSmsError] = React.useState(/** @type {string | null} */ (null))

  // Agents are scoped to their store server-side; "all" just means "your store" for them.
  const locationParam = isAdmin ? scopeSelect : ALL_LOCATIONS

  React.useEffect(() => {
    setPage(0)
    setSearch("")
  }, [scopeSelect])

  const customersQuery = useQuery({
    queryKey: ["customers", token, isAdmin ? scopeSelect : "agent-store"],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchCustomers(token, locationParam)
      if (!result.ok) throw new Error(result.error || "Failed to load customers.")
      return result
    },
  })

  // Live count for the broadcast target chosen in the dialog. Shares the query key with the
  // main list, so picking the current view costs no extra fetch.
  const broadcastCountQuery = useQuery({
    queryKey: ["customers", token, broadcastTarget],
    enabled: Boolean(token) && smsOpen && !smsTarget && isAdmin,
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchCustomers(token, broadcastTarget)
      if (!result.ok) throw new Error(result.error || "Failed to load customers.")
      return result
    },
  })

  const allCustomers = React.useMemo(
    () => customersQuery.data?.customers ?? [],
    [customersQuery.data],
  )
  const topCustomers = customersQuery.data?.top ?? []
  const totalUnique = customersQuery.data?.totalUniqueNumbers ?? allCustomers.length
  const scopeLabel =
    customersQuery.data?.scopeLabel || (isSalesAgent ? agentStore?.name ?? "Your store" : "All locations")

  const filteredCustomers = React.useMemo(() => {
    const q = search.trim().replace(/\s+/g, "")
    if (!q) return allCustomers
    const qDigits = q.replace(/\D/g, "")
    return allCustomers.filter((c) => {
      const phone = c.phone || ""
      const local = formatGhanaPhoneLocal(phone)
      const display = formatGhanaPhoneDisplayLocal(phone).replace(/\s+/g, "")
      return local.includes(q) || display.includes(q) || phone.replace(/\D/g, "").includes(qDigits)
    })
  }, [allCustomers, search])

  const pageCount = Math.max(1, Math.ceil(filteredCustomers.length / NUMBERS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageCustomers = filteredCustomers.slice(
    safePage * NUMBERS_PER_PAGE,
    safePage * NUMBERS_PER_PAGE + NUMBERS_PER_PAGE,
  )

  React.useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1))
  }, [page, pageCount])

  const exportCsv = () => {
    const header = "Phone number,Purchases,Active days,Total spent (GHS)"
    const lines = filteredCustomers.map((c) => {
      const phone = formatGhanaPhoneLocal(c.phone).replace(/"/g, '""')
      return `"${phone}",${c.purchases},${c.activeDays},${c.totalSpent}`
    })
    const csv = [header, ...lines].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `customers-${locationParam}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const smsMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const message = smsMessage.trim()
      if (!message) throw new Error("Enter a message to send.")
      const result = await sendCustomersSms(token, {
        locationId: smsTarget ? locationParam : isAdmin ? broadcastTarget : ALL_LOCATIONS,
        phone: smsTarget || undefined,
        message,
      })
      if (!result.ok) throw new Error(result.error || "Failed to send SMS.")
      return result
    },
    onSuccess: (r) => {
      setSmsResult(r)
      setSmsError(null)
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
    },
    onError: (e) => {
      setSmsError(e instanceof Error ? e.message : "Failed to send SMS.")
      setSmsResult(null)
    },
  })

  const openBroadcast = () => {
    setSmsTarget(null)
    setBroadcastTarget(isAdmin ? scopeSelect : ALL_LOCATIONS)
    setSmsMessage("")
    setSmsResult(null)
    setSmsError(null)
    setSmsOpen(true)
  }

  const openSingleSms = (phone) => {
    setSmsTarget(phone)
    setSmsMessage("")
    setSmsResult(null)
    setSmsError(null)
    setSmsOpen(true)
  }

  // Recipient count + label for the broadcast confirmation. Agents are fixed to their store;
  // admins follow the dialog's target picker (falling back to the current view's count).
  const broadcastCount = isSalesAgent
    ? totalUnique
    : broadcastCountQuery.data?.totalUniqueNumbers ??
      (broadcastTarget === scopeSelect ? totalUnique : undefined)
  const broadcastLabel = isSalesAgent
    ? scopeLabel
    : broadcastTarget === ALL_LOCATIONS
      ? "All locations"
      : locations.find((l) => l.id === broadcastTarget)?.name ?? "this location"
  const recipientCount = smsTarget ? 1 : broadcastCount

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Everyone who has purchased — across all locations by default. Filter by location, reward your most consistent buyers, and message them by SMS."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={openBroadcast}
            disabled={customersQuery.isLoading || totalUnique === 0}
            className="gap-2"
          >
            <MessageSquare className="size-4" aria-hidden />
            Message all
          </Button>
          <Button type="button" onClick={exportCsv} disabled={!filteredCustomers.length} className="gap-2">
            <Download className="size-4" aria-hidden />
            Export CSV
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="bg-primary/10 flex size-11 shrink-0 items-center justify-center rounded-xl">
              <Users className="text-primary size-5" aria-hidden />
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Customers</p>
              <p className="text-2xl font-bold tabular-nums">
                {customersQuery.isLoading ? "…" : totalUnique}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm sm:col-span-1 lg:col-span-2">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl">
              <MapPin className="text-muted-foreground size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Viewing</p>
              <p className="truncate text-lg font-semibold">{scopeLabel}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {topCustomers.length > 0 ? (
        <Card className="border-amber-500/30 bg-amber-500/[0.04] shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-amber-500" aria-hidden />
              <CardTitle className="text-base">Top 5 customers to reward</CardTitle>
            </div>
            <CardDescription>
              Your most consistent buyers in {scopeLabel} — by number of purchases, then how many separate days they
              came back.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topCustomers.map((c, i) => (
              <div
                key={formatGhanaPhoneLocal(c.phone)}
                className="border-border/70 bg-background/60 flex items-center gap-3 rounded-lg border px-3 py-2.5"
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                    i === 0
                      ? "bg-amber-500 text-white"
                      : i === 1
                        ? "bg-amber-500/30 text-amber-700 dark:text-amber-300"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-semibold tabular-nums">
                    {formatGhanaPhoneDisplayLocal(c.phone)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {c.purchases} buy{c.purchases === 1 ? "" : "s"} · {c.activeDays} day
                    {c.activeDays === 1 ? "" : "s"}
                    {c.totalSpent > 0 ? ` · ${formatCedis(c.totalSpent)}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label={`Send SMS to ${formatGhanaPhoneDisplayLocal(c.phone)}`}
                  onClick={() => openSingleSms(c.phone)}
                >
                  <MessageSquare className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/80 overflow-hidden shadow-sm">
        <CardHeader className="border-border/60 border-b pb-4">
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription>
            Numbers are deduplicated and shown in local format (starting with 0). The same buyer saved as 024… or 233…
            appears once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {isAdmin ? (
              <div className="space-y-1.5">
                <Label htmlFor="customers-location">WiFi location</Label>
                <Select value={scopeSelect} onValueChange={setScopeSelect}>
                  <SelectTrigger id="customers-location" className="w-full shadow-none">
                    <SelectValue placeholder="All locations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Your store</Label>
                <p className="border-border bg-muted/30 rounded-md border px-3 py-2 text-sm font-medium">
                  {agentStore?.name ?? "No store assigned"}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="customers-search">Search numbers</Label>
              <div className="relative">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  id="customers-search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(0)
                  }}
                  placeholder="e.g. 024 or 054"
                  className="pl-9 shadow-none"
                />
              </div>
            </div>
          </div>

          {customersQuery.isError ? (
            <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
              {customersQuery.error instanceof Error ? customersQuery.error.message : "Failed to load"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 overflow-hidden shadow-sm">
        <CardHeader className="border-border/60 border-b pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Customers by purchases</CardTitle>
              <CardDescription className="mt-1">
                {customersQuery.isLoading
                  ? "Loading…"
                  : `${filteredCustomers.length} customer${filteredCustomers.length === 1 ? "" : "s"}${search.trim() ? " matching search" : ", most active first"}`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {customersQuery.isLoading ? (
            <div className="text-muted-foreground flex justify-center py-16 text-sm">Loading customers…</div>
          ) : pageCustomers.length === 0 ? (
            <div className="text-muted-foreground py-16 text-center text-sm">
              {search.trim() ? "No numbers match your search." : "No customers found yet."}
            </div>
          ) : (
            <ul className="divide-border divide-y">
              {pageCustomers.map((customer, index) => {
                const rowNumber = safePage * NUMBERS_PER_PAGE + index + 1
                const display = formatGhanaPhoneDisplayLocal(customer.phone)
                const local = formatGhanaPhoneLocal(customer.phone)
                const isTop = !search.trim() && rowNumber === 1 && customer.purchases > 0
                return (
                  <li
                    key={local}
                    className="hover:bg-muted/40 flex items-center gap-3 px-4 py-3.5 transition-colors sm:px-5"
                  >
                    <span className="text-muted-foreground w-8 shrink-0 text-right text-xs font-medium tabular-nums">
                      {rowNumber}
                    </span>
                    <div
                      className={
                        isTop
                          ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500"
                          : "bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg"
                      }
                    >
                      {isTop ? <Trophy className="size-4" aria-hidden /> : <Phone className="size-4" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-base font-semibold tracking-wide tabular-nums">{display}</p>
                      <p className="text-muted-foreground text-xs">
                        {local}
                        {customer.lastPurchase ? ` · last ${customer.lastPurchase.slice(0, 10)}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums">
                        {customer.purchases}{" "}
                        <span className="text-muted-foreground text-xs font-normal">
                          buy{customer.purchases === 1 ? "" : "s"}
                        </span>
                      </p>
                      {customer.totalSpent > 0 ? (
                        <p className="text-muted-foreground text-xs tabular-nums">{formatCedis(customer.totalSpent)}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={`Send SMS to ${display}`}
                      onClick={() => openSingleSms(customer.phone)}
                    >
                      <MessageSquare className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          {filteredCustomers.length > 0 ? (
            <div className="border-border/60 flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-muted-foreground text-xs tabular-nums sm:text-sm">
                Page {safePage + 1} of {pageCount}
                <span className="hidden sm:inline">
                  {" "}
                  · Showing {pageCustomers.length} of {filteredCustomers.length}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-4" aria-hidden />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={smsOpen}
        onOpenChange={(o) => {
          setSmsOpen(o)
          if (!o) {
            setSmsResult(null)
            setSmsError(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{smsTarget ? "Send SMS to customer" : "Message all customers"}</DialogTitle>
            <DialogDescription>
              {smsTarget
                ? `To ${formatGhanaPhoneDisplayLocal(smsTarget)}.`
                : recipientCount == null
                  ? `To all customers in ${broadcastLabel}.`
                  : `To all ${recipientCount} customer${recipientCount === 1 ? "" : "s"} in ${broadcastLabel}.`}{" "}
              Standard SMS rates apply.
            </DialogDescription>
          </DialogHeader>

          {smsResult ? (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm">
                Sent to <span className="font-semibold">{smsResult.sent}</span> of {smsResult.total}.
                {smsResult.failed > 0 ? (
                  <span className="text-destructive"> {smsResult.failed} failed.</span>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => setSmsOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {!smsTarget && isAdmin ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sms-target">Send to</Label>
                  <Select
                    value={broadcastTarget}
                    onValueChange={setBroadcastTarget}
                    disabled={smsMutation.isPending}
                  >
                    <SelectTrigger id="sms-target" className="w-full shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_LOCATIONS}>All locations (everyone)</SelectItem>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {broadcastCountQuery.isFetching && recipientCount == null
                      ? "Counting recipients…"
                      : `${recipientCount ?? 0} customer${recipientCount === 1 ? "" : "s"} will receive this.`}
                  </p>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="sms-message">Message</Label>
                <textarea
                  id="sms-message"
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value.slice(0, MAX_SMS_LENGTH))}
                  rows={4}
                  placeholder="e.g. New data bundles are live at the front desk today. Reply STOP to opt out."
                  disabled={smsMutation.isPending}
                  className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-muted-foreground text-xs tabular-nums">{smsMessage.length}/{MAX_SMS_LENGTH}</p>
              </div>

              {smsError ? (
                <p className="text-destructive text-sm" role="alert">
                  {smsError}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setSmsOpen(false)} disabled={smsMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="gap-2"
                  onClick={() => smsMutation.mutate()}
                  disabled={smsMutation.isPending || !smsMessage.trim()}
                >
                  <Send className="size-4" aria-hidden />
                  {smsMutation.isPending
                    ? "Sending…"
                    : smsTarget
                      ? "Send"
                      : recipientCount != null
                        ? `Send to ${recipientCount}`
                        : "Send to all"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
