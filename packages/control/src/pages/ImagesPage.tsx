import { useEffect, useMemo, useState } from "react";
import type { ImageAsset } from "@sm/shared";
import { api, ApiError } from "../api";
import { compactDateTime } from "../service-date";

interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  count: number;
}

function buildTree(images: ImageAsset[]): FolderNode {
  const root: FolderNode = { name: "All images", path: "", children: [], count: images.length };
  const index = new Map<string, FolderNode>([["", root]]);
  for (const image of images) {
    const parts = image.folder ? image.folder.split("/") : [];
    let parent = root;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      let node = index.get(current);
      if (!node) {
        node = { name: part, path: current, children: [], count: 0 };
        index.set(current, node);
        parent.children.push(node);
      }
      node.count += 1;
      parent = node;
    }
  }
  const sort = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

function FolderBranch({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      <button
        className={`image-folder ${node.path === selected ? "current" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onSelect(node.path)}
      >
        <span className="image-folder-icon">{node.path ? "▸" : "▣"}</span>
        <span>{node.name}</span>
        <span className="muted">{node.count}</span>
      </button>
      {node.children.map((child) => (
        <FolderBranch
          key={child.path}
          node={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export default function ImagesPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState("");
  const [uploadFolder, setUploadFolder] = useState("uploads");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const result = await api.images();
      setImages(result.images);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load images", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const tree = useMemo(() => buildTree(images), [images]);
  const query = search.trim().toLowerCase();
  const visible = images.filter((image) => {
    if (query) return `${image.name} ${image.folder}`.toLowerCase().includes(query);
    return folder === "" || image.folder === folder || image.folder.startsWith(`${folder}/`);
  });

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadImage(file, uploadFolder);
      setFile(null);
      await load();
      notify(`Uploaded ${result.image.name}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not upload image", "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(image: ImageAsset) {
    if (!confirm(`Delete “${image.name}”?`)) return;
    try {
      await api.deleteImage(image.path);
      await load();
      notify("Image deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete image", "error");
    }
  }

  return (
    <div className="images-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Images</h2>
            <p className="muted">
              Browse folders under <code>library/images</code>, search globally or upload new images.
            </p>
          </div>
          <span className="muted">{images.length} images</span>
        </div>
        <div className="image-toolbar">
          <input
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search all images and folders…"
          />
          <label>
            Upload to folder
            <input
              value={uploadFolder}
              onChange={(event) => setUploadFolder(event.target.value)}
              placeholder="e.g. backgrounds"
            />
          </label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button className="button primary" onClick={upload} disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Upload image"}
          </button>
        </div>
        <p className="hint">
          Search ignores the selected folder. Supported formats: PNG, JPEG, GIF, WebP, AVIF and SVG;
          maximum 25 MB.
        </p>
      </section>

      <div className="images-layout">
        <aside className="panel image-tree">
          <div className="panel-heading">
            <h3>Folders</h3>
          </div>
          <FolderBranch node={tree} depth={0} selected={folder} onSelect={setFolder} />
        </aside>

        <section className="panel image-results">
          <div className="panel-heading">
            <h3>{query ? `Search: “${search}”` : folder || "All images"}</h3>
            <span className="muted">{visible.length}</span>
          </div>
          {loading ? (
            <p className="muted">Loading images…</p>
          ) : visible.length ? (
            <div className="image-grid">
              {visible.map((image) => (
                <article key={image.path} className="image-card">
                  <a href={image.url} target="_blank" rel="noreferrer" className="image-thumb">
                    <img src={image.url} alt={image.name} loading="lazy" />
                  </a>
                  <div className="image-card-meta">
                    <strong>{image.name}</strong>
                    <span className="muted">
                      {image.folder || "root"} · {(image.bytes / 1024).toFixed(0)} KB ·{" "}
                      {compactDateTime(image.modifiedAt)}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      className="button ghost small"
                      onClick={() => {
                        navigator.clipboard?.writeText(image.path);
                        notify("Image path copied");
                      }}
                    >
                      Copy path
                    </button>
                    <button className="button ghost small danger-text" onClick={() => remove(image)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No images found.</p>
          )}
        </section>
      </div>
    </div>
  );
}
