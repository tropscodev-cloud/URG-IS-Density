import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface Props {
  name: string;
  children: ReactNode;
  /** Compact inline card instead of filling the container — for small panels. */
  compact?: boolean;
  /** If set, the boundary re-mounts its children automatically after this many ms (kiosk mode). */
  autoRecoverMs?: number;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info.componentStack);
    if (this.props.autoRecoverMs) {
      this.recoverTimer = setTimeout(() => this.reset(), this.props.autoRecoverMs);
    }
  }

  componentWillUnmount(): void {
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    if (this.props.compact) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-severity-critical/30 bg-severity-critical/5 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-severity-critical" aria-hidden="true" />
          <p className="text-xs text-fg-secondary">{this.props.name} failed to load.</p>
          <button
            type="button"
            onClick={this.reset}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-secondary hover:bg-bg-raised"
          >
            <RotateCw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg-canvas p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-severity-critical" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-fg-primary">{this.props.name} ran into a problem</h2>
        <p className="max-w-sm text-xs text-fg-muted">
          The rest of the console is unaffected. You can retry this panel without reloading the page.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:brightness-110"
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }
}
