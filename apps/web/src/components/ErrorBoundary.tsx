import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Remount the boundary (clearing the error) when this value changes. */
  resetKey?: unknown;
}
interface State {
  error: Error | null;
}

/**
 * Catches render errors in page components so a thrown error shows a useful
 * fallback instead of a blank screen. Resets when `resetKey` changes (e.g. on
 * navigation or organization switch).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Page error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm font-semibold text-red-700">Something went wrong on this page</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-red-600">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
