const toPct = (value) => `${Math.round(value * 100)}%`;

export function ControlsPanel({
  lines,
  selectedLineId,
  onSelectLine,
  onAddLine,
  onDeleteLine,
  onDuplicateLine,
  onUpdateLine,
  showDebug,
  onToggleDebug,
  onExport,
  onImport,
}) {
  const selectedLine = lines.find((line) => line.id === selectedLineId) || null;

  return (
    <aside className="controls-panel">
      <div className="panel-header">
        <h2>Line Orchestra</h2>
        <button onClick={onAddLine}>+ Add line</button>
      </div>

      <label className="debug-row">
        <input type="checkbox" checked={showDebug} onChange={(e) => onToggleDebug(e.target.checked)} />
        Show debug overlay
      </label>

      <div className="lines-list">
        {lines.map((line) => (
          <button
            key={line.id}
            className={`line-item ${line.id === selectedLineId ? 'selected' : ''}`}
            onClick={() => onSelectLine(line.id)}
          >
            <span className="swatch" style={{ background: line.color }} />
            <span>{line.name}</span>
            <span className="line-meta">{toPct(line.thickness / 24)}</span>
          </button>
        ))}
      </div>

      {selectedLine && (
        <div className="line-settings">
          <h3>Selected line settings</h3>

          <label>
            Name
            <input
              value={selectedLine.name}
              onChange={(e) => onUpdateLine(selectedLine.id, { name: e.target.value })}
            />
          </label>

          <label>
            Color
            <input
              type="color"
              value={selectedLine.color}
              onChange={(e) => onUpdateLine(selectedLine.id, { color: e.target.value })}
            />
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={selectedLine.enabled}
              onChange={(e) => onUpdateLine(selectedLine.id, { enabled: e.target.checked })}
            />
            Enabled
          </label>

          <label>
            Thickness ({selectedLine.thickness}px)
            <input
              type="range"
              min="2"
              max="24"
              value={selectedLine.thickness}
              onChange={(e) => onUpdateLine(selectedLine.id, { thickness: Number(e.target.value) })}
            />
          </label>

          <label>
            Note offset ({selectedLine.noteOffset} st)
            <input
              type="range"
              min="-12"
              max="12"
              value={selectedLine.noteOffset}
              onChange={(e) => onUpdateLine(selectedLine.id, { noteOffset: Number(e.target.value) })}
            />
          </label>

          <label>
            Pitch sensitivity ({(selectedLine.sensitivity ?? 1).toFixed(2)})
            <input
              type="range"
              min="0.4"
              max="2"
              step="0.05"
              value={selectedLine.sensitivity ?? 1}
              onChange={(e) => onUpdateLine(selectedLine.id, { sensitivity: Number(e.target.value) })}
            />
          </label>

          <label>
            High pitch range ({(selectedLine.pitchSpread ?? 1).toFixed(2)}x)
            <input
              type="range"
              min="0.45"
              max="1"
              step="0.05"
              value={selectedLine.pitchSpread ?? 1}
              onChange={(e) => onUpdateLine(selectedLine.id, { pitchSpread: Number(e.target.value) })}
            />
          </label>

          <label>
            Gain ({(selectedLine.gain ?? 0.7).toFixed(2)})
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={selectedLine.gain ?? 0.7}
              onChange={(e) => onUpdateLine(selectedLine.id, { gain: Number(e.target.value) })}
            />
          </label>

          <div className="line-actions">
            <button onClick={() => onDuplicateLine(selectedLine.id)}>Duplicate</button>
            <button className="danger" onClick={() => onDeleteLine(selectedLine.id)}>Delete</button>
          </div>
        </div>
      )}

      <div className="io-actions">
        <button onClick={onExport}>Export Lines JSON</button>
        <label className="import-btn">
          Import JSON
          <input type="file" accept="application/json" onChange={onImport} />
        </label>
      </div>
    </aside>
  );
}
