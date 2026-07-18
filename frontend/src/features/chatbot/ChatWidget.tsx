import { useEffect, useRef, useState } from 'react';
import { Bot, X, Send, Loader2, Info } from 'lucide-react';
import clsx from 'clsx';
import { useChatQuery, type ChatResponse, type ChatSource } from './api';
import { useSelectionStore } from '@/lib/state/selectionStore';
import { useTimeStore } from '@/lib/state/timeStore';
import { useCameras } from '@/features/cameras/api';
import { formatLocalWithZone } from '@/lib/utils/time';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  grounded?: boolean;
}

const CANNED_INTENTS = [
  'Busiest camera right now',
  'Compare Godavari Bund Road & Pushkar Ghat vs Rajahmundry Railway Station',
  'When did Camera 12 last breach threshold?',
  'Summarize the last hour',
];

export function ChatWidget(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const chatQuery = useChatQuery();
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedCameraId = useSelectionStore((s) => s.cameraId);
  const selectedGroupIds = useSelectionStore((s) => s.groupCameraIds);
  const selectCamera = useSelectionStore((s) => s.selectCamera);
  const isHistorical = useTimeStore((s) => s.isHistorical);
  const rangeFromMs = useTimeStore((s) => s.rangeFromMs);
  const rangeToMs = useTimeStore((s) => s.rangeToMs);
  const { data: cameras } = useCameras();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  function contextLabel(): string {
    if (selectedCameraId) {
      const name = cameras?.items.find((c) => c.id === selectedCameraId)?.name;
      return name ? `Context: ${name}` : 'Context: selected camera';
    }
    if (selectedGroupIds.length > 0) return `Context: ${selectedGroupIds.length} selected cameras`;
    return isHistorical ? 'Context: historical range' : 'Context: whole fleet';
  }

  async function send(text: string): Promise<void> {
    if (!text.trim() || chatQuery.isPending) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', text };
    setMessages((m) => [...m, userMsg]);
    setInput('');

    const context = {
      cameraIds: selectedCameraId ? [selectedCameraId] : selectedGroupIds.length > 0 ? selectedGroupIds : undefined,
      from: isHistorical ? new Date(rangeFromMs).toISOString() : undefined,
      to: isHistorical ? new Date(rangeToMs).toISOString() : undefined,
    };

    try {
      const res: ChatResponse = await chatQuery.mutateAsync({ message: text, context });
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: res.answer, sources: res.sources, grounded: res.grounded }]);
    } catch {
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', text: "I couldn't reach the analytics service. Try again in a moment.", grounded: false },
      ]);
    }
  }

  function handleSourceClick(source: ChatSource): void {
    if (source.cameraId.startsWith('zone:')) return;
    selectCamera(source.cameraId);
  }

  return (
    <div className="absolute bottom-3 right-3 z-30">
      {open && (
        <div className="mb-2 flex h-[28rem] w-96 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border bg-bg-surface/98 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-accent" aria-hidden="true" />
              <span className="text-xs font-semibold text-fg-primary">AI Assistant</span>
            </div>
            <span className="text-[10px] text-fg-muted">{contextLabel()}</span>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-fg-muted">Ask about live or historical crowd data. Try:</p>
                {CANNED_INTENTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void send(q)}
                    className="block w-full rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-fg-secondary hover:bg-bg-raised"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={clsx('max-w-[85%] rounded-lg px-3 py-2 text-xs', m.role === 'user' ? 'ml-auto bg-accent text-accent-fg' : 'bg-bg-raised text-fg-primary')}>
                <p>{m.text}</p>
                {m.role === 'assistant' && m.grounded === false && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-severity-warning">
                    <Info className="h-3 w-3" aria-hidden="true" />
                    Not grounded in data — verify independently.
                  </p>
                )}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.sources.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSourceClick(s)}
                        title={`${s.metric} = ${s.value} · ${formatLocalWithZone(s.from)}`}
                        className="rounded border border-border bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-accent hover:underline"
                      >
                        {s.cameraId.startsWith('zone:') ? s.cameraId.replace('zone:', '') : s.cameraId} · {s.metric}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {chatQuery.isPending && (
              <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Thinking…
              </div>
            )}
          </div>

          <p className="border-t border-border px-3 py-1.5 text-[10px] text-fg-muted">
            Advisory only — verify before acting. All queries are audit-logged.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex gap-2 border-t border-border p-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about crowd data…"
              aria-label="Chat message"
              className="flex-1 rounded-md border border-border bg-bg-raised px-2.5 py-1.5 text-xs text-fg-primary outline-none focus-visible:border-accent"
            />
            <button
              type="submit"
              disabled={!input.trim() || chatQuery.isPending}
              aria-label="Send message"
              className="rounded-md bg-accent px-2.5 py-1.5 text-accent-fg hover:brightness-110 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg hover:brightness-110"
      >
        {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Bot className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  );
}
