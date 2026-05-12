import { isBackendEnabled } from "@/lib/env.js"

/** Shown on login/signup when the app is using in-browser mock auth (no API calls). */
export function ApiDisabledNotice() {
  if (isBackendEnabled()) return null

  return (
    <div
      role="status"
      className="border-amber-500/35 bg-amber-500/10 text-amber-950 mb-3 w-full max-w-[440px] rounded-lg border px-3 py-2.5 text-left text-xs leading-snug shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-50 sm:mb-4 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm sm:leading-relaxed"
    >
      <p className="font-semibold text-amber-950 dark:text-amber-100">API is off — you are in mock mode</p>
      <p className="text-amber-900/90 mt-1 dark:text-amber-100/90">
        No requests are sent to your Node/Mongo backend. In <code className="rounded bg-black/10 px-1 font-mono dark:bg-white/10">Frontend/.env</code> set{" "}
        <code className="rounded bg-black/10 px-1 font-mono dark:bg-white/10">VITE_USE_BACKEND=true</code> (or{" "}
        <code className="rounded bg-black/10 px-1 font-mono dark:bg-white/10">VITE_USE_API=true</code>), save, then{" "}
        <strong className="font-semibold">stop and restart</strong> the Vite dev server. Keep the backend running with a valid{" "}
        <code className="rounded bg-black/10 px-1 font-mono dark:bg-white/10">MONGODB_URI</code>.
      </p>
    </div>
  )
}
