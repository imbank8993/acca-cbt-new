/**
 * Question Type Schema System
 * Provides type-safe state management for all question types.
 * Used by useReducer-based form orchestrator.
 */

export type QuestionType =
  | 'mcq'
  | 'mcq_complex'
  | 'true_false'
  | 'matching'
  | 'categorization'
  | 'short_answer'
  | 'essay'
  | 'sjt'
  | 'ordering';

// ---- Option shapes per type ----

/** Base option shared by MCQ, MCQ Complex, True/False */
export interface BaseOption {
  id?: string;
  text: string;
  isCorrect: boolean;
  order: number;
  weight: number;
  match_texts: string[];
  category_names: string[];
  dimension_id?: string | null;
}

/** MCQ / MCQ Complex option */
export interface MCQOption extends BaseOption {
  text: string;
  isCorrect: boolean;
}

/** True/False statement option */
export interface TFOption extends BaseOption {
  text: string;
  /** true = statement is Benar, false = statement is Salah */
  isCorrect: boolean;
}

/** Matching: left item with right item references */
export interface MatchingOption extends BaseOption {
  text: string;
  match_texts: string[]; // texts of matched right items
}

/** Categorization item with category assignment */
export interface CategorizationOption extends BaseOption {
  text: string;
  category_names: string[];
}

// ---- Metadata per type ----

export interface MatchingMetadata {
  right_items: string[];
}

export interface ShortAnswerMetadata {
  blanks: { answer: string; variations: string[] }[];
}

export interface CategorizationMetadata {
  categories: string[];
}

export interface OrderingMetadata {
  correct_order: string[]; // ordered array of option IDs
}

export interface EssayMetadata {
  allow_file_upload?: boolean;
  allow_video_link?: boolean;
  is_multi_topic?: boolean;
}

export type QuestionMetadata =
  | MatchingMetadata
  | ShortAnswerMetadata
  | CategorizationMetadata
  | OrderingMetadata
  | EssayMetadata
  | Record<string, never>;

// ---- Full question state ----

export interface QuestionState {
  id?: string;
  type: QuestionType;
  questionText: string;
  options: BaseOption[];
  metadata: QuestionMetadata;
  categories: string[];
  scoreDefault: number;
  kisiKisi: string;
  pembahasan: string;
}

// ---- Actions ----

export type QuestionAction =
  | { type: 'SET_TYPE'; payload: QuestionType }
  | { type: 'SET_QUESTION_TEXT'; payload: string }
  | { type: 'SET_OPTIONS'; payload: BaseOption[] }
  | { type: 'ADD_OPTION'; payload?: Partial<BaseOption> }
  | { type: 'ADD_OPTIONS'; payload: Partial<BaseOption>[] }
  | { type: 'REMOVE_OPTION'; payload: number }
  | { type: 'UPDATE_OPTION'; payload: { index: number; fields: Partial<BaseOption> } }
  | { type: 'SET_OPTION_CORRECT'; payload: { index: number; isCorrect: boolean } }
  | { type: 'SET_ALL_CORRECT'; payload: { index: number } } // MCQ: only one correct
  | { type: 'TOGGLE_CORRECT'; payload: { index: number } } // MCQ Complex
  | { type: 'SET_METADATA'; payload: Partial<QuestionMetadata> }
  | { type: 'SET_CATEGORIES'; payload: string[] }
  | { type: 'ADD_RIGHT_ITEM'; payload?: string }
  | { type: 'REMOVE_RIGHT_ITEM'; payload: number }
  | { type: 'UPDATE_RIGHT_ITEM'; payload: { index: number; text: string } }
  | { type: 'SET_LEFT_MATCH'; payload: { optIndex: number; rightTexts: string[] } }
  | { type: 'SET_CATEGORY_FOR_ITEM'; payload: { optIndex: number; categories: string[] } }
  | { type: 'ADD_BLANK'; payload?: { answer: string; variations: string[] } }
  | { type: 'UPDATE_BLANK'; payload: { index: number; fields: { answer?: string; variations?: string[] } } }
  | { type: 'REMOVE_BLANK'; payload: number }
  | { type: 'INSERT_OPTION'; payload: { index: number; fields?: Partial<BaseOption> } }
  | { type: 'SET_SCORE'; payload: number }
  | { type: 'SET_KISI_KISI'; payload: string }
  | { type: 'SET_PEMBAHASAN'; payload: string }
  | { type: 'RESET_FOR_TYPE'; payload: QuestionType }
  | { type: 'LOAD_QUESTION'; payload: QuestionState }
  | { type: 'SET_OPTION_WEIGHT'; payload: { index: number; weight: number } } // SJT
  | { type: 'SET_CORRECT_ORDER'; payload: string[] } // Ordering
  | { type: 'MOVE_ORDERING_ITEM'; payload: { from: number; to: number } }; // Ordering

// ---- Type display info ----

export interface QuestionTypeInfo {
  value: QuestionType;
  label: string;
  description: string;
  hasOptions: boolean;
  hasLeftItems: boolean;
  hasRightItems: boolean;
  hasCategories: boolean;
  hasBlanks: boolean;
  hasKisiKisi: boolean;
  hasPembahasan: boolean;
  hasWeights?: boolean;   // SJT
  hasOrdering?: boolean;  // Ordering
}

export const QUESTION_TYPE_INFO: QuestionTypeInfo[] = [
  {
    value: 'mcq',
    label: 'Pilihan Ganda',
    description: 'Pilih satu jawaban benar',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'mcq_complex',
    label: 'PG Kompleks',
    description: 'Pilih beberapa jawaban benar',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'true_false',
    label: 'Benar / Salah',
    description: 'Tentukan benar atau salah',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'matching',
    label: 'Menjodohkan',
    description: 'Pasangkan kolom kiri dan kanan',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: true,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'categorization',
    label: 'Kategorisasi',
    description: 'Klasifikasikan ke dalam kategori',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: true,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'short_answer',
    label: 'Isian Singkat',
    description: 'Jawaban singkat dan tepat',
    hasOptions: false,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: true,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'essay',
    label: 'Essay / Uraian',
    description: 'Jawaban berupa teks panjang',
    hasOptions: false,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
  },
  {
    value: 'sjt',
    label: 'SJT (Situational Judgment)',
    description: 'Pilihan ganda dengan bobot poin tiap opsi',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
    hasWeights: true,
  },
  {
    value: 'ordering',
    label: 'Pengurutan',
    description: 'Susun pernyataan sesuai urutan yang benar',
    hasOptions: true,
    hasLeftItems: false,
    hasRightItems: false,
    hasCategories: false,
    hasBlanks: false,
    hasKisiKisi: true,
    hasPembahasan: true,
    hasOrdering: true,
  },
];

export const QUESTION_TYPE_MAP = QUESTION_TYPE_INFO.reduce(
  (acc, t) => ({ ...acc, [t.value]: t }),
  {} as Record<QuestionType, QuestionTypeInfo>
);

// ---- Default state factory ----

export function createDefaultState(type: QuestionType = 'mcq'): QuestionState {
  const info = QUESTION_TYPE_MAP[type];
  return {
    type,
    questionText: '',
    options: [],
    metadata: {} as QuestionMetadata,
    categories: [],
    scoreDefault: 1,
    kisiKisi: '',
    pembahasan: '',
  };
}

// ---- Reducer ----

export function questionReducer(
  state: QuestionState,
  action: QuestionAction
): QuestionState {
  switch (action.type) {
    case 'SET_TYPE':
      return { ...state, type: action.payload };

    case 'SET_QUESTION_TEXT':
      return { ...state, questionText: action.payload };

    case 'SET_OPTIONS':
      return { ...state, options: action.payload };

    case 'ADD_OPTION': {
      const newOption: BaseOption = {
        text: '',
        isCorrect: false,
        order: state.options.length,
        weight: 0,
        match_texts: [],
        category_names: [],
        ...action.payload,
      };
      const newOpts = [...state.options, newOption];
      // Auto-sync correct_order for ordering type
      if (state.type === 'ordering') {
        return {
          ...state,
          options: newOpts,
          metadata: { ...state.metadata, correct_order: newOpts.map(o => o.id || String(o.order)) } as OrderingMetadata,
        };
      }
      return { ...state, options: newOpts };
    }

    case 'ADD_OPTIONS': {
      const newOptions = action.payload.map((opt, i) => ({
        text: '',
        isCorrect: false,
        order: state.options.length + i,
        weight: 0,
        match_texts: [],
        category_names: [],
        ...opt,
      }));
      return { ...state, options: [...state.options, ...newOptions] };
    }

    case 'REMOVE_OPTION': {
      const newOpts = state.options.filter((_, i) => i !== action.payload);
      if (state.type === 'ordering') {
        return {
          ...state,
          options: newOpts,
          metadata: { ...state.metadata, correct_order: newOpts.map(o => o.id || String(o.order)) } as OrderingMetadata,
        };
      }
      return { ...state, options: newOpts };
    }

    case 'INSERT_OPTION': {
      const { index, fields } = action.payload;
      const newOption: BaseOption = {
        text: '',
        isCorrect: false,
        order: index,
        weight: 0,
        match_texts: [],
        category_names: [],
        ...fields,
      };
      const newOpts = [...state.options];
      newOpts.splice(index, 0, newOption);
      return { ...state, options: newOpts };
    }

    case 'UPDATE_OPTION': {
      const { index, fields } = action.payload;
      const newOpts = [...state.options];
      newOpts[index] = { ...newOpts[index], ...fields };
      return { ...state, options: newOpts };
    }

    case 'SET_OPTION_CORRECT': {
      const { index, isCorrect } = action.payload;
      const newOpts = [...state.options];
      newOpts[index] = { ...newOpts[index], isCorrect };
      return { ...state, options: newOpts };
    }

    case 'SET_ALL_CORRECT': {
      // MCQ: only one option is correct
      const { index } = action.payload;
      const newOpts = state.options.map((o, i) => ({
        ...o,
        isCorrect: i === index,
      }));
      return { ...state, options: newOpts };
    }

    case 'TOGGLE_CORRECT': {
      // MCQ Complex: toggle individual option
      const { index } = action.payload;
      const newOpts = [...state.options];
      newOpts[index] = {
        ...newOpts[index],
        isCorrect: !newOpts[index].isCorrect,
      };
      return { ...state, options: newOpts };
    }

    case 'SET_METADATA':
      return { ...state, metadata: { ...state.metadata, ...action.payload } as QuestionMetadata };

    case 'SET_CATEGORIES':
      return { ...state, categories: action.payload };

    case 'ADD_RIGHT_ITEM': {
      const rightItems = (state.metadata as MatchingMetadata).right_items || [];
      return {
        ...state,
        metadata: {
          ...state.metadata,
          right_items: [...rightItems, action.payload ?? ''],
        } as MatchingMetadata,
      };
    }

    case 'REMOVE_RIGHT_ITEM': {
      const rightItems = (state.metadata as MatchingMetadata).right_items || [];
      return {
        ...state,
        metadata: {
          ...state.metadata,
          right_items: rightItems.filter((_, i) => i !== action.payload),
        } as MatchingMetadata,
      };
    }

    case 'UPDATE_RIGHT_ITEM': {
      const { index, text } = action.payload;
      const rightItems = [...((state.metadata as MatchingMetadata).right_items || [])];
      rightItems[index] = text;
      return {
        ...state,
        metadata: { ...state.metadata, right_items: rightItems } as MatchingMetadata,
      };
    }

    case 'SET_LEFT_MATCH': {
      const { optIndex, rightTexts } = action.payload;
      const newOpts = [...state.options];
      newOpts[optIndex] = { ...newOpts[optIndex], match_texts: rightTexts };
      return { ...state, options: newOpts };
    }

    case 'SET_CATEGORY_FOR_ITEM': {
      const { optIndex, categories } = action.payload;
      const newOpts = [...state.options];
      newOpts[optIndex] = { ...newOpts[optIndex], category_names: categories };
      return { ...state, options: newOpts };
    }

    case 'ADD_BLANK': {
      const blanks = (state.metadata as ShortAnswerMetadata).blanks || [];
      return {
        ...state,
        metadata: {
          ...state.metadata,
          blanks: [
            ...blanks,
            action.payload ?? { answer: '', variations: [] },
          ],
        } as ShortAnswerMetadata,
      };
    }

    case 'UPDATE_BLANK': {
      const { index, fields } = action.payload;
      const blanks = [...((state.metadata as ShortAnswerMetadata).blanks || [])];
      blanks[index] = { ...blanks[index], ...fields };
      return {
        ...state,
        metadata: { ...state.metadata, blanks } as ShortAnswerMetadata,
      };
    }

    case 'REMOVE_BLANK': {
      const blanks = (state.metadata as ShortAnswerMetadata).blanks || [];
      return {
        ...state,
        metadata: {
          ...state.metadata,
          blanks: blanks.filter((_, i) => i !== action.payload),
        } as ShortAnswerMetadata,
      };
    }

    case 'SET_SCORE':
      return { ...state, scoreDefault: action.payload };

    case 'SET_KISI_KISI':
      return { ...state, kisiKisi: action.payload };

    case 'SET_PEMBAHASAN':
      return { ...state, pembahasan: action.payload };

    case 'SET_OPTION_WEIGHT': {
      const { index, weight } = action.payload;
      const newOpts = [...state.options];
      newOpts[index] = { ...newOpts[index], weight };
      return { ...state, options: newOpts };
    }

    case 'SET_CORRECT_ORDER':
      return {
        ...state,
        metadata: { ...state.metadata, correct_order: action.payload } as OrderingMetadata,
      };

    case 'MOVE_ORDERING_ITEM': {
      const { from, to } = action.payload;
      const newOpts = [...state.options];
      const [moved] = newOpts.splice(from, 1);
      newOpts.splice(to, 0, moved);
      newOpts.forEach((o, i) => { o.order = i; });
      // Sync correct_order to match new option order
      const ids = newOpts.map(o => o.id || String(o.order));
      return {
        ...state,
        options: newOpts,
        metadata: { ...state.metadata, correct_order: ids } as OrderingMetadata,
      };
    }

    case 'RESET_FOR_TYPE': {
      const base: QuestionState = {
        id: state.id,
        type: action.payload,
        questionText: '',
        options: [],
        metadata: {} as QuestionMetadata,
        categories: [],
        scoreDefault: 1,
        kisiKisi: '',
        pembahasan: '',
      };
      if (action.payload === 'matching') {
        base.metadata = { right_items: [] } as MatchingMetadata;
      } else if (action.payload === 'short_answer') {
        base.metadata = { blanks: [{ answer: '', variations: [] }] } as ShortAnswerMetadata;
      } else if (action.payload === 'categorization') {
        base.categories = [];
      } else if (action.payload === 'true_false') {
        base.options = [
          createOption('', true),
          createOption('', false),
        ];
      } else if (action.payload === 'ordering') {
        base.options = [];
        base.metadata = { correct_order: [] } as OrderingMetadata;
      }
      return base;
    }

    case 'LOAD_QUESTION':
      return { ...action.payload };

    default:
      return state;
  }
}

function createOption(
  text: string,
  isCorrect: boolean,
  extra: Partial<BaseOption> = {}
): BaseOption {
  return {
    text,
    isCorrect,
    order: 0,
    weight: isCorrect ? 1 : 0,
    match_texts: [],
    category_names: [],
    ...extra,
  };
}
