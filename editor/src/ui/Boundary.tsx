// Keeps one broken panel from blanking the whole editor: it shows what failed and a retry key,
// and the rest of the desk (and the file) keeps working.
import React from 'react';

type Props = {children: React.ReactNode; name: string; resetKey?: unknown; /** grid area the panel fills */ area?: string};

export class Boundary extends React.Component<Props, {error: string | null}> {
  state = {error: null as string | null};
  static getDerivedStateFromError(e: unknown) { return {error: e instanceof Error ? e.message : String(e)}; }
  componentDidCatch(e: unknown) { console.error(`[${this.props.name}]`, e); }
  componentDidUpdate(prev: Props) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({error: null}); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel-error" style={{gridArea: this.props.area}} role="alert">
        <b>{this.props.name} stopped</b>
        <code dir="ltr">{this.state.error}</code>
        <span>The file is intact and your work is saved. Try again; if it keeps happening, tell Claude about this message.</span>
        <button className="key small" onClick={() => this.setState({error: null})}>Try again</button>
      </div>
    );
  }
}
