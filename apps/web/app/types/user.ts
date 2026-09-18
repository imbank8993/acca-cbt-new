/**
 * User-related types for CBT App
 * Centralized type definitions for user/auth domain
 */

// ─── User Roles ──────────────────────────────────────────────

export type UserRole = 'admin' | 'guru' | 'siswa' | 'proktor';

// ─── Base User ──────────────────────────────────────────────

export interface BaseUser {
  id: string;
  email: string;
  role: UserRole;
  full_name: string;
  avatar_url?: string;
  created_at?: string;
  last_login_at?: string;
  is_active: boolean;
}

// ─── Student ─────────────────────────────────────────────────

export interface Student extends BaseUser {
  role: 'siswa';
  nis?: string;                   // Nomor Induk Siswa
  nisn?: string;                  // Nomor Induk Siswa Nasional
  class_id?: string;
  class_name?: string;
  study_group?: string;            // Jurusan/Peminatan (for SMA)
  parent_email?: string;
  phone?: string;
}

// ─── Teacher (Guru) ─────────────────────────────────────────

export interface Teacher extends BaseUser {
  role: 'guru';
  nip?: string;                   // Nomor Induk Pegawai
  subject?: string;               // Mata pelajaran
  department?: string;             // Unit/Bagian
  phone?: string;
}

// ─── Proctor (Proktor) ──────────────────────────────────────

export interface Proctor extends BaseUser {
  role: 'proktor';
  nip?: string;
  assigned_rooms?: string[];      // Room IDs assigned to this proctor
}

// ─── Admin ──────────────────────────────────────────────────

export interface Admin extends BaseUser {
  role: 'admin';
  admin_level: 'super' | 'standard';
  permissions?: string[];
}

// ─── Unified User Type ──────────────────────────────────────

export type AppUser = Student | Teacher | Proctor | Admin;

// ─── User Session ────────────────────────────────────────────

export interface UserSession {
  user: AppUser;
  token: string;
  expires_at: string;
  refresh_token?: string;
}

// ─── User Profile Update ──────────────────────────────────────

export interface ProfileUpdateInput {
  full_name?: string;
  avatar_url?: string;
  phone?: string;
}

export interface StudentProfileUpdate extends ProfileUpdateInput {
  nis?: string;
  nisn?: string;
  class_id?: string;
  parent_email?: string;
}

export interface TeacherProfileUpdate extends ProfileUpdateInput {
  nip?: string;
  subject?: string;
  department?: string;
  phone?: string;
}

// ─── Class ───────────────────────────────────────────────────

export interface StudentClass {
  id: string;
  name: string;                   // e.g., "X IPA 1"
  grade_level: number;            // 10, 11, 12
  study_group?: string;           // IPA / IPS / Bahasa
  homeroom_teacher_id?: string;
  academic_year?: string;         // "2024/2025"
  created_at?: string;
}

// ─── Permission Check ────────────────────────────────────────

export interface Permission {
  resource: string;
  action: '*' | 'create' | 'read' | 'update' | 'delete';
}

export function hasPermission(user: AppUser, permission: Permission): boolean {
  const rolePermissions: Record<UserRole, Permission[]> = {
    admin: [
      { resource: '*', action: '*' }, // Full access
    ],
    guru: [
      { resource: 'questions', action: 'create' },
      { resource: 'questions', action: 'read' },
      { resource: 'questions', action: 'update' },
      { resource: 'exams', action: 'create' },
      { resource: 'exams', action: 'read' },
      { resource: 'exams', action: 'update' },
      { resource: 'results', action: 'read' },
    ],
    siswa: [
      { resource: 'exams', action: 'read' },
      { resource: 'exams', action: 'create' }, // Start exam
      { resource: 'results', action: 'read' },
    ],
    proktor: [
      { resource: 'exams', action: 'read' },
      { resource: 'monitoring', action: 'read' },
      { resource: 'students', action: 'update' }, // Force logout
    ],
  };

  const userPermissions = rolePermissions[user.role];
  if (!userPermissions) return false;

  return userPermissions.some(p =>
    p.resource === '*' || (p.resource === permission.resource && p.action === permission.action)
  );
}

// ─── Helper Functions ────────────────────────────────────────

export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: 'Administrator',
    guru: 'Guru',
    siswa: 'Siswa',
    proktor: 'Proktor',
  };
  return labels[role];
}

export function isStudent(user: AppUser): user is Student {
  return user.role === 'siswa';
}

export function isTeacher(user: AppUser): user is Teacher {
  return user.role === 'guru';
}

export function isAdmin(user: AppUser): user is Admin {
  return user.role === 'admin';
}

export function isProctor(user: AppUser): user is Proctor {
  return user.role === 'proktor';
}