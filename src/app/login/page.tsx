
'use client';

import type { Metadata } from 'next'
import Link from 'next/link'
import LoginForm from '@/components/LoginForm'


import { useEffect } from 'react';
import { useSimStore } from '@/components/useSimStore';

function UserDebugLogger() {
  const user = useSimStore(state => state.user);
  
  useEffect(() => {
    console.log('Current user state:', user);
  }, [user]);
  
  return null;
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
          <LoginForm />
          
          <p className="mt-6 text-center text-xs text-white/50">
            Don&apos;t have access? Ping me at <Link href="mailto:dthoang@intuelle.com" className="text-white/60 hover:text-white">dthoang@intuelle.com</Link>.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link href="https://www.intuelle.com" className="text-sm text-white/60 hover:text-white">
            Visit Kitchen's Blog
          </Link>
          <span className="text-sm text-white/40 mx-2">·</span>
          <span className="text-sm text-white/50">Proudly made in Toulouse.</span>
        </div>
      </section>
    </main>
  )
}
