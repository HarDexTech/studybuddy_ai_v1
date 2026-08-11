# Change Report

## 2026-08-11 CEST — Fix 504 Gateway Timeout on test creation

- **Problem:** Creating a test on Vercel (`studybuddyai-silk.vercel.app`) returned 504 Gateway Timeout. The "create test" flow runs server actions (`generateBatchTestQuestions` et al.) that POST to `/` and await a full DeepSeek LLM stream with a 90s retry budget (+ 25s Gemini fallback). Vercel kills serverless functions at the plan timeout (10s Hobby without Fluid Compute / 60s Pro default), returning 504.
- **Root cause 1:** `src/app/page.tsx` was a `"use client"` component that exported `export const maxDuration = 30` — route-segment configs (`maxDuration`, `dynamic`) are ignored on client components, so the default plan timeout applied.
- **Fix:**
  - `git mv src/app/page.tsx` → `src/components/app/home-view.tsx` (client component; removed its dead `dynamic`/`maxDuration` exports).
  - New `src/app/page.tsx` is a server component that renders `HomeView` and exports `export const dynamic = "force-dynamic"; export const maxDuration = 300;`, so Vercel raises the function cap to 300s (Hobby Fluid Compute max; also valid on Pro).
- **Still required (user action):** Enable **Fluid Compute** in Vercel dashboard (Settings → Functions → Fluid Compute). Without it, Hobby functions are hard-capped at 10s and `maxDuration` is silently clamped. On Pro, 300s is allowed by default up to 800s.
- **Tests run:** `npm run typecheck` (pass), `npm run build` (pass, Next 16.2.10). Not deployed — user must push + redeploy.
- **Notable:** Worst-case per-call budget (~115s) fits under the new 300s cap. The `api/[[...route]]` stub, `/api/generate-summary`, and preload parallelism untouched (out of scope).