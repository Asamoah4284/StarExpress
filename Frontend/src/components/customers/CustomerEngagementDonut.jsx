import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"

const COLORS = {
  Active: "#22c55e",
  Inactive: "#f59e0b",
}

/**
 * @param {{ active: number, inactive: number, total: number, height?: number }} props
 */
export function CustomerEngagementDonut({ active, inactive, total, height = 220 }) {
  const data = [
    { name: "Active", value: active },
    { name: "Inactive", value: inactive },
  ].filter((d) => d.value > 0)

  const retentionPct = total > 0 ? Math.round((active / total) * 100) : 0

  if (total === 0) {
    return (
      <div
        className="text-muted-foreground flex items-center justify-center text-sm"
        style={{ height }}
      >
        No customer data yet
      </div>
    )
  }

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)",
              background: "var(--card)",
              fontSize: 12,
            }}
            formatter={(value, _name, item) => {
              const v = Number(value)
              const pct = total ? Math.round((v / total) * 100) : 0
              return [`${v} customers (${pct}%)`, item.payload.name]
            }}
          />
          <Pie
            data={data.length ? data : [{ name: "Empty", value: 1 }]}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={3}
            cornerRadius={3}
            isAnimationActive
            animationDuration={600}
          >
            {(data.length ? data : [{ name: "Empty", value: 1 }]).map((entry) => (
              <Cell
                key={entry.name}
                fill={COLORS[entry.name] ?? "var(--muted)"}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-foreground text-2xl font-bold tabular-nums">{retentionPct}%</p>
        <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">Active</p>
      </div>
    </div>
  )
}
