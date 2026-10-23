# Captive Portal Auth — Working State Log

> **Reference document.** If the "Connect to WiFi" button stops working, diff the current
> source against the snapshots below before touching anything else.

---

## History

| Date | Change |
|------|--------|
| 2026-10-16 | **FIXED** — replaced `<form method="GET">` with `window.location.assign()` to stop browsers stripping the query string; moved `clearPersistedPortalParams()` after navigation. |

---

## Auth Flow (confirmed working 2026-10-16)

```
User device (on venue WiFi)
  │
  │  AP intercepts any HTTP request
  ▼
Grandstream GWN AP
  │  302 redirect →
  ▼
/buy?login_url=https://cwp.gwnportal.cloud:8443/gwn_login
    &client_mac=<device-mac>
    &orig_url=<original-destination>
    &ap_mac=<ap-mac>
    &ssid=<network-name>
  │
  │  resolvePortalParams() reads + persists to sessionStorage
  ▼
HotspotConnectForm renders with:
  loginUrl    = "https://cwp.gwnportal.cloud:8443/gwn_login"
  origUrl     = "<original-destination>"
  defaultCode = "<voucher from API or URL>"
  │
  │  User taps "Connect to WiFi"
  ▼
buildHotspotAuthorizeUrl(loginUrl, pin, { orig_url: origUrl })
  │
  │  Returns →
  ▼
"https://cwp.gwnportal.cloud:8443/gwn_login
  ?username=<voucher>
  &password=<voucher>
  &redirect=<orig_url-encoded>"
  │
  │  window.location.assign(target)   ← MUST be this, not a GET form
  ▼
Grandstream GWN AP
  │  RADIUS Access-Request (user=<voucher>, pass=<voucher>)
  ▼
RADIUS server accepts → AP grants internet access
  │  302 redirect →
  ▼
orig_url (user is online ✓)
```

---

## Key Files

| File | Role |
|------|------|
| `HotspotConnectForm.jsx` (this directory) | Form UI + submission logic |
| `../../lib/captivePortalParams.js` | URL building, param parsing, sessionStorage persistence |
| `../../pages/CaptiveBuy.jsx` | Host page — calls `resolvePortalParams()` and passes props |

---

## Critical Implementation Rules

### 1. `submitToGateway` MUST use `window.location.assign()`

**Never use a `<form method="GET">`.**

The HTML specification (§4.10.21.3, step 2) requires browsers to strip the
query string from `action` on GET form submissions and replace it with the
serialised form field values. Since the form has no `<input>` elements, the AP
receives an empty query string:

```
GET https://cwp.gwnportal.cloud:8443/gwn_login?   ← empty
```

The AP returns `302 /buy?auth_status=PARAMETERS_FAILED` and no RADIUS request
is made. `window.location.assign(url)` sends the URL exactly as built.

**Working implementation:**
```js
function submitToGateway(target) {
  window.location.assign(target)
}
```

**Broken implementation (DO NOT restore):**
```js
// ❌ DO NOT USE — strips the query string
function submitToGateway(target) {
  const form = document.createElement("form")
  form.method = "GET"
  form.action = target        // ← query string is stripped by the browser
  document.body.appendChild(form)
  form.submit()
}
```

---

### 2. `clearPersistedPortalParams()` ordering

Call it **after** `submitToGateway()`, not before.

```js
// ✅ CORRECT ORDER
submitToGateway(targetUrl)
clearPersistedPortalParams()

// ❌ WRONG ORDER — params gone before AP responds
clearPersistedPortalParams()
submitToGateway(targetUrl)
```

**Why:** If the AP rejects the voucher (wrong code, expired) it bounces the user
back to `/buy`. `resolvePortalParams()` then reads from sessionStorage to
rebuild the form. If the storage was already cleared, `loginUrl` is empty, the
form cannot build a URL, and the user sees the "gateway not detected" error.

---

### 3. `buildHotspotAuthorizeUrl` — parameter names

Function signature:
```js
buildHotspotAuthorizeUrl(loginUrl: string, code: string, extra?: { orig_url?: string }): string
```

Query parameters appended to `loginUrl`:

| Parameter  | Value | Notes |
|------------|-------|-------|
| `username` | voucher code (URL-encoded) | RADIUS username |
| `password` | voucher code (URL-encoded) | RADIUS password — same value as username |
| `redirect` | `orig_url` value (URL-encoded) | Only appended when `orig_url` is non-empty |

Joiner logic (avoids double `?`):
```js
const joiner = base.includes("?") ? "&" : "?"
```

Example output:
```
https://cwp.gwnportal.cloud:8443/gwn_login
  ?username=ABC123
  &password=ABC123
  &redirect=http%3A%2F%2Fexample.com
```

---

### 4. DevTools debug log

Right before navigation, `doConnect()` logs the URL with the password masked:

```
[buy] gateway target https://cwp.gwnportal.cloud:8443/gwn_login?username=ABC123&password=****&redirect=…
```

Open Chrome DevTools → Console, filter by `[buy]` to see it.

---

## Symptom → Root Cause Quick Reference

| Symptom | Likely cause | Where to look |
|---------|-------------|---------------|
| Page reloads after "Connect" / `auth_status=PARAMETERS_FAILED` | `submitToGateway` uses a GET form again | `HotspotConnectForm.jsx` — `submitToGateway()` |
| "Gateway not detected" error after a wrong-code retry | `clearPersistedPortalParams` called before `submitToGateway` | `HotspotConnectForm.jsx` — `doConnect()` |
| Empty `username` / `password` in the AP request | `buildHotspotAuthorizeUrl` not called, or `loginUrl` empty | `onSubmit()` and `resolvePortalParams()` output |
| `redirect` param missing from AP URL | `origUrl` prop empty — AP did not send `orig_url` in redirect | Check AP portal config; not a code bug |
| Auth loop (valid code, AP keeps rejecting) | RADIUS server / voucher issue, not a frontend bug | Backend `radiusAuth.js` + AP RADIUS logs |

---

## Code Snapshots (working, 2026-10-16)

### `HotspotConnectForm.jsx` — core logic

```jsx
// submitToGateway — MUST use assign(), never a GET form
function submitToGateway(target) {
  window.location.assign(target)
}

// doConnect — order is critical
const doConnect = (targetUrl) => {
  setConnecting(true)
  setError(null)
  const logUrl = targetUrl.replace(/(password=)[^&]*/, (_, p) => `${p}****`)
  console.log("[buy] gateway target", logUrl)
  submitToGateway(targetUrl)          // navigate FIRST
  clearPersistedPortalParams()        // clear AFTER
}

// onSubmit — URL priority: built > fallback
const onSubmit = (e) => {
  e.preventDefault()
  const pin = code.trim()
  if (!pin) { setError("Enter your WiFi code before connecting."); return }
  const built = buildHotspotAuthorizeUrl(loginUrl, pin, { orig_url: origUrl })
  const fallback = authorizeUrl && pin === String(defaultCode || "").trim()
    ? String(authorizeUrl).trim() : ""
  const target = built || fallback
  if (!target) { setError("Hotspot gateway address was not detected…"); return }
  doConnect(target)
}
```

### `captivePortalParams.js` — `buildHotspotAuthorizeUrl`

```js
export function buildHotspotAuthorizeUrl(loginUrl, code, extra = {}) {
  const base = typeof loginUrl === "string" ? loginUrl.trim() : ""
  const pin  = typeof code    === "string" ? code.trim()     : ""
  if (!base || !pin) return ""
  const joiner = base.includes("?") ? "&" : "?"
  const orig   = typeof extra.orig_url === "string" ? extra.orig_url.trim() : ""
  let url = `${base}${joiner}username=${encodeURIComponent(pin)}&password=${encodeURIComponent(pin)}`
  if (orig) url += `&redirect=${encodeURIComponent(orig)}`
  return url
}
```
