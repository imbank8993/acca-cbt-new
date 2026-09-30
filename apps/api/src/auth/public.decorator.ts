import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Tandai endpoint atau controller sebagai endpoint publik yang tidak memerlukan
 * otentikasi JWT (misalnya penyajian file publik / gambar soal).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
