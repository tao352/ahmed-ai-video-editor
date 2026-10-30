// The shortcuts sheet (?): read straight from the keymap, so it never goes out of date.
import React from 'react';
import {X} from '@phosphor-icons/react';
import {editor, useEditor} from '../store';
import {GROUPS, SHORTCUTS, type Group} from './keymap';

export function Shortcuts() {
  const open = useEditor(s => s.help);
  if (!open) return null;
  const close = () => editor.set(s => ({...s, help: false}));
  const groups = Object.keys(GROUPS) as Group[];
  return (
    <div className="sheet-scrim" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <header className="sheet-head">
          <h2 id="sheet-title">Keyboard shortcuts</h2>
          <span className="hint">Right-click anything on the timeline or the player to see what you can do with it</span>
          <button className="key small icon" aria-label="Close" title="Close (Esc)" onClick={close} autoFocus><X size={14} /></button>
        </header>
        <div className="sheet-cols">
          {groups.map(g => (
            <div key={g} className="sheet-group">
              <h3>{GROUPS[g]}</h3>
              <dl>
                {SHORTCUTS.filter(s => s.group === g && s.keys).map(s => (
                  <div key={s.keys} className="sheet-row"><dt>{s.label}</dt><dd><kbd>{s.keys}</kbd></dd></div>
                ))}
              </dl>
            </div>
          ))}
          <div className="sheet-group">
            <h3>Mouse</h3>
            <dl>
              <div className="sheet-row"><dt>Zoom the timeline around the pointer</dt><dd><kbd>Ctrl + Wheel</kbd></dd></div>
              <div className="sheet-row"><dt>Select more than one</dt><dd><kbd>Shift + Click</kbd></dd></div>
              <div className="sheet-row"><dt>Edit any text in the picture</dt><dd><kbd>Double-click</kbd></dd></div>
              <div className="sheet-row"><dt>Lock, hide or mute a track</dt><dd>Right-click its name</dd></div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}
