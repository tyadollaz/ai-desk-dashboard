import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  label?: string;
  children: ReactNode;
}

/** Contains render failures to one card so the rest of the page keeps working. */
export default class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Log only the error name: card data is private and must not reach logs.
    console.error(`Card render failed${this.props.label ? ` (${this.props.label})` : ''}: ${error.name}`);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="card-fallback" role="alert">
          {this.props.label ? `${this.props.label}: ` : ''}This card could not be displayed.
        </div>
      );
    }
    return this.props.children;
  }
}
