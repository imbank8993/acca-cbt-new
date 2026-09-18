"use client";
/**
 * QuestionFormsWrapper — demonstrates integration of the new schema-driven
 * question forms with the existing QuestionEditorModal.
 *
 * This wrapper:
 * 1. Uses useReducer for all option/metadata state (schema.ts)
 * 2. Renders the correct form via QuestionForms orchestrator
 * 3. Syncs back to the parent's props via callbacks
 *
 * Usage: Replace the inline form conditionals in QuestionEditorModal
 * with this wrapper component.
 */
import React, { useCallback } from 'react';
import {
  QuestionForms,
  useQuestionForms,
} from './QuestionForms';
import {
  type QuestionType,
  type BaseOption,
} from '../schema';

interface QuestionFormsWrapperProps {
  selectedType: QuestionType;
  options: BaseOption[];
  metadata: Record<string, unknown>;
  categories: string[];
  scoreDefault: number;
  kisiKisi: string;
  pembahasan: string;
  // Setters (from parent state)
  setOptions: (opts: BaseOption[]) => void;
  setMetadata: (meta: Record<string, unknown>) => void;
  setCategories: (cats: string[]) => void;
  setScoreDefault: (score: number) => void;
  setKisiKisi: (kisi: string) => void;
  setPembahasan: (p: string) => void;
}

export const QuestionFormsWrapper = React.memo(({
  selectedType,
  options,
  metadata,
  categories,
  scoreDefault,
  kisiKisi,
  pembahasan,
  setOptions,
  setMetadata,
  setCategories,
  setScoreDefault,
  setKisiKisi,
  setPembahasan,
}: QuestionFormsWrapperProps) => {
  // Initialize reducer state from props
  const { state, dispatch } = useQuestionForms({
    type: selectedType,
    options,
    metadata: metadata as any,
    categories,
    scoreDefault,
    kisiKisi,
    pembahasan,
  });

  // Dispatch wrapper that syncs to parent
  const reducer = useCallback(
    (action: Parameters<typeof dispatch>[0]) => {
      dispatch(action);
      // Note: sync happens via useEffect in the parent,
      // or you can use useEffect here to call syncToParent(state)
    },
    [dispatch]
  );

  return (
    <QuestionForms
      state={state}
      dispatch={reducer}
    />
  );
});

QuestionFormsWrapper.displayName = 'QuestionFormsWrapper';

/**
 * USE_QUESTION_FORMS — custom hook version for pages that manage
 * their own question state. Provides state + dispatch + type-safe setters.
 *
 * Example usage in a page:
 *
 *   const { state, dispatch, setters } = useQuestionFormState({
 *     type: 'mcq',
 *     scoreDefault: 1,
 *   });
 *
 *   // Then in JSX:
 *   <QuestionForms state={state} dispatch={dispatch} />
 *
 *   // And for saving:
 *   const handleSave = async () => {
 *     const payload = {
 *       type: state.type,
 *       questionText,
 *       options: state.options,
 *       metadata: state.metadata,
 *       categories: state.categories,
 *       scoreDefault: state.scoreDefault,
 *     };
 *     await saveQuestionAction(payload);
 *   };
 */
export function useQuestionFormState(initial?: {
  type?: QuestionType;
  scoreDefault?: number;
}) {
  const { state, dispatch } = useQuestionForms({
    type: initial?.type ?? 'mcq',
    scoreDefault: initial?.scoreDefault ?? 1,
  });

  const setters = {
    setType: useCallback(
      (t: QuestionType) => dispatch({ type: 'SET_TYPE', payload: t }),
      [dispatch]
    ),
    setOptions: useCallback(
      (opts: BaseOption[]) => dispatch({ type: 'SET_OPTIONS', payload: opts }),
      [dispatch]
    ),
    addOption: useCallback(
      (extra?: Partial<BaseOption>) => dispatch({ type: 'ADD_OPTION', payload: extra }),
      [dispatch]
    ),
    removeOption: useCallback(
      (idx: number) => dispatch({ type: 'REMOVE_OPTION', payload: idx }),
      [dispatch]
    ),
    updateOption: useCallback(
      (idx: number, fields: Partial<BaseOption>) =>
        dispatch({ type: 'UPDATE_OPTION', payload: { index: idx, fields } }),
      [dispatch]
    ),
    setMetadata: useCallback(
      (meta: Record<string, unknown>) =>
        dispatch({ type: 'SET_METADATA', payload: meta as any }),
      [dispatch]
    ),
    setCategories: useCallback(
      (cats: string[]) => dispatch({ type: 'SET_CATEGORIES', payload: cats }),
      [dispatch]
    ),
    setScore: useCallback(
      (s: number) => dispatch({ type: 'SET_SCORE', payload: s }),
      [dispatch]
    ),
    setKisiKisi: useCallback(
      (k: string) => dispatch({ type: 'SET_KISI_KISI', payload: k }),
      [dispatch]
    ),
    setPembahasan: useCallback(
      (p: string) => dispatch({ type: 'SET_PEMBAHASAN', payload: p }),
      [dispatch]
    ),
    resetForType: useCallback(
      (t: QuestionType) => dispatch({ type: 'RESET_FOR_TYPE', payload: t }),
      [dispatch]
    ),
    loadQuestion: useCallback(
      (q: typeof state) => dispatch({ type: 'LOAD_QUESTION', payload: q }),
      [dispatch]
    ),
  };

  return { state, dispatch, setters };
}
