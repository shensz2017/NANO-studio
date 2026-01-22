import React, { useState, useEffect, useRef, useCallback } from 'react';
// @ts-ignore
import JSZip from 'jszip';
import { Task, TaskStatus, GenerationConfig, AspectRatio, ImageSize, LogEntry, StagedFile, StagedText } from './types';
import { generateImage } from './services/api';
import { 
  PlayIcon, PlusIcon, TrashIcon, SettingsIcon, FolderIcon, 
  CheckCircleIcon, XCircleIcon, RefreshIcon, SaveIcon, MagicIcon, ListIcon, ArrowDownIcon, DownloadIcon, UserIcon, ImageIcon
} from './components/Icons';

// --- Particles Component ---
const Particles = ({ enabled }: { enabled: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    let animId: number;
    
    interface Particle {
      x: number;
      y: number;
      r: number;
      dx: number;
      dy: number;
      a: number;
      color: string;
      glow: boolean;
    }

    const particles: Particle[] = [];
    const particleCount = 180;
    const colors = ['#ffffff', '#ffffff', '#fbbf24', '#fef3c7'];

    const createParticle = (resetY = false): Particle => ({
        x: Math.random() * w,
        y: resetY ? -10 : Math.random() * h,
        r: Math.random() * 2.5 + 0.5,
        dx: (Math.random() - 0.5) * 0.8,
        dy: Math.random() * 1.5 + 0.5,
        a: Math.random() * 0.6 + 0.2,
        color: colors[Math.floor(Math.random() * colors.length)],
        glow: Math.random() > 0.8
    });

    for(let i=0; i<particleCount; i++) particles.push(createParticle());
    
    const draw = () => {
        if (!ctx) return;
        ctx.clearRect(0,0,w,h);
        
        particles.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            const twinkle = Math.sin(Date.now() * 0.003 + p.x) * 0.2 + 0.8;
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.a * twinkle;
            if (p.glow) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = p.color;
            } else {
                ctx.shadowBlur = 0;
            }
            ctx.fill();
            p.x += p.dx;
            p.y += p.dy;
            if(p.y > h + 10 || p.x < -10 || p.x > w + 10) { 
                particles[i] = createParticle(true);
            }
        });
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        animId = requestAnimationFrame(draw);
    };
    
    draw();
    
    const handleResize = () => {
        if (canvas) {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animId);
        if (ctx) ctx.clearRect(0,0,w,h);
    };
  }, [enabled]);
  
  if (!enabled) return null;
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50 mix-blend-screen" />;
};

const DEFAULT_BASE_URL = 'https://api.bltcy.ai';
const MAX_CONCURRENT_TASKS = 30;
const STAGGER_DELAY_MS = 500;

const App: React.FC = () => {
  // --- State ---
  const [config, setConfig] = useState<GenerationConfig>({
    apiKey: localStorage.getItem('nano_api_key') || '',
    baseUrl: localStorage.getItem('nano_base_url') || DEFAULT_BASE_URL,
    model: 'nano-banana-2',
    aspectRatio: AspectRatio.MOBILE,
    imageSize: ImageSize.K2,
    count: 1
  });

  const [showParticles, setShowParticles] = useState(true);
  const [activeTab, setActiveTab] = useState<'single' | 'batch-text' | 'batch-folder'>('single');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Single Task State
  const [singlePrompt, setSinglePrompt] = useState('');

  // Text Batch State
  const [textBatchCount, setTextBatchCount] = useState<number>(3);
  const [stagedTexts, setStagedTexts] = useState<StagedText[]>([]);

  // Image Batch State
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [batchPrompt, setBatchPrompt] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Reference Library State
  const [refPreviews, setRefPreviews] = useState<string[]>([]);
  const [refBase64s, setRefBase64s] = useState<string[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // --- Effects ---

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- Async Task Scheduler ---
  // This effect runs every time 'tasks' changes (start/end) and acts as the "Tick"
  useEffect(() => {
    const runScheduler = async () => {
        // 1. Check active threads
        const activeTasks = tasks.filter(t => t.status === TaskStatus.PROCESSING);
        
        if (activeTasks.length >= MAX_CONCURRENT_TASKS) {
            return; // Max concurrency reached
        }

        // 2. Find next pending task
        const nextTask = tasks.find(t => t.status === TaskStatus.PENDING);
        
        if (nextTask) {
             // 3. Start task
             startTaskExecution(nextTask);
        }
    };

    // Stagger check by 500ms to prevent flooding and allow UI updates
    const timer = setTimeout(runScheduler, STAGGER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tasks, config]); // Re-evaluate when tasks or config changes

  const startTaskExecution = async (task: Task) => {
      // Optimistically update status to PROCESSING to prevent double-picking by scheduler
      updateTaskStatus(task.id, TaskStatus.PROCESSING);
      // Use original filename in log if available for clarity
      const logName = task.originalFilename || task.id.split('_')[1];
      addLog(`[ASYNC START] ${logName} (${task.prompt.slice(0, 15)}...)`, 'info');

      try {
          // The API call happens here. Other tasks can continue to start in parallel 
          // (up to limit) because this function is async and doesn't block the UI thread.
          const url = await generateImage(task, config);
          updateTaskStatus(task.id, TaskStatus.COMPLETED, url);
          addLog(`[COMPLETED] ${logName}`, 'success');
      } catch (err: any) {
          updateTaskStatus(task.id, TaskStatus.FAILED, undefined, err.message);
          addLog(`[FAILED] ${logName}: ${err.message}`, 'error');
      }
  };

  // --- Logic ---

  const saveSettings = () => {
      localStorage.setItem('nano_api_key', config.apiKey);
      localStorage.setItem('nano_base_url', config.baseUrl);
      addLog('Settings saved locally.', 'success');
  };

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [...prev, entry]);
  };

  const updateTaskStatus = (id: string, status: TaskStatus, resultUrl?: string, error?: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) return { ...t, status, resultUrl, error };
      return t;
    }));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // --- Reference Library Logic ---

  const handleReferenceSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          const files = Array.from(e.target.files) as File[];
          files.forEach(async (file) => {
              const url = URL.createObjectURL(file);
              setRefPreviews(prev => [...prev, url]);
              const b64 = await fileToBase64(file);
              setRefBase64s(prev => [...prev, b64]);
          });
      }
  };

  const clearReferences = () => {
      setRefPreviews([]);
      setRefBase64s([]);
  };

  // --- Global Prompt Fill Logic (Smart) ---
  const handleGlobalFill = (overwrite: boolean) => {
      if (!batchPrompt) return;

      if (activeTab === 'batch-text') {
           if (stagedTexts.length === 0) {
               addLog('No staged text prompts to fill. Generate a list first.', 'error');
               return;
           }
           setStagedTexts(prev => prev.map(item => {
               if (overwrite || !item.prompt.trim()) {
                   return { ...item, prompt: batchPrompt };
               }
               return item;
           }));
           addLog(`Updated ${stagedTexts.length} staged text items.`, 'info');
      } else if (activeTab === 'batch-folder') {
           if (stagedFiles.length === 0) {
               addLog('No staged images to fill. Load a folder first.', 'error');
               return;
           }
           setStagedFiles(prev => prev.map(item => {
               if (overwrite || !item.prompt.trim()) {
                   return { ...item, prompt: batchPrompt };
               }
               return item;
           }));
           addLog(`Updated ${stagedFiles.length} staged image items.`, 'info');
      }
  };

  // --- Single Task Logic ---
  const handleSingleTask = () => {
      if (!singlePrompt.trim()) return;
      const task: Task = {
          id: `sgl_${Date.now()}`,
          prompt: singlePrompt.trim(),
          referenceImages: [...refBase64s],
          status: TaskStatus.PENDING,
          timestamp: Date.now()
      };
      setTasks(prev => [...prev, task]);
      addLog('Single task added to queue.', 'info');
      setSinglePrompt('');
  };

  // --- Text Batch Logic (Updated) ---
  const handleGenerateTextList = () => {
      const count = Math.max(1, Math.floor(textBatchCount));
      const newItems: StagedText[] = Array(count).fill(null).map(() => ({
          id: Math.random().toString(36).substr(2, 9),
          prompt: ''
      }));
      setStagedTexts(newItems); // Replace or append? Usually replace for "Generate List" button
      addLog(`Generated list with ${count} empty slots.`, 'info');
  };

  const handleStagedTextToQueue = () => {
      if (stagedTexts.length === 0) return;
      
      const newTasks: Task[] = [];
      stagedTexts.forEach(item => {
          if (!item.prompt.trim()) return;
          
          newTasks.push({
              id: `txt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              prompt: item.prompt,
              referenceImages: [...refBase64s],
              status: TaskStatus.PENDING,
              timestamp: Date.now()
          });
      });
      setTasks(prev => [...prev, ...newTasks]);
      setStagedTexts([]);
      addLog(`Added ${newTasks.length} text tasks to processing queue.`, 'info');
  };

  const clearStagedTexts = () => setStagedTexts([]);

  // --- Image Folder Logic ---

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          const files = (Array.from(e.target.files) as File[]).filter(f => f.type.startsWith('image/'));
          if (files.length === 0) return;

          const newStaged: StagedFile[] = files.map(f => ({
              id: Math.random().toString(36).substr(2, 9),
              file: f,
              preview: URL.createObjectURL(f),
              prompt: ''
          }));
          
          setStagedFiles(prev => [...prev, ...newStaged]);
          addLog(`Loaded ${files.length} images from folder to staging list.`, 'info');
          
          newStaged.forEach(async (item) => {
              const b64 = await fileToBase64(item.file);
              setStagedFiles(prev => prev.map(s => s.id === item.id ? { ...s, base64: b64 } : s));
          });
      }
  };

  const handleStagedImagesToQueue = () => {
      const readyFiles = stagedFiles.filter(f => f.base64);
      if (readyFiles.length === 0) return;

      const newTasks: Task[] = [];
      readyFiles.forEach(item => {
             newTasks.push({
                id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                prompt: item.prompt || 'Untitled',
                referenceImages: [...refBase64s, item.base64!],
                status: TaskStatus.PENDING,
                timestamp: Date.now(),
                originalFilename: item.file.name // STORE ORIGINAL FILENAME
            });
      });

      setTasks(prev => [...prev, ...newTasks]);
      setStagedFiles([]); 
      addLog(`Added ${newTasks.length} image tasks to processing queue.`, 'info');
  };

  const clearStagedFiles = () => setStagedFiles([]);
  
  // --- Queue Management ---
  const clearQueue = () => {
      setTasks(prev => prev.filter(t => t.status === TaskStatus.PROCESSING));
      addLog('Queue cleared.', 'info');
  };

  const retryTask = (task: Task) => {
      setTasks(prev => prev.filter(t => t.id !== task.id));
      const newTask = { ...task, id: `retry_${Date.now()}`, status: TaskStatus.PENDING, error: undefined, resultUrl: undefined };
      setTasks(prev => [...prev, newTask]);
      addLog(`Retrying task ${task.id}...`, 'info');
  };

  // --- Download Logic (Refined) ---

  const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    const completed = tasks.filter(t => t.status === TaskStatus.COMPLETED && t.resultUrl);
    if (completed.length === 0) {
        addLog('No completed images to download.', 'error');
        return;
    }
    
    if (downloading) return;
    setDownloading(true);

    const tryZipDownload = async () => {
        addLog('Preparing ZIP archive (Browser limited)...', 'info');
        try {
            const zip = new JSZip();
            const imgFolder = zip.folder("nano_banana_images");
            
            let count = 0;
            for (const task of completed) {
                if (!task.resultUrl) continue;
                try {
                    // Fetch blob to avoid cross-origin redirect issues
                    const response = await fetch(task.resultUrl);
                    const blob = await response.blob();
                    const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
                    
                    // Determine Filename based on original source if available
                    let fileName = `nano_${task.id}.${ext}`;
                    if (task.originalFilename) {
                        const baseName = task.originalFilename.substring(0, task.originalFilename.lastIndexOf('.')) || task.originalFilename;
                        fileName = `${baseName}_nano.${ext}`;
                    }

                    imgFolder?.file(fileName, blob);
                    count++;
                } catch (e) {
                    console.error('Failed to fetch image for zip:', e);
                    addLog(`Skipped image ${task.id} (Fetch Error)`, 'error');
                }
            }
            
            if (count > 0) {
                addLog('Compressing files...', 'info');
                const content = await zip.generateAsync({type: "blob"});
                downloadBlob(content, `nano_batch_${Date.now()}.zip`);
                addLog('ZIP Download started.', 'success');
            } else {
                addLog('No valid images could be fetched for zipping.', 'error');
            }

        } catch (e: any) {
            addLog(`ZIP creation failed: ${e.message}`, 'error');
        }
    };

    if ('showDirectoryPicker' in window) {
        try {
             // @ts-ignore
            const dirHandle = await window.showDirectoryPicker();
            addLog('Saving to folder...', 'info');
            
            let count = 0;
            for (const task of completed) {
                if (!task.resultUrl) continue;
                try {
                    const response = await fetch(task.resultUrl);
                    const blob = await response.blob();
                    const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
                    
                    // Determine Filename based on original source if available
                    let filename = `nano_${task.id}.${ext}`;
                    if (task.originalFilename) {
                        const baseName = task.originalFilename.substring(0, task.originalFilename.lastIndexOf('.')) || task.originalFilename;
                        filename = `${baseName}_nano.${ext}`;
                    }
                    
                    // @ts-ignore
                    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                    // @ts-ignore
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    count++;
                } catch (e) {
                    console.error('File write error:', e);
                }
            }
            addLog(`Successfully saved ${count} images to folder.`, 'success');
        } catch (err: any) {
             // If SecurityError (iframe) or AbortError
             if (err.name !== 'AbortError') {
                 console.warn('Directory Picker failed, falling back to ZIP:', err);
                 await tryZipDownload();
             } else {
                 addLog('Download cancelled.', 'info');
             }
        }
    } else {
        await tryZipDownload();
    }
    
    setDownloading(false);
  };

  // --- Helper for UI ---
  const processingCount = tasks.filter(t => t.status === TaskStatus.PROCESSING).length;

  // --- Render ---

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-sans selection:bg-banana-500 selection:text-white overflow-hidden relative">
      <Particles enabled={showParticles} />
      
      {/* Sidebar */}
      <div className="w-80 flex flex-col border-r border-gray-800 bg-gray-900/80 backdrop-blur-md z-10 relative">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
            {/* Title Effect */}
            <h1 className="text-2xl font-black italic tracking-tighter relative">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-yellow-300 via-orange-400 to-red-500 animate-pulse">
                    NANO BANANA
                </span>
                <span className="block text-sm text-gray-400 font-normal not-italic tracking-normal">
                    PRO STUDIO
                </span>
                <span className="absolute -inset-1 bg-yellow-500/20 blur-xl -z-10 rounded-full"></span>
            </h1>
            <button onClick={() => setShowSettings(!showSettings)} className="text-gray-400 hover:text-white transition">
                <SettingsIcon />
            </button>
        </div>

        {/* Settings Panel */}
        <div className={`p-4 bg-gray-900 border-b border-gray-800 transition-all duration-300 overflow-hidden ${showSettings ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0 p-0 border-0'}`}>
             <div className="mb-4 flex items-center justify-between">
                 <span className="text-xs font-medium text-gray-400">Particle Effects</span>
                 <button 
                    onClick={() => setShowParticles(!showParticles)}
                    className={`w-10 h-5 rounded-full relative transition ${showParticles ? 'bg-banana-500' : 'bg-gray-700'}`}
                 >
                     <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full transition transform ${showParticles ? 'translate-x-5' : ''}`}></div>
                 </button>
             </div>
             <label className="block text-xs font-medium text-gray-400 mb-1">API Endpoint</label>
            <input 
                type="text" 
                value={config.baseUrl}
                onChange={(e) => setConfig({...config, baseUrl: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs mb-3 text-white focus:border-banana-500 outline-none"
            />
             <label className="block text-xs font-medium text-gray-400 mb-1">API Key</label>
             <div className="flex space-x-2">
                <input 
                    type="password" 
                    value={config.apiKey}
                    onChange={(e) => setConfig({...config, apiKey: e.target.value})}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-banana-500 outline-none"
                    placeholder="sk-..."
                />
                <button onClick={saveSettings} className="bg-gray-800 hover:bg-banana-600 text-white p-1 rounded border border-gray-700 transition" title="Save API Key">
                    <SaveIcon className="w-4 h-4" />
                </button>
             </div>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
            {/* Reference Library */}
            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-gray-300 uppercase tracking-wide">Reference Library</label>
                    {refPreviews.length > 0 && (
                        <button onClick={clearReferences} className="text-xs text-red-400 hover:text-red-300">Clear</button>
                    )}
                </div>
                
                <div className="grid grid-cols-3 gap-2 mb-2">
                    {refPreviews.map((src, idx) => (
                        <div key={idx} className="aspect-square rounded overflow-hidden border border-gray-600 relative group bg-black">
                            <img src={src} alt="ref" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
                            <div className="absolute top-0 left-0 bg-banana-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-br shadow-sm">
                                {idx + 1}
                            </div>
                        </div>
                    ))}
                     <label className="aspect-square rounded border border-dashed border-gray-600 flex items-center justify-center cursor-pointer hover:border-banana-500 hover:text-banana-500 text-gray-500 transition hover:bg-gray-800">
                        <PlusIcon className="w-6 h-6" />
                        <input type="file" multiple className="hidden" onChange={handleReferenceSelect} accept="image/*" />
                    </label>
                </div>
                <p className="text-[10px] text-gray-500 leading-tight">
                    Images are indexed 1-{refPreviews.length}. Use these numbers in your prompt logic.
                </p>
            </div>

            {/* Model Config */}
            <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">Model Settings</label>
                <div className="space-y-3">
                    <select 
                        value={config.model} 
                        onChange={(e) => setConfig({...config, model: e.target.value})}
                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-gray-200 focus:border-banana-500 outline-none"
                    >
                        <option value="nano-banana-2">Nano Banana 2</option>
                        <option value="nano-banana-hd">Nano Banana HD</option>
                    </select>
                    
                    <div className="grid grid-cols-3 gap-2">
                         {Object.values(AspectRatio).map(ratio => (
                             <button
                                key={ratio}
                                onClick={() => setConfig({...config, aspectRatio: ratio})}
                                className={`text-xs py-1.5 rounded border transition ${config.aspectRatio === ratio ? 'border-banana-500 bg-banana-500/20 text-banana-400 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                             >
                                 {ratio}
                             </button>
                         ))}
                    </div>

                    <div className="flex items-center space-x-2 bg-gray-800 p-2 rounded border border-gray-700">
                        <span className="text-xs text-gray-400 whitespace-nowrap">Size:</span>
                        <select 
                            value={config.imageSize} 
                            onChange={(e) => setConfig({...config, imageSize: e.target.value as ImageSize})}
                            className="bg-transparent text-sm text-banana-400 font-mono outline-none w-full text-right"
                        >
                            {Object.values(ImageSize).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                     <div className="bg-gray-800 p-2 rounded border border-gray-700">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>Global Loop</span>
                            <span className="text-banana-400 font-mono">{config.count}x</span>
                        </div>
                        <input 
                            type="range" min="1" max="10" 
                            value={config.count} 
                            onChange={(e) => setConfig({...config, count: parseInt(e.target.value)})}
                            className="w-full accent-banana-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col z-10 relative bg-black/50 backdrop-blur-sm">
          
          {/* Input Header & Prompting */}
          <div className="h-1/3 min-h-[300px] border-b border-gray-800 bg-gray-900/40 flex flex-col">
              {/* Tab Switcher */}
              <div className="flex border-b border-gray-800 bg-gray-900/50">
                  <button 
                    onClick={() => setActiveTab('single')}
                    className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center space-x-2 ${activeTab === 'single' ? 'bg-gray-800/50 text-banana-400 border-b-2 border-banana-500' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'}`}
                  >
                      <UserIcon className="w-4 h-4" />
                      <span>SINGLE TASK</span>
                  </button>
                  <button 
                    onClick={() => setActiveTab('batch-text')}
                    className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center space-x-2 ${activeTab === 'batch-text' ? 'bg-gray-800/50 text-banana-400 border-b-2 border-banana-500' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'}`}
                  >
                      <ListIcon className="w-4 h-4" />
                      <span>BATCH (TEXT LOOP)</span>
                  </button>
                  <button 
                    onClick={() => setActiveTab('batch-folder')}
                    className={`flex-1 py-3 text-sm font-medium transition flex items-center justify-center space-x-2 ${activeTab === 'batch-folder' ? 'bg-gray-800/50 text-banana-400 border-b-2 border-banana-500' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'}`}
                  >
                      <FolderIcon className="w-4 h-4" />
                      <span>BATCH (FOLDER)</span>
                  </button>
              </div>

              {/* Shared Global Prompt Bar - Visible only for Batch Tabs */}
              {activeTab !== 'single' && (
                  <div className="px-4 py-3 bg-gray-800/30 flex items-center space-x-2 border-b border-gray-800/50">
                        <span className="text-xs font-bold text-gray-400 uppercase mr-2 whitespace-nowrap">Global Prompt:</span>
                        <input 
                            type="text" 
                            value={batchPrompt}
                            onChange={(e) => setBatchPrompt(e.target.value)}
                            placeholder={activeTab === 'batch-text' ? "Fill text prompts..." : "Fill image prompts..."}
                            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-banana-500 outline-none"
                        />
                        <button 
                            onClick={() => handleGlobalFill(false)}
                            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded border border-gray-700 transition"
                        >
                            Fill Empty
                        </button>
                        <button 
                            onClick={() => handleGlobalFill(true)}
                            className="px-3 py-1.5 bg-gray-800 hover:bg-red-900/30 hover:border-red-800 text-xs text-red-300 rounded border border-gray-700 transition"
                        >
                            Overwrite
                        </button>
                  </div>
              )}

              {/* Content Area */}
              <div className="flex-1 p-4 overflow-hidden flex flex-col">
                
                {/* --- SINGLE TASK TAB --- */}
                {activeTab === 'single' && (
                    <div className="flex flex-col h-full">
                        <div className="mb-2 text-xs text-gray-400 uppercase tracking-wide">Enter Prompt</div>
                        <textarea 
                            className="flex-1 bg-gray-900/50 border border-gray-700 rounded-lg p-3 text-sm focus:border-banana-500 outline-none resize-none font-mono custom-scrollbar mb-4"
                            placeholder="Describe your image..."
                            value={singlePrompt}
                            onChange={(e) => setSinglePrompt(e.target.value)}
                        />
                        <div className="flex justify-end">
                            <button 
                                onClick={handleSingleTask}
                                disabled={!singlePrompt.trim()}
                                className={`px-8 py-3 rounded-full shadow-lg flex items-center font-bold text-sm transition transform ${singlePrompt.trim() ? 'bg-gradient-to-r from-banana-600 to-orange-600 hover:from-banana-500 hover:to-orange-500 text-white hover:scale-105 active:scale-95 shadow-banana-900/30' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                            >
                                <PlayIcon className="w-4 h-4 mr-2" />
                                START TASK (ASYNC)
                            </button>
                        </div>
                    </div>
                )}

                {/* --- BATCH TEXT LOOP TAB --- */}
                {activeTab === 'batch-text' && (
                     <div className="flex flex-col h-full">
                         {/* Control Row */}
                         <div className="flex-none flex items-center space-x-4 mb-4 bg-gray-900/40 p-3 rounded border border-gray-800">
                             <div className="flex items-center space-x-2">
                                <span className="text-xs text-gray-400 font-bold uppercase">Gen Count:</span>
                                <input 
                                    type="number" 
                                    min="1" max="100"
                                    value={textBatchCount}
                                    onChange={(e) => setTextBatchCount(parseInt(e.target.value))}
                                    className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-center focus:border-banana-500 outline-none"
                                />
                             </div>
                             <button 
                                onClick={handleGenerateTextList}
                                className="px-4 py-1.5 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 text-xs text-white transition flex items-center"
                             >
                                <ListIcon className="w-3 h-3 mr-1.5" />
                                Generate List
                             </button>
                             <div className="flex-1"></div>
                             <span className="text-[10px] text-gray-500">Step 1: Set Count & Generate → Step 2: Fill Prompts → Step 3: Start</span>
                         </div>
                         
                         {/* Staging List */}
                         <div className="flex-1 flex flex-col min-h-0 bg-gray-900/30 rounded border border-gray-800">
                             <div className="p-2 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                                 <span className="text-xs font-medium text-banana-400">Task List ({stagedTexts.length})</span>
                                 <button onClick={clearStagedTexts} className="text-xs text-red-400 hover:underline">Clear</button>
                             </div>
                             <div className="flex-1 overflow-y-auto custom-scrollbar">
                                 {stagedTexts.map((item, idx) => (
                                     <div key={item.id} className="flex items-center p-2 border-b border-gray-800/50 hover:bg-gray-800/30">
                                         <span className="text-xs text-gray-500 w-8 text-center bg-gray-800/50 rounded py-0.5 mr-2">{idx + 1}</span>
                                         <input 
                                            type="text"
                                            value={item.prompt}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setStagedTexts(curr => curr.map(s => s.id === item.id ? {...s, prompt: val} : s));
                                            }}
                                            className="flex-1 bg-transparent text-sm text-gray-200 outline-none placeholder-gray-700"
                                            placeholder="Empty prompt..."
                                         />
                                     </div>
                                 ))}
                                 {stagedTexts.length === 0 && (
                                     <div className="flex flex-col items-center justify-center h-full text-xs text-gray-600">
                                         <ArrowDownIcon className="w-8 h-8 mb-2 opacity-50" />
                                         Set Count & Click "Generate List" to begin
                                     </div>
                                 )}
                             </div>
                         </div>

                         {/* Action Button */}
                         <div className="mt-3 flex justify-end">
                             <button 
                                  onClick={handleStagedTextToQueue}
                                  disabled={stagedTexts.length === 0}
                                  className={`px-8 py-2 rounded-full shadow-lg flex items-center font-bold text-sm transition transform ${stagedTexts.length > 0 ? 'bg-gradient-to-r from-banana-600 to-orange-600 hover:from-banana-500 hover:to-orange-500 text-white hover:scale-105 active:scale-95 shadow-banana-900/30' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                             >
                                 <PlayIcon className="w-4 h-4 mr-2" />
                                 START BATCH
                             </button>
                         </div>
                    </div>
                )}

                {/* --- BATCH FOLDER TAB --- */}
                {activeTab === 'batch-folder' && (
                    <div className="flex flex-col h-full">
                        {stagedFiles.length === 0 ? (
                            <div 
                                className="flex-1 border-2 border-dashed border-gray-700 rounded-lg flex flex-col items-center justify-center bg-gray-800/20 hover:bg-gray-800/30 transition cursor-pointer group"
                                onClick={() => folderInputRef.current?.click()}
                            >
                                <FolderIcon className="w-16 h-16 text-gray-600 group-hover:text-banana-500 transition mb-4" />
                                <h3 className="text-lg font-medium text-gray-300">Click to Select Folder</h3>
                                <p className="text-sm text-gray-500 mt-2">Supports bulk image loading</p>
                                <input 
                                    type="file" 
                                    ref={folderInputRef}
                                    {...({ webkitdirectory: "", directory: "" } as any)}
                                    multiple 
                                    className="hidden" 
                                    onChange={handleFolderSelect} 
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col h-full">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs text-gray-400">Step 2: Review & Fill ({stagedFiles.length} files)</span>
                                    <button onClick={clearStagedFiles} className="text-xs text-red-400 hover:underline">Clear Staged</button>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar bg-gray-900/30 rounded border border-gray-800">
                                    {stagedFiles.map((file, idx) => (
                                        <div key={file.id} className="flex items-center p-2 border-b border-gray-800/50 hover:bg-gray-800/30">
                                            <div className="relative w-10 h-10 mr-3 shrink-0">
                                                <img src={file.preview} className="w-full h-full object-cover rounded" />
                                                <div className="absolute -top-1 -right-1 bg-gray-700 text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full border border-gray-600">
                                                    {refPreviews.length + idx + 1}
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0 mr-3">
                                                <div className="text-xs text-gray-500 truncate mb-1">{file.file.name}</div>
                                                <input 
                                                    type="text" 
                                                    value={file.prompt}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setStagedFiles(curr => curr.map(s => s.id === file.id ? {...s, prompt: val} : s));
                                                    }}
                                                    placeholder="Enter prompt..."
                                                    className="w-full bg-transparent text-sm text-gray-200 placeholder-gray-600 outline-none border-b border-gray-700 focus:border-banana-500"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 flex justify-end">
                                     <button 
                                          onClick={handleStagedImagesToQueue}
                                          className="bg-gradient-to-r from-banana-600 to-orange-600 hover:from-banana-500 hover:to-orange-500 text-white px-8 py-2 rounded-full shadow-lg shadow-banana-900/30 flex items-center font-bold text-sm transition transform hover:scale-105 active:scale-95"
                                     >
                                         <PlayIcon className="w-4 h-4 mr-2" />
                                         START BATCH
                                     </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
              </div>
          </div>

          {/* Bottom Area: Queue & Results */}
          <div className="flex-1 flex overflow-hidden border-t border-gray-800">
               {/* Queue */}
               <div className="w-80 border-r border-gray-800 bg-gray-900/30 flex flex-col">
                    <div className="p-2 bg-gray-900/80 border-b border-gray-800 flex justify-between items-center backdrop-blur-sm">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-2">Queue ({tasks.length})</span>
                        <button onClick={clearQueue} className="p-1 hover:bg-gray-800 rounded transition text-gray-500 hover:text-red-400">
                            <TrashIcon className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                        {tasks.map((task, idx) => (
                          <div key={task.id} className="bg-gray-800/60 rounded p-2 border border-gray-700/50 flex items-center justify-between group hover:border-gray-600 transition">
                              <div className="flex items-center min-w-0">
                                   {/* Status Indicator */}
                                   <div className="mr-2">
                                       {task.status === TaskStatus.PENDING && <div className="w-2 h-2 rounded-full bg-gray-500"></div>}
                                       {task.status === TaskStatus.PROCESSING && <div className="w-2 h-2 rounded-full bg-banana-500 animate-ping"></div>}
                                       {task.status === TaskStatus.COMPLETED && <CheckCircleIcon className="w-4 h-4 text-green-500" />}
                                       {task.status === TaskStatus.FAILED && <XCircleIcon className="w-4 h-4 text-red-500" />}
                                   </div>
                                   <div className="overflow-hidden">
                                        <div className="flex items-center space-x-2 mb-0.5">
                                            {/* Index Logic or Filename */}
                                            {task.originalFilename ? (
                                                <span className="text-[10px] bg-gray-700 text-gray-200 px-1 rounded truncate max-w-[150px]">
                                                    {task.originalFilename}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] text-gray-500 font-mono truncate max-w-[80px]">{task.id.split('_')[1]}</span>
                                            )}
                                        </div>
                                       <div className="text-xs text-gray-300 truncate w-40" title={task.prompt}>{task.prompt || "No prompt"}</div>
                                   </div>
                              </div>
                              {task.status === TaskStatus.FAILED && (
                                  <button onClick={() => retryTask(task)} className="text-gray-500 hover:text-white"><RefreshIcon className="w-3 h-3" /></button>
                              )}
                          </div>
                        ))}
                    </div>
               </div>

               {/* Gallery */}
               <div className="flex-1 bg-gray-950/50 flex flex-col relative overflow-hidden">
                    {/* Gallery Header */}
                    <div className="h-10 bg-gray-900 border-b border-gray-800 flex justify-between items-center px-4">
                        <span className="text-xs font-bold text-gray-400">GALLERY</span>
                        <button 
                            onClick={handleDownloadAll}
                            disabled={downloading}
                            className={`text-xs bg-gray-800 hover:bg-banana-600 text-gray-300 hover:text-white px-3 py-1 rounded border border-gray-700 transition flex items-center ${downloading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <DownloadIcon className="w-3 h-3 mr-1.5" />
                            {downloading ? 'Zipping...' : 'Download All (ZIP)'}
                        </button>
                    </div>

                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
                        {tasks.filter(t => t.status === TaskStatus.COMPLETED).length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                                <MagicIcon className="w-32 h-32 text-gray-500" />
                            </div>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            {tasks.filter(t => t.status === TaskStatus.COMPLETED && t.resultUrl).map(task => {
                                const baseName = task.originalFilename 
                                    ? (task.originalFilename.substring(0, task.originalFilename.lastIndexOf('.')) || task.originalFilename)
                                    : `nano_${task.id}`;
                                const downloadName = `${baseName}_nano.png`;

                                return (
                                <div key={task.id} className="group relative rounded-lg overflow-hidden border border-gray-800 bg-gray-900 shadow-xl transition transform hover:-translate-y-1 hover:shadow-banana-900/20">
                                    <img src={task.resultUrl} alt={task.prompt} className="w-full h-auto object-cover aspect-[9/16]" loading="lazy" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition duration-300 flex flex-col justify-end p-3">
                                        <div className="text-[10px] text-banana-400 font-bold mb-1 truncate">
                                            {task.originalFilename || task.id}
                                        </div>
                                        <p className="text-[10px] text-gray-300 line-clamp-2 mb-2">{task.prompt}</p>
                                        <a 
                                            href={task.resultUrl} 
                                            target="_blank" 
                                            rel="noreferrer" 
                                            download={downloadName}
                                            className="bg-white text-black text-[10px] font-bold py-1.5 px-3 rounded text-center hover:bg-banana-400 transition"
                                        >
                                            OPEN / SAVE
                                        </a>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
               </div>
          </div>

          {/* Footer Console */}
          <div className="h-32 bg-gray-900/90 border-t border-gray-800 flex flex-col font-mono text-[10px] z-20">
              <div className="px-3 py-1 bg-black/40 text-gray-500 flex justify-between border-b border-gray-800">
                  <span className="flex items-center text-banana-400 font-bold">
                       <span className={`w-2 h-2 rounded-full mr-2 ${processingCount > 0 ? 'bg-banana-500 animate-pulse' : 'bg-gray-600'}`}></span>
                       ACTIVE THREADS: {processingCount} / {MAX_CONCURRENT_TASKS}
                  </span>
                  <span>v2.1.0 NANO-CORE</span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                  {logs.map((log) => (
                      <div key={log.id} className={`flex ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-gray-400'}`}>
                          <span className="opacity-30 mr-2">[{log.timestamp}]</span> 
                          <span>{log.message}</span>
                      </div>
                  ))}
                  <div ref={logEndRef} />
              </div>
          </div>
      </div>
    </div>
  );
};

export default App;