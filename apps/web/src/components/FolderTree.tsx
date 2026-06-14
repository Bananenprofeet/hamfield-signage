import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { MediaFolderDto } from '@signage/shared';
import { Button, Modal } from './ui';

export interface FolderTreeNode {
  folder: MediaFolderDto;
  children: FolderTreeNode[];
}

/** Builds a nested tree from the flat folder list returned by the API. */
export function buildFolderTree(folders: MediaFolderDto[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>(
    folders.map((folder) => [folder.id, { folder, children: [] }]),
  );
  const roots: FolderTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.folder.parentFolderId ? nodes.get(node.folder.parentFolderId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (list: FolderTreeNode[]) => {
    list.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    for (const node of list) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}

export function FolderTree({
  folders,
  selectedId,
  onSelect,
  onDropMedia,
  renderExtra,
}: {
  folders: MediaFolderDto[];
  selectedId: string | null;
  onSelect: (folderId: string) => void;
  /** Called when media cards are dropped onto a folder (media browser DnD). */
  onDropMedia?: (folderId: string, mediaIds: string[]) => void;
  renderExtra?: (folder: MediaFolderDto) => ReactNode;
}) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (e: DragEvent, folderId: string) => {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData('application/x-media-ids');
    if (!raw || !onDropMedia) return;
    try {
      const ids = JSON.parse(raw) as string[];
      if (ids.length > 0) onDropMedia(folderId, ids);
    } catch {
      // not our payload
    }
  };

  const renderNode = (node: FolderTreeNode, depth: number): ReactNode => (
    <div key={node.folder.id}>
      <div
        className={`group flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
          selectedId === node.folder.id
            ? 'bg-blue-50 font-medium text-blue-700'
            : dropTarget === node.folder.id
              ? 'bg-blue-100'
              : 'text-slate-700 hover:bg-slate-100'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onSelect(node.folder.id)}
        onDragOver={(e) => {
          if (onDropMedia && e.dataTransfer.types.includes('application/x-media-ids')) {
            e.preventDefault();
            setDropTarget(node.folder.id);
          }
        }}
        onDragLeave={() => setDropTarget((t) => (t === node.folder.id ? null : t))}
        onDrop={(e) => handleDrop(e, node.folder.id)}
      >
        {node.children.length > 0 ? (
          <button
            className="w-4 shrink-0 text-xs text-slate-400 hover:text-slate-600"
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.folder.id);
            }}
            aria-label={collapsed.has(node.folder.id) ? 'Expand' : 'Collapse'}
          >
            {collapsed.has(node.folder.id) ? '▸' : '▾'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span aria-hidden>📁</span>
        <span className="min-w-0 flex-1 truncate" title={node.folder.path}>
          {node.folder.name}
        </span>
        {renderExtra ? renderExtra(node.folder) : null}
        {node.folder.mediaCount != null ? (
          <span className="text-xs text-slate-400">{node.folder.mediaCount}</span>
        ) : null}
      </div>
      {!collapsed.has(node.folder.id)
        ? node.children.map((child) => renderNode(child, depth + 1))
        : null}
    </div>
  );

  return <div className="space-y-0.5">{tree.map((node) => renderNode(node, 0))}</div>;
}

/**
 * Modal folder picker used for move/bulk-move targets and playlist folder
 * entries. `allowRoot` adds a "Root (no folder)" choice that picks null.
 */
export function FolderPickerModal({
  title,
  folders,
  allowRoot,
  excludeIds,
  confirmLabel,
  onPick,
  onClose,
  renderExtra,
}: {
  title: string;
  folders: MediaFolderDto[];
  allowRoot?: boolean;
  /** Folders that cannot be picked (e.g. the folder being deleted). */
  excludeIds?: string[];
  confirmLabel?: string;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
  renderExtra?: (folder: MediaFolderDto) => ReactNode;
}) {
  const excluded = new Set(excludeIds ?? []);
  const pickable = folders.filter((folder) => !excluded.has(folder.id));
  const [selected, setSelected] = useState<string | null>(
    allowRoot ? null : (pickable[0]?.id ?? null),
  );

  return (
    <Modal title={title} onClose={onClose}>
      <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200 p-2">
        {allowRoot ? (
          <div
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
              selected === null
                ? 'bg-blue-50 font-medium text-blue-700'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => setSelected(null)}
          >
            <span aria-hidden>🏠</span> Root (no folder)
          </div>
        ) : null}
        <FolderTree
          folders={pickable}
          selectedId={selected}
          onSelect={setSelected}
          renderExtra={renderExtra}
        />
        {pickable.length === 0 ? (
          <p className="px-2 py-3 text-sm text-slate-500">No folders available.</p>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onPick(selected)} disabled={selected === null && !allowRoot}>
          {confirmLabel ?? 'Select'}
        </Button>
      </div>
    </Modal>
  );
}
