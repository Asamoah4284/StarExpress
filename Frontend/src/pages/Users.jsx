import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { DataTable } from "@/components/shared/DataTable.jsx"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { createTeamUser, fetchUsersList, setTeamUserActive, updateTeamUser } from "@/lib/api.js"

const NONE_LOCATION = "__none__"

const emptyForm = () => ({
  name: "",
  email: "",
  role: "Sales Agent",
  password: "",
  locationId: "",
})

/**
 * @param {{
 *   onEdit: (row: { id: string, name: string, email: string, role: string, active: boolean, locationId?: string, locationName?: string }) => void
 *   onDeactivate: (id: string) => void
 *   pendingId: string | null
 *   canManageUsers: boolean
 * }} props
 */
function useUserColumns({ onEdit, onDeactivate, pendingId, canManageUsers }) {
  return React.useMemo(
    () => [
      { accessorKey: "name", header: "Name" },
      { accessorKey: "email", header: "Email" },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ getValue }) => {
          const v = getValue()
          return <Badge variant={v === "Admin" ? "default" : "secondary"}>{v}</Badge>
        },
      },
      {
        accessorKey: "locationName",
        header: "Location",
        cell: ({ row }) => {
          if (row.original.role !== "Sales Agent") return <span className="text-muted-foreground">—</span>
          const name = String(row.original.locationName || "").trim()
          return name || <span className="text-muted-foreground">Unassigned</span>
        },
      },
      {
        accessorKey: "active",
        header: "Status",
        cell: ({ getValue }) => {
          const active = getValue()
          return <Badge variant={active ? "outline" : "destructive"}>{active ? "Active" : "Inactive"}</Badge>
        },
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
              disabled={!canManageUsers || pendingId === row.original.id}
              onClick={() => onEdit(row.original)}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canManageUsers || !row.original.active || pendingId === row.original.id}
              onClick={() => onDeactivate(row.original.id)}
            >
              Deactivate
            </Button>
          </div>
        ),
      },
    ],
    [onEdit, onDeactivate, pendingId, canManageUsers],
  )
}

export default function Users() {
  const { token, authReady, user } = useAuth()
  const queryClient = useQueryClient()
  const catalog = useCatalog()
  const locations = catalog.data?.locations ?? []
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(/** @type {{ id: string } | null} */ (null))
  const [form, setForm] = React.useState(emptyForm)
  const [formError, setFormError] = React.useState(null)

  const usersQuery = useQuery({
    queryKey: ["teamUsers", token],
    queryFn: async () => {
      if (!token) throw new Error("Not signed in")
      const result = await fetchUsersList(token)
      if (!result.ok) throw new Error(result.error || "Failed to load users")
      return result.users
    },
    enabled: authReady && Boolean(token),
  })

  const deactivateMutation = useMutation({
    mutationFn: async (id) => {
      if (!token) throw new Error("Not signed in")
      const r = await setTeamUserActive(token, id, false)
      if (!r.ok) throw new Error(r.error || "Failed to deactivate")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamUsers"] })
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        locationId: form.role === "Sales Agent" ? form.locationId : "",
      }
      if (editing) {
        const r = await updateTeamUser(token, editing.id, {
          ...payload,
          ...(form.password ? { password: form.password } : {}),
        })
        if (!r.ok) throw new Error(r.error || "Failed to update user")
        return
      }
      const r = await createTeamUser(token, {
        ...payload,
        password: form.password,
      })
      if (!r.ok) {
        if ("code" in r && r.code === "exists") throw new Error("That email is already registered.")
        throw new Error("error" in r ? r.error : "Failed to create user")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamUsers"] })
      queryClient.invalidateQueries({ queryKey: ["catalog"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setOpen(false)
      setEditing(null)
      setForm(emptyForm())
      setFormError(null)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Something went wrong")
    },
  })

  const onDeactivate = React.useCallback(
    (id) => {
      deactivateMutation.mutate(id)
    },
    [deactivateMutation],
  )

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm())
    setFormError(null)
    setOpen(true)
  }

  const openEdit = React.useCallback((row) => {
    setEditing({ id: row.id })
    setForm({
      name: row.name,
      email: row.email,
      role: row.role === "Admin" ? "Admin" : "Sales Agent",
      password: "",
      locationId: row.locationId || "",
    })
    setFormError(null)
    setOpen(true)
  }, [])

  const saveUser = () => {
    setFormError(null)
    if (form.name.trim().length < 2) {
      setFormError("Name must be at least 2 characters.")
      return
    }
    if (!form.email.trim()) {
      setFormError("Email is required.")
      return
    }
    if (!editing && form.password.length < 6) {
      setFormError("Password must be at least 6 characters.")
      return
    }
    if (editing && form.password && form.password.length < 6) {
      setFormError("New password must be at least 6 characters.")
      return
    }
    saveMutation.mutate()
  }

  const rows = usersQuery.data ?? []
  const isAdmin = user?.role === "Admin"

  const columns = useUserColumns({
    onEdit: openEdit,
    onDeactivate,
    pendingId: deactivateMutation.isPending ? deactivateMutation.variables ?? null : null,
    canManageUsers: isAdmin,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Add team accounts, edit details, and assign sales agents to a wifi location."
      >
        <Button type="button" onClick={openAdd} disabled={!isAdmin}>
          Add user
        </Button>
      </PageHeader>

      {authReady && !token ? (
        <p className="text-muted-foreground text-sm">Sign in to load users.</p>
      ) : null}
      {usersQuery.isLoading ? <p className="text-muted-foreground text-sm">Loading users…</p> : null}
      {usersQuery.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {usersQuery.error instanceof Error ? usersQuery.error.message : "Failed to load users"}
        </p>
      ) : null}
      {deactivateMutation.error ? (
        <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm" role="alert">
          {deactivateMutation.error instanceof Error ? deactivateMutation.error.message : "Action failed"}
        </p>
      ) : null}

      <DataTable data={rows} columns={columns} searchPlaceholder="Search name, email, role, location…" pageSize={8} />

      <UserFormDialog
        open={open}
        editing={Boolean(editing)}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setFormError(null)
            setEditing(null)
            setForm(emptyForm())
          }
        }}
        form={form}
        setForm={setForm}
        locations={locations}
        onSave={saveUser}
        formError={formError}
        saving={saveMutation.isPending}
        saveDisabled={!isAdmin}
      />
    </div>
  )
}

/**
 * @param {{
 *   open: boolean
 *   editing: boolean
 *   onOpenChange: (open: boolean) => void
 *   form: { name: string, email: string, role: string, password: string, locationId: string }
 *   setForm: React.Dispatch<React.SetStateAction<{ name: string, email: string, role: string, password: string, locationId: string }>>
 *   locations: { id: string, name: string }[]
 *   onSave: () => void
 *   formError?: string | null
 *   saving?: boolean
 *   saveDisabled?: boolean
 * }} props
 */
function UserFormDialog({
  open,
  editing,
  onOpenChange,
  form,
  setForm,
  locations,
  onSave,
  formError,
  saving,
  saveDisabled,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {formError ? (
            <p className="text-destructive bg-destructive/10 rounded-md px-2 py-1.5 text-sm" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input id="user-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) =>
                setForm((f) => ({
                  ...f,
                  role: v,
                  locationId: v === "Sales Agent" ? f.locationId : "",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Sales Agent">Sales Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.role === "Sales Agent" ? (
            <div className="space-y-1.5">
              <Label>Assigned location</Label>
              <Select
                value={form.locationId || NONE_LOCATION}
                onValueChange={(v) => setForm((f) => ({ ...f, locationId: v === NONE_LOCATION ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_LOCATION}>Unassigned</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Sales agents only see stock and sales for this location.
              </p>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="user-password">{editing ? "New password (optional)" : "Temporary password"}</Label>
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={editing ? "Leave blank to keep the current password" : "At least 6 characters"}
            />
            <p className="text-muted-foreground text-xs">
              {editing ? "Only fill this if you want to reset their password." : "Share this with the new user."}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={saveDisabled || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
