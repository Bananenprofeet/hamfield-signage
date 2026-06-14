import type { PrismaClient } from '@signage/database';

export interface FolderNode {
  id: string;
  parentFolderId: string | null;
  name: string;
}

/**
 * Folder paths and the folder tree are always computed from parent
 * relationships — never cached in the database — so renames and moves can
 * never leave stale paths behind. Organizations have at most a few hundred
 * folders, so loading them all is cheap.
 */
export async function loadFolders(
  prisma: PrismaClient,
  organizationId: string,
): Promise<FolderNode[]> {
  return prisma.mediaFolder.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, parentFolderId: true, name: true },
  });
}

/** Computes "Parent / Child / Grandchild" display paths for every folder. */
export function computeFolderPaths(folders: FolderNode[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = new Map<string, string>();

  const resolve = (id: string, seen: Set<string>): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const folder = byId.get(id);
    if (!folder) return '';
    // `seen` guards against accidental cycles in corrupted data.
    if (seen.has(id)) return folder.name;
    seen.add(id);
    const parentPath =
      folder.parentFolderId && byId.has(folder.parentFolderId)
        ? resolve(folder.parentFolderId, seen)
        : '';
    const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
    paths.set(id, path);
    return path;
  };

  for (const folder of folders) resolve(folder.id, new Set());
  return paths;
}

/** Returns the ids of `folderId` plus all its (transitive) subfolders. */
export function collectDescendantIds(folders: FolderNode[], folderId: string): string[] {
  const children = new Map<string | null, string[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentFolderId) ?? [];
    list.push(folder.id);
    children.set(folder.parentFolderId, list);
  }
  const result: string[] = [];
  const queue = [folderId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}

/** True when moving `folderId` under `newParentId` would create a cycle. */
export function wouldCreateCycle(
  folders: FolderNode[],
  folderId: string,
  newParentId: string,
): boolean {
  if (folderId === newParentId) return true;
  return collectDescendantIds(folders, folderId).includes(newParentId);
}

/**
 * Expands a folder reference into the folder ids to read media from,
 * honoring the includeSubfolders flag.
 */
export function expandFolderIds(
  folders: FolderNode[],
  folderId: string,
  includeSubfolders: boolean,
): string[] {
  if (!folders.some((f) => f.id === folderId)) return [];
  return includeSubfolders ? collectDescendantIds(folders, folderId) : [folderId];
}
