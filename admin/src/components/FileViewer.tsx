import { useState, useEffect } from 'react';
import { getVaultFiles, getFileContent } from '../api';

interface FileViewerProps {
  vaultId: string;
  initialFilepath?: string;
  onClose: () => void;
}

interface FileNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: FileNode[];
}

function buildFileTree(files: string[]): FileNode[] {
  const root: FileNode[] = [];
  
  for (const filepath of files) {
    const parts = filepath.split('/');
    let current = root;
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      
      let node = current.find(n => n.name === part);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          isFolder: !isLast,
          children: []
        };
        current.push(node);
      }
      current = node.children;
    }
  }
  
  // Sort folders first, then files
  const sortNodes = (nodes: FileNode[]): FileNode[] => {
    return nodes
      .sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(node => ({
        ...node,
        children: sortNodes(node.children)
      }));
  };
  
  return sortNodes(root);
}

function FileTreeNode({ 
  node, 
  selectedPath, 
  onSelect,
  depth = 0 
}: { 
  node: FileNode; 
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  
  const handleClick = () => {
    if (node.isFolder) {
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };
  
  return (
    <div className="tree-node">
      <div 
        className={`tree-item ${selectedPath === node.path ? 'selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        <span className="tree-icon">
          {node.isFolder ? (expanded ? '📂' : '📁') : '📄'}
        </span>
        <span className="tree-name">{node.name}</span>
      </div>
      {node.isFolder && expanded && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode 
              key={child.path} 
              node={child} 
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileViewer({ vaultId, initialFilepath, onClose }: FileViewerProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFilepath || null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFiles();
  }, [vaultId]);

  useEffect(() => {
    if (selectedFile) {
      loadFileContent(selectedFile);
    } else {
      setFileContent(null);
    }
  }, [selectedFile]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      setError(null);
      const fileList = await getVaultFiles(vaultId);
      setFiles(fileList);
      setFileTree(buildFileTree(fileList));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (filepath: string) => {
    try {
      setLoadingContent(true);
      const content = await getFileContent(vaultId, filepath);
      setFileContent(content);
    } catch (err) {
      setFileContent(`Error loading file: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingContent(false);
    }
  };

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <button className="back-button" onClick={onClose}>
          ← Back
        </button>
        <h2>{vaultId}</h2>
        <span className="file-count">{files.length} files</span>
      </div>
      
      <div className="file-viewer-content">
        <div className="file-tree-panel">
          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner" />
              <p>Loading files...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <p>{error}</p>
            </div>
          ) : fileTree.length === 0 ? (
            <div className="empty-state small">
              <span className="empty-icon">📄</span>
              <p>No files in vault</p>
            </div>
          ) : (
            <div className="file-tree">
              {fileTree.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  selectedPath={selectedFile}
                  onSelect={setSelectedFile}
                />
              ))}
            </div>
          )}
        </div>
        
        <div className="file-preview-panel">
          {selectedFile ? (
            <>
              <div className="preview-header">
                <span className="preview-filename">{selectedFile}</span>
              </div>
              <div className="preview-content">
                {loadingContent ? (
                  <div className="loading-state">
                    <div className="loading-spinner" />
                  </div>
                ) : (
                  <pre className="file-content">{fileContent}</pre>
                )}
              </div>
            </>
          ) : (
            <div className="empty-preview">
              <span className="empty-icon">📄</span>
              <p>Select a file to preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

