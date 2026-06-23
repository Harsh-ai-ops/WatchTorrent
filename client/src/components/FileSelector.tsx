import { isVideoFile } from '../lib/utils.ts';
import { FiFile, FiFolder } from 'react-icons/fi';

interface TorrentFile {
  index: number;
  name: string;
  length: number;
  type: string;
}

interface FileSelectorProps {
  files: TorrentFile[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  compact?: boolean;
}

export default function FileSelector({ files, selectedIndex, onSelect, compact }: FileSelectorProps) {
  const videoFiles = files.filter((f) => f.type === 'video');
  if (videoFiles.length <= 1) return null;

  return (
    <div className={compact ? '' : 'space-y-2'}>
      {!compact && <h3 className="text-sm font-medium text-zinc-400">Files</h3>}
      <div className={`space-y-1 ${compact ? 'max-h-32 overflow-y-auto' : 'max-h-60 overflow-y-auto'}`}>
        {videoFiles.map((file) => (
          <button
            key={file.index}
            onClick={() => onSelect(file.index)}
            className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 cursor-pointer ${
              selectedIndex === file.index
                ? 'bg-purple-600/20 text-purple-300 border border-purple-600/30'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <FiFile className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{file.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
