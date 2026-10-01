/**
 * arabic-utils.ts — Utilitas untuk mendeteksi, menangani, dan memformat tipografi
 * teks bahasa Arab dan teks Latin agar tampilan sangat elegan, jelas, dan proporsional.
 * Unicode Arab: U+0600–U+06FF (Arab dasar & harakat), U+0750–U+077F (Tambahan Arab),
 *               U+08A0–U+08FF (Arab Extended-A),
 *               U+FB50–U+FDFF (Presentasi Arab A), U+FE70–U+FEFF (Presentasi Arab B)
 */

/** Regex mendeteksi karakter dan harakat Arab */
export const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Regex mendeteksi karakter huruf Latin */
export const LATIN_REGEX = /[A-Za-z\u00C0-\u024F]/;

/**
 * Mengembalikan true jika string mengandung minimal satu karakter Arab.
 * Bekerja pada teks biasa maupun HTML.
 */
export function containsArabic(text: string): boolean {
  if (!text) return false;
  return ARABIC_REGEX.test(text);
}

/**
 * Mengembalikan true jika string mengandung minimal satu huruf Latin.
 */
export function containsLatin(text: string): boolean {
  if (!text) return false;
  return LATIN_REGEX.test(text);
}

/**
 * Menghapus tag HTML dari string sebelum memeriksa teks Arab,
 * agar tidak ada false positive dari teks dalam atribut tag.
 */
export function htmlContainsArabic(html: string): boolean {
  if (!html) return false;
  const textOnly = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return ARABIC_REGEX.test(textOnly);
}

/**
 * Menghapus tag HTML dari string sebelum memeriksa teks Latin.
 */
export function htmlContainsLatin(html: string): boolean {
  if (!html) return false;
  const textOnly = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return LATIN_REGEX.test(textOnly);
}

export type TextSegmentType = 'arabic' | 'latin' | 'latin_gloss' | 'neutral';

export interface TextSegment {
  type: TextSegmentType;
  text: string;
}

/**
 * Memecah teks biasa menjadi segmen-segmen terpisah:
 * - 'arabic': teks Arab (akan diberi font Arab yang proporsional dan ukuran lebih besar untuk harakat)
 * - 'latin_gloss': teks Latin di dalam tanda kurung seperti "(Masjid adalah tempat shalat)" (terjemahan / keterangan)
 * - 'latin': teks Latin di luar tanda kurung (pertanyaan, opsi, instruksi)
 * - 'neutral': pemisah spasi atau tanda baca
 */
export function segmentArabicAndLatin(text: string): TextSegment[] {
  if (!text) return [];

  // Jika tidak ada huruf Arab sama sekali
  if (!ARABIC_REGEX.test(text)) {
    return [{ type: 'latin', text }];
  }

  // Jika ada huruf Arab dan TIDAK ADA huruf Latin sama sekali
  if (!LATIN_REGEX.test(text)) {
    return [{ type: 'arabic', text }];
  }

  // Teks campuran (mengandung huruf Arab dan huruf Latin)
  // Tahap 1: Tangkap teks Latin di dalam kurung e.g. "(Masjid adalah tempat shalat)", "(Buku)"
  const parenRegex = /(\([^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]*?[A-Za-z][^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]*?\))/g;
  const rawParts: { isParen: boolean; content: string }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = parenRegex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      rawParts.push({ isParen: false, content: text.slice(lastIdx, m.index) });
    }
    rawParts.push({ isParen: true, content: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    rawParts.push({ isParen: false, content: text.slice(lastIdx) });
  }

  const result: TextSegment[] = [];

  for (const part of rawParts) {
    if (part.isParen) {
      result.push({ type: 'latin_gloss', text: part.content });
      continue;
    }

    const str = part.content;
    if (!str) continue;

    const hasAr = ARABIC_REGEX.test(str);
    const hasLat = LATIN_REGEX.test(str);

    if (hasAr && !hasLat) {
      result.push({ type: 'arabic', text: str });
      continue;
    }
    if (!hasAr && hasLat) {
      result.push({ type: 'latin', text: str });
      continue;
    }
    if (!hasAr && !hasLat) {
      result.push({ type: 'neutral', text: str });
      continue;
    }

    // Teks dalam bagian ini mengandung huruf Arab dan Latin (e.g. "بَيْتٌ Rumah" atau "Arti kata كِتَابٌ adalah")
    const arRegex = /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[\s،؛؟ـ\.\,\:\;\"\'\-]+[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)*)/g;
    let sLast = 0;
    let sm: RegExpExecArray | null;

    while ((sm = arRegex.exec(str)) !== null) {
      if (sm.index > sLast) {
        const between = str.slice(sLast, sm.index);
        if (LATIN_REGEX.test(between)) {
          result.push({ type: 'latin', text: between });
        } else {
          result.push({ type: 'neutral', text: between });
        }
      }
      result.push({ type: 'arabic', text: sm[1] });
      sLast = sm.index + sm[0].length;
    }

    if (sLast < str.length) {
      const rest = str.slice(sLast);
      if (LATIN_REGEX.test(rest)) {
        result.push({ type: 'latin', text: rest });
      } else {
        result.push({ type: 'neutral', text: rest });
      }
    }
  }

  return result;
}

/**
 * Mengembalikan font family yang sesuai:
 * - Jika teks mengandung bahasa Arab: prioritaskan font Naskh klasik (Amiri) & modern (Noto Naskh Arabic, Cairo)
 * - Jika teks Latin biasa: font serif CBT profesional
 */
export function getFontFamilyForText(html: string): string {
  if (htmlContainsArabic(html)) {
    return "'Amiri', 'Noto Naskh Arabic', 'Cairo', 'Traditional Arabic', serif";
  }
  return "'Merriweather', 'Source Serif 4', Georgia, serif";
}

/**
 * Mengembalikan direction CSS yang tepat ('rtl' atau 'ltr'):
 * - Jika teks murni atau mayoritas Arab (atau diawali kata Arab setelah nomor/label): 'rtl'
 * - Jika pertanyaan Latin dengan selipan istilah Arab: 'ltr'
 */
export function getTextDirection(html: string): 'rtl' | 'ltr' {
  if (!htmlContainsArabic(html)) return 'ltr';

  const textOnly = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();

  // Bersihkan label opsi awal seperti "A. ", "1. ", "(A) ", "P1 "
  const cleaned = textOnly.replace(/^(?:\(?[A-Za-z0-9]+\)?[\.\:\)]\s*)+/, '').trim();

  // Jika karakter pertama setelah label adalah karakter Arab, maka RTL
  if (cleaned.length > 0 && ARABIC_REGEX.test(cleaned.charAt(0))) {
    return 'rtl';
  }

  // Hitung proporsi huruf Arab vs Latin
  const arMatches = cleaned.match(new RegExp(ARABIC_REGEX.source, 'g')) || [];
  const latMatches = cleaned.match(new RegExp(LATIN_REGEX.source, 'g')) || [];

  return arMatches.length >= latMatches.length ? 'rtl' : 'ltr';
}
