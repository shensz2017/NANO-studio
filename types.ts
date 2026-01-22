export enum TaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum AspectRatio {
  SQUARE = '1:1',
  PORTRAIT = '3:4',
  LANDSCAPE = '4:3',
  WIDE = '16:9',
  MOBILE = '9:16',
  ULTRAWIDE = '21:9'
}

export enum ImageSize {
  K1 = '1K',
  K2 = '2K',
  K4 = '4K'
}

export interface GenerationConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  count: number;
}

export interface Task {
  id: string;
  prompt: string;
  referenceImages: string[]; // Base64 strings. Includes global refs + specific task image
  status: TaskStatus;
  resultUrl?: string;
  error?: string;
  timestamp: number;
  originalFilename?: string; // Changed: Added to track source filename
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface StagedFile {
  id: string;
  file: File;
  preview: string;
  base64?: string;
  prompt: string;
}

export interface StagedText {
  id: string;
  prompt: string;
}