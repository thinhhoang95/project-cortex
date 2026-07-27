
'use client';

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import LoginForm from '@/components/LoginForm'


import { useEffect, useState } from 'react';
import { useSimStore } from '@/components/useSimStore';

function UserDebugLogger() {
  const user = useSimStore(state => state.user);
  
  useEffect(() => {
    console.log('Current user state:', user);
  }, [user]);
  
  return null;
}


export default function LoginPage() {
  const [jobToast, setJobToast] = useState<boolean>(true);

  return (
    <main className="relative h-screen flex items-center justify-center px-6 py-12 overflow-hidden">
      
      {/* Ambient cyan glow accents */}
      <div className="pointer-events-none absolute -top-20 -left-24 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />

      {/* Subtle vertical gradient to deepen contrast */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-900/30 to-slate-950/60" />

      <section className="relative z-10 w-full max-w-3xl">

        <div className="grid grid-cols-1 md:grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-2xl">
          {/* Left: Illustration */}
          <div className="relative hidden md:block">
            <Image
              src="/assets/DSC_0320.png"
              width={512}
              height={768}
              
              alt="Stylized login art"
              className="h-full w-full object-cover"
              priority
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-slate-900/30 to-transparent" />
            <div className="absolute bottom-2 right-2 text-xs text-white/30">
              
            </div>
          </div>

          {/* Right: Form */}
          <div className="p-8 md:p-8 flex flex-col justify-center h-full">
            <h1 className="text-3xl font-semibold tracking-tight text-white mb-8">Sign in</h1>
            <LoginForm />
            <p className="mt-8 text-center text-xs text-white/50">
              Don&apos;t have access? Ping me at <Link href="mailto:dthoang@intuelle.com" className="text-white/60 hover:text-white">dthoang@intuelle.com</Link>.
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <span className="text-sm text-white/50">Sunset in Veneto</span>
          <span className="text-sm text-white/40 mx-2">·</span>
          <Link href="https://www.intuelle.com" className="text-sm text-white/60 hover:text-white">
            Visit the Kitchen&apos;s Blog
          </Link>
        </div>
      </section>

      {/* Job search toast notification */}
      {jobToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm flex items-start gap-3 bg-cyan-500/15 border-cyan-300/60 text-cyan-100">
          <div className="flex-1 text-sm">
            <div>
              I&apos;m also <span className="underline">desperately looking for a new job</span>. I could do some coding, some ML stuffs, and I know a bit about design too. If you like what you see, let&apos;s connect.
            </div>
            <a 
              href="https://www.linkedin.com/in/thinh-hoang-571252b7/" 
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[12px] underline hover:text-cyan-50"
            >
              LinkedIn Profile
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14"></path>
                <path d="M12 5l7 7-7 7"></path>
              </svg>
            </a>
          </div>
          <button
            onClick={() => setJobToast(false)}
            className="text-[12px] text-white/70 hover:text-white"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}
    </main>
  )
}
