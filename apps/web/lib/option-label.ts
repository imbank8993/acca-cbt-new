/** Spreadsheet-style labels: A…Z, AA…AZ, BA… */
export function optionLabel(index: number): string {
    let label = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        label = String.fromCharCode(65 + (n - 1) % 26) + label;
    }
    return label;
}
export function optionIndex(label: string): number {
    return [...label.toUpperCase()].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
}
