import * as i18n from '@runhq/cockpit-ui/i18n/core';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  private unsubscribeLocale?: () => void;

  override componentDidMount(): void {
    this.unsubscribeLocale = i18n.subscribe(() => this.forceUpdate());
  }

  override componentWillUnmount(): void {
    this.unsubscribeLocale?.();
  }

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="bg-surface flex h-screen items-center justify-center p-8">
          <div className="text-center">
            <h2 className="text-fg text-lg font-semibold">{i18n.t('Something went wrong')}</h2>
            <p className="text-fg-muted mt-2 text-sm">
              {this.state.error?.message ?? i18n.t('An unexpected error occurred.')}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="bg-accent text-accent-fg mt-4 rounded-lg px-4 py-2 text-sm font-medium"
            >
              {i18n.t('Try again')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
