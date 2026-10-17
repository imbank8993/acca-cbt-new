// =====================================================
// PAS/PAT System Types
// =====================================================

export type PASPeriodType = 'pas' | 'pat' | 'pts' | 'pkn';
export type Semester = 'ganjil' | 'genap';
export type ScheduleStatus = 'scheduled' | 'active' | 'finished' | 'cancelled';
export type DifficultyTarget = 'easy' | 'medium' | 'hard' | 'mixed' | string;

export interface Subject {
  id: string;
  organization_id: string;
  name: string;
  code: string | null;
  color: string;
  created_at: string;
}

export interface PASPeriod {
  screenshot_enabled?: boolean;
  id: string;
  organization_id: string;
  name: string;
  type: PASPeriodType;
  school_year: string;
  semester: Semester;
  start_date: string;
  end_date: string;
  is_locked: boolean;
  created_by: string | null;
  created_at: string;
  // Joined data
  pas_subjects?: PASSubject[];
  pas_class_schedules?: PASClassSchedule[];
  _count?: {
    pas_subjects: number;
    pas_class_schedules: number;
  };
}

export interface PASSubject {
  id: string;
  pas_period_id: string;
  subject_id: string;
  bank_id: string | null;
  duration_minutes: number;
  total_questions: number;
  passing_score: number;
  difficulty_target: DifficultyTarget;
  created_at: string;
  // Joined data
  subjects?: Subject;
  question_banks?: {
    id: string;
    title: string;
  };
  pas_class_schedules?: PASClassSchedule[];
  _count?: {
    pas_class_schedules: number;
  };
}

export interface PASSession {
  id: string;
  pas_period_id: string;
  name: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface PASClassSchedule {
  allocated_room_ids?: string[];
  is_activated?: boolean | null;
  readiness?: { ready: boolean; issues: string[] };
  id: string;
  pas_period_id: string;
  bank_id: string | null;
  subject_id: string | null;
  class_id: string;
  exam_id: string | null;
  scheduled_date: string;
  scheduled_time: string;
  window_end_time: string;  // Student must start before this time
  session_id: string | null;
  duration_minutes: number | null;
  room: string | null;
  status: ScheduleStatus;
  created_at: string;
  // Joined data
  classes?: {
    id: string;
    name: string;
  };
  subjects?: {
    id: string;
    name: string;
  };
  exams?: {
    id: string;
    title: string;
    is_published: boolean;
  };
  question_banks?: {
    id?: string;
    title: string;
  } | null;
}

// Form input types
export interface CreatePASPeriodInput {
  name: string;
  type: PASPeriodType;
  school_year: string;
  semester: Semester;
  start_date: string;
  end_date: string;
}

export interface UpdatePASPeriodInput {
  name?: string;
  type?: PASPeriodType;
  school_year?: string;
  semester?: Semester;
  start_date?: string;
  end_date?: string;
  is_locked?: boolean;
}

export interface CreatePASSubjectInput {
  pas_period_id: string;
  subject_id: string;
  bank_id?: string;
  duration_minutes?: number;
  total_questions?: number;
  passing_score?: number;
  difficulty_target?: DifficultyTarget;
}

export interface UpdatePASSubjectInput {
  subject_id?: string;
  bank_id?: string | null;
  duration_minutes?: number;
  total_questions?: number;
  passing_score?: number;
  difficulty_target?: DifficultyTarget;
}

export interface CreatePASScheduleInput {
  pas_period_id: string;
  bank_id: string;
  subject_id?: string;
  class_id: string;
  scheduled_date: string;
  session_id: string;
  duration_override?: number;
  room?: string;
}

export interface UpdatePASScheduleInput {
  bank_id?: string;
  scheduled_date?: string;
  session_id?: string;
  duration_minutes?: number | null;
  room?: string | null;
  status?: ScheduleStatus;
  exam_id?: string | null;
}

// Dashboard stats
export interface PASDashboardStats {
  total_periods: number;
  active_periods: number;
  locked_periods: number;
  total_subjects: number;
  total_schedules: number;
  scheduled_count: number;
  active_count: number;
  finished_count: number;
}


// Exam Config / Folder types
export type ExamConfigStatus = 'draft' | 'active' | 'finished' | 'archived';
export type ExamConfigBankStatus = 'scheduled' | 'active' | 'finished' | 'cancelled';
export interface ExamConfig {
  id: string;
  organization_id: string;
  name: string;
  school_year: string | null;
  semester: string | null;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
  created_by: string | null;
  created_at: string;
  exam_config_banks?: ExamConfigBank[];
  _count?: { exam_config_banks: number };
}
export interface ExamConfigBank {
  id: string;
  exam_config_id: string;
  bank_id: string;
  subject_id: string | null;
  duration_minutes: number;
  created_at: string;
  question_banks?: { title: string } | null;
  subjects?: { name: string } | null;
  exam_config_exams?: ExamConfigExam[];
}
export interface ExamConfigExam {
  id: string;
  exam_config_id: string;
  exam_config_bank_id: string;
  class_id: string;
  exam_id: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  window_end_time: string | null;
  status: string;
  created_at: string;
  classes?: { name: string } | null;
  exams?: { id: string } | null;
}
export interface CreateExamConfigInput {
  name: string;
  school_year?: string;
  semester?: string;
  start_date?: string;
  end_date?: string;
}
export interface UpdateExamConfigInput {
  name?: string;
  school_year?: string;
  semester?: string;
  start_date?: string;
  end_date?: string;
  is_locked?: boolean;
}
export interface AddExamConfigBankInput {
  exam_config_id: string;
  bank_id: string;
  subject_id?: string;
  duration_minutes?: number;
}
export interface UpdateExamConfigBankInput {
  subject_id?: string;
  duration_minutes?: number;
}
export interface AddExamConfigExamInput {
  exam_config_id: string;
  exam_config_bank_id: string;
  class_id: string;
  scheduled_date?: string;
  scheduled_time?: string;
  window_end_time?: string;
}
