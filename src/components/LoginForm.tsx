"use client";

import { ArrowRight } from "lucide-react";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ShimmeringText from '@/components/ShimmeringText';
import { useSimStore } from '@/components/useSimStore';
import { waitForPersistHydration } from '@/lib/persistHydration';

export default function LoginForm() {
  const router = useRouter();
  const login = useSimStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.ok === false) {
        setError(result.error);
        setLoading(false);
        return;
      }
      await waitForPersistHydration(useSimStore.persist);
      const nextResourceDate = useSimStore.getState().resourceDate;
      router.push(nextResourceDate ? '/' : '/select-date');
    } catch (err) {
      setError('Unable to sign in. Please try again.');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-white/40 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/30"
          required
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
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder-white/40 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-500/30"
          required
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 text-red-300 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="group inline-flex w-full items-center justify-center rounded-lg bg-cyan-500 px-4 py-2.5 font-medium text-slate-900 transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>Signing In...</>
        ) : (
          'Sign In'
        )}
        {!loading && (
          <ArrowRight aria-hidden="true" className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-0.5" strokeWidth="1.5" />
        )}
      </button>
    </form>
  );
}
