import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useCreateCanvaGeneration,
  useCreateCanvaImageImport,
  useDisconnectCanva,
  useGetCanvaAuthStatus,
  useGetCanvaGeneration,
  useGetCanvaImageImport,
  getGetCanvaAuthStatusQueryKey,
  getGetCanvaGenerationQueryKey,
  getGetCanvaImageImportQueryKey,
} from '@workspace/api-client-react';
import type { CanvaGenerationJob, CanvaImageImportJob } from '@workspace/api-client-react';
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Sparkles,
  Trash2,
  Unplug,
  WandSparkles,
  X,
} from 'lucide-react';
import './index.css';

type AspectRatio = 'square' | 'landscape' | 'portrait';
type HistoryItem = {
  id: string;
  prompt: string;
  aspectRatio: AspectRatio;
  createdAt: string;
  imageUrl?: string;
  assetId?: string;
};

const STORAGE_KEY = 'campaign-studio-history-v1';
const RECONNECT_NOTICE = 'Your Canva connection is no longer valid. Reconnect Canva to continue.';
function needsReconnect(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // The fetch wrapper attaches the HTTP status and parsed response body.
  const apiError = error as Error & { status?: number; data?: unknown };
  if (apiError.status !== 401) return false;
  const data = apiError.data as { code?: string } | null;
  return ['canva_reconnect_required', 'canva_auth_required', 'canva_session_invalid'].includes(data?.code ?? '');
}
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const ratioOptions: { value: AspectRatio; title: string; size: string; shape: string }[] = [
  { value: 'square', title: 'Square', size: '1:1', shape: 'square' },
  { value: 'landscape', title: 'Landscape', size: '4:3', shape: 'landscape' },
  { value: 'portrait', title: 'Portrait', size: '3:4', shape: 'portrait' },
];

function readHistory(): HistoryItem[] {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as HistoryItem[] : [];
  } catch {
    return [];
  }
}

function useStudio() {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('square');
  const [history, setHistory] = useState<HistoryItem[]>(readHistory);
  const [generationId, setGenerationId] = useState('');
  const [importId, setImportId] = useState('');
  const [jobPrompt, setJobPrompt] = useState('');
  const [jobRatio, setJobRatio] = useState<AspectRatio>('square');
  const [notice, setNotice] = useState('');
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const savedJobId = useRef('');
  const queryClient = useQueryClient();

  useEffect(() => {
    const url = new URL(window.location.href);
    const connection = url.searchParams.get('canva');
    if (!connection) return;
    if (connection === 'connected') setNotice('Canva connected. You can now generate an image.');
    if (connection === 'cancelled') setNotice('Canva authorization was cancelled. Connect again when you are ready.');
    if (connection === 'error') setNotice('Canva authorization could not be verified. Please try connecting again.');
    url.searchParams.delete('canva');
    window.history.replaceState({}, '', url.toString());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      setNotice('Your browser could not save prompt history.');
    }
  }, [history]);

  const auth = useGetCanvaAuthStatus({
    query: {
      queryKey: getGetCanvaAuthStatusQueryKey(),
      refetchOnWindowFocus: true,
    },
  });
  const connected = auth.data?.connected === true && !auth.isError && !reconnectRequired;
  function handleCanvaError(error: unknown, fallback: string) {
    if (needsReconnect(error)) {
      setReconnectRequired(true);
      setNotice(RECONNECT_NOTICE);
      // Cancel an older status request before marking the cached connection
      // disconnected, then obtain the current server-side status.
      void queryClient.cancelQueries({ queryKey: getGetCanvaAuthStatusQueryKey() }).then(() => {
        queryClient.setQueryData(getGetCanvaAuthStatusQueryKey(), { connected: false, expiresAt: null });
        void auth.refetch();
      });
    } else {
      setNotice(error instanceof Error ? error.message : fallback);
    }
  }
  useEffect(() => {
    if (auth.data?.connected && !auth.isFetching) {
      setReconnectRequired(false);
      setNotice((current) => current === RECONNECT_NOTICE ? '' : current);
    }
  }, [auth.data, auth.isFetching]);
  const disconnect = useDisconnectCanva();
  const generate = useCreateCanvaGeneration();
  const generation = useGetCanvaGeneration(generationId, {
    query: {
      enabled: !!generationId && connected,
      retry: (count, error) => !needsReconnect(error) && count < 1,
      queryKey: getGetCanvaGenerationQueryKey(generationId),
      refetchInterval: (query) => !query.state.error && query.state.data?.status === 'in_progress' ? 1600 : false,
    },
  });
  const importImage = useCreateCanvaImageImport();
  const importJob = useGetCanvaImageImport(importId, {
    query: {
      enabled: !!importId && connected,
      retry: (count, error) => !needsReconnect(error) && count < 1,
      queryKey: getGetCanvaImageImportQueryKey(importId),
      refetchInterval: (query) => !query.state.error && query.state.data?.status === 'in_progress' ? 1600 : false,
    },
  });

  const result = generation.data as CanvaGenerationJob | undefined;
  const importResult = importJob.data as CanvaImageImportJob | undefined;
  useEffect(() => {
    const error = generation.error ?? importJob.error;
    if (needsReconnect(error)) handleCanvaError(error, RECONNECT_NOTICE);
  }, [generation.error, importJob.error]);
  useEffect(() => {
    if (result?.status !== 'success' || savedJobId.current === result.jobId) return;
    savedJobId.current = result.jobId;
    setHistory((items) => [{
      id: result.jobId,
      prompt: jobPrompt,
      aspectRatio: jobRatio,
      createdAt: new Date().toISOString(),
      imageUrl: result.imageUrl ?? undefined,
      assetId: result.assetId ?? undefined,
    }, ...items].slice(0, 12));
  }, [result, jobPrompt, jobRatio]);

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || !connected || isGenerating) return;
    setNotice('');
    setImportId('');
    setGenerationId('');
    setJobPrompt(prompt.trim());
    setJobRatio(aspectRatio);
    savedJobId.current = '';
    generate.mutate({ data: { prompt: prompt.trim(), aspectRatio } }, {
      onSuccess: (created) => setGenerationId(created.jobId),
      onError: (error) => handleCanvaError(error, 'Generation could not be started. Try again.'),
    });
  }

  function connectUrl() {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${base}/api/canva/oauth/start`;
  }

  function removeHistory(id: string) {
    setHistory((items) => items.filter((item) => item.id !== id));
  }

  function clearHistory() {
    setHistory([]);
  }

  function restoreHistory(item: HistoryItem) {
    setPrompt(item.prompt);
    setAspectRatio(item.aspectRatio);
    setNotice('Brief restored. Adjust it or send it to Canva again.');
  }

  function startImport(assetId: string) {
    if (!connected) return;
    const title = jobPrompt.trim().slice(0, 255) || 'Campaign image';
    importImage.mutate({ data: { assetId, title } }, {
      onSuccess: (created) => setImportId(created.jobId),
      onError: (error) => handleCanvaError(error, 'Could not send this image to Canva.'),
    });
  }

  const imageUrl = result?.status === 'success' ? result.imageUrl : null;
  const activeJob = !!generationId;
  const isGenerating = generate.isPending || (connected && !generation.isError && !!activeJob && (generation.isLoading || result?.status === 'in_progress'));

  return {
    prompt, setPrompt, aspectRatio, setAspectRatio, history, generationId, setGenerationId,
    jobPrompt, jobRatio,
    importId, setImportId, notice, setNotice, auth, disconnect, generate, generation,
    result, importImage, importJob, importResult, imageUrl, isGenerating, activeJob,
    submitPrompt, connectUrl, removeHistory, clearHistory, restoreHistory, startImport,
    queryClient, connected, reconnectRequired,
  };
}

function Studio() {
  const studio = useStudio();
  const connected = studio.connected;
  const importBusy = studio.importImage.isPending || (connected && !studio.importJob.isError && !!studio.importId && (
    studio.importJob.isLoading || studio.importResult?.status === 'in_progress'
  ));
  const connectBase = import.meta.env.BASE_URL.replace(/\/$/, '');
  const generationError = studio.generation.isError
    ? 'We lost the connection while checking this job.'
    : studio.result?.status === 'failed' ? studio.result.error || 'Canva could not create this image.' : '';
  const importError = studio.importJob.isError
    ? 'We lost the connection while checking this import.'
    : studio.importResult?.status === 'failed' ? studio.importResult.error || 'Canva could not make this design.' : '';

  return (
    <main className="studio-grain min-h-[100dvh] bg-background text-foreground">
      <div className="relative z-10 mx-auto w-full max-w-[1380px] px-5 pb-14 sm:px-8 lg:px-12">
        <header className="flex h-[82px] items-center justify-between border-b border-border/80">
          <a href={connectBase || '/'} className="flex items-center gap-3 text-foreground no-underline" data-testid="link-brand-home">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-primary text-primary-foreground">
              <WandSparkles size={18} strokeWidth={1.7} />
            </span>
            <span className="leading-tight">
              <span className="block text-[13px] font-extrabold tracking-[-.04em]">little studio</span>
              <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[.18em] text-muted-foreground">campaign image maker</span>
            </span>
          </a>
          <div className="flex items-center gap-2">
            {studio.auth.isLoading ? (
              <div className="h-9 w-[118px] animate-pulse rounded-full bg-secondary" aria-label="Checking Canva connection" />
            ) : studio.auth.isError ? (
              <button className="connection-pill text-muted-foreground" onClick={() => void studio.auth.refetch()} data-testid="button-retry-canva-status">
                <RefreshCw size={13} /> Retry connection
              </button>
            ) : connected ? (
              <div className="connection-pill connected" data-testid="status-canva-connected">
                <span className="connection-dot" /> Canva connected
                <button
                  className="disconnect-icon"
                  title="Disconnect Canva"
                  aria-label="Disconnect Canva"
                  disabled={studio.disconnect.isPending}
                  onClick={() => studio.disconnect.mutate(undefined, {
                    onSuccess: () => {
                      void studio.queryClient.invalidateQueries({ queryKey: getGetCanvaAuthStatusQueryKey() });
                      studio.setNotice('Canva disconnected.');
                    },
                    onError: (error) => studio.setNotice(error instanceof Error ? error.message : 'Could not disconnect Canva.'),
                  })}
                  data-testid="button-disconnect-canva"
                >
                  <Unplug size={13} />
                </button>
              </div>
            ) : (
              <a href={studio.connectUrl()} target="_blank" rel="noopener noreferrer" className="connection-pill connect-link" data-testid="link-connect-canva">
                <span className="connect-star"><Sparkles size={13} /></span> {studio.reconnectRequired ? 'Reconnect Canva' : 'Connect Canva'} <ArrowUpRight size={13} />
              </a>
            )}
          </div>
        </header>

        <section className="mx-auto max-w-[1180px] pt-11 sm:pt-[58px]">
          <div className="mb-9 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="rise-in">
              <p className="mb-3 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.18em] text-accent">
                <span className="h-px w-7 bg-accent" /> A small space for big ideas
              </p>
              <h1 className="max-w-[700px] text-[38px] font-semibold leading-[1.06] tracking-[-.055em] sm:text-[52px]">
                Make the image.<br className="hidden sm:block" /> <span className="font-serif font-medium italic text-accent">Make your point.</span>
              </h1>
              <p className="mt-4 max-w-[540px] text-[14px] leading-6 text-muted-foreground sm:text-[15px]">
                A brief in, a campaign-ready image out. Start with the feeling, we’ll take it to Canva.
              </p>
            </div>
            <div className="hidden items-center gap-2 pb-1 font-mono text-[10px] uppercase tracking-[.13em] text-muted-foreground md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#748b69]" /> Your creative desk <span className="px-1 text-border">/</span> No clutter, just making
            </div>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.03fr)_minmax(0,.97fr)] lg:gap-6">
            <section className="rise-in rounded-[22px] border border-border bg-card p-5 shadow-[0_12px_40px_rgba(50,64,54,.045)] sm:p-7" aria-labelledby="brief-title">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="section-kicker">01 / Your brief</p>
                  <h2 id="brief-title" className="mt-1.5 text-[20px] font-bold tracking-[-.04em]">What are we making?</h2>
                </div>
                <span className="step-mark">01</span>
              </div>

              <form onSubmit={studio.submitPrompt}>
                <label className="mb-2 block text-[11px] font-bold uppercase tracking-[.09em] text-foreground/70" htmlFor="brief-prompt">
                  Tell us what it should feel like
                </label>
                <div className="prompt-wrap">
                  <textarea
                    id="brief-prompt"
                    value={studio.prompt}
                    onChange={(event) => studio.setPrompt(event.target.value.slice(0, 2000))}
                    placeholder="A sunlit still life for a neighborhood flower shop’s spring launch. Loose tulips, vivid coral, a little imperfection..."
                    maxLength={2000}
                    rows={5}
                    data-testid="input-campaign-brief"
                  />
                  <div className="prompt-foot">
                    <span className="flex items-center gap-1.5"><Sparkles size={12} /> Be specific about mood, subject, and light</span>
                    <span className="font-mono">{studio.prompt.length}<span className="text-muted-foreground/50"> / 2000</span></span>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-[.09em] text-foreground/70">Choose a shape</span>
                    <span className="font-mono text-[10px] text-muted-foreground">You can resize later</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {ratioOptions.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        onClick={() => studio.setAspectRatio(option.value)}
                        className={`ratio-option ${studio.aspectRatio === option.value ? 'selected' : ''}`}
                        aria-pressed={studio.aspectRatio === option.value}
                        data-testid={`button-ratio-${option.value}`}
                      >
                        <span className={`ratio-glyph ${option.shape}`} />
                        <span className="min-w-0 text-left">
                          <span className="block text-[12px] font-bold">{option.title}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{option.size}</span>
                        </span>
                        <span className="ratio-check">{studio.aspectRatio === option.value ? <Check size={11} /> : null}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {!connected && !studio.auth.isLoading && (!studio.auth.isError || studio.reconnectRequired) && (
                  <div className="mt-5 flex items-start gap-3 rounded-xl bg-[#f2eee5] px-3.5 py-3 text-[11px] leading-[1.55] text-muted-foreground">
                    <LockKeyhole size={14} className="mt-0.5 shrink-0 text-primary" />
                    <p>
                      {studio.reconnectRequired ? RECONNECT_NOTICE : 'Connect Canva to generate and turn your image into an editable design. Your account stays securely linked through Canva.'}
                      {studio.reconnectRequired && <a href={studio.connectUrl()} target="_blank" rel="noopener noreferrer" className="ml-2 font-semibold underline" data-testid="link-reconnect-canva">Reconnect Canva <ArrowUpRight size={12} className="inline" /></a>}
                    </p>
                  </div>
                )}

                {studio.notice && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-[11px] leading-5 text-muted-foreground" role="status" data-testid="status-studio-notice">
                    <CircleAlert size={14} className="mt-0.5 shrink-0 text-accent" />
                    <span className="flex-1">{studio.notice}</span>
                    <button type="button" onClick={() => studio.setNotice('')} aria-label="Dismiss message" data-testid="button-dismiss-notice"><X size={13} /></button>
                  </div>
                )}
                {studio.generate.isError && !studio.notice && (
                  <p className="mt-3 text-[11px] text-destructive" role="alert">Couldn’t start that generation. Please try once more.</p>
                )}

                <button
                  type="submit"
                  disabled={!connected || !studio.prompt.trim() || studio.isGenerating}
                  className="make-button mt-6"
                  data-testid="button-generate-campaign"
                >
                  {studio.generate.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <WandSparkles size={16} />}
                  <span>{studio.generate.isPending ? 'Sending brief to Canva…' : 'Make my campaign image'}</span>
                  {!studio.generate.isPending && <ArrowUpRight size={15} className="ml-auto opacity-70" />}
                </button>
                <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[10px] text-muted-foreground">
                  <LockKeyhole size={10} /> Generated with Canva. No preview until Canva returns one.
                </p>
              </form>
            </section>

            <section className="rise-in-delay rounded-[22px] border border-border bg-[#e9e7dc] p-4 sm:p-5" aria-labelledby="result-title">
              <div className="flex items-center justify-between px-1 pb-3">
                <div>
                  <p className="section-kicker">02 / The image</p>
                  <h2 id="result-title" className="mt-1.5 text-[20px] font-bold tracking-[-.04em]">Your canvas</h2>
                </div>
                {studio.result?.status === 'success' && <span className="result-ready"><span className="connection-dot" /> Ready to work with</span>}
                {studio.isGenerating && <span className="result-ready pending"><LoaderCircle size={12} className="animate-spin" /> Creating</span>}
              </div>

              <div className={`preview-stage ${studio.imageUrl ? 'has-image' : ''}`}>
                {studio.imageUrl ? (
                  <img src={studio.imageUrl} alt="Generated campaign image" className="generated-image" data-testid="img-campaign-result" />
                ) : studio.isGenerating ? (
                  <div className={`preview-skeleton ratio-${studio.jobRatio}`} data-testid="status-generation-progress">
                    <span className="skeleton-orbit"><span /><span /><span /></span>
                    <span className="mt-4 text-[12px] font-semibold text-primary">Canva is finding the image in your words.</span>
                    <span className="mt-1 font-mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">This can take a little moment</span>
                  </div>
                ) : studio.result?.status === 'success' ? (
                  <div className="preview-empty" data-testid="status-result-no-preview">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e6ebdf] text-[#597250]"><Check size={17} /></span>
                    <p className="mt-4 text-[12px] font-semibold">Canva finished your image.</p>
                    <p className="mt-1 max-w-[250px] text-[11px] leading-5 text-muted-foreground">There isn’t a preview URL to show here, but the brief is saved below.</p>
                  </div>
                ) : (
                  <div className="preview-empty" data-testid="status-empty-canvas">
                    <div className="empty-canvas-mark">
                      <span className="canvas-cross top-left" /><span className="canvas-cross top-right" />
                      <span className="canvas-cross bottom-left" /><span className="canvas-cross bottom-right" />
                      <div className="empty-sun" />
                      <div className="empty-line one" /><div className="empty-line two" /><div className="empty-line three" />
                      <span className="empty-note">your next idea</span>
                    </div>
                    <p className="mt-5 text-[12px] font-semibold tracking-[-.01em]">Your next campaign starts here.</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Write a brief and send it to Canva.</p>
                  </div>
                )}
              </div>

              {generationError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#d9b0a6] bg-[#fff9f5] px-3 py-2.5 text-[11px] leading-5 text-[#8e463b]" role="alert" data-testid="status-generation-error">
                  <CircleAlert size={14} className="mt-0.5 shrink-0" /><span className="flex-1">{generationError}</span>
                  {connected && <button onClick={() => void studio.generation.refetch()} className="underline underline-offset-2" data-testid="button-retry-generation">Retry</button>}
                </div>
              )}
              {studio.generation.isLoading && studio.generationId && (
                <div className="mt-3 h-8 animate-pulse rounded-lg bg-[#dcdacf]" aria-label="Loading generation status" />
              )}

              {studio.imageUrl && (
                <div className="mt-3 rounded-[13px] border border-border/80 bg-card p-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold">Image is ready</p>
                      <p className="mt-1 max-w-[310px] truncate text-[10px] text-muted-foreground">{studio.jobPrompt || 'Campaign image'}</p>
                    </div>
                    <button
                      className="canva-import-button"
                      disabled={!connected || !studio.result?.assetId || importBusy}
                      onClick={() => studio.result?.assetId && studio.startImport(studio.result.assetId)}
                      data-testid="button-send-to-canva"
                    >
                      {importBusy ? <LoaderCircle size={13} className="animate-spin" /> : <ArrowUpRight size={13} />}
                      {importBusy ? 'Preparing design…' : 'Save to Canva'}
                    </button>
                  </div>
                  {!studio.result?.assetId && <p className="mt-2 text-[10px] text-muted-foreground">Canva did not return an editable asset for this image.</p>}
                  {studio.importResult?.status === 'success' && studio.importResult.designUrl && (
                    <a href={studio.importResult.designUrl} target="_blank" rel="noreferrer" className="import-success mt-3" data-testid="link-open-canva-design">
                      <Check size={13} /> Your editable design is ready <ArrowUpRight size={12} className="ml-auto" />
                    </a>
                  )}
                  {importError && (
                    <div className="mt-3 flex items-center gap-2 text-[10px] text-destructive" role="alert" data-testid="status-import-error">
                      <CircleAlert size={13} /><span className="flex-1">{importError}</span>
                      {connected && studio.result?.assetId && <button className="underline" onClick={() => studio.startImport(studio.result!.assetId!)} data-testid="button-retry-import">Try again</button>}
                    </div>
                  )}
                  {studio.importResult?.status === 'in_progress' && <p className="mt-3 text-[10px] text-muted-foreground" data-testid="status-import-progress">Canva is turning the image into an editable design…</p>}
                </div>
              )}
              {!studio.imageUrl && !studio.isGenerating && !generationError && (
                <div className="mt-3 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><ImageIcon size={12} /> Output appears here</span>
                  <span className="font-mono uppercase tracking-[.1em]">Canva image generation</span>
                </div>
              )}
            </section>
          </div>

          <section className="mt-9 border-t border-border/80 pt-6" aria-labelledby="history-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-end gap-3">
                <div className="step-mark small">03</div>
                <div>
                  <p className="section-kicker">Kept on this device</p>
                  <h2 id="history-title" className="mt-1 text-[17px] font-bold tracking-[-.035em]">Recent briefs <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{studio.history.length.toString().padStart(2, '0')}</span></h2>
                </div>
              </div>
              {studio.history.length > 0 && (
                <button onClick={studio.clearHistory} className="text-[10px] font-semibold text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground" data-testid="button-clear-history">
                  Clear history
                </button>
              )}
            </div>
            {studio.history.length === 0 ? (
              <div className="mt-4 flex min-h-[76px] items-center gap-3 rounded-xl border border-dashed border-border/90 bg-card/40 px-4" data-testid="status-empty-history">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Clock3 size={14} /></span>
                <div>
                  <p className="text-[11px] font-semibold">Your recent ideas will live here.</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">History is saved only in this browser. Briefs are sent to Canva to generate images.</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {studio.history.map((item) => (
                  <article key={item.id} className="history-row group" data-testid={`card-history-${item.id}`}>
                    <button onClick={() => studio.restoreHistory(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left" data-testid={`button-restore-history-${item.id}`}>
                      {item.imageUrl ? <img src={item.imageUrl} className="history-thumb" alt="" /> : <span className={`history-thumb history-placeholder ${item.aspectRatio}`}><ImageIcon size={15} /></span>}
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-semibold">{item.prompt}</span>
                        <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">
                          {item.aspectRatio} <span className="text-border">·</span> {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </span>
                    </button>
                    <button onClick={() => studio.removeHistory(item.id)} className="history-delete" aria-label="Remove saved brief" data-testid={`button-delete-history-${item.id}`}><Trash2 size={13} /></button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <footer className="mt-10 flex flex-col gap-2 border-t border-border/70 pt-4 text-[9px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="font-mono uppercase tracking-[.14em]">Little Studio <span className="mx-1.5 text-border">/</span> For the next good idea</span>
            <span className="flex items-center gap-1.5"><LockKeyhole size={10} /> Brief history stays in your browser. Canva handles creation and design import.</span>
          </footer>
        </section>
      </div>
    </main>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Studio />
    </QueryClientProvider>
  );
}

export default App;
