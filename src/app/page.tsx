"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  AudioLines, Check, ChevronDown, CircleHelp, Clapperboard, Clock3, Download, FileAudio2,
  ImagePlus, LoaderCircle, Music2, Pause, Play, Plus, Settings2, Sparkles,
  Upload, WandSparkles, X,
} from "lucide-react";
import { LyricVideo, type LyricVideoProps, type LyricMode, type VisualizerMode } from "@/remotion/LyricVideo";
import type { AlignmentResult, TimedLyricsLine } from "@/core/alignment";

interface ProjectResponse {
  id: string;
  name: string;
  duration: number;
  timedLyrics: AlignmentResult;
  usage?: { cost?: number };
  model: string;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remain = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
}

function parseDisplayLines(lyrics: string): string[] {
  return lyrics.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !/^\[[^\]]+\]$/u.test(line));
}

export default function Home() {
  const [lyrics, setLyrics] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [mediaSrc, setMediaSrc] = useState("");
  const [backgroundSrc, setBackgroundSrc] = useState("");
  const [duration, setDuration] = useState(180);
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [lines, setLines] = useState<TimedLyricsLine[]>([]);
  const [selectedLine, setSelectedLine] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [mode, setMode] = useState<LyricMode>("karaoke");
  const [visualizer, setVisualizer] = useState<VisualizerMode>("waveform");
  const [fontFamily, setFontFamily] = useState("Arial, sans-serif");
  const [accentColor, setAccentColor] = useState("#c8f169");
  const [showProgress, setShowProgress] = useState(true);
  const [renderFormat, setRenderFormat] = useState("1920");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportUrl, setExportUrl] = useState("");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [audioPeaks, setAudioPeaks] = useState<number[]>([]);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const metadataAudioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  const displayLyrics = useMemo(() => parseDisplayLines(lyrics), [lyrics]);
  const currentSeconds = currentFrame / 30;
  const backgroundKind = backgroundFile?.type.startsWith("video/") ? "video" : "image";

  useEffect(() => {
    return () => {
      if (mediaSrc.startsWith("blob:")) URL.revokeObjectURL(mediaSrc);
      if (backgroundSrc.startsWith("blob:")) URL.revokeObjectURL(backgroundSrc);
    };
  }, [mediaSrc, backgroundSrc]);

  useEffect(() => {
    if (mediaSrc && metadataAudioRef.current) metadataAudioRef.current.load();
  }, [mediaSrc]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      setCurrentFrame((previous) => Math.abs(previous - detail.frame) >= 8 ? detail.frame : previous);
    };
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [mediaSrc]);

  function setMedia(file: File) {
    setMediaFile(file);
    setMediaSrc(URL.createObjectURL(file));
    setAudioPeaks([]);
    void readAudioPeaks(file).then(setAudioPeaks).catch(() => setAudioPeaks([]));
    setProject(null);
    setLines([]);
    setExportUrl("");
    setNotice("");
  }

  async function readAudioPeaks(file: File): Promise<number[]> {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const channel = decoded.getChannelData(0);
      const bucketCount = 160;
      const samplesPerBucket = Math.max(1, Math.floor(channel.length / bucketCount));
      const peaks = Array.from({ length: bucketCount }, (_, bucket) => {
        const start = bucket * samplesPerBucket;
        const end = bucket === bucketCount - 1 ? channel.length : Math.min(channel.length, start + samplesPerBucket);
        let sumSquares = 0;
        for (let index = start; index < end; index += 1) sumSquares += channel[index] * channel[index];
        return Math.sqrt(sumSquares / Math.max(1, end - start));
      });
      const maximum = Math.max(...peaks, 0.001);
      return peaks.map((peak) => peak / maximum);
    } finally {
      await context.close();
    }
  }

  function setBackground(file: File) {
    setBackgroundFile(file);
    setBackgroundSrc(URL.createObjectURL(file));
    setExportUrl("");
  }

  async function syncLyrics() {
    if (!mediaFile) {
      setError("Chọn file audio/video hoặc tải bộ test mẫu trước.");
      return;
    }
    if (!lyrics.trim()) {
      setError("Nhập lời bài hát trước khi đồng bộ.");
      return;
    }
    setIsSyncing(true);
    setError("");
    setNotice("Đang gửi audio lên OpenRouter và căn lời...");
    try {
      const body = new FormData();
      body.set("media", mediaFile);
      body.set("lyrics", lyrics);
      body.set("language", "vi");
      if (backgroundFile) body.set("background", backgroundFile);
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const data = await response.json() as { error?: string; project?: ProjectResponse; transcript?: string; mediaUrl?: string; backgroundUrl?: string | null };
      if (!response.ok || !data.project) throw new Error(data.error || "Không thể căn lyrics.");
      setProject(data.project);
      setLines(data.project.timedLyrics.lines);
      setDuration(data.project.duration);
      setTranscript(data.transcript ?? "");
      setMediaSrc(data.mediaUrl ?? "");
      setBackgroundSrc(data.backgroundUrl ?? (backgroundFile ? backgroundSrc : ""));
      setSelectedLine(0);
      setExportUrl("");
      const reviewCount = data.project.timedLyrics.lines.filter((line) => line.needsReview).length;
      setNotice(`Đã đồng bộ ${data.project.timedLyrics.lines.length} dòng. ${reviewCount ? `${reviewCount} dòng cần rà soát timing.` : "Timing có độ tin cậy tốt."}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không thể căn lyrics.";
      setError(message);
      setNotice("");
    } finally {
      setIsSyncing(false);
    }
  }

  function updateSelectedTiming(field: "start" | "end", value: number) {
    setLines((current) => current.map((line, index) => {
      if (index !== selectedLine) return line;
      const nextStart = field === "start" ? Math.min(Math.max(0, value), line.end) : line.start;
      const nextEnd = field === "end" ? Math.max(value, line.start) : line.end;
      const oldSpan = Math.max(0.001, line.end - line.start);
      const newSpan = Math.max(0, nextEnd - nextStart);
      const words = line.words.map((word) => ({
        ...word,
        start: nextStart + ((word.start - line.start) / oldSpan) * newSpan,
        end: nextStart + ((word.end - line.start) / oldSpan) * newSpan,
      }));
      return { ...line, start: nextStart, end: nextEnd, words };
    }));
    setExportUrl("");
  }

  async function saveTiming() {
    if (!project) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: lines.map((line) => ({ id: line.id, start: line.start, end: line.end, words: line.words.map((word) => ({ start: word.start, end: word.end })) })) }),
      });
      const result = await response.json() as ProjectResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || "Không lưu được timing.");
      setProject(result);
      setLines(result.timedLyrics.lines);
      setNotice("Đã lưu timing vào dự án.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không lưu được timing.");
    } finally {
      setSaving(false);
    }
  }

  async function exportVideo() {
    if (!project) {
      setError("Hãy đồng bộ lyrics trước khi xuất video.");
      return;
    }
    setIsExporting(true);
    setRenderProgress(0);
    setError("");
    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, mode, visualizer, accentColor, fontFamily, showProgress, width: renderFormat }),
      });
      let job = await response.json() as { id?: string; status?: string; progress?: number; error?: string; url?: string };
      if (!response.ok) throw new Error(job.error || "Không thể bắt đầu render.");
      if (job.status !== "completed") {
        if (!job.id) throw new Error("Máy chủ không trả về mã render job.");
        const jobId = job.id;
        for (let attempt = 0; attempt < 600; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          const statusResponse = await fetch(`/api/render?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          job = await statusResponse.json() as typeof job;
          if (!statusResponse.ok) throw new Error(job.error || "Không đọc được trạng thái render.");
          setRenderProgress(job.progress ?? 0);
          if (job.status === "failed") throw new Error(job.error || "Render video thất bại.");
          if (job.status === "completed") break;
        }
      }
      if (job.status !== "completed" || !job.url) throw new Error("Render đang chạy lâu hơn dự kiến. Hãy thử kiểm tra lại sau ít phút.");
      setExportUrl(job.url);
      const link = document.createElement("a");
      link.href = job.url;
      link.download = "lydra-lyric-video.mp4";
      link.click();
      setNotice("Video MP4 đã sẵn sàng để tải xuống.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không xuất được video.");
    } finally {
      setIsExporting(false);
    }
  }

  const playerProps: LyricVideoProps = {
    lines,
    ...(mediaSrc ? { audioSrc: mediaSrc } : {}),
    ...(backgroundSrc ? { backgroundSrc } : {}),
    backgroundKind,
    mode,
    visualizer,
    accentColor,
    fontFamily,
    showProgress,
    durationInSeconds: duration,
  };
  const selected = lines[selectedLine];
  const playerFrames = Math.max(1, Math.ceil(duration * 30));
  const compositionWidth = renderFormat === "1920" ? 1920 : 1080;
  const compositionHeight = renderFormat === "1080-square" ? 1080 : renderFormat === "1080" ? 1920 : 1080;
  const formatLabel = renderFormat === "1920" ? "16:9" : renderFormat === "1080" ? "9:16" : "1:1";

  return <main className="studio-shell">
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark"><AudioLines size={21} strokeWidth={2.1} /></div><div><strong>lydra</strong><span>LYRIC VIDEO STUDIO</span></div></div>
      <div className="topbar-center"><span className="status-dot" /> Bản nháp <span className="slash">/</span> {project?.name ?? "Dự án mới"}</div>
      <div className="topbar-actions"><button className="button button-primary" onClick={exportVideo} disabled={isExporting || !project}>{isExporting ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} {isExporting ? `Đang render ${renderProgress}%` : "Xuất video"}</button></div>
    </header>

    <section className="workspace">
      <aside className="panel left-panel">
        <div className="panel-heading"><div><span className="eyebrow">01 — NỘI DUNG</span><h2>Nguyên liệu</h2></div><button className="icon-button" aria-label="Trợ giúp"><CircleHelp size={17} /></button></div>

        <div className="field-block">
          <div className="field-label-row"><label>Âm thanh</label><span className="field-meta">MP3 · WAV · M4A · MP4</span></div>
          <button className={`upload-card ${mediaFile ? "is-ready" : ""}`} onClick={() => audioInputRef.current?.click()}>
            <span className="upload-icon"><FileAudio2 size={18} /></span><span className="upload-copy"><strong>{mediaFile?.name ?? "Chọn audio hoặc video"}</strong><small>{mediaFile ? `${(mediaFile.size / 1024 / 1024).toFixed(1)} MB · ${formatTime(duration)}` : "Bấm để chọn file trên máy"}</small></span>{mediaFile ? <Check className="ready-icon" size={17} /> : <Plus size={17} className="upload-plus" />}
          </button>
          <input ref={audioInputRef} className="hidden-input" type="file" accept="audio/*,video/mp4,video/quicktime,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) setMedia(file); }} />
        </div>

        <div className="field-block lyrics-block">
          <div className="field-label-row"><label htmlFor="lyrics-input">Lời bài hát</label><span className="field-meta">{displayLyrics.length} DÒNG</span></div>
          <textarea id="lyrics-input" className="lyrics-input" value={lyrics} placeholder={"Dán lời bài hát ở đây, mỗi câu một dòng.\n\n[Verse 1]\nLời câu thứ nhất\nLời câu thứ hai\n\n[Chorus]\nLời điệp khúc"} onChange={(event) => { setLyrics(event.target.value); setProject(null); setLines([]); setExportUrl(""); }} spellCheck={false} />
          <div className="input-hint"><Sparkles size={13} /> Dòng trong [ngoặc vuông] sẽ được giữ làm metadata, không render.</div>
        </div>

        <div className="left-footer"><div className="provider-note"><span className="provider-pulse" /><span><strong>OpenRouter</strong><small>Khóa API chỉ dùng ở server</small></span><ChevronDown size={14} /></div><button className="button button-sync" onClick={syncLyrics} disabled={isSyncing}>{isSyncing ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />} {isSyncing ? "Đang đồng bộ…" : "Đồng bộ lyrics"}</button></div>
      </aside>

      <section className="preview-column">
        <div className="preview-heading"><div><span className="eyebrow">02 — XEM TRƯỚC</span><h2>Khung hình</h2></div><div className="preview-tools"><span className="live-tag"><span /> LIVE PREVIEW</span><button className="icon-button" aria-label="Thiết lập xem trước"><Settings2 size={17} /></button></div></div>
        <div className="preview-frame-wrap">
          <div className={`preview-frame ${renderFormat === "1080" ? "preview-portrait" : renderFormat === "1080-square" ? "preview-square" : ""}`}>
            {mediaSrc ? <Player ref={playerRef} component={LyricVideo} inputProps={playerProps} durationInFrames={playerFrames} fps={30} compositionWidth={compositionWidth} compositionHeight={compositionHeight} style={{ width: "100%", height: "100%" }} controls clickToPlay doubleClickToFullscreen acknowledgeRemotionLicense /> : <div className="empty-preview"><div className="empty-orbit"><Music2 size={25} /></div><strong>Khung hình sẽ xuất hiện ở đây</strong><span>Chọn audio và dán lời bài hát để bắt đầu</span></div>}
          </div>
          <div className="preview-caption"><div className="caption-left"><span className="format-pill">{formatLabel}</span><span>{compositionWidth} × {compositionHeight}</span><span className="caption-separator" /> <Clock3 size={13} /> {formatTime(currentSeconds)} <span className="caption-muted">/ {formatTime(duration)}</span></div><span className="render-engine"><span className="engine-dot" /> Remotion Player</span></div>
        </div>
        <div className="message-stack" aria-live="polite">{error ? <div className="message error-message"><X size={15} />{error}<button onClick={() => setError("")} aria-label="Đóng"><X size={14} /></button></div> : null}{notice ? <div className="message success-message"><Check size={15} />{notice}<button onClick={() => setNotice("")} aria-label="Đóng"><X size={14} /></button></div> : null}</div>
        {transcript ? <details className="transcript-details"><summary>Bản nhận diện STT <span>{project?.model}</span></summary><p>{transcript}</p></details> : null}
      </section>

      <aside className="panel right-panel">
        <div className="panel-heading"><div><span className="eyebrow">03 — THIẾT KẾ</span><h2>Phong cách</h2></div><button className="icon-button" aria-label="Tuỳ chọn"><Settings2 size={17} /></button></div>
        <div className="design-scroll">
          <div className="field-block"><div className="field-label-row"><label>Nền hình ảnh / video</label><span className="field-meta">TÙY CHỌN</span></div><button className="background-picker" onClick={() => backgroundInputRef.current?.click()}>{backgroundSrc ? (backgroundKind === "video" ? <video src={backgroundSrc} muted loop autoPlay playsInline /> : <img src={backgroundSrc} alt="Ảnh nền xem trước" />) : <span className="background-empty"><ImagePlus size={18} /><small>Thêm ảnh hoặc video</small></span>}<span className="background-overlay"><Plus size={17} /></span></button><input ref={backgroundInputRef} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => { const file = event.target.files?.[0]; if (file) setBackground(file); }} /><div className="helper-line">Chọn nền trước khi đồng bộ để lưu vào video xuất.</div></div>

          <div className="field-block"><div className="field-label-row"><label>Kiểu hiển thị</label></div><div className="segmented-control"><button className={mode === "line" ? "active" : ""} onClick={() => setMode("line")}>Theo câu</button><button className={mode === "karaoke" ? "active" : ""} onClick={() => setMode("karaoke")}>Karaoke</button></div></div>

          <div className="field-block"><div className="field-label-row"><label>Kiểu chữ</label></div><div className="select-wrap"><select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}><option value="Arial, sans-serif">Arial · Sans Serif</option><option value="Georgia, serif">Georgia · Serif</option><option value="Trebuchet MS, sans-serif">Trebuchet · Rounded</option></select><ChevronDown size={15} /></div></div>

          <div className="field-block"><div className="field-label-row"><label>Tỉ lệ khung hình</label></div><div className="select-wrap"><select value={renderFormat} onChange={(event) => setRenderFormat(event.target.value)}><option value="1920">YouTube · 16:9</option><option value="1080">TikTok / Reels · 9:16</option><option value="1080-square">Bài đăng · 1:1</option></select><ChevronDown size={15} /></div></div>

          <div className="field-block"><div className="field-label-row"><label>Màu nhấn</label><span className="field-meta">LỚP PHỦ NỀN</span></div><div className="color-row"><div className="color-swatches">{["#c8f169", "#a8d8ff", "#ffd48a", "#f1a7cb", "#ffffff"].map((color) => <button key={color} className={`color-swatch ${accentColor === color ? "selected" : ""}`} style={{ backgroundColor: color }} onClick={() => setAccentColor(color)} aria-label={`Chọn màu ${color}`} />)}</div><label className="color-custom" title="Chọn màu tuỳ chỉnh"><input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /><span>{accentColor.toUpperCase()}</span></label></div></div>

          <div className="field-block"><div className="field-label-row"><label>Visualizer</label></div><div className="visualizer-grid"><button className={visualizer === "none" ? "selected" : ""} onClick={() => setVisualizer("none")}><span className="visualizer-preview no-visualizer"><span /></span><small>Tối giản</small></button><button className={visualizer === "vinyl" ? "selected" : ""} onClick={() => setVisualizer("vinyl")}><span className="visualizer-preview"><i className="mini-vinyl" /></span><small>Đĩa than</small></button><button className={visualizer === "waveform" ? "selected" : ""} onClick={() => setVisualizer("waveform")}><span className="visualizer-preview mini-wave">{Array.from({ length: 15 }, (_, index) => <i key={index} style={{ height: `${6 + (index * 17 % 20)}px` }} />)}</span><small>Sóng âm</small></button></div></div>

          <div className="toggle-row"><span><strong>Thanh tiến trình</strong><small>Tiến độ phát audio</small></span><button className={`toggle ${showProgress ? "on" : ""}`} onClick={() => setShowProgress((value) => !value)} aria-label="Bật tắt thanh tiến trình"><i /></button></div>
          <div className="contrast-card"><WandSparkles size={15} /><span><strong>Lớp phủ tối</strong><small>Lớp phủ nền giúp chữ luôn dễ đọc</small></span><span className="auto-badge">ON</span></div>
        </div>
      </aside>
    </section>

    <section className="timeline-panel">
      <div className="timeline-top"><div className="timeline-title"><div><span className="eyebrow">04 — TIMELINE</span><h2>Chỉnh sửa timing</h2></div><span className="line-count">{lines.length || displayLyrics.length} câu</span></div><div className="timeline-actions">{selected ? <span className={`review-pill ${selected.needsReview ? "needs-review" : ""}`}>{selected.needsReview ? "Cần rà soát" : "Độ khớp tốt"}</span> : <span className="timeline-hint">Đồng bộ để tạo timeline</span>}<button className="button button-quiet button-small" onClick={saveTiming} disabled={!project || saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} {saving ? "Đang lưu" : "Lưu timing"}</button></div></div>
      <div className="timeline-content">
        <div className="timeline-ruler"><div className="ruler-label">AUDIO / LYRICS</div><div className="ruler-track">{Array.from({ length: 7 }, (_, index) => <span key={index} style={{ left: `${(index / 6) * 100}%` }}>{formatTime((duration * index) / 6)}</span>)}</div></div>
        <div className="timeline-scroll">
          <div className="timeline-row audio-timeline-row"><div className="track-label"><span className="track-icon audio-track-icon"><AudioLines size={14} /></span><span>Audio</span></div><div className="track-area"><div className="audio-waveform">{audioPeaks.map((peak, index) => <i key={index} style={{ height: `${4 + peak * 34}px` }} />)}</div></div></div>
          {(lines.length ? lines : displayLyrics.map((text, index) => ({ id: `draft-${index}`, text, start: index * (duration / Math.max(displayLyrics.length, 1)), end: (index + 1) * (duration / Math.max(displayLyrics.length, 1)), confidence: 0, needsReview: true, words: [] }))).map((line, index) => {
            const left = Math.min(99.8, Math.max(0, (line.start / Math.max(duration, 0.1)) * 100));
            const width = Math.max(0.35, Math.min(100 - left, ((line.end - line.start) / Math.max(duration, 0.1)) * 100));
            return <div className={`timeline-row lyric-timeline-row ${selectedLine === index && lines.length ? "selected" : ""}`} key={line.id}>
              <button className="track-label line-track-label" onClick={() => { setSelectedLine(index); if (lines.length) { const frame = Math.round(line.start * 30); playerRef.current?.seekTo(frame); setCurrentFrame(frame); } }}><span className={`track-index ${line.needsReview ? "low-confidence" : ""}`}>{String(index + 1).padStart(2, "0")}</span><span className="track-line-text">{line.text}</span></button>
              <div className="track-area"><button className={`lyric-block ${line.needsReview ? "low-confidence" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => setSelectedLine(index)} title={`${formatTime(line.start)} – ${formatTime(line.end)} · ${line.text}`}><span>{line.text}</span></button></div>
            </div>;
          })}
        </div>
      </div>
      {selected && project ? <div className="timing-inspector"><div className="inspector-copy"><span className="eyebrow">ĐANG CHỌN</span><strong>{selected.text}</strong></div><label>Bắt đầu <input type="number" min="0" max={duration} step="0.05" value={selected.start.toFixed(2)} onChange={(event) => updateSelectedTiming("start", Number(event.target.value))} /> <small>s</small></label><label>Kết thúc <input type="number" min="0" max={duration} step="0.05" value={selected.end.toFixed(2)} onChange={(event) => updateSelectedTiming("end", Number(event.target.value))} /> <small>s</small></label><span className="confidence-label">Độ tin cậy <strong>{Math.round(selected.confidence * 100)}%</strong></span></div> : null}
    </section>

    <footer className="bottom-note"><span><span className="footer-spark">✳</span> Lyrics của bạn luôn là bản chuẩn hiển thị.</span><span><Clapperboard size={13} /> Render bằng Remotion <span className="caption-separator" /> <button onClick={() => { setLines([]); setProject(null); setTranscript(""); setExportUrl(""); setNotice("Đã đặt lại timing. Dữ liệu lời nhập vẫn được giữ."); }}>Đặt lại timing</button></span></footer>

    <audio ref={metadataAudioRef} src={mediaSrc || undefined} className="hidden-audio" preload="metadata" onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0 && !project) setDuration(value); }} />
    {exportUrl ? <a className="download-ready" href={exportUrl} download><Download size={15} /> Tải lại MP4</a> : null}
    <span className="sr-only"><Play size={1} /><Pause size={1} /><Upload size={1} /><ImagePlus size={1} /></span>
  </main>;
}
