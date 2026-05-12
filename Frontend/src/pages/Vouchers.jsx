import * as React from "react"
import { FileUp, Trash2, Upload } from "lucide-react"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const ACCEPT = ".pdf,.csv,.png,.jpg,.jpeg,.webp,.xlsx,.xls"

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** @param {File} file */
function rowFromFile(file) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    size: file.size,
    type: file.type || "—",
    addedAt: new Date().toISOString(),
  }
}

export default function Vouchers() {
  const inputId = React.useId()
  const inputRef = React.useRef(null)
  const [rows, setRows] = React.useState([])
  const [dragOver, setDragOver] = React.useState(false)

  const addFiles = React.useCallback((fileList) => {
    const list = fileList ? Array.from(fileList) : []
    if (!list.length) return
    setRows((prev) => [...list.map(rowFromFile), ...prev])
  }, [])

  const onInputChange = (e) => {
    addFiles(e.target.files)
    e.target.value = ""
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  const removeRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vouchers"
        description="Upload voucher batches (PDF, images, CSV, or spreadsheets). Files stay in this browser session only until a backend is connected."
      />

      <Card className="border-border bg-card shadow-none ring-1 ring-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold tracking-tight">Upload vouchers</CardTitle>
          <CardDescription>
            Drag files here or choose from your device. Multiple files are supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/35 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 transition-colors",
              dragOver && "border-primary bg-primary/5",
            )}
          >
            <div className="bg-primary/10 text-primary mb-3 flex size-12 items-center justify-center rounded-full">
              <Upload className="size-6 stroke-[1.5]" aria-hidden />
            </div>
            <p className="text-foreground text-sm font-medium">Drop files to upload</p>
            <p className="text-muted-foreground mt-1 text-center text-xs">or click to browse · {ACCEPT.replaceAll(",", ", ")}</p>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              multiple
              accept={ACCEPT}
              className="sr-only"
              onChange={onInputChange}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="gap-2 border-border shadow-none" onClick={() => inputRef.current?.click()}>
              <FileUp className="size-4 stroke-[1.5]" aria-hidden />
              Choose files
            </Button>
            <Label htmlFor={inputId} className="sr-only">
              Voucher files
            </Label>
          </div>

          <Separator />

          <div>
            <h2 className="text-foreground mb-3 text-sm font-semibold tracking-tight">Staged uploads</h2>
            {rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No files yet. Uploads will appear here.</p>
            ) : (
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="hidden md:table-cell">Added</TableHead>
                      <TableHead className="w-[72px] text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="max-w-[200px] truncate font-medium">{r.name}</TableCell>
                        <TableCell className="text-muted-foreground hidden max-w-[140px] truncate text-xs sm:table-cell">
                          {r.type}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBytes(r.size)}</TableCell>
                        <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                          {r.addedAt.slice(0, 19).replace("T", " ")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${r.name}`}
                            onClick={() => removeRow(r.id)}
                          >
                            <Trash2 className="size-4 stroke-[1.5]" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
