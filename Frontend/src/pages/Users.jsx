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
import { createTeamUser, fetchUsersList, setTeamUserActive } from "@/lib/api.js"

/** @param {{ onDeactivate: (id: string) => void, pendingId: string | null, canManageUsers: boolean }} props */
function useUserColumns({ onDeactivate, pendingId, canManageUsers }) {
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
              disabled={!canManageUsers || !row.original.active || pendingId === row.original.id}
              onClick={() => onDeactivate(row.original.id)}
            >
              Deactivate
            </Button>
          </div>
        ),
      },
    ],
    [onDeactivate, pendingId, canManageUsers],
  )
}

export default function Users() {
  const { token, authReady, user } = useAuth()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", email: "", role: "Sales Agent", password: "" })
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
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not signed in")
      const r = await createTeamUser(token, {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
      })
      if (!r.ok) {
        if ("code" in r && r.code === "exists") throw new Error("That email is already registered.")
        throw new Error("error" in r ? r.error : "Failed to create user")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamUsers"] })
      queryClient.invalidateQueries({ queryKey: ["auditLogs"] })
      setOpen(false)
      setForm({ name: "", email: "", role: "Sales Agent", password: "" })
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
    if (form.password.length < 6) {
      setFormError("Password must be at least 6 characters.")
      return
    }
    createMutation.mutate()
  }

  const rows = usersQuery.data ?? []
  const isAdmin = user?.role === "Admin"

  const columns = useUserColumns({
    onDeactivate,
    pendingId: deactivateMutation.isPending ? deactivateMutation.variables ?? null : null,
    canManageUsers: isAdmin,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Team accounts from the API. Add and deactivate users: Admin only."
      >
        <Button type="button" onClick={() => setOpen(true)} disabled={!isAdmin}>
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

      <DataTable data={rows} columns={columns} searchPlaceholder="Search name, email, role…" pageSize={8} />

      <UserAddDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setFormError(null)
            setForm({ name: "", email: "", role: "Sales Agent", password: "" })
          }
        }}
        form={form}
        setForm={setForm}
        onSave={saveUser}
        formError={formError}
        saving={createMutation.isPending}
        saveDisabled={!isAdmin}
      />
    </div>
  )
}

/**
 * @param {{
 *   open: boolean
 *   onOpenChange: (open: boolean) => void
 *   form: { name: string, email: string, role: string, password: string }
 *   setForm: React.Dispatch<React.SetStateAction<{ name: string, email: string, role: string, password: string }>>
 *   onSave: () => void
 *   formError?: string | null
 *   saving?: boolean
 *   saveDisabled?: boolean
 * }} props
 */
function UserAddDialog({ open, onOpenChange, form, setForm, onSave, formError, saving, saveDisabled }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
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
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Sales Agent">Sales Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-password">Temporary password</Label>
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="At least 6 characters"
            />
            <p className="text-muted-foreground text-xs">Share this with the new user.</p>
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
