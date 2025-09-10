import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Sign In • Flow's Kitchen",
  description: 'Access your Flow\'s Kitchen workspace',
}

export default function LoginPage() {
  return (
    <main className="relative h-screen flex items-center justify-center px-6 py-12 overflow-hidden">
      {/* Ambient cyan glow accents */}
      <div className="pointer-events-none absolute -top-20 -left-24 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />

      {/* Subtle vertical gradient to deepen contrast */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-900/30 to-slate-950/60" />

      <section className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          
          <h1 className="text-3xl font-semibold tracking-tight text-white">Sign in</h1>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-sm">
          <form action="#" method="post" className="space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="mb-2 block text-sm text-white/80">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="your.name@intuelle.com"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-white/40 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/30"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm text-white/80">
                  Password
                </label>
                
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-white/40 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/30"
              />
            </div>

            <button
              type="submit"
              className="group inline-flex w-full items-center justify-center rounded-lg bg-cyan-500 px-4 py-2.5 font-medium text-slate-900 transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/50"
            >
              Sign In
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-0.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 8.25 21 12m0 0-3.75 3.75M21 12H3" />
              </svg>
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-white/50">
            Don&apos;t have access? Ping me at <Link href="mailto:dthoang@intuelle.com" className="text-white/60 hover:text-white">dthoang@intuelle.com</Link>.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link href="https://www.intuelle.com" className="text-sm text-white/60 hover:text-white">
            Visit Kitchen's Blog
          </Link>
          <span className="text-sm text-white/40 mx-2">·</span>
          <span className="text-sm text-white/50">See what we learned about solving DCBs.</span>
        </div>
      </section>
    </main>
  )
}

