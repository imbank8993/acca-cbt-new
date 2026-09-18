"use client";
import React, { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Crop, Check, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ImageCropperModalProps {
    isOpen: boolean;
    onClose: () => void;
    imageSrc: string;
    onCropComplete: (croppedImage: string) => void;
}

import { createPortal } from 'react-dom';

const ImageCropperModal = ({ isOpen, onClose, imageSrc, onCropComplete }: ImageCropperModalProps) => {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
    const [mounted, setMounted] = useState(false);

    React.useEffect(() => {
        setMounted(true);
        if (isOpen) {
            document.body.classList.add('scroll-locked');
        } else {
            document.body.classList.remove('scroll-locked');
        }
        return () => document.body.classList.remove('scroll-locked');
    }, [isOpen]);

    const onCropChange = (crop: any) => {
        setCrop(crop);
    };

    const onZoomChange = (zoom: number) => {
        setZoom(zoom);
    };

    const onCropAreaComplete = useCallback((_croppedArea: any, croppedAreaPixels: any) => {
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

    const getCroppedImg = async (imageSrc: string, pixelCrop: any, rotation = 0): Promise<string> => {
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
                        className="absolute inset-0 bg-black/80"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-4xl bg-white border border-slate-100 rounded-[32px] overflow-hidden shadow-2xl flex flex-col h-[80vh]"
                    >
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary/10 rounded-xl text-primary font-black">
                                    <Crop size={20} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-primary uppercase tracking-tight">Crop & Potong Gambar</h3>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">Sesuaikan tampilan gambar sesuai keinginan</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="relative flex-1 bg-slate-100 overflow-hidden">
                            <Cropper
                                image={imageSrc}
                                crop={crop}
                                zoom={zoom}
                                rotation={rotation}
                                aspect={undefined} // Free aspect ratio
                                onCropChange={onCropChange}
                                onCropComplete={onCropAreaComplete}
                                onZoomChange={onZoomChange}
                                onRotationChange={setRotation}
                            />
                        </div>

                        <div className="p-8 space-y-6 bg-white border-t border-slate-100">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <label className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                        <span>Zoom</span>
                                        <span className="text-primary">{Math.round(zoom * 100)}%</span>
                                    </label>
                                    <div className="flex items-center gap-4">
                                        <ZoomOut size={16} className="text-slate-400" />
                                        <input
                                            type="range"
                                            value={zoom}
                                            min={1}
                                            max={3}
                                            step={0.1}
                                            aria-labelledby="Zoom"
                                            onChange={(e) => onZoomChange(Number(e.target.value))}
                                            className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                        <ZoomIn size={16} className="text-slate-400" />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                        <span>Rotation</span>
                                        <span className="text-primary">{rotation}°</span>
                                    </label>
                                    <div className="flex items-center gap-4">
                                        <RotateCcw size={16} className="text-slate-400" />
                                        <input
                                            type="range"
                                            value={rotation}
                                            min={0}
                                            max={360}
                                            step={1}
                                            aria-labelledby="Rotation"
                                            onChange={(e) => setRotation(Number(e.target.value))}
                                            className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-primary"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-4 pt-4 border-t border-slate-50">
                                <button
                                    onClick={onClose}
                                    className="px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all border border-transparent"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    className="px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-primary text-white flex items-center gap-2 hover:bg-primary-light transition-all shadow-xl shadow-primary/20 active:scale-95"
                                >
                                    <Check size={16} /> Potong & Gunakan
                                </button>
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
