import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { cn, fmtBytes } from '../lib/format';
import type { FormatPreset, Project, Stage, Status, TreeNode } from '../types';
import { ProjectDetail } from './ProjectDetail';
import { Button, EmptyState, Modal, Spinner } from './ui';

function Tree({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return (
    <ul className={cn(depth > 0 && 'ml-4 border-l border-line pl-3')}>
      {nodes.map((node) => (
        <li key={node.name} className="py-0.5 text-sm">
          <span className={node.type === 'dir' ? 'font-medium' : 'text-ink-soft'}>
            {node.name}
            {node.type === 'dir' && '/'}
          </span>
          {node.type === 'file' && node.size != null && (
            <span className="ml-2 text-xs text-ink-soft">{fmtBytes(node.size)}</span>
          )}
          {node.children && node.children.length > 0 && <Tree nodes={node.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function ProjectCard({
  project,
  stages,
  formats,
  onChanged,
  onDelete,
  onOpen,
  onNotify,
}: {
  project: Project;
  stages: Stage[];
  formats: FormatPreset[];
  onChanged: () => void;
  onDelete: (project: Project) => void;
  onOpen: (project: Project) => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [showTree, setShowTree] = useState(false);
  const current = stages.findIndex((s) => s.id === project.stage);

  const toggleTree = async (): Promise<void> => {
    if (!showTree) {
      try {
        setTree((await api.project(project.id)).tree);
      } catch (e) {
        onNotify((e as Error).message, 'error');
        return;
      }
    }
    setShowTree((v) => !v);
  };

  const setStage = async (stage: string): Promise<void> => {
    try {
      await api.updateProject(project.id, { stage });
      onChanged();
    } catch (e) {
      onNotify((e as Error).message, 'error');
    }
  };

  const copyPath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(project.folder);
      onNotify('Ruta copiada.', 'ok');
    } catch {
      onNotify('No se pudo copiar. Selecciona la ruta y cópiala a mano.', 'error');
    }
  };

  return (
    <article className="space-y-4 rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-3xl leading-tight">{project.name}</h3>
          {project.reference ? (
            <p className="mt-1 text-sm text-ink-soft">
              Referencia:{' '}
              <a href={project.reference.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-accent">
                {project.reference.title}
              </a>
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">Sin video de referencia</p>
          )}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {project.platforms.map((id) => {
            const f = formats.find((x) => x.id === id);
            return (
              <li key={id} className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent">
                {f ? `${f.label} · ${f.aspect}` : id}
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Etapa actual</p>
        <ol className="flex flex-wrap gap-1.5">
          {stages.map((stage, i) => {
            const state = i < current ? 'done' : i === current ? 'current' : 'todo';
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  onClick={() => setStage(stage.id)}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    state === 'current' && 'border-inverse bg-inverse font-semibold text-on-inverse',
                    state === 'done' && 'border-line bg-paper text-ink',
                    state === 'todo' && 'border-line bg-sunken text-ink-soft hover:border-ink-soft',
                  )}
                >
                  {state === 'done' && <span aria-hidden="true">✓ </span>}
                  {stage.label}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-paper px-3 py-2">
        <code className="min-w-0 flex-1 break-all text-xs text-ink-soft">{project.folder}</code>
        <Button variant="ghost" onClick={copyPath} className="py-1">
          Copiar ruta
        </Button>
      </div>
      {!project.folderExists && (
        <p className="text-sm text-warn">La carpeta ya no existe en el disco. Puedes quitar el proyecto de la lista.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onOpen(project)}>
          Abrir proyecto
        </Button>
        <Button onClick={toggleTree} aria-expanded={showTree}>
          {showTree ? 'Ocultar carpetas' : 'Ver carpetas'}
        </Button>
        <Button variant="ghost" onClick={() => onDelete(project)}>
          Quitar proyecto
        </Button>
      </div>

      {showTree && tree && (
        <div className="rounded-xl border border-line p-3">
          {tree.length === 0 ? <p className="text-sm text-ink-soft">La carpeta está vacía.</p> : <Tree nodes={tree} />}
        </div>
      )}
    </article>
  );
}

export function ProjectsView({
  stages,
  formats,
  status,
  version,
  onChanged,
  onNotify,
  onGoToVideos,
}: {
  stages: Stage[];
  formats: FormatPreset[];
  status: Status;
  version: number;
  onChanged: () => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
  onGoToVideos: () => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const [alsoFiles, setAlsoFiles] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .projects()
      .then((p) => {
        setProjects(p);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load, version]);

  const confirmDelete = async (): Promise<void> => {
    if (!toDelete) return;
    try {
      await api.deleteProject(toDelete.id, alsoFiles);
      onNotify(alsoFiles ? 'Proyecto y archivos eliminados.' : 'Proyecto quitado. Sus archivos siguen en el disco.', 'ok');
      setToDelete(null);
      setAlsoFiles(false);
      onChanged();
    } catch (e) {
      onNotify((e as Error).message, 'error');
    }
  };

  if (error) {
    return (
      <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-danger">
        {error}
      </p>
    );
  }
  if (!projects) return <Spinner label="Cargando proyectos" />;

  const open = openId != null ? projects.find((p) => p.id === openId) : undefined;
  if (open) {
    return (
      <ProjectDetail
        project={open}
        stages={stages}
        formats={formats}
        status={status}
        onBack={() => setOpenId(null)}
        onChanged={onChanged}
        onNotify={onNotify}
      />
    );
  }

  return (
    <section aria-label="Proyectos" className="space-y-4">
      {projects.length === 0 ? (
        <EmptyState
          title="Aún no tienes proyectos"
          actions={
            <Button variant="primary" onClick={onGoToVideos}>
              Elegir un video viral
            </Button>
          }
        >
          Un proyecto crea su carpeta de trabajo, con una subcarpeta por etapa y una de exportación por plataforma. Se crea desde
          un video viral.
        </EmptyState>
      ) : (
        projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            stages={stages}
            formats={formats}
            onChanged={onChanged}
            onDelete={setToDelete}
            onOpen={(p) => setOpenId(p.id)}
            onNotify={onNotify}
          />
        ))
      )}

      <Modal open={toDelete != null} onClose={() => setToDelete(null)} title="Quitar proyecto">
        <p className="text-ink-soft">
          Se quitará <strong className="text-ink">{toDelete?.name}</strong> de la lista.
        </p>
        <label className="mt-4 flex items-start gap-3 rounded-xl bg-paper p-3 text-sm">
          <input
            type="checkbox"
            checked={alsoFiles}
            onChange={(e) => setAlsoFiles(e.target.checked)}
            className="mt-0.5 accent-danger"
          />
          <span>
            Borrar también la carpeta y todos sus archivos del disco. <strong>No se puede deshacer.</strong>
          </span>
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setToDelete(null)}>
            Cancelar
          </Button>
          <Button variant={alsoFiles ? 'danger' : 'primary'} onClick={confirmDelete}>
            {alsoFiles ? 'Borrar proyecto y archivos' : 'Quitar proyecto'}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
