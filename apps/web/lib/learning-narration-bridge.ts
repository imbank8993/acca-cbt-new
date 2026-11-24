/**
 * Audio narasi untuk materi HTML ("video" berbasis HTML).
 *
 * Iframe materi tidak boleh mengakses jaringan (CSP `connect-src 'none'`, origin opaque),
 * jadi halaman induk mengambil audio lewat endpoint LMS berautentikasi lalu mengirim
 * byte-nya ke iframe. Skrip di bawah berjalan DI DALAM sandbox: membuat URL blob milik
 * iframe sendiri (diizinkan `media-src blob:`) dan memasangnya ke pemutar.
 *
 * Konvensi untuk penulis HTML:
 * - `<audio data-lms-narration controls>`: pemutar milik materi. Jika tidak ada, pemutar
 *   bawaan muncul di bagian bawah layar.
 * - `data-lms-at="12.5"` (+ opsional `data-lms-until="30"`): elemen hanya tampil pada
 *   rentang detik audio tersebut. Tambahkan `data-lms-keep` agar elemen tidak
 *   disembunyikan; hanya kelas `lms-active` yang berganti (untuk animasi CSS sendiri).
 * - `data-lms-seek="42"` pada tombol/tautan: lompat ke detik tersebut.
 * - Event `lms:narration` (detail.audio) dan `lms:narration-time` (detail.time) untuk
 *   animasi JavaScript sendiri.
 */
export function learningNarrationBridge(channel: string) {
    return `(${runtime.toString()})(${JSON.stringify(channel)})`;
}

export function narrationMimeType(name?: string | null) {
    const extension = name?.split('.').pop()?.toLowerCase() || '';
    const types: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };
    return types[extension] || 'audio/mpeg';
}

function runtime(channel: string) {
    let audio: HTMLAudioElement | null = null;
    let received = false;
    let frame = 0;
    const cues = () => Array.from(document.querySelectorAll<HTMLElement>('[data-lms-at]'));
    const update = () => {
        const time = audio ? audio.currentTime : 0;
        cues().forEach(node => {
            const at = parseFloat(node.getAttribute('data-lms-at') || '0');
            const until = parseFloat(node.getAttribute('data-lms-until') || '');
            const active = time >= (isNaN(at) ? 0 : at) && (isNaN(until) || time < until);
            node.classList.toggle('lms-active', active);
            if (!node.hasAttribute('data-lms-keep')) node.style.display = active ? '' : 'none';
        });
        window.dispatchEvent(new CustomEvent('lms:narration-time', { detail: { time } }));
    };
    const tick = () => { update(); frame = audio && !audio.paused ? requestAnimationFrame(tick) : 0; };
    const revealAll = () => cues().forEach(node => { node.style.display = ''; node.classList.add('lms-active'); });
    const player = () => {
        const own = document.querySelector<HTMLAudioElement>('audio[data-lms-narration]');
        if (own) return own;
        const bar = document.createElement('div');
        bar.setAttribute('data-lms-ignore', '');
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:8px 12px;background:rgba(255,255,255,.96);box-shadow:0 -4px 18px rgba(15,23,42,.12);display:flex;align-items:center;gap:10px;font:600 13px system-ui,sans-serif;color:#0f3d2e';
        const label = document.createElement('span'); label.textContent = 'Narasi'; label.style.flex = 'none';
        const element = document.createElement('audio'); element.controls = true; element.style.cssText = 'flex:1;width:100%;height:40px';
        bar.append(label, element);
        document.body.append(bar);
        document.body.style.paddingBottom = `${Math.max(parseFloat(getComputedStyle(document.body).paddingBottom) || 0, 64)}px`;
        return element;
    };
    window.addEventListener('message', event => {
        if (event.source !== parent || event.data?.channel !== channel) return;
        if (event.data.type === 'lms-narration-error') { received = true; revealAll(); return; }
        if (event.data.type !== 'lms-narration' || received || !(event.data.bytes instanceof ArrayBuffer)) return;
        received = true;
        audio = player();
        audio.preload = 'auto';
        audio.src = URL.createObjectURL(new Blob([event.data.bytes], { type: String(event.data.mime || 'audio/mpeg') }));
        for (const name of ['timeupdate', 'seeked', 'loadedmetadata', 'pause', 'ended']) audio.addEventListener(name, update);
        audio.addEventListener('play', () => { if (!frame) frame = requestAnimationFrame(tick); });
        update();
        window.dispatchEvent(new CustomEvent('lms:narration', { detail: { audio } }));
    });
    document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target.closest('[data-lms-seek]') : null;
        if (!target || !audio) return;
        const time = parseFloat(target.getAttribute('data-lms-seek') || '');
        if (isNaN(time)) return;
        event.preventDefault();
        audio.currentTime = time; void audio.play().catch(() => undefined);
    });
    const announce = () => { if (!received) parent.postMessage({ type: 'lms-narration-ready', channel }, '*'); };
    const start = () => { update(); announce(); };
    const handshake = setInterval(() => { if (received) clearInterval(handshake); else announce(); }, 500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
