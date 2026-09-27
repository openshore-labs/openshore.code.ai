// A render fault stays inside the part that failed (0.10). React unmounts the
// whole tree on an error thrown while rendering, so without a boundary one
// bad note blanked the app. The fallback gets a reset; a new resetKey (the
// next note, edited text) resets it too, so the way back never needs a
// relaunch.
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** What shows instead of the children after a fault. */
  fallback: (reset: () => void) => ReactNode;
  /** Clears the fault when it changes. */
  resetKey?: unknown;
}

interface State {
  failed: boolean;
  key: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return Object.is(props.resetKey, state.key) ? null : { failed: false, key: props.resetKey };
  }

  reset = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
