import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { FileUp, Trash2, Upload } from "lucide-react"
import { useAuth } from "@/context/AuthContext.jsx"
import { useCatalog } from "@/hooks/useCatalog.js"
import { PageHeader } from "@/components/shared/PageHeader.jsx"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { importVouchersBatch } from "@/lib/api.js"
import { parseCsv } from "@/lib/parseCsv.js"
import { isHiddenVoucherThroughputColumnKey } from "@/lib/voucherColumnDisplay.js"
import { ROLE_ADMIN } from "@/lib/roles.js"
import { cn } from "@/lib/utils"

/**
 * @typedef {object} StagedUpload
 * @property {string} id
 * @property {string} name
 * @property {number} size
 * @property {string} type
 * @property {string} addedAt
 * @property {"csv" | "other"} kind
 * @property {string[][] | null} matrix
 * @property {string | null} parseError
 * @property {"idle" | "loading" | "success" | "error"} [importState]
 * @property {string} [importMessage]
 */

const ACCEPT = ".pdf,.csv,.png,.jpg,.jpeg,.webp,.xlsx,.xls"

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** @param {File} file */
function isCsvFile(file) {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".csv")) return true
  const t = (file.type || "").toLowerCase()
  return t === "text/csv" || t === "application/csv"
}

/**
 * @param {File} file
 * @returns {Promise<StagedUpload>}
 */
async function stagedUploadFromFile(file) {
  const base = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    size: file.size,
    type: file.type || "—",
    addedAt: new Date().toISOString(),
    kind: /** @type {"csv" | "other"} */ (isCsvFile(file) ? "csv" : "other"),
    matrix: null,
    parseError: null,
    importState: "idle",
    importMessage: "",
  }

  if (base.kind !== "csv") return base

  try {
    const text = await file.text()
    const matrix = parseCsv(text)
    return { ...base, matrix }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this file"
    return { ...base, parseError: message }
  }
}

function CsvPreviewTable({ matrix }) {
  if (!matrix.length) {
    return <p className="text-muted-foreground px-3 py-4 text-center text-sm">This CSV has no rows.</p>
  }

  const rawHeader = matrix[0]
  const omit = new Set()
  for (let i = 0; i < rawHeader.length; i++) {
    if (isHiddenVoucherThroughputColumnKey(String(rawHeader[i] ?? ""))) omit.add(i)
  }
  const header = rawHeader.filter((_, i) => !omit.has(i))

  /** @param {string[]} line */
  function visibleCells(line) {
    const out = []
    for (let i = 0; i < rawHeader.length; i++) {
      if (omit.has(i)) continue
      out.push(i < line.length ? line[i] : "")
    }
    return out
  }

  const body = matrix.slice(1).map((line) => visibleCells(line))
  const colSpan = Math.max(header.length, 1)

  return (
    <div className="max-h-[min(70vh,520px)] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {header.map((cell, i) => (
              <TableHead key={i} className="whitespace-nowrap font-semibold">
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {body.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-muted-foreground text-center text-sm">
                No data rows after the header row.
              </TableCell>
            </TableRow>
          ) : (
            body.map((line, ri) => (
              <TableRow key={ri}>
                {line.map((cell, ci) => (
                  <TableCell key={ci} className="max-w-[280px] truncate whitespace-nowrap">
                    <span className="inline-block max-w-[min(280px,40vw)] truncate align-top" title={cell}>
                      {cell}
                    </span>
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export default function Vouchers() {
  const inputId = React.useId()
  const inputRef = React.useRef(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useCatalog()
  const { token, user, authReady } = useAuth()
  /** @type {React.MutableRefObject<boolean>} */
  const cancelledRef = React.useRef(false)
  const [rows, setRows] = React.useState([])
  const [dragOver, setDragOver] = React.useState(false)
  const [parsing, setParsing] = React.useState(false)
  const [selectedLocationId, setSelectedLocationId] = React.useState("")
  const [selectedPackageId, setSelectedPackageId] = React.useState("")
  const [singleVoucherId, setSingleVoucherId] = React.useState("")
  const [singleSaving, setSingleSaving] = React.useState(false)
  const [singleFeedback, setSingleFeedback] = React.useState(/** @type {{ kind: "success" | "error"; text: string } | null} */ (null))
  const isAdmin = user?.role === ROLE_ADMIN

  const locations = React.useMemo(() => {
    const list = catalog.data?.locations ?? []
    return [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
  }, [catalog.data?.locations])

  const activePackages = React.useMemo(() => {
    const list = catalog.data?.packages ?? []
    return list
      .filter((p) => p.status === "Active")
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
  }, [catalog.data?.packages])

  const locationReady = Boolean(selectedLocationId.trim())
  const packageReady = Boolean(selectedPackageId.trim())
  const assignReady = locationReady && packageReady

  React.useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const addFiles = React.useCallback(async (fileList) => {
    const list = fileList ? Array.from(fileList) : []
    if (!list.length) return
    setParsing(true)
    try {
      const newRows = await Promise.all(list.map((f) => stagedUploadFromFile(f)))
      if (!cancelledRef.current) {
        setRows((prev) => [...newRows, ...prev])
      }
    } finally {
      if (!cancelledRef.current) setParsing(false)
    }
  }, [])

  const onInputChange = (e) => {
    void addFiles(e.target.files)
    e.target.value = ""
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    void addFiles(e.dataTransfer.files)
  }

  const removeRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  const importCsv = React.useCallback(
    async (/** @type {StagedUpload} */ upload) => {
      if (!token || upload.kind !== "csv" || !upload.matrix?.length || upload.parseError) return
      if (upload.matrix.length < 2) return
      const locId = selectedLocationId.trim()
      const pkgId = selectedPackageId.trim()
      if (!locId || !pkgId) return

      setRows((prev) =>
        prev.map((x) => (x.id === upload.id ? { ...x, importState: "loading", importMessage: "" } : x)),
      )

      const out = await importVouchersBatch(token, {
        fileName: upload.name,
        rows: upload.matrix,
        locationId: locId,
        packageId: pkgId,
      })

      setRows((prev) =>
        prev.map((x) => {
          if (x.id !== upload.id) return x
          if (!out.ok) return { ...x, importState: "error", importMessage: out.error }
          return {
            ...x,
            importState: "success",
            importMessage: `Saved ${out.inserted} new voucher(s) for this package. Skipped ${out.skippedAlreadyInDb} already on this package, ${out.skippedDuplicateInFile} duplicate in file, ${out.skippedNoId} row(s) without id (batch ${out.batchId}). Other packages are unchanged.`,
          }
        }),
      )

      if (out.ok) {
        await queryClient.invalidateQueries({ queryKey: ["auditLogs", token] })
        await queryClient.invalidateQueries({ queryKey: ["vouchers", token] })
        navigate("/vouchers/uploaded")
      }
    },
    [token, queryClient, navigate, selectedLocationId, selectedPackageId],
  )

  const saveSingleVoucher = React.useCallback(async () => {
    if (!token || !isAdmin) return
    const locId = selectedLocationId.trim()
    const pkgId = selectedPackageId.trim()
    if (!locId) {
      setSingleFeedback({ kind: "error", text: "Select a location first." })
      return
    }
    if (!pkgId) {
      setSingleFeedback({ kind: "error", text: "Select a package first." })
      return
    }
    const id = singleVoucherId.trim()
    if (!id) {
      setSingleFeedback({ kind: "error", text: "Enter a voucher ID." })
      return
    }
    if (id.length > 128) {
      setSingleFeedback({ kind: "error", text: "Voucher ID must be at most 128 characters." })
      return
    }
    setSingleSaving(true)
    setSingleFeedback(null)
    try {
      const out = await importVouchersBatch(token, {
        fileName: `single-voucher-${Date.now()}.csv`,
        rows: [["Voucher ID"], [id]],
        locationId: locId,
        packageId: pkgId,
      })
      if (!out.ok) {
        setSingleFeedback({ kind: "error", text: out.error })
        return
      }
      setSingleVoucherId("")
      setSingleFeedback({
        kind: "success",
        text: `Saved ${out.inserted} new voucher(s) for this package. Skipped ${out.skippedAlreadyInDb} already on this package, ${out.skippedDuplicateInFile} duplicate in file, ${out.skippedNoId} without id (batch ${out.batchId}).`,
      })
      await queryClient.invalidateQueries({ queryKey: ["auditLogs", token] })
      await queryClient.invalidateQueries({ queryKey: ["vouchers", token] })
    } catch (e) {
      setSingleFeedback({
        kind: "error",
        text: e instanceof Error ? e.message : "Request failed.",
      })
    } finally {
      setSingleSaving(false)
    }
  }, [token, isAdmin, selectedLocationId, selectedPackageId, singleVoucherId, queryClient])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload vouchers"
        description="Choose a location and an active package, then add one voucher by ID or import a CSV in bulk (admin). PDF and images are not sent to the server yet."
      />

      <Card className="border-border bg-card shadow-none ring-1 ring-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold tracking-tight">Assign & import</CardTitle>
          <CardDescription>
            Every import is tied to a <strong>location</strong> and an <strong>active package</strong>. Use{" "}
            <strong>Single voucher</strong> for one ID or <strong>Bulk (CSV)</strong> for many rows. Open{" "}
            <strong>Vouchers</strong> in the sidebar to review saved rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              {catalog.isLoading ? (
                <span>Loading catalog…</span>
              ) : (
                <span>Pick a location and package before importing.</span>
              )}
            </p>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" asChild>
              <Link to="/vouchers/uploaded">View uploaded vouchers</Link>
            </Button>
          </div>

          {catalog.isError ? (
            <p className="text-destructive text-sm" role="alert">
              {catalog.error instanceof Error ? catalog.error.message : "Could not load locations."}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="voucher-assign-location" className="text-muted-foreground text-xs font-medium">
              Location
            </Label>
            <Select
              value={selectedLocationId || undefined}
              onValueChange={(v) => setSelectedLocationId(v)}
              disabled={!authReady || !token || !isAdmin || catalog.isLoading || locations.length === 0}
            >
              <SelectTrigger id="voucher-assign-location" className="h-9 w-full max-w-md">
                <SelectValue placeholder={locations.length === 0 ? "No locations yet" : "Select location…"} />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!catalog.isLoading && locations.length === 0 && isAdmin ? (
              <p className="text-muted-foreground text-xs">
                Create a location under <strong>Locations</strong> before importing vouchers.
              </p>
            ) : null}
            {authReady && !isAdmin ? (
              <p className="text-muted-foreground text-xs">Only administrators can import vouchers.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="voucher-assign-package" className="text-muted-foreground text-xs font-medium">
              Package
            </Label>
            <Select
              value={selectedPackageId || undefined}
              onValueChange={(v) => setSelectedPackageId(v)}
              disabled={!authReady || !token || !isAdmin || catalog.isLoading || activePackages.length === 0}
            >
              <SelectTrigger id="voucher-assign-package" className="h-9 w-full max-w-md">
                <SelectValue placeholder={activePackages.length === 0 ? "No active packages" : "Select package…"} />
              </SelectTrigger>
              <SelectContent>
                {activePackages.map((pkg) => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.name}
                    {pkg.dataLimit ? ` · ${pkg.dataLimit}` : ""}
                    {typeof pkg.priceGHS === "number" ? ` · GH₵ ${pkg.priceGHS}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!catalog.isLoading && activePackages.length === 0 && isAdmin ? (
              <p className="text-muted-foreground text-xs">
                Add an <strong>Active</strong> package under <strong>Packages</strong> before importing vouchers.
              </p>
            ) : null}
          </div>

          <Tabs defaultValue="bulk" className="w-full min-w-0">
            <TabsList className="grid h-9 w-full max-w-md grid-cols-2">
              <TabsTrigger value="single">Single voucher</TabsTrigger>
              <TabsTrigger value="bulk">Bulk (CSV)</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="single-voucher-id">Voucher ID</Label>
                <Input
                  id="single-voucher-id"
                  placeholder="e.g. 18645924131"
                  value={singleVoucherId}
                  onChange={(e) => setSingleVoucherId(e.target.value)}
                  maxLength={128}
                  autoComplete="off"
                  className="max-w-md"
                  disabled={!authReady || !token || !isAdmin}
                />
                <p className="text-muted-foreground text-xs">Saves one voucher with only the ID column (same rules as CSV import).</p>
              </div>
              {singleFeedback ? (
                <p
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    singleFeedback.kind === "error"
                      ? "text-destructive border-destructive/30 bg-destructive/5"
                      : "text-muted-foreground border-border bg-muted/30",
                  )}
                  role={singleFeedback.kind === "error" ? "alert" : "status"}
                >
                  {singleFeedback.text}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={
                  !authReady ||
                  !token ||
                  !isAdmin ||
                  !assignReady ||
                  singleSaving ||
                  locations.length === 0 ||
                  activePackages.length === 0 ||
                  !singleVoucherId.trim()
                }
                onClick={() => void saveSingleVoucher()}
              >
                {singleSaving ? "Saving…" : "Save to server"}
              </Button>
            </TabsContent>

            <TabsContent value="bulk" className="mt-4 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {parsing ? <span>Reading files…</span> : <span>Staged files appear below.</span>}
                </p>
              </div>

              {rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No files staged yet. Use <strong>Choose files</strong> or the drop zone below.
                </p>
              ) : (
                <div className="space-y-4">
                  {rows.map((r) => (
                    <div key={r.id} className="border-border overflow-hidden rounded-lg border">
                      <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{r.name}</p>
                          <p className="text-muted-foreground text-xs tabular-nums">
                            {formatBytes(r.size)}
                            <span className="mx-1.5">·</span>
                            {r.addedAt.slice(0, 19).replace("T", " ")}
                            {r.kind === "other" ? (
                              <>
                                <span className="mx-1.5">·</span>
                                {r.type}
                              </>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {r.kind === "csv" && !r.parseError && r.matrix && r.matrix.length >= 2 ? (
                            <Button
                              type="button"
                              size="sm"
                              className="h-8"
                              disabled={
                                !authReady ||
                                !token ||
                                !isAdmin ||
                                r.importState === "loading" ||
                                !assignReady ||
                                locations.length === 0 ||
                                activePackages.length === 0
                              }
                              onClick={() => void importCsv(r)}
                              title={
                                !assignReady ? "Select a location and package first" : undefined
                              }
                            >
                              {r.importState === "loading" ? "Importing…" : "Import to server"}
                            </Button>
                          ) : null}
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
                        </div>
                      </div>

                      {authReady && !isAdmin ? (
                        <p className="text-muted-foreground border-b border-border px-3 py-2 text-xs">
                          Only administrators can import voucher CSV rows to the database.
                        </p>
                      ) : null}

                      {r.importState === "error" || r.importState === "success" ? (
                        <p
                          className={cn(
                            "border-b border-border px-3 py-2 text-xs",
                            r.importState === "error" ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {r.importMessage}
                        </p>
                      ) : null}

                      {r.kind === "csv" && r.parseError ? (
                        <p className="text-destructive px-3 py-3 text-sm">{r.parseError}</p>
                      ) : null}

                      {r.kind === "csv" && !r.parseError && r.matrix ? <CsvPreviewTable matrix={r.matrix} /> : null}

                      {r.kind === "other" ? (
                        <p className="text-muted-foreground px-3 py-3 text-sm">
                          Table preview is available for <span className="text-foreground font-medium">.csv</span> files. Other formats are not
                          sent to the server yet.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <Separator />

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
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
