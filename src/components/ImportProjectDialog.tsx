import { useProjectStore } from '../store/useProjectStore';
import type { ImportPlanPreview } from '../utils/importProject';
import './ImportProjectDialog.css';

interface ImportProjectDialogProps {
  preview: ImportPlanPreview;
  fileName: string;
  onClose: () => void;
}

/**
 * Preview dialog for the "Append project" import flow. Shows a
 * summary of what the merged state will contain (new / renamed
 * plans, new / merged lenses, folders, catalogue-match counts) and
 * lets the user commit or cancel. On commit, applies the import
 * via the store's `appendImport` action and, if any shelf items
 * became orphans (no SKU match in the master catalogue), shows a
 * follow-up popup listing the SKUs.
 */
export function ImportProjectDialog({ preview, fileName, onClose }: ImportProjectDialogProps) {
  const appendImport = useProjectStore((s) => s.appendImport);
  const { summary, nextProject } = preview;

  const nothingToImport =
    summary.planCount === 0 &&
    summary.newLenses.length === 0 &&
    summary.mergedLenses.length === 0;

  const handleConfirm = () => {
    appendImport(nextProject);
    onClose();
    if (summary.orphanItemCount > 0) {
      // Setimeout so the dialog unmount commits before the alert
      // pops — otherwise the alert stops the React commit cycle.
      setTimeout(() => {
        const skus = summary.orphanSkus;
        const preview = skus.slice(0, 20).join('\n');
        const more = skus.length > 20 ? `\n…and ${skus.length - 20} more` : '';
        alert(
          `${summary.orphanItemCount} item${summary.orphanItemCount === 1 ? '' : 's'} from the imported plans could not be matched to your catalogue (${skus.length} unique SKU${skus.length === 1 ? '' : 's'}):\n\n` +
          `${preview}${more}\n\n` +
          `These cards will display as "(Not in catalogue)" with just the SKU. Load a catalogue containing these SKUs to re-link them automatically.`,
        );
      }, 80);
    }
  };

  return (
    <div className="import-dialog-overlay" onClick={onClose}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="import-dialog-header">
          <h2>Append plans from file</h2>
          <div className="import-dialog-filename" title={fileName}>{fileName}</div>
        </div>

        {nothingToImport ? (
          <div className="import-dialog-empty">
            <p>Nothing to import from this file.</p>
          </div>
        ) : (
          <div className="import-dialog-body">
            {summary.planCount > 0 && (
              <section>
                <h3>
                  {summary.planCount} plan{summary.planCount === 1 ? '' : 's'}
                </h3>
                {summary.renamedPlans.length > 0 && (
                  <>
                    <div className="section-hint">
                      Renamed to avoid collisions with existing plans:
                    </div>
                    <ul className="import-renames">
                      {summary.renamedPlans.map(({ originalName, newName }) => (
                        <li key={originalName}>
                          <span className="original">{originalName}</span>
                          <span className="arrow">→</span>
                          <span className="renamed">{newName}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

            {(summary.newLenses.length + summary.mergedLenses.length) > 0 && (
              <section>
                <h3>
                  {summary.newLenses.length + summary.mergedLenses.length} len
                  {summary.newLenses.length + summary.mergedLenses.length === 1 ? 's' : 'ses'}
                </h3>
                <ul className="import-items">
                  {summary.newLenses.map((n) => (
                    <li key={`new-${n}`}>
                      {n} <span className="tag tag-new">new</span>
                    </li>
                  ))}
                  {summary.mergedLenses.map((n) => (
                    <li key={`mrg-${n}`}>
                      {n} <span className="tag tag-merge">merge into existing</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(summary.newFolders.length + summary.mergedFolders.length) > 0 && (
              <section>
                <h3>Folders</h3>
                <ul className="import-items">
                  {summary.newFolders.map((n) => (
                    <li key={`nf-${n}`}>
                      {n} <span className="tag tag-new">new</span>
                    </li>
                  ))}
                  {summary.mergedFolders.map((n) => (
                    <li key={`mf-${n}`}>
                      {n} <span className="tag tag-merge">merge into existing</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3>Catalogue</h3>
              <ul className="import-items">
                <li>
                  <strong>{summary.matchedItemCount}</strong> item
                  {summary.matchedItemCount === 1 ? '' : 's'} matched to existing products by SKU
                </li>
                {summary.orphanItemCount > 0 && (
                  <li className="orphan-warning">
                    <strong>{summary.orphanItemCount}</strong> item
                    {summary.orphanItemCount === 1 ? '' : 's'} ({summary.orphanSkus.length} unique SKU
                    {summary.orphanSkus.length === 1 ? '' : 's'}) not in your catalogue — will display
                    as <em>"(Not in catalogue)"</em>
                  </li>
                )}
              </ul>
            </section>
          </div>
        )}

        <div className="import-dialog-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={nothingToImport}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
