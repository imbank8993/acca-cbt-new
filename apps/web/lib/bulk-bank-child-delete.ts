import { getErrorMessage } from './errors';

/** Delete selected bank items in small batches, retaining failures for retry. */
export async function deleteBankChildItems(
    ids: string[],
    remove: (id: string) => Promise<{ success: boolean; error?: string }>,
): Promise<{ failedIds: string[]; firstError: string }> {
    const failedIds: string[] = [];
    let firstError = '';

    for (let offset = 0; offset < ids.length; offset += 5) {
        const results = await Promise.all(ids.slice(offset, offset + 5).map(async id => {
            try { return await remove(id); }
            catch (error) { return { success: false, error: getErrorMessage(error) }; }
        }));
        results.forEach((result, index) => {
            if (result.success) return;
            failedIds.push(ids[offset + index]);
            firstError ||= result.error || 'Permintaan gagal.';
        });
    }

    return { failedIds, firstError };
}
