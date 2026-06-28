import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

const BUCKET_COLORS = ["#22c55e", "#4ade80", "#f59e0b", "#fb923c", "#ef4444"]

/**
 * @param {{ customers: Array<{ daysSinceLastPurchase?: number | null }>, thresholdDays?: number, height?: number }} props
 */
export function CustomerRecencyBarChart({ customers, thresholdDays = 8, height = 200 }) {
  const buckets = [
    { name: "Today", min: 0, max: 0, value: 0 },
    { name: "1–4 days", min: 1, max: thresholdDays - 1, value: 0 },
    { name: `${thresholdDays}–14d`, min: thresholdDays, max: 14, value: 0 },
    { name: "15–30d", min: 15, max: 30, value: 0 },
    { name: "30+ days", min: 31, max: Infinity, value: 0 },
  ]

  for (const c of customers) {
    const d = c.daysSinceLastPurchase
    if (d == null || !Number.isFinite(d)) continue
    for (const b of buckets) {
      if (d >= b.min && d <= b.max) {
        b.value += 1
        break
      }
    }
  }

  const data = buckets.map(({ name, value }) => ({ name, value }))
  const maxVal = Math.max(1, ...data.map((d) => d.value))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="name"
          tickMargin={8}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          domain={[0, Math.ceil(maxVal * 1.15)]}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          width={32}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            fontSize: 12,
          }}
          formatter={(value) => [`${value} customers`, "Last purchase"]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive animationDuration={500}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={BUCKET_COLORS[i % BUCKET_COLORS.length]} fillOpacity={0.9} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
