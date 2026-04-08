import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: '#c00', background: '#fee', borderRadius: 8, margin: 16 }}>
          <h3 style={{ margin: '0 0 8px' }}>Something went wrong</h3>
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{this.state.error?.message}</pre>
          <pre style={{ fontSize: 10, color: '#888', whiteSpace: 'pre-wrap' }}>{this.state.error?.stack}</pre>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 8, padding: '4px 12px', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
