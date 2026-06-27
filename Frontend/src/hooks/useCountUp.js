import * as React from "react"

/**
 * Animate a number from its previous value to `target` (ease-out cubic).
 * @param {number} target
 * @param {{ duration?: number, enabled?: boolean, scopeKey?: string | number, bumpKey?: string | number }} [options]
 */
export function useCountUp(target, options = {}) {
  const { duration = 900, enabled = true, scopeKey = "", bumpKey = 0 } = options
  const safeTarget = Number.isFinite(Number(target)) ? Math.round(Number(target)) : 0
  const [display, setDisplay] = React.useState(0)
  const fromRef = React.useRef(0)
  const scopeRef = React.useRef(scopeKey)

  React.useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      fromRef.current = 0
      scopeRef.current = scopeKey
    }
  }, [scopeKey])

  React.useEffect(() => {
    if (!enabled) {
      setDisplay(safeTarget)
      fromRef.current = safeTarget
      return
    }

    const from = fromRef.current
    const to = safeTarget
    if (from === to) {
      setDisplay(to)
      return
    }

    const start = performance.now()
    let raf = 0

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const next = Math.round(from + (to - from) * eased)
      setDisplay(next)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        setDisplay(to)
        fromRef.current = to
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [safeTarget, duration, enabled, scopeKey, bumpKey])

  return display
}

/**
 * Animate a percentage from 0 (or previous) to `target` for progress bars.
 * @param {number} targetPct 0–100
 * @param {{ duration?: number, enabled?: boolean, scopeKey?: string | number, bumpKey?: string | number }} [options]
 */
export function useCountUpPercent(targetPct, options = {}) {
  const { duration = 1100, enabled = true, scopeKey = "", bumpKey = 0 } = options
  const safeTarget = Number.isFinite(Number(targetPct)) ? Math.max(0, Math.min(100, Number(targetPct))) : 0
  const [display, setDisplay] = React.useState(0)
  const fromRef = React.useRef(0)
  const scopeRef = React.useRef(scopeKey)

  React.useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      fromRef.current = 0
      scopeRef.current = scopeKey
    }
  }, [scopeKey])

  React.useEffect(() => {
    if (!enabled) {
      setDisplay(safeTarget)
      fromRef.current = safeTarget
      return
    }

    const from = fromRef.current
    const to = safeTarget
    const start = performance.now()
    let raf = 0

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const next = from + (to - from) * eased
      setDisplay(next)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        setDisplay(to)
        fromRef.current = to
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [safeTarget, duration, enabled, scopeKey, bumpKey])

  return display
}

/**
 * Animate a decimal amount (e.g. currency totals).
 * @param {number} target
 * @param {{ duration?: number, enabled?: boolean, scopeKey?: string | number, bumpKey?: string | number }} [options]
 */
export function useCountUpFloat(target, options = {}) {
  const { duration = 1000, enabled = true, scopeKey = "", bumpKey = 0 } = options
  const safeTarget = Number.isFinite(Number(target)) ? Math.round(Number(target) * 100) / 100 : 0
  const [display, setDisplay] = React.useState(0)
  const fromRef = React.useRef(0)
  const scopeRef = React.useRef(scopeKey)

  React.useEffect(() => {
    if (scopeRef.current !== scopeKey) {
      fromRef.current = 0
      scopeRef.current = scopeKey
    }
  }, [scopeKey])

  React.useEffect(() => {
    if (!enabled) {
      setDisplay(safeTarget)
      fromRef.current = safeTarget
      return
    }

    const from = fromRef.current
    const to = safeTarget
    if (from === to) {
      setDisplay(to)
      return
    }

    const start = performance.now()
    let raf = 0

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const next = Math.round((from + (to - from) * eased) * 100) / 100
      setDisplay(next)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        setDisplay(to)
        fromRef.current = to
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [safeTarget, duration, enabled, scopeKey, bumpKey])

  return display
}
