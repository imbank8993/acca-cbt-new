"use client";
import TipTapEditorCore from './TipTapEditorCore';

interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  onAudioUpload?: (file: File) => Promise<string>;
  minHeight?: string;
}

export function TipTapEditor(props: TipTapEditorProps) {
  return <TipTapEditorCore {...props} />;
}

export default TipTapEditor;