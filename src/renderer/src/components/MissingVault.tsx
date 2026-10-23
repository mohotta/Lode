import { useState } from 'react';
import type { VaultInfo } from '@shared/types';
import appIcon from '../../../../build/icon.svg';
import { CheckIcon, CopyIcon, FolderIcon, FolderPlusIcon, RefreshIcon, SearchIcon } from './Icons';
import { copyText } from './Markdown';

interface Props {
  vault: VaultInfo;
  /** Pick the folder's new place; it replaces this entry. */
  onLocate(): void;
  /** Check the path again (e.g. after reconnecting a drive). */
  onRetry(): void;
  onRecreate(): void;
  onOpenOther(): void;
  onForget(): void;
}

/**
 * Shown instead of the panes when the open vault's folder is gone (moved, renamed or deleted
 * outside Lode, or on a disconnected drive). Nothing is created unless the user asks for it here.
 */
export function MissingVault({ vault, onLocate, onRetry, onRecreate, onOpenOther, onForget }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="missing-vault">
      <div className="missing-brand">
        <img src={appIcon} alt="" aria-hidden="true" />
        Lode
      </div>
      <section className="missing-card" role="alert" aria-labelledby="vm-title">
        <div className="missing-top">
          <span className="missing-icon" aria-hidden="true">
            <FolderIcon size={18} />
          </span>
          <div>
            <h1 id="vm-title">Can't find the “{vault.name}” vault</h1>
            <p>The folder isn't where it used to be. It may have been moved, renamed or deleted, or its drive isn't connected.</p>
          </div>
        </div>
        <div className="missing-path">
          <span className="missing-path-cap">Last seen</span>
          <code title={vault.path}>{vault.path}</code>
          <button
            className="icon-btn"
            aria-label={copied ? 'Copied' : 'Copy path'}
            title={copied ? 'Copied' : 'Copy path'}
            onClick={() =>
              void copyText(vault.path).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>
        <div className="missing-options">
          <button className="missing-opt primary" onClick={onLocate} autoFocus>
            <span className="opt-tile accent" aria-hidden="true">
              <SearchIcon size={15} />
            </span>
            <span className="row-main">
              <span className="row-title">Locate the folder…</span>
              <span className="row-sub">If you moved or renamed it</span>
            </span>
            <kbd aria-hidden="true">↵</kbd>
          </button>
          <button className="missing-opt" onClick={onRetry}>
            <span className="opt-tile" aria-hidden="true">
              <RefreshIcon size={15} />
            </span>
            <span className="row-main">
              <span className="row-title">Try again</span>
              <span className="row-sub">If it's on a drive you've just reconnected</span>
            </span>
          </button>
          <button className="missing-opt" onClick={onRecreate}>
            <span className="opt-tile" aria-hidden="true">
              <FolderPlusIcon size={15} />
            </span>
            <span className="row-main">
              <span className="row-title">Create an empty vault here</span>
              <span className="row-sub">Start fresh at the same path</span>
            </span>
          </button>
        </div>
        <div className="missing-foot">
          <button className="link-btn" onClick={onOpenOther}>
            Open another vault…
          </button>
          <button className="btn quiet-danger" onClick={onForget}>
            Remove from list
          </button>
        </div>
      </section>
      <p className="missing-hint">Removing it from the list doesn't delete any files.</p>
    </div>
  );
}
