import * as React from "react"
import { users as seedUsers } from "@/data/users.js"
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

let uid = 50

export default function Users() {
  const [rows, setRows] = React.useState(() => seedUsers.map((u) => ({ ...u })))
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState({ name: "", email: "", role: "Sales Agent" })

  const deactivate = React.useCallback((id) => {
    setRows((prev) => prev.map((u) => (u.id === id ? { ...u, active: false } : u)))
  }, [])

  const addUser = () => {
    if (!form.name.trim() || !form.email.trim()) return
    uid += 1
    setRows((prev) => [
      ...prev,
      { id: `u${uid}`, name: form.name.trim(), email: form.email.trim(), role: form.role, active: true },
    ])
    setOpen(false)
    setForm({ name: "", email: "", role: "Sales Agent" })
  }

  const columns = React.useMemo(
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
              disabled={!row.original.active}
              onClick={() => deactivate(row.original.id)}
            >
              Deactivate
            </Button>
          </div>
        ),
      },
    ],
    [deactivate],
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Admin and sales agent accounts (mock).">
        <Button type="button" onClick={() => setOpen(true)}>
          Add user
        </Button>
      </PageHeader>

      <DataTable data={rows} columns={columns} searchPlaceholder="Search name, email, role…" pageSize={8} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={addUser}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
