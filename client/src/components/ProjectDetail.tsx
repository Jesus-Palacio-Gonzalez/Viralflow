import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AnalysisDTO, Clip, FormatPreset, Music, Project, ProjectContent, RenderState, ScriptDTO, Stage, Status } from '../types';
import { AnalysisPanel } from './AnalysisPanel';
import { ScriptPanel } from './ScriptPanel';
import { VideoPanel } from './VideoPanel';
import { Button, Spinner } from './ui';

export function ProjectDetail({
  project,
  stages,
  formats,
  status,
  onBack,
  onChanged,
  onNotify,
}: {
  project: Project;
  stages: Stage[];
  formats: FormatPreset[];
  status: Status;
  onBack: () => void;
  onChanged: () => void;
  onNotify: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [content, setContent] = useState<ProjectContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    api
      .content(project.id)
      .then((c) => !cancelled && setContent(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const setAnalysis = (analysis: AnalysisDTO): void => {
    setContent((c) => (c ? { ...c, analysis } : c));
    onChanged();
  };
  const setScript = (script: ScriptDTO): void => {
    setContent((c) => (c ? { ...c, script } : c));
    onChanged();
  };

  const setClips = (update: (clips: Clip[]) => Clip[]): void => {
    setContent((c) => (c ? { ...c, clips: update(c.clips) } : c));
    onChanged();
  };
  const setMusic = (music: Music | null): void => setContent((c) => (c ? { ...c, music } : c));
  const setRender = useCallback(
    (render: RenderState): void => {
      setContent((c) => (c ? { ...c, render } : c));
      if (render.status !== 'running') onChanged();
    },
    [onChanged],
  );

  const stage = stages.find((s) => s.id === project.stage);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" onClick={onBack} className="-ml-3">
          ← Todos los proyectos
        </Button>
        <h2 className="mt-1 font-display text-5xl leading-tight">{project.name}</h2>
        <p className="mt-1 text-ink-soft">
          Etapa: <span className="font-medium text-ink">{stage?.label ?? project.stage}</span>
          {project.reference && (
            <>
              {' · '}
              Referencia:{' '}
              <a href={project.reference.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-accent">
                {project.reference.title}
              </a>
            </>
          )}
        </p>
      </div>

      {!status.aiConfigured && (
        <p role="note" className="rounded-xl bg-caution px-4 py-3 text-sm text-warn">
          Falta <code>GEMINI_API_KEY</code> en el archivo <code>.env</code>. Es gratis: créala en{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
            aistudio.google.com/apikey
          </a>{' '}
          y reinicia el servidor.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-danger">
          {error}
        </p>
      )}
      {!content && !error && <Spinner label="Cargando proyecto" />}

      {content && (
        <>
          <AnalysisPanel project={project} analysis={content.analysis} aiConfigured={status.aiConfigured} onDone={setAnalysis} />
          <ScriptPanel
            project={project}
            formats={formats}
            script={content.script}
            aiConfigured={status.aiConfigured}
            hasAnalysis={content.analysis != null}
            onScript={setScript}
            onNotify={onNotify}
          />
          <VideoPanel
            project={project}
            formats={formats}
            script={content.script}
            analysis={content.analysis}
            clips={content.clips}
            music={content.music}
            render={content.render}
            voices={content.voices}
            aiConfigured={status.aiConfigured}
            onClips={setClips}
            onMusic={setMusic}
            onRender={setRender}
            onNotify={onNotify}
          />
        </>
      )}
    </div>
  );
}
