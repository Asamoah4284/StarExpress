import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { createCatalogLocation, deleteCatalogLocation, fetchUsersList, updateCatalogLocation } from "@/lib/api.js"
import { ROLE_SALES_AGENT } from "@/lib/roles.js"
import { cn } from "@/lib/utils"

/**
 * @param {string} managerLabel
 * @param {Array<{ id: string, name: string, email: string, role: string, active: boolean }>} users
 * @returns {string | null}
 */
function matchSalesAgentIdForManagerLabel(managerLabel, users) {
  const t = managerLabel.trim()
  if (!t) return null
  const agents = users.filter((u) => u.role === ROLE_SALES_AGENT && u.active !== false)
  const key = t.toLowerCase()
  const byName = agents.filter((u) => u.name.trim().toLowerCase() === key)
  if (byName.length === 1) return byName[0].id
  const byFormatted = agents.find((u) => t === `${u.name.trim()} (${u.email.trim()})`)
  if (byFormatted) return byFormatted.id
  const byEmail = agents.find((u) => t.includes(u.email.trim()))
  return byEmail ? byEmail.id : null
}

export default function Locations() {
  const { token, user, authReady } = useAuth()
  const catalog = useCatalog()
  const queryClient = useQueryClient()
  const locations = catalog.data?.locations
  const rows = React.useMemo(() => locations ?? [], [locations])
  const isAdmin = user?.role === "Admin"

  const usersQuery = useQuery({
    queryKey: ["teamUsers", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchUsersList(token)
      if (!result.ok) throw new Error(result.error || "Failed to load users")
      return result.users
    },
    enabled: authReady && Boolean(token) && isAdmin,
  })

  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const [form, setForm] = React.useState({
    name: "",
    address: "",
    salesAgentId: null,
    legacyManager: "",
    totalSales: "",
    managerPayoutNumber: "",
  })
  const emptyForm = () => ({
    name: "",
    address: "",
    salesAgentId: null,
    legacyManager: "",
    totalSales: "",
    managerPayoutNumber: "",
  })
  const [formError, setFormError] = React.useState(null)
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false)
  const [agentSearch, setAgentSearch] = React.useState("")
  const [deleteTarget, setDeleteTarget] = React.useState(/** @type {{ id: string, name: string } | null} */ (null))

  const salesAgents = React.useMemo(() => {
    const users = usersQuery.data ?? []
    return users.filter((u) => u.role === ROLE_SALES_AGENT && u.active !== false)
  }, [usersQuery.data])

  const teamUsers = React.useMemo(() => usersQuery.data ?? [], [usersQuery.data])

  /** @type {Map<string, string>} agent user id → other location name */
  const agentTakenElsewhere = React.useMemo(() => {
    const map = new Map()
    for (const loc of rows) {
      if (editing?.id && loc.id === editing.id) continue
      let uid = loc.managerUserId && typeof loc.managerUserId === "string" ? loc.managerUserId : null
      if (!uid) uid = matchSalesAgentIdForManagerLabel(String(loc.manager ?? ""), teamUsers)
      if (!uid) continue
      map.set(uid, loc.name)
    }
    return map
  }, [rows, editing, teamUsers])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const total = Number(form.totalSales)
      const users = queryClient.getQueryData(["teamUsers", token])
      const userList = Array.isArray(users) ? users : []
      let manager
      if (form.salesAgentId) {
        const agent = userList.find((u) => u.id === form.salesAgentId)
        if (!agent || agent.role !== ROLE_SALES_AGENT || agent.active === false) {
          throw new Error("Pick an active sales agent, or use the manager label field on edit.")
        }
        manager = agent.name.trim()
      } else {
        manager = form.legacyManager.trim()
      }
      if (editing) {
        const r = await updateCatalogLocation(token, editing.id, {
          name: form.name.trim(),
          address: form.address.trim(),
          manager,
          totalSales: total,
          managerUserId: form.salesAgentId || null,
          managerPayoutNumber: form.managerPayoutNumber.trim(),
        })
        if (!r.ok) throw new Error(r.error || "Update failed")
      } else {
        const r = await createCatalogLocation(token, {
          name: form.name.trim(),
          address: form.address.trim(),
          manager,
          totalSales: total,
          managerUserId: form.salesAgentId || null,
          managerPayoutNumber: form.managerPayoutNumber.trim(),
        })
        if (!r.ok) throw new Error(r.error || "Create failed")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm())
      setFormError(null)
      setAgentPickerOpen(false)
      setAgentSearch("")
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Request failed")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!token) throw new Error("Not signed in")
      const r = await deleteCatalogLocation(token, id)
      if (!r.ok) throw new Error(r.error || "Delete failed")
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setDeleteTarget(null)
      setEditing((e) => {
        if (e?.id === deletedId) {
          setOpen(false)
          setForm(emptyForm())
          setFormError(null)
          setAgentPickerOpen(false)
          setAgentSearch("")
          return null
        }
        return e
      })
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Delete failed")
    },
  })

  const requestDelete = React.useCallback((row) => {
    setDeleteTarget({ id: row.id, name: row.name })
    setFormError(null)
  }, [])

  const reset = () => {
    setForm(emptyForm())
    setEditing(null)
    setFormError(null)
    setAgentPickerOpen(false)
    setAgentSearch("")
  }

  const openAdd = () => {
    reset()
    setOpen(true)
  }

  const openEdit = React.useCallback(
    (row) => {
      setEditing(row)
      const users = usersQuery.data ?? []
      let salesAgentId = null
      let legacyManager = ""
      if (row.managerUserId && typeof row.managerUserId === "string") {
        const stillValid = users.some(
          (u) => u.id === row.managerUserId && u.role === ROLE_SALES_AGENT && u.active !== false,
        )
        if (stillValid) salesAgentId = row.managerUserId
      }
      if (!salesAgentId) {
        const matchedId = matchSalesAgentIdForManagerLabel(row.manager, users)
        if (matchedId) salesAgentId = matchedId
        else legacyManager = String(row.manager ?? "")
      }
      setForm({
        name: row.name,
        address: row.address,
        salesAgentId,
        legacyManager,
        totalSales: String(row.totalSales),
        managerPayoutNumber: String(row.managerPayoutNumber ?? ""),
      })
      setFormError(null)
      setAgentPickerOpen(false)
      setAgentSearch("")
      setOpen(true)
    },
    [usersQuery.data],
  )

  const save = () => {
    setFormError(null)
    const total = Number(form.totalSales)
    if (!form.name.trim() || Number.isNaN(total)) {
      setFormError("Name and a numeric total sales count are required.")
      return
    }
    if (!editing && !form.salesAgentId) {
      setFormError("Choose an active sales agent to assign as manager.")
      return
    }
    if (editing && !form.salesAgentId && !form.legacyManager.trim()) {
      setFormError("Choose a sales agent or enter a manager name.")
      return
    }
    if (!isAdmin) {
      setFormError("Only administrators can change locations.")
      return
    }
    saveMutation.mutate()
  }

  const selectedAgent = form.salesAgentId ? salesAgents.find((u) => u.id === form.salesAgentId) : null
  const agentFilter = agentSearch.trim().toLowerCase()
  const filteredAgents = React.useMemo(() => {
    if (!agentFilter) return salesAgents
    return salesAgents.filter(
      (u) =>
        u.name.toLowerCase().includes(agentFilter) || u.email.toLowerCase().includes(agentFilter),
    )
  }, [salesAgents, agentFilter])

  const showLegacyManagerField = Boolean(editing) && !form.salesAgentId

  const columns = React.useMemo(
    () => [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "address", header: "Address" },
      { accessorKey: "manager", header: "Sales agent" },
      {
        accessorKey: "managerPayoutNumber",
        header: "Payout number",
        cell: ({ getValue }) => {
          const v = String(getValue() ?? "").trim()
          return v || "—"
        },
      },
      {
        accessorKey: "totalSales",
        header: "Total sales",
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
        cell: ({ getValue }) => Number(getValue()).toLocaleString(),
      },
      {
        id: "actions",
        accessorFn: () => "",
        header: "Actions",
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
        cell: ({ row }) => (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!isAdmin}
              onClick={() => openEdit(row.original)}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive shrink-0"
              disabled={!isAdmin || deleteMutation.isPending}
              aria-label={`Delete location ${row.original.name}`}
              title="Delete location"
              onClick={() => requestDelete(row.original)}
            >
              <Trash2 className="size-4 stroke-[1.5]" aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    [openEdit, requestDelete, isAdmin, deleteMutation.isPending],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Locations" description="Retail and partner locations from the API.">
        <Button type="button" onClick={openAdd} disabled={!isAdmin}>
          Add location
        </Button>
      </PageHeader>

      {catalog.isLoading ? <p className="text-muted-foreground text-sm">Loading…</p> : null}
      {catalog.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {catalog.error instanceof Error ? catalog.error.message : "Failed to load"}
        </p>
      ) : null}
      {deleteMutation.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {deleteMutation.error instanceof Error ? deleteMutation.error.message : "Delete failed"}
        </p>
      ) : null}

      <DataTable
        data={rows}
        columns={columns}
        searchPlaceholder="Search name, address, sales agent, payout…"
        pageSize={8}
      />

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null)
            deleteMutation.reset()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete location</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Remove "${deleteTarget.name}" from the catalog? This cannot be undone. Locations that have sales history cannot be deleted.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                deleteMutation.reset()
              }}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteTarget == null || deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit location" : "Add location"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {formError ? (
              <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="loc-name">Location name</Label>
              <Input id="loc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-address">Address</Label>
              <Input
                id="loc-address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label id="loc-agent-label">Assigned sales agent</Label>
              {usersQuery.isLoading ? (
                <p className="text-muted-foreground text-xs">Loading team accounts…</p>
              ) : null}
              {usersQuery.error ? (
                <p className="text-destructive text-xs" role="alert">
                  {usersQuery.error instanceof Error ? usersQuery.error.message : "Could not load users"}
                </p>
              ) : null}
              <Popover
                open={agentPickerOpen}
                onOpenChange={(next) => {
                  setAgentPickerOpen(next)
                  if (next) setAgentSearch("")
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    aria-labelledby="loc-agent-label"
                    className="h-10 w-full justify-between gap-2 px-3 font-normal"
                    disabled={usersQuery.isLoading || Boolean(usersQuery.error)}
                  >
                    <span className="truncate text-left">
                      {selectedAgent
                        ? selectedAgent.name
                        : showLegacyManagerField && form.legacyManager.trim()
                          ? form.legacyManager.trim()
                          : "Search and choose a sales agent…"}
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(100vw-2rem,22rem)] p-0" align="start">
                  <div className="border-b p-2">
                    <Input
                      placeholder="Search by name or email…"
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <ScrollArea className="h-[min(240px,40vh)]">
                    <ul className="p-1">
                      {filteredAgents.map((agent) => {
                        const isSelected = form.salesAgentId === agent.id
                        const takenAt = agentTakenElsewhere.get(agent.id)
                        const willMove = Boolean(takenAt) && !isSelected
                        return (
                          <li key={agent.id}>
                            <button
                              type="button"
                              title={willMove ? `Will move this agent from ${takenAt} to this location.` : undefined}
                              className={cn(
                                "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                                isSelected && "bg-accent",
                              )}
                              onClick={() => {
                                setForm((f) => ({
                                  ...f,
                                  salesAgentId: agent.id,
                                  legacyManager: "",
                                }))
                                setAgentPickerOpen(false)
                              }}
                            >
                              <Check
                                className={cn("mt-0.5 size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium">{agent.name}</span>
                                <span className="text-muted-foreground block text-xs">{agent.email}</span>
                                {willMove ? (
                                  <span className="text-muted-foreground block text-xs">
                                    Currently at {takenAt} — will move here on save
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                    {salesAgents.length === 0 && !usersQuery.isLoading ? (
                      <p className="text-muted-foreground px-3 py-4 text-center text-xs">
                        No active sales agents yet. Add a Sales Agent under Users, then assign them here.
                      </p>
                    ) : null}
                    {salesAgents.length > 0 && filteredAgents.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-4 text-center text-xs">No matches for that search.</p>
                    ) : null}
                  </ScrollArea>
                  {editing ? (
                    <div className="border-t p-2 space-y-1">
                      {form.salesAgentId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-8 w-full text-xs"
                          onClick={() => {
                            setForm((f) => ({
                              ...f,
                              salesAgentId: null,
                              legacyManager: "—",
                            }))
                            setAgentPickerOpen(false)
                          }}
                        >
                          Remove sales agent assignment
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground h-8 w-full text-xs"
                        onClick={() => {
                          const fromId = form.salesAgentId
                            ? salesAgents.find((u) => u.id === form.salesAgentId)
                            : null
                          setForm((f) => ({
                            ...f,
                            salesAgentId: null,
                            legacyManager:
                              f.legacyManager.trim() ||
                              (editing ? String(editing.manager ?? "") : "") ||
                              (fromId ? fromId.name : ""),
                          }))
                          setAgentPickerOpen(false)
                        }}
                      >
                        Use custom manager label instead
                      </Button>
                    </div>
                  ) : null}
                </PopoverContent>
              </Popover>
              {showLegacyManagerField ? (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="loc-manager-legacy">Manager label</Label>
                  <Input
                    id="loc-manager-legacy"
                    value={form.legacyManager}
                    onChange={(e) => setForm((f) => ({ ...f, legacyManager: e.target.value }))}
                    placeholder="Name shown for this location"
                  />
                  <p className="text-muted-foreground text-xs">
                    No team user matched this location’s current manager. Edit the label or pick a sales agent above.
                  </p>
                </div>
              ) : null}
              {editing && form.salesAgentId && agentTakenElsewhere.has(form.salesAgentId) ? (
                <p className="text-muted-foreground text-xs">
                  Saving will move this agent from{" "}
                  <span className="text-foreground font-medium">{agentTakenElsewhere.get(form.salesAgentId)}</span> to
                  this location.
                </p>
              ) : null}
              {editing ? (
                <p className="text-muted-foreground text-xs">
                  Pick a different sales agent anytime, or remove the assignment and save.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-payout">Hostel manager payout number</Label>
              <Input
                id="loc-payout"
                inputMode="tel"
                autoComplete="tel"
                placeholder="e.g. 0241234567"
                value={form.managerPayoutNumber}
                onChange={(e) => setForm((f) => ({ ...f, managerPayoutNumber: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">
                MoMo / phone number used when paying the hostel manager for this location.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loc-total">Total sales (count)</Label>
              <Input
                id="loc-total"
                inputMode="numeric"
                value={form.totalSales}
                onChange={(e) => setForm((f) => ({ ...f, totalSales: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={!isAdmin || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
