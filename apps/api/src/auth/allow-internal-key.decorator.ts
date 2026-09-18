import { SetMetadata } from '@nestjs/common';

export const ALLOW_INTERNAL_KEY = 'allowInternalKey';

/**
 * Izinkan endpoint ini dipanggil dengan `x-internal-key` selain dengan token
 * pengguna.
 *
 * Harus disebutkan per-endpoint, TIDAK berlaku menyeluruh. Sebelumnya
 * `JwtAuthGuard` menerima kunci internal untuk endpoint mana pun — akibatnya
 * setiap endpoint terjaga bisa dipanggil tanpa pengguna sama sekali, dan
 * `@CurrentUser()` menjadi null tanpa ada yang menyadarinya.
 *
 * Pakai hanya untuk endpoint yang memang TIDAK bergantung pada identitas
 * pemanggil dan tidak mengembalikan data sensitif.
 */
export const AllowInternalKey = () => SetMetadata(ALLOW_INTERNAL_KEY, true);
