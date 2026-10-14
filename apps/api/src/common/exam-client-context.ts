import { isIP } from 'node:net';

export function examClientContext(request: {
    headers: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
}, internalKey = process.env.INTERNAL_API_KEY) {
    const header = (name: string) => typeof request.headers[name] === 'string' ? request.headers[name] as string : '';
    const trusted = Boolean(internalKey) && header('x-internal-key') === internalKey;
    const rawIp = trusted ? header('x-cbt-client-ip') : request.socket?.remoteAddress || '';
    const ip = rawIp.replace(/^::ffff:/, '').trim();
    const ua = (trusted ? header('x-cbt-client-ua') : header('user-agent')).slice(0, 1024);
    const browsers: [string, RegExp][] = [
        ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/i], ['Opera', /(?:OPR|Opera)\/([\d.]+)/i],
        ['Samsung Internet', /SamsungBrowser\/([\d.]+)/i], ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/i],
        ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/i], ['Safari', /Version\/([\d.]+).*Safari/i],
    ];
    let browser: string | null = null;
    for (const [name, pattern] of browsers) {
        const match = ua.match(pattern);
        if (match) { browser = `${name} ${match[1].split('.')[0]}`; break; }
    }
    const os = /Windows/i.test(ua) ? 'Windows' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
        : /Android/i.test(ua) ? 'Android' : /CrOS/i.test(ua) ? 'ChromeOS'
            : /Macintosh|Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : null;
    return { browser, os, ip_address: isIP(ip) && !/^127\./.test(ip) && ip !== '::1' ? ip : null };
}
