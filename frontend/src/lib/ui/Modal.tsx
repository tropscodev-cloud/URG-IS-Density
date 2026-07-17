import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Portal } from './Portal';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
}

export function Modal({ title, onClose, children, widthClassName = 'max-w-lg' }: ModalProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Portal>
      <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className={`relative max-h-[90vh] w-full ${widthClassName} overflow-y-auto rounded-lg border border-border bg-bg-surface shadow-2xl`}>
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-bg-surface px-4 py-3">
            <h2 id="modal-title" className="text-sm font-semibold text-fg-primary">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-fg-muted hover:bg-bg-raised">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </Portal>
  );
}
