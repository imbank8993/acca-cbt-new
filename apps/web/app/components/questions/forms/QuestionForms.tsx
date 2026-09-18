"use client";
/**
 * QuestionForms — Orchestrator for all question type forms.
 * Uses useReducer + schema types for clean, scalable state management.
 * Replaces the monolithic inline conditionals in QuestionEditorModal.
 */
import React, { useReducer, useCallback, useMemo } from 'react';
import {
  questionReducer,
  createDefaultState,
  type QuestionState,
  type QuestionAction,
  type QuestionType,
  type BaseOption,
  QUESTION_TYPE_MAP,
} from '../schema';

import { MCQForm } from './MCQForm';
import { TrueFalseForm } from './TrueFalseForm';
import { MatchingForm } from './MatchingForm';
import { CategorizationForm } from './CategorizationForm';
import { ShortAnswerForm } from './ShortAnswerForm';
import { EssayForm } from './EssayForm';
import { SJTForm } from './SJTForm';
import { OrderingForm } from './OrderingForm';

interface QuestionFormsProps {
  /** Initial state (e.g., editing an existing question) */
  initial?: Partial<QuestionState>;
  /** Called when the form state changes */
  onChange?: (state: QuestionState) => void;
}

/**
 * Hook to manage question form state with useReducer.
 */
export function useQuestionForms(initial?: Partial<QuestionState>) {
  const mergedInitial = useMemo(
    () => ({ ...createDefaultState(initial?.type ?? 'mcq'), ...initial }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [state, dispatch] = useReducer(questionReducer, mergedInitial);

  // Dispatch + notify parent on change
  const reducer = useCallback(
    (action: QuestionAction) => {
      dispatch(action);
    },
    [dispatch]
  );

  return { state, dispatch, reducer };
}

/**
 * Main orchestrator component — renders the correct form based on question type.
 */
export const QuestionForms = React.memo(({
  state,
  dispatch,
}: {
  state: QuestionState;
  dispatch: React.Dispatch<QuestionAction>;
}) => {
  const info = QUESTION_TYPE_MAP[state.type];
  if (!info) return null;

  // --- Type-agnostic handlers ---
  const addOption = useCallback(
    (extra: Partial<BaseOption> = {}) => dispatch({ type: 'ADD_OPTION', payload: extra }),
    [dispatch]
  );

  const addOptions = useCallback(
    (options: Partial<BaseOption>[]) => dispatch({ type: 'ADD_OPTIONS', payload: options }),
    [dispatch]
  );

  const removeOption = useCallback(
    (index: number) => dispatch({ type: 'REMOVE_OPTION', payload: index }),
    [dispatch]
  );

  const updateOption = useCallback(
    (index: number, fields: Partial<BaseOption>) =>
      dispatch({ type: 'UPDATE_OPTION', payload: { index, fields } }),
    [dispatch]
  );

  const insertOption = useCallback(
    (index: number, fields: Partial<BaseOption> = {}) =>
      dispatch({ type: 'INSERT_OPTION', payload: { index, fields } }),
    [dispatch]
  );

  // --- Type-specific handlers ---
  const handleSetAllCorrect = useCallback(
    (index: number) => dispatch({ type: 'SET_ALL_CORRECT', payload: { index } }),
    [dispatch]
  );

  const handleToggleCorrect = useCallback(
    (index: number) => dispatch({ type: 'TOGGLE_CORRECT', payload: { index } }),
    [dispatch]
  );

  const handleAddLeftItem = useCallback(
    () => dispatch({ type: 'ADD_OPTION', payload: { match_texts: [] } }),
    [dispatch]
  );

  const handleRemoveLeftItem = useCallback(
    (index: number) => dispatch({ type: 'REMOVE_OPTION', payload: index }),
    [dispatch]
  );

  const handleUpdateLeftItem = useCallback(
    (index: number, text: string) =>
      dispatch({ type: 'UPDATE_OPTION', payload: { index, fields: { text } } }),
    [dispatch]
  );

  const handleAddRightItem = useCallback(
    () => dispatch({ type: 'ADD_RIGHT_ITEM' }),
    [dispatch]
  );

  const handleRemoveRightItem = useCallback(
    (index: number) => dispatch({ type: 'REMOVE_RIGHT_ITEM', payload: index }),
    [dispatch]
  );

  const handleUpdateRightItem = useCallback(
    (index: number, text: string) =>
      dispatch({ type: 'UPDATE_RIGHT_ITEM', payload: { index, text } }),
    [dispatch]
  );

  const handleSetLeftMatch = useCallback(
    (optIndex: number, rightTexts: string[]) =>
      dispatch({ type: 'SET_LEFT_MATCH', payload: { optIndex, rightTexts } }),
    [dispatch]
  );

  const handleSetCategories = useCallback(
    (cats: string[]) => dispatch({ type: 'SET_CATEGORIES', payload: cats }),
    [dispatch]
  );

  const handleSetItemCategory = useCallback(
    (optIndex: number, categories: string[]) =>
      dispatch({ type: 'SET_CATEGORY_FOR_ITEM', payload: { optIndex, categories } }),
    [dispatch]
  );

  const handleAddBlank = useCallback(
    () => dispatch({ type: 'ADD_BLANK', payload: { answer: '', variations: [] } }),
    [dispatch]
  );

  const handleRemoveBlank = useCallback(
    (index: number) => dispatch({ type: 'REMOVE_BLANK', payload: index }),
    [dispatch]
  );

  const handleUpdateBlank = useCallback(
    (index: number, fields: { answer?: string; variations?: string[] }) =>
      dispatch({ type: 'UPDATE_BLANK', payload: { index, fields } }),
    [dispatch]
  );

  const handleSetOptionWeight = useCallback(
    (index: number, weight: number) =>
      dispatch({ type: 'SET_OPTION_WEIGHT', payload: { index, weight } }),
    [dispatch]
  );

  const handleSetCorrectOrder = useCallback(
    (order: string[]) => dispatch({ type: 'SET_CORRECT_ORDER', payload: order }),
    [dispatch]
  );

  const handleMoveOrderingItem = useCallback(
    (from: number, to: number) =>
      dispatch({ type: 'MOVE_ORDERING_ITEM', payload: { from, to } }),
    [dispatch]
  );

  // Render appropriate form
  const renderForm = () => {
    switch (state.type) {
      case 'mcq':
      case 'mcq_complex':
        return (
          <MCQForm
            options={state.options}
            isComplex={state.type === 'mcq_complex'}
            onAddOption={addOption}
            onBulkAdd={(texts) => addOptions(texts.map(t => ({ text: t })))}
            onInsertOption={insertOption}
            onRemoveOption={removeOption}
            onUpdateOption={updateOption}
            onSetAllCorrect={handleSetAllCorrect}
            onToggleCorrect={handleToggleCorrect}
          />
        );

      case 'true_false':
        return (
          <TrueFalseForm
            options={state.options}
            onAddOption={addOption}
            onBulkAdd={(texts) => addOptions(texts.map(t => ({ text: t })))}
            onInsertOption={insertOption}
            onRemoveOption={removeOption}
            onUpdateOption={updateOption}
          />
        );

      case 'matching':
        return (
          <MatchingForm
            options={state.options}
            rightItems={(state.metadata as any).right_items || []}
            onAddLeftItem={handleAddLeftItem}
            onRemoveLeftItem={handleRemoveLeftItem}
            onUpdateLeftItem={handleUpdateLeftItem}
            onAddRightItem={handleAddRightItem}
            onRemoveRightItem={handleRemoveRightItem}
            onUpdateRightItem={handleUpdateRightItem}
            onSetLeftMatch={handleSetLeftMatch}
          />
        );

      case 'categorization':
        return (
          <CategorizationForm
            options={state.options}
            categories={state.categories}
            onAddItem={addOption}
            onBulkAdd={(texts) => addOptions(texts.map(t => ({ text: t })))}
            onInsertItem={insertOption}
            onRemoveItem={removeOption}
            onUpdateItem={(idx, text) => updateOption(idx, { text })}
            onSetCategories={handleSetCategories}
            onSetItemCategory={handleSetItemCategory}
          />
        );

      case 'short_answer':
        return (
          <ShortAnswerForm
            blanks={(state.metadata as any).blanks || []}
            questionText={state.questionText}
            onAddBlank={handleAddBlank}
            onRemoveBlank={handleRemoveBlank}
            onUpdateBlank={handleUpdateBlank}
          />
        );

      case 'essay':
        return <EssayForm 
          metadata={(state.metadata as any) || {}}
          onUpdateMetadata={(fields) => dispatch({ type: 'SET_METADATA', payload: fields })}
        />;

      case 'sjt':
        return (
          <SJTForm
            options={state.options}
            onAddOption={addOption}
            onBulkAdd={(texts) => addOptions(texts.map(t => ({ text: t })))}
            onInsertOption={insertOption}
            onRemoveOption={removeOption}
            onUpdateOption={updateOption}
            onSetOptionWeight={handleSetOptionWeight}
          />
        );

      case 'ordering':
        return (
          <OrderingForm
            options={state.options}
            correctOrder={((state.metadata as any).correct_order as string[]) || []}
            onAddItem={() => dispatch({ type: 'ADD_OPTION', payload: {} })}
            onBulkAdd={(texts) => addOptions(texts.map(t => ({ text: t })))}
            onRemoveItem={removeOption}
            onUpdateItem={(idx, fields) => updateOption(idx, fields)}
            onMoveItem={handleMoveOrderingItem}
            onSetCorrectOrder={handleSetCorrectOrder}
          />
        );

      default:
        return (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-600">
            Tipe soal tidak dikenali: {state.type}
          </div>
        );
    }
  };

  return <>{renderForm()}</>;
});

QuestionForms.displayName = 'QuestionForms';
