/** In the documented nginx setup, the proxy appends its observed peer last.
 * Earlier entries may have been supplied by the caller and are not evidence.
 */
export function examClientHeaders(headers: Pick<Headers, 'get'>, internalKey: string) {
    const ip = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || '';
    return {
        'x-internal-key': internalKey,
        'x-cbt-client-ip': ip.slice(0, 64),
        'x-cbt-client-ua': (headers.get('user-agent') || '').slice(0, 1024),
    };
}
