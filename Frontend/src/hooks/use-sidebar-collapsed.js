import * as React from "react"

const STORAGE_KEY = "starexpress-sidebar-collapsed"

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1"
    } catch {
      return false
    }
  })

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return { collapsed, toggle }
}
