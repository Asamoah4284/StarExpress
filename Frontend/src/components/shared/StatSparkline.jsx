import * as React from "react"
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, YAxis } from "recharts"
import { cn } from "@/lib/utils"

/**
 * Minimal in-card trend (no axes): uses `currentColor` from the parent `className`.
 * @param {{ x?: string, y: number }[]} data
 * @param {"area" | "bar"} variant
 * @param {string} [className] e.g. Tailwind `text-violet-600` for stroke/fill
 */
export function StatSparkline({ data, variant = "area", className }) {
  const uid = React.useId().replace(/:/g, "")
  const gradId = `spark-${uid}`

  const yTop = React.useMemo(() => {
    const maxY = data.reduce((m, d) => (Number(d.y) > m ? Number(d.y) : m), 0)
    return maxY <= 0 ? 1 : maxY * 1.14
  }, [data])

  if (!data?.length) return null

  const chartMargin = { top: 2, right: 0, left: 0, bottom: 0 }

  return (
    <div className={cn("mt-1.5", className)} aria-hidden>
      <div className="h-7 w-full sm:h-8">
        <ResponsiveContainer width="100%" height="100%">
          {variant === "area" ? (
            <AreaChart data={data} margin={chartMargin}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity={0.24} />
                  <stop offset="72%" stopColor="currentColor" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={[0, yTop]} hide width={0} />
              <Area
                type="monotone"
                dataKey="y"
                stroke="currentColor"
                strokeOpacity={0.85}
                strokeWidth={1.5}
                fill={`url(#${gradId})`}
                fillOpacity={1}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <BarChart data={data} margin={chartMargin} barCategoryGap="36%">
              <YAxis domain={[0, yTop]} hide width={0} />
              <Bar
                dataKey="y"
                fill="currentColor"
                fillOpacity={0.45}
                radius={[3, 3, 1, 1]}
                maxBarSize={7}
                isAnimationActive={false}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
