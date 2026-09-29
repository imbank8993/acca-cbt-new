"use client";
import { useCallback,useState } from 'react';

// In-memory global cache
const memoryCache = new Map<string, unknown>();

/**
 * A drop-in replacement for useState that persists data across page transitions
 * using an in-memory cache. Provides instant SPA-like navigation without loading spinners.
 */
export function useMemoryState<T>(key: string, initialValue: T): [T, (val: T | ((prev: T) => T)) => void] {
    // Synchronously initialize from cache if available to prevent hydration mismatch / flashes
    const [state, setState] = useState<T>(() => {
        if (typeof window === 'undefined') return initialValue; // Server side
        if (memoryCache.has(key)) return memoryCache.get(key) as T;
        return initialValue;
    });

    const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
        setState((prev) => {
            const nextVal = value instanceof Function ? value(prev) : value;
            if (typeof window !== 'undefined') {
                memoryCache.set(key, nextVal);
            }
            return nextVal;
        });
    }, [key]);

    return [state, setPersistedState];
}

/**
 * Clear the memory cache. Should be called on user logout or critical role switches.
 */
export function clearMemoryCache() {
    memoryCache.clear();
}

/**
 * Delete cache entries whose key starts with any of the given prefixes.
 * Use this on role switch to evict stale data from a different role's
 * dashboard so the new role starts with a clean slate.
 */
export function clearMemoryCacheByPrefix(prefixes: string[]): void {
    for (const key of Array.from(memoryCache.keys())) {
        if (prefixes.some((p) => key === p || key.startsWith(p + '_') || key.startsWith(p + '/'))) {
            memoryCache.delete(key);
        }
    }
}
