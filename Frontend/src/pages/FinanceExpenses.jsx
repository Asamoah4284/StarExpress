import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowLeft, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { DateRangePicker } from "@/components/reports/DateRangePicker.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext.jsx"
import {
  createFinanceExpense,
  deleteFinanceExpense,
  fetchFinanceExpenses,
  fetchFinanceLocations,
} from "@/lib/api.js"
import {
  formatDateRangeLabel,
  isCompleteDateRange,
  localDateToIso,
  normalizeDateRange,
} from "@/lib/dates.js"
import { locationNameById } from "@/lib/locations.js"
import { formatCedis } from "@/lib/utils"

const EXPENSE_CATEGORIES = [
  { value: "data_bundle", label: "Data bundle" },
  { value: "router_hardware", label: "Router hardware" },
  { value: "starlink_subscription", label: "Starlink subscription" },
  { value: "maintenance", label: "Maintenance" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
]

function categoryLabel(value) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

export default function FinanceExpenses() {
  const { token, authReady } = useAuth()
  const queryClient = useQueryClient()

  const [dateRange, setDateRange] = React.useState(/** @type {{ from?: Date, to?: Date } | undefined} */ (undefined))
  const [filterLocationId, setFilterLocationId] = React.useState("all")
  const [deleteTarget, setDeleteTarget] = React.useState(/** @type {{ id: string, title: string } | null} */ (null))
  const [formError, setFormError] = React.useState(/** @type {string | null} */ (null))

  const [title, setTitle] = React.useState("")
  const [category, setCategory] = React.useState("other")
  const [amount, setAmount] = React.useState("")
  const [expenseDate, setExpenseDate] = React.useState(() => localDateToIso(new Date()))
  const [locationId, setLocationId] = React.useState("general")
  const [notes, setNotes] = React.useState("")

  const locationsQuery = useQuery({
    queryKey: ["financeLocations", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchFinanceLocations(token)
      if (!result.ok) throw new Error(result.error || "Failed to load locations.")
      return result.locations
    },
    enabled: authReady && Boolean(token),
  })

  const rangeComplete = isCompleteDateRange(dateRange)
  const fromIso = rangeComplete && dateRange?.from ? localDateToIso(dateRange.from) : ""
  const toIso = rangeComplete && dateRange?.to ? localDateToIso(dateRange.to) : ""

  const expensesQuery = useQuery({
    queryKey: ["financeExpenses", token, filterLocationId, fromIso, toIso],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchFinanceExpenses(token, {
        ...(filterLocationId !== "all" ? { locationId: filterLocationId } : {}),
        ...(fromIso ? { from: fromIso } : {}),
        ...(toIso ? { to: toIso } : {}),
      })
      if (!result.ok) throw new Error(result.error || "Failed to load expenses.")
      return result.expenses
    },
    enabled: authReady && Boolean(token),
  })

  const locations = locationsQuery.data ?? []

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const parsedAmount = Number(amount)
      if (!title.trim()) throw new Error("Title is required.")
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) throw new Error("Enter a valid amount.")
      const result = await createFinanceExpense(token, {
        title: title.trim(),
        category,
        amount: parsedAmount,
        date: expenseDate,
        locationId: locationId === "general" ? null : locationId,
        notes: notes.trim(),
      })
      if (!result.ok) throw new Error(result.error || "Could not add expense.")
      return result.expense
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financeExpenses"] })
      queryClient.invalidateQueries({ queryKey: ["financeSummary"] })
      setTitle("")
      setAmount("")
      setNotes("")
      setFormError(null)
    },
    onError: (e) => {
      setFormError(e instanceof Error ? e.message : "Could not add expense.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!token) throw new Error("Not signed in")
      const result = await deleteFinanceExpense(token, id)
      if (!result.ok) throw new Error(result.error || "Could not delete expense.")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financeExpenses"] })
      queryClient.invalidateQueries({ queryKey: ["financeSummary"] })
      setDeleteTarget(null)
    },
  })

  const columns = React.useMemo(
    () => [
      { accessorKey: "date", header: "Date" },
      { accessorKey: "title", header: "Title", cell: ({ getValue }) => <span className="font-medium">{String(getValue() ?? "")}</span> },
      {
        accessorKey: "category",
        header: "Category",
        cell: ({ getValue }) => categoryLabel(String(getValue() ?? "")),
      },
      {
        accessorKey: "amount",
        header: "Amount",
        meta: { headerClassName: "text-right", cellClassName: "text-right tabular-nums" },
        cell: ({ getValue }) => formatCedis(getValue()),
      },
      {
        accessorKey: "locationId",
        header: "Location",
        cell: ({ getValue }) => {
          const id = getValue()
          if (id == null || id === "") return "General (shared)"
          return locationNameById(String(id), locations) || String(id)
        },
      },
      {
        id: "actions",
        header: "",
        meta: { headerClassName: "w-12", cellClassName: "text-right" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive size-8"
            onClick={() => setDeleteTarget({ id: row.original.id, title: row.original.title })}
            aria-label={`Delete ${row.original.title}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        ),
      },
    ],
    [locations],
  )

  return (
    <div className="space-y-8">
      <PageHeader title="Expenses" description="Track operating costs by location or as general shared expenses.">
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/finance" className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden />
            Finance summary
          </Link>
        </Button>
      </PageHeader>

      <Card className="border-border shadow-none ring-1 ring-border">
        <CardHeader>
          <CardTitle className="text-base">Add expense</CardTitle>
          <CardDescription>Record a cost for the selected week or any date.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="expense-title">Title</Label>
            <Input id="expense-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Starlink renewal" />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense-amount">Amount (GHS)</Label>
            <Input id="expense-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expense-date">Date</Label>
            <Input id="expense-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General (shared)</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="expense-notes">Notes (optional)</Label>
            <Input id="expense-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {formError ? (
            <p className="text-destructive text-sm sm:col-span-2" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="button" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Add expense"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border shadow-none ring-1 ring-border">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Expense history</CardTitle>
            <CardDescription>
              {rangeComplete ? formatDateRangeLabel(dateRange) : "Filter by date range and location."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Location</Label>
              <Select value={filterLocationId} onValueChange={setFilterLocationId}>
                <SelectTrigger className="w-[11rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  <SelectItem value="general">General only</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DateRangePicker value={dateRange} onChange={(r) => setDateRange(normalizeDateRange(r))} />
          </div>
        </CardHeader>
        <CardContent>
          {expensesQuery.isLoading ? <p className="text-muted-foreground text-sm">Loading expenses…</p> : null}
          <DataTable columns={columns} data={expensesQuery.data ?? []} emptyMessage="No expenses match your filters." />
        </CardContent>
      </Card>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete expense?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `"${deleteTarget.title}" will be removed permanently.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending || !deleteTarget}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
