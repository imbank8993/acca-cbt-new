import sys

file_path = r'C:\Users\imran\.gemini\antigravity\scratch\cbt-app\app\dashboard\proktor\questions\[bankId]\page.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# The Editor modal starts with {/* Editor Modal: SMART SPLIT LAYOUT */} around line 1394
# The preview modal starts with {/* Student View Modal / Global Preview / Simulation Engine */} around line 2062
# Find those indices
start_idx1 = -1
end_idx1 = -1
start_idx2 = -1
end_idx2 = -1

for i, line in enumerate(lines):
    if '{/* Editor Modal: SMART SPLIT LAYOUT */}' in line:
        start_idx1 = i
    if '{/* Student View Modal / Global Preview / Simulation Engine */}' in line:
        end_idx1 = i - 1
        start_idx2 = i
    if '{/* Visual Equation Builder (MathType-style) */}' in line:
        end_idx2 = i - 1

if start_idx1 != -1 and end_idx1 != -1 and start_idx2 != -1 and end_idx2 != -1:
    new_lines = lines[:start_idx1]
    
    # Insert Editor Modal
    new_lines.append('            {/* Editor Modal: SMART SPLIT LAYOUT */}\n')
    new_lines.append('            <QuestionEditorModal\n')
    new_lines.append('                isOpen={isEditorOpen}\n')
    new_lines.append('                onClose={() => setIsEditorOpen(false)}\n')
    new_lines.append('                editingQuestion={editingQuestion}\n')
    new_lines.append('                bankId={params.bankId as string}\n')
    new_lines.append('                org={org}\n')
    new_lines.append('                onSaveSuccess={async () => {\n')
    new_lines.append('                    await fetchQuestions();\n')
    new_lines.append('                    setEditingQuestion(null);\n')
    new_lines.append('                    resetEditor();\n')
    new_lines.append('                    router.refresh();\n')
    new_lines.append('                }}\n')
    new_lines.append('                handleOpenPreview={handleOpenPreview}\n')
    new_lines.append('                setIsEquationBuilderOpen={setIsEquationBuilderOpen}\n')
    new_lines.append('                setIsSymbolPickerOpen={setIsSymbolPickerOpen}\n')
    new_lines.append('                setIsTableConfigOpen={setIsTableConfigOpen}\n')
    new_lines.append('                setQuillInstance={setQuillInstance}\n')
    new_lines.append('                questionText={questionText}\n')
    new_lines.append('                setQuestionText={setQuestionText}\n')
    new_lines.append('                options={options}\n')
    new_lines.append('                setOptions={setOptions}\n')
    new_lines.append('                selectedType={selectedType}\n')
    new_lines.append('                setSelectedType={setSelectedType}\n')
    new_lines.append('                scoreDefault={scoreDefault}\n')
    new_lines.append('                setScoreDefault={setScoreDefault}\n')
    new_lines.append('                metadata={metadata}\n')
    new_lines.append('                setMetadata={setMetadata}\n')
    new_lines.append('                categories={categories}\n')
    new_lines.append('                setCategories={setCategories}\n')
    new_lines.append('                kisiKisi={kisiKisi}\n')
    new_lines.append('                setKisiKisi={setKisiKisi}\n')
    new_lines.append('                isSubmitting={isSubmitting}\n')
    new_lines.append('                setIsSubmitting={setIsSubmitting}\n')
    new_lines.append('                setIsCropperOpen={setIsCropperOpen}\n')
    new_lines.append('                setImageToCrop={setImageToCrop}\n')
    new_lines.append('                setCropperContext={setCropperContext}\n')
    new_lines.append('            />\n\n')
    
    # Insert Preview Modal
    new_lines.append('            {/* Student View Modal / Global Preview / Simulation Engine */}\n')
    new_lines.append('            <PreviewModal\n')
    new_lines.append('                isOpen={isViewModalOpen}\n')
    new_lines.append('                onClose={() => {\n')
    new_lines.append('                    setIsViewModalOpen(false);\n')
    new_lines.append('                    resetSimulation();\n')
    new_lines.append('                    const params = new URLSearchParams(window.location.search);\n')
    new_lines.append('                    params.delete("preview");\n')
    new_lines.append('                    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`);\n')
    new_lines.append('                }}\n')
    new_lines.append('                bankInfo={bankInfo}\n')
    new_lines.append('                viewingQuestion={viewingQuestion}\n')
    new_lines.append('                filteredQuestions={filteredQuestions}\n')
    new_lines.append('                currentPreviewIndex={currentPreviewIndex}\n')
    new_lines.append('                setCurrentPreviewIndex={setCurrentPreviewIndex}\n')
    new_lines.append('                columnWidths={columnWidths}\n')
    new_lines.append('                setColumnWidths={setColumnWidths}\n')
    new_lines.append('                isResizing={isResizing}\n')
    new_lines.append('                handleMouseDown={handleMouseDown}\n')
    new_lines.append('                matchingAnswers={matchingAnswers}\n')
    new_lines.append('                setMatchingAnswers={setMatchingAnswers}\n')
    new_lines.append('                isSimulating={isSimulating}\n')
    new_lines.append('                simulatedResults={simulatedResults}\n')
    new_lines.append('                doubtfulPreviews={doubtfulPreviews}\n')
    new_lines.append('                setDoubtfulPreviews={setDoubtfulPreviews}\n')
    new_lines.append('                runSimulation={runSimulation}\n')
    new_lines.append('                resetSimulation={resetSimulation}\n')
    new_lines.append('                calculateScore={calculateScore}\n')
    new_lines.append('                setQuestions={setQuestions}\n')
    new_lines.append('            />\n\n')
    
    new_lines.extend(lines[end_idx2+1:])
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f'Successfully updated page.tsx ! Removed {end_idx2 - start_idx1} lines.')
else:
    print('Could not find all indices')
    print('start_idx1:', start_idx1)
    print('end_idx1:', end_idx1)
    print('start_idx2:', start_idx2)
    print('end_idx2:', end_idx2)
