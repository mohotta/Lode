/** The app's empty state: an icon tile, a title, a line of help and optional actions. */
export function EmptyState({ icon, title, children, actions, compact = false }: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div className={`empty-v2 ${compact ? 'compact' : ''}`}>
      <span className="empty-tile" aria-hidden="true">
        {icon}
      </span>
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}
