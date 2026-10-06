"use client";
import { AnimatePresence, motion } from 'framer-motion';
import { Crop, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import type { Area, Point } from 'react-easy-crop';
import Cropper from 'react-easy-crop';
import { useClientMounted } from '@/hooks/useClientMounted';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';

interface ImageCropperModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageSrc: string;
    onCropComplete: (croppedImage: string) => void;
    /** Paksa rasio tertentu — mis. 1 untuk 1:1, 16/9 untuk 16:9. undefined = bebas. */
    aspect?: number;
}

const ImageCropperModal = ({ isOpen, onClose, imageSrc, onCropComplete, aspect }: ImageCropperModalProps) => {
    const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
    const mounted = useClientMounted();

    React.useEffect(() => {
        if (isOpen) {
            document.body.classList.add('scroll-locked');
        } else {
            document.body.classList.remove('scroll-locked');
        }
        return () => document.body.classList.remove('scroll-locked');
    }, [isOpen]);

    const onCropChange = (crop: Point) => {
        setCrop(crop);
    };

    const onZoomChange = (zoom: number) => {
        setZoom(zoom);
    };

    const onCropAreaComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
        setCroppedAreaPixels(croppedAreaPixels);
    }, []);

    const createImage = (url: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
            const image = new Image();
            image.addEventListener('load', () => resolve(image));
            image.addEventListener('error', (error) => reject(error));
            image.setAttribute('crossOrigin', 'anonymous');
            image.src = url;
        });

    const getCroppedImg = async (imageSrc: string, pixelCrop: Area, rotation = 0): Promise<string> => {
        const image = await createImage(imageSrc);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) return '';

        const rotateRad = (rotation * Math.PI) / 180;
        const { width: bBoxWidth, height: bBoxHeight } = {
            width: Math.abs(Math.cos(rotateRad) * image.width) + Math.abs(Math.sin(rotateRad) * image.height),
            height: Math.abs(Math.sin(rotateRad) * image.width) + Math.abs(Math.cos(rotateRad) * image.height),
        };

        canvas.width = bBoxWidth;
        canvas.height = bBoxHeight;

        ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
        ctx.rotate(rotateRad);
        ctx.translate(-image.width / 2, -image.height / 2);

        ctx.drawImage(image, 0, 0);

        const data = ctx.getImageData(pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height);

        canvas.width = pixelCrop.width;
        canvas.height = pixelCrop.height;

        ctx.putImageData(data, 0, 0);

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) return;
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    resolve(reader.result as string);
                };
            }, 'image/jpeg');
        });
    };

    const handleConfirm = async () => {
        if (!croppedAreaPixels) return;
        try {
            const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels, rotation);
            onCropComplete(croppedImage);
            onClose();
        } catch (e) {
            console.error(e);
        }
    };

    if (!mounted) return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/70 backdrop-blur-xs"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 12 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 12 }}
                        className="relative w-full max-w-2xl bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[75vh] max-h-[580px]"
                    >
                        {/* Header */}
                        <div className="px-5 py-3.5 border-b border-slate-200/80 flex justify-between items-center bg-white">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                                    <Crop size={16} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-slate-800 leading-tight">Sesuaikan Foto Cover</h3>
                                    {aspect === 1 && (
                                        <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">Rasio persegi (1:1)</p>
                                    )}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                aria-label="Tutup"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Cropper Container */}
                        <div className="relative flex-1 bg-slate-900 overflow-hidden">
                            <Cropper
                                image={imageSrc}
                                crop={crop}
                                zoom={zoom}
                                rotation={rotation}
                                aspect={aspect}
                                onCropChange={onCropChange}
                                onCropComplete={onCropAreaComplete}
                                onZoomChange={onZoomChange}
                                onRotationChange={setRotation}
                            />
                        </div>

                        {/* Controls & Actions */}
                        <div className="p-4 sm:p-5 space-y-4 bg-white border-t border-slate-200/80">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-medium text-slate-600">Perbesar (Zoom)</span>
                                        <span className="font-semibold text-primary">{Math.round(zoom * 100)}%</span>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        <ZoomOut size={14} className="text-slate-400 flex-shrink-0" />
                                        <input
                                            type="range"
                                            value={zoom}
                                            min={1}
                                            max={3}
                                            step={0.1}
                                            aria-label="Zoom"
                                            onChange={(e) => onZoomChange(Number(e.target.value))}
                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#3083FF]"
                                        />
                                        <ZoomIn size={14} className="text-slate-400 flex-shrink-0" />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="font-medium text-slate-600">Rotasi</span>
                                        <span className="font-semibold text-primary">{rotation}°</span>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        <RotateCcw size={14} className="text-slate-400 flex-shrink-0" />
                                        <input
                                            type="range"
                                            value={rotation}
                                            min={0}
                                            max={360}
                                            step={1}
                                            aria-label="Rotasi"
                                            onChange={(e) => setRotation(Number(e.target.value))}
                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#3083FF]"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                                <Button
                                    type="button"
                                    variant="cancel"
                                    onClick={onClose}
                                    icon="cancel"
                                >
                                    Batal
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleConfirm}
                                    icon="save"
                                >
                                    Gunakan Gambar
                                </Button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
};

export default ImageCropperModal;
