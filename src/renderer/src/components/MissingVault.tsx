import type { VaultInfo } from '@shared/types';
import { FolderIcon } from './Icons';

interface Props {
  vault: VaultInfo;
  onRecreate(): void;
  onForget(): void;
  onOpenOther(): void;
}

/**
 * Shown instead of the panes when the open vault's folder is gone (moved, renamed or deleted
 * outside Lode). Nothing is created unless the user asks for it here.
 */
export function MissingVault({ vault, onRecreate, onForget, onOpenOther }: Props): React.JSX.Element {
  return (
    <div className="missing-vault" role="alert">
      <span className="missing-icon" aria-hidden="true">
        <FolderIcon size={22} />
      </span>
      <h1>Can't find the “{vault.name}” vault</h1>
      <p>Its folder isn't at this location any more. It may have been moved, renamed or deleted, or its drive isn't connected.</p>
      <code className="missing-path">{vault.path}</code>
      <div className="missing-actions">
        <button className="btn primary tall" onClick={onOpenOther}>
          Open another folder…
        </button>
        <button className="btn tall" onClick={onRecreate}>
          Create an empty vault here
        </button>
        <button className="btn quiet-danger tall" onClick={onForget}>
          Remove from list
        </button>
      </div>
      <p className="missing-hint">
        If you moved the folder, open it from its new place. Removing it from the list doesn't delete any files.
      </p>
    </div>
  );
}
