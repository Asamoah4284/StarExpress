import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** @param {import("@tanstack/react-table").Header<any, unknown> | undefined} header */
function mobileFieldLabel(header) {
  if (!header || header.isPlaceholder) return null
  return flexRender(header.column.columnDef.header, header.getContext())
}

/**
 * @param {unknown} record
 * @returns {{ title: string, subtitle: string | null, skipIds: Set<string> } | null}
 */
function getMobileHero(record) {
  if (!record || typeof record !== "object") return null
  const r = /** @type {Record<string, unknown>} */ (record)
  const phone =
    typeof r.customerPhone === "string" && r.customerPhone.trim()
      ? r.customerPhone.trim()
      : typeof r.customerName === "string" && r.customerName.trim()
        ? r.customerName.trim()
        : ""
  if (phone) {
    const id = r.id != null ? String(r.id) : null
    return {
      title: phone,
      subtitle: id ? `Sale ID · ${id}` : null,
      skipIds: new Set(["customerName", "customerPhone", "id"]),
    }
  }
  if (typeof r.email === "string" && typeof r.role === "string") {
    const name = typeof r.name === "string" ? r.name.trim() : ""
    if (!name) return null
    const id = r.id != null ? String(r.id) : null
    return {
      title: name,
      subtitle: id ? `User ID · ${id}` : null,
      skipIds: new Set(["name", "id"]),
    }
  }
  if (typeof r.priceGHS === "number" && typeof r.dataLimit === "string") {
    const name = typeof r.name === "string" ? r.name.trim() : ""
    if (!name) return null
    const id = r.id != null ? String(r.id) : null
    return {
      title: name,
      subtitle: id ? `Package ID · ${id}` : null,
      skipIds: new Set(["name", "id"]),
    }
  }
  if (
    typeof r.name === "string" &&
    typeof r.address === "string" &&
    typeof r.manager === "string" &&
    typeof r.totalSales === "number"
  ) {
    const name = r.name.trim()
    if (!name) return null
    const addr = r.address.trim()
    const id = r.id != null ? String(r.id) : null
    return {
      title: name,
      subtitle: addr || (id ? `Location ID · ${id}` : null),
      skipIds: new Set(["name", "address", "id"]),
    }
  }
  return null
}

export function DataTable({
  data,
  columns,
  searchPlaceholder = "Search…",
  globalFilter: controlledFilter,
  onGlobalFilterChange,
  pageSize = 10,
  /** @type {import("@tanstack/react-table").SortingState | undefined} */
  initialSorting,
  className,
  /** When true, columns respect width constraints and long text wraps instead of overlapping. */
  fixedLayout = false,
  /**
   * When true, filtering runs only when the user clicks Search or presses Enter.
   * Default false — filter updates as the user types.
   */
  searchOnButton = false,
}) {
  const [internalFilter, setInternalFilter] = React.useState("")
  const [searchDraft, setSearchDraft] = React.useState("")
  const globalFilter = controlledFilter ?? internalFilter
  const setGlobalFilter = onGlobalFilterChange ?? setInternalFilter

  React.useEffect(() => {
    if (controlledFilter !== undefined) setSearchDraft(controlledFilter)
  }, [controlledFilter])

  // TanStack Table returns unstable function references; React Compiler skips memoization here.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: "includesString",
    initialState: { pagination: { pageSize }, sorting: initialSorting ?? [] },
  })

  const applySearch = React.useCallback(() => {
    const query = searchDraft.trim()
    setGlobalFilter(query)
    table.setPageIndex(0)
  }, [searchDraft, setGlobalFilter, table])

  const clearSearch = React.useCallback(() => {
    setSearchDraft("")
    setGlobalFilter("")
    table.setPageIndex(0)
  }, [setGlobalFilter, table])

  const handleSearchInputChange = (/** @type {React.ChangeEvent<HTMLInputElement>} */ e) => {
    const value = e.target.value
    setSearchDraft(value)
    if (!searchOnButton) {
      setGlobalFilter(value)
      table.setPageIndex(0)
    }
  }

  const handleSearchKeyDown = (/** @type {React.KeyboardEvent<HTMLInputElement>} */ e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      applySearch()
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder={searchPlaceholder}
            value={searchOnButton ? searchDraft : globalFilter}
            onChange={handleSearchInputChange}
            onKeyDown={searchOnButton ? handleSearchKeyDown : undefined}
            className="border-border bg-card flex-1 shadow-none"
            aria-label="Search table"
          />
          {searchOnButton ? (
            <>
              <Button type="button" className="shrink-0" onClick={applySearch}>
                Search
              </Button>
              {globalFilter ? (
                <Button type="button" variant="outline" className="shrink-0" onClick={clearSearch}>
                  Clear
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">
          {table.getFilteredRowModel().rows.length} row(s)
        </p>
      </div>
      {/* Desktop: table */}
      <ScrollArea className="hidden w-full rounded-lg border border-border bg-card shadow-none md:block">
        <Table className={cn(fixedLayout && "table-fixed min-w-[52rem]")}>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "whitespace-nowrap",
                      /** @type {{ headerClassName?: string } | undefined} */ (header.column.columnDef.meta)?.headerClassName,
                    )}
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1 font-semibold",
                          header.column.getCanSort() && "cursor-pointer select-none hover:text-primary",
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : null}
                      </button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "align-middle",
                        /** @type {{ cellClassName?: string, wrap?: boolean } | undefined} */ (
                          cell.column.columnDef.meta
                        )?.wrap === false
                          ? "whitespace-nowrap"
                          : "whitespace-normal",
                        /** @type {{ cellClassName?: string } | undefined} */ (cell.column.columnDef.meta)?.cellClassName,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Mobile: card rows — header + left/right fields (no <table>) */}
      <div className="space-y-3 md:hidden" role="list" aria-label="Results">
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => {
            const headerRow = table.getHeaderGroups()[0]
            const hero = getMobileHero(row.original)
            return (
              <div
                key={row.id}
                role="listitem"
                className="border-border bg-card overflow-hidden rounded-lg border shadow-none"
              >
                {hero ? (
                  <div className="border-border/80 bg-muted/15 border-b px-4 py-3">
                    <p className="text-foreground text-base font-semibold leading-snug tracking-tight">{hero.title}</p>
                    {hero.subtitle ? (
                      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed font-normal break-words">
                        {hero.subtitle}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="divide-border/60 divide-y px-4 py-1">
                  {row.getVisibleCells().map((cell) => {
                    if (hero?.skipIds.has(cell.column.id)) return null
                    const header = headerRow?.headers.find((h) => h.column.id === cell.column.id)
                    const label = mobileFieldLabel(header) ?? cell.column.id
                    return (
                      <div
                        key={cell.id}
                        className="flex items-start justify-between gap-4 py-2.5 first:pt-2 last:pb-2"
                      >
                        <span className="text-muted-foreground shrink-0 text-xs font-medium tracking-wide uppercase">
                          {label}
                        </span>
                        <span className="text-foreground max-w-[58%] min-w-0 text-right text-sm font-medium leading-snug break-words">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        ) : (
          <div className="text-muted-foreground border-border bg-card rounded-lg border py-10 text-center text-sm">
            No results.
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="First page"
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border bg-card shadow-none"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Last page"
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
