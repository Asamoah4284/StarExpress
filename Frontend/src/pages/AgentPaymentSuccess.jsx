import * as React from "react"
import { CheckCircle2 } from "lucide-react"

/** Moolre redirect target — loaded inside the payment iframe after MoMo approval. */
export default function AgentPaymentSuccess() {
  React.useEffect(() => {
    document.title = "Payment successful"
  }, [])

  return (
    <div className="bg-background flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <CheckCircle2 className="text-primary size-12" aria-hidden />
      <h1 className="text-lg font-semibold">Payment successful</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        You can close this window. Your agent screen will finish the sale automatically.
      </p>
    </div>
  )
}
