import { useState, useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket.ts';
import { FiSend } from 'react-icons/fi';

interface ChatProps {
  roomId: string;
}

interface Message {
  id: string;
  userId: string;
  name: string;
  text: string;
  type: string;
  timestamp: number;
}

export default function Chat({ roomId }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const socket = getSocket();

  useEffect(() => {
    const msgHandler = (msg: Message) => {
      setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]);
    };

    const loadHandler = (msgs: Message[]) => {
      setMessages(msgs || []);
    };

    socket.on('chat-message', msgHandler);
    socket.on('chat-messages', loadHandler);

    return () => {
      socket.off('chat-message', msgHandler);
      socket.off('chat-messages', loadHandler);
    };
  }, [roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    socket.emit('chat-message', { roomId, text: input.trim(), type: 'text' });
    setInput('');
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className="animate-fade-in">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-medium text-purple-400 truncate max-w-[120px]">
                {msg.name}
              </span>
              <span className="text-[10px] text-zinc-600">{formatTime(msg.timestamp)}</span>
            </div>
            <p className="text-sm text-zinc-200 break-words">{msg.text}</p>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 text-sm mt-8">
            No messages yet. Start the conversation!
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 focus:border-purple-500 focus:outline-none text-sm text-white placeholder-zinc-500"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <FiSend className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
