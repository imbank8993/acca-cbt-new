"use client";
import { AlertTriangle,Home,RefreshCw } from 'lucide-react';
import React,{ Component,ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ─── Error Fallback Component ───────────────────────────

interface FallbackProps {
  error: Error;
  resetError: () => void;
}

export function ErrorFallback({ error, resetError }: FallbackProps) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
        {/* Header with icon */}
        <div className="bg-red-50 px-6 py-8 text-center border-b border-red-100">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Terjadi Kesalahan</h2>
          <p className="text-sm text-slate-500 mt-1">Mohon maaf, terjadi kesalahan yang tidak terduga.</p>
        </div>

        {/* Error details (collapsible) */}
        <div className="px-6 py-4">
          <details className="group">
            <summary className="flex items-center gap-2 text-sm text-slate-500 cursor-pointer hover:text-slate-700">
              <span>Detail Error</span>
              <span className="text-xs text-slate-400 group-open:hidden">(klik untuk lihat)</span>
              <span className="text-xs text-slate-400 hidden group-open:block">(sembunyikan)</span>
            </summary>
            <div className="mt-3 p-3 bg-slate-50 rounded-lg text-xs font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap break-all">
              {error.message || 'Unknown error'}
            </div>
          </details>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
          <button
            onClick={resetError}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-medium text-sm hover:opacity-90 transition-all"
          >
            <RefreshCw size={16} />
            Coba Lagi
          </button>
          <a
            href="/dashboard"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-medium text-sm hover:bg-slate-50 transition-all"
          >
            <Home size={16} />
            Beranda
          </a>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-400">
            Jika masalah persists, hubungi administrator.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Error Boundary Component ─────────────────────────────

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error (can integrate with Sentry, LogRocket, etc.)
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          error={this.state.error}
          resetError={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}

// ─── Simple Error Display (for inline use) ───────────────

interface InlineErrorProps {
  message?: string;
  onRetry?: () => void;
}

export function InlineError({ message = 'Terjadi kesalahan', onRetry }: InlineErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-3">
        <AlertTriangle size={20} className="text-red-400" />
      </div>
      <p className="text-sm text-slate-500 mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium text-primary hover:bg-slate-50 rounded-lg transition-colors"
        >
          Coba Lagi
        </button>
      )}
    </div>
  );
}

// ─── Loading Error State ─────────────────────────────────

export function LoadingError() {
  return (
    <div className="min-h-[200px] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-slate-200 border-t-red-500 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400">Memuat...</p>
      </div>
    </div>
  );
}

// ─── Network Error State ──────────────────────────────────

export function NetworkError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="min-h-[200px] flex items-center justify-center">
      <div className="text-center max-w-xs">
        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 mb-1">Koneksi Terputus</p>
        <p className="text-xs text-slate-400 mb-4">Periksa koneksi internet Anda dan coba lagi.</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-all"
          >
            Coba Lagi
          </button>
        )}
      </div>
    </div>
  );
}