/**
 * Central type exports for CBT App
 * Import types from here instead of individual files
 */

export * from './question';
export * from './exam';
export * from './user';
export * from './analytics';
export * from './notification';

// ─── Common API Types ────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string>;
}

// ─── Supabase Database Types (for DB operations) ────────────

export interface DbRow {
  id: string;
  created_at?: string;
  updated_at?: string;
}

export interface TimestampColumns {
  created_at: string;
  updated_at?: string;
}

// ─── Action Result Types ─────────────────────────────────────

export interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export type AsyncActionResult<T = void> = Promise<ActionResult<T>>;