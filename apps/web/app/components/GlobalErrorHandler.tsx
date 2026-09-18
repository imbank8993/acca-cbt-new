"use client";
import { useEffect } from 'react';

export default function GlobalErrorHandler() {
  useEffect(() => {
    // Global error handler to catch uncaught errors
    const handleError = (event: ErrorEvent) => {
      const error = event.error;
      if (!error) return;
      // Log to console with extra context
      console.error('[GlobalErrorHandler] Uncaught error:', error.message);
      console.error('[GlobalErrorHandler] Stack:', error.stack);
    };

    // Global promise rejection handler
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (!reason) return;
      if (reason instanceof Error) {
        console.error('[GlobalErrorHandler] Unhandled promise rejection:', reason.message);
        console.error('[GlobalErrorHandler] Stack:', reason.stack);
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}
