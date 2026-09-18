#!/usr/bin/env python3
"""Remove duplicate const doc block in question.ts."""
import sys

path = r'c:\Users\imran\.gemini\antigravity\scratch\cbt-app\app\actions\question.ts'

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find both occurrences of "const doc = new Document({"
doc1 = None
doc2 = None
for i, line in enumerate(lines):
    if line.strip() == 'const doc = new Document({':
        if doc1 is None:
            doc1 = i
        else:
            doc2 = i
            break

if doc1 is None or doc2 is None:
    print(f'Could not find both doc declarations. doc1={doc1}, doc2={doc2}')
    sys.exit(1)

print(f'Found duplicate const doc at line {doc2+1} (first at line {doc1+1})')

# Find the end of the second doc block: line with "});" after doc2
# and before "const buffer"
end_line = None
for i in range(doc2, len(lines)):
    if lines[i].strip() == '});':
        end_line = i
        break

if end_line is None:
    print('Could not find end of duplicate doc block')
    sys.exit(1)

print(f'Removing lines {doc2+1} to {end_line+1}')

# Remove lines from doc2 to end_line inclusive
new_lines = lines[:doc2] + lines[end_line+1:]

with open(path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f'Done! File now has {len(new_lines)} lines')