export interface FoundArchive {
  path: string;
  name: string;
  type: string;
  size: number;
  fileCount: number;
  gameDir: string | null;
}

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  archives: FoundArchive[];
}
