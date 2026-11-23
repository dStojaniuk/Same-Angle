import { useEffect, useRef, useState } from "react";

import { downloadBlob } from "./download";
import type { Point } from "./outline";
import type { RoomPhoto } from "./photo";
import { PhotoViewport } from "./PhotoViewport";
import {
  exportStylePlan,
  maxStylePrompt,
  maxStyleRegions,
  renderStyle,
  styleProviderConfigured,
  type StyleRegion,
} from "./styleRender";

const ignoreGeometryMove = () => {};

type ProviderStatus = "checking" | "configured" | "missing" | "unavailable";
const providerMessages: Record<ProviderStatus, string> = {
  checking: "Checking generation setup…",
  configured: "Generation sends the photo, mask and prompt to OpenAI.",
  missing: "Browser generation requires OPENAI_API_KEY on the local backend.",
  unavailable: "The local renderer could not report its generation status.",
};

type StyleEditorProps = {
  active: boolean;
  photo: RoomPhoto;
  onBack: () => void;
};

export function StyleEditor({ active, photo, onBack }: StyleEditorProps) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<StyleRegion["kind"]>("editable");
  const [draft, setDraft] = useState<Point[]>([]);
  const [regions, setRegions] = useState<StyleRegion[]>([]);
  const [candidate, setCandidate] = useState<File | null>(null);
  const [rendering, setRendering] = useState(false);
  const [exportingPlan, setExportingPlan] = useState(false);
  const [error, setError] = useState("");
  const [comparisonUrl, setComparisonUrl] = useState<string | null>(null);
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [provider, setProvider] = useState<ProviderStatus>("checking");
  const [providerCheck, setProviderCheck] = useState(0);
  const [featherEdges, setFeatherEdges] = useState(true);

  const request = useRef<AbortController | null>(null);
  const output = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const slider = useRef<HTMLInputElement>(null);

  const canRender =
    Boolean(prompt.trim()) &&
    !draft.length &&
    !rendering &&
    regions.some((region) => region.kind === "editable") &&
    regions.some((region) => region.kind === "protected");
  const comparison = comparisonUrl ? { url: comparisonUrl, split } : null;
  const editCount = regions.filter((region) => region.kind === "editable").length;
  const protectedCount = regions.length - editCount;
  const regionCount = kind === "editable" ? editCount : protectedCount;
  const basename = photo.name.replace(/\.[^.]+$/, "") || "room";

  useEffect(() => {
    if (!active) return;

    if (comparisonUrl) slider.current?.focus();
    else heading.current?.focus();
  }, [active, comparisonUrl]);

  useEffect(() => {
    if (!active) return;

    const controller = new AbortController();
    void styleProviderConfigured(controller.signal)
      .then((configured) => {
        if (!controller.signal.aborted) setProvider(configured ? "configured" : "missing");
      })
      .catch(() => {
        if (!controller.signal.aborted) setProvider("unavailable");
      });

    return () => controller.abort();
  }, [active, providerCheck]);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
      if (output.current) URL.revokeObjectURL(output.current);
    },
    [],
  );

  function addRegion() {
    if (draft.length < 3 || regionCount >= maxStyleRegions) return;

    setRegions([...regions, { kind, points: draft }]);
    setDraft([]);
    setError("");
  }

  function clearComparison() {
    if (output.current) URL.revokeObjectURL(output.current);
    output.current = null;
    setComparisonUrl(null);
  }

  function cancelRender() {
    request.current?.abort();
    request.current = null;
    setRendering(false);
  }

  async function saveStylePlan() {
    if (!canRender || exportingPlan) return;

    setExportingPlan(true);
    setError("");
    try {
      const plan = await exportStylePlan(photo, prompt, regions, featherEdges);
      downloadBlob(plan, `${basename}-style-plan.json`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Codex plan could not be saved.");
    } finally {
      setExportingPlan(false);
    }
  }

  async function arrange(imported: File | null) {
    if (!canRender || request.current || (!imported && provider !== "configured")) return;

    const controller = new AbortController();
    request.current = controller;
    setRendering(true);
    setError("");
    let url: string | null = null;

    try {
      const png = await renderStyle(
        photo,
        prompt,
        regions,
        imported,
        controller.signal,
        featherEdges,
      );
      if (controller.signal.aborted) return;

      url = URL.createObjectURL(png);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (controller.signal.aborted) return;
      if (image.naturalWidth !== photo.width || image.naturalHeight !== photo.height) {
        throw new Error("The render no longer matches the original photo size.");
      }

      output.current = url;
      setComparisonUrl(url);
      setSplit(50);
      url = null;
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The room edit could not be opened.");
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (request.current === controller) {
        request.current = null;
        setRendering(false);
      }
    }
  }

  if (!active) return null;

  return (
    <>
      <div className="studio-heading">
        <h1 ref={heading} tabIndex={-1}>
          Restyle room
        </h1>
      </div>
      <div className="studio-layout">
        <section className="canvas" aria-label="Style photo">
          <div className="canvas-header">
            <div className="photo-details">
              <strong title={photo.name}>{photo.name}</strong>
              <span>
                {photo.width} × {photo.height} px
              </span>
            </div>
            <div className="canvas-actions">
              <button
                type="button"
                className="text-button"
                disabled={zoom === 1}
                aria-pressed={panning}
                onClick={() => setPanning(!panning)}
              >
                Pan
              </button>
              <select
                aria-label="Photo zoom"
                value={zoom}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setZoom(value);
                  if (value === 1) setPanning(false);
                }}
              >
                <option value={1}>100%</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
              </select>
            </div>
          </div>
          <PhotoViewport
            photo={photo}
            outline={draft}
            onEdit={rendering ? ignoreGeometryMove : setDraft}
            onGeometryMove={ignoreGeometryMove}
            tool={panning ? "pan" : "points"}
            zoom={zoom}
            comparison={comparison}
            styleRegions={regions}
          />
          {comparison && (
            <div className="comparison-control">
              <span>All styled</span>
              <input
                type="range"
                ref={slider}
                aria-label="Before and after"
                aria-valuetext={`${split}% original, ${100 - split}% styled`}
                min={0}
                max={100}
                value={split}
                onChange={(event) => setSplit(event.currentTarget.valueAsNumber)}
              />
              <span>All original</span>
            </div>
          )}
        </section>

        <aside className="editor-panel" aria-label="Style tools">
          {comparison ? (
            <>
              <h2>Compare the style edit</h2>
              <p>Protected regions and pixels outside the edit mask use the original photo.</p>
              <a
                className="primary-button download-button"
                href={comparison.url}
                download={`${basename}-style.png`}
              >
                Download styled PNG
              </a>
              <button type="button" className="secondary-button" onClick={clearComparison}>
                Back to masks
              </button>
            </>
          ) : (
            <>
              <h2>Describe the changes</h2>
              <label className="style-field">
                Style prompt
                <textarea
                  rows={5}
                  value={prompt}
                  maxLength={maxStylePrompt}
                  disabled={rendering}
                  onChange={(event) => setPrompt(event.currentTarget.value)}
                  placeholder="Use light oak, remove the cabinet, and add a small dressing table."
                />
              </label>
              <fieldset className="style-field" disabled={rendering}>
                <legend>Mask regions</legend>
                <p id="style-mask-help">
                  Click to outline an area. Add edit regions for materials and furniture. Add
                  protected regions over doors and visible wall seams.
                </p>
                <label className="style-field">
                  Region type
                  <select
                    value={kind}
                    disabled={draft.length > 0}
                    onChange={(event) => setKind(event.currentTarget.value as StyleRegion["kind"])}
                  >
                    <option value="editable">Edit area</option>
                    <option value="protected">Protect geometry</option>
                  </select>
                </label>
                <output>
                  {editCount} {editCount === 1 ? "edit region" : "edit regions"}, {protectedCount}{" "}
                  protected
                </output>
                <div className="editor-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={addRegion}
                    disabled={draft.length < 3 || regionCount >= maxStyleRegions}
                  >
                    Add region
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!draft.length}
                    onClick={() => setDraft([])}
                  >
                    Clear outline
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!regions.length}
                    onClick={() => setRegions(regions.slice(0, -1))}
                  >
                    Undo added region
                  </button>
                </div>
              </fieldset>
              <label>
                <input
                  type="checkbox"
                  checked={featherEdges}
                  disabled={rendering}
                  onChange={(event) => setFeatherEdges(event.currentTarget.checked)}
                />
                Feather mask edges
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!canRender || provider !== "configured"}
                aria-describedby="generation-status"
                onClick={() => void arrange(null)}
              >
                Generate with OpenAI
              </button>
              <output id="generation-status">{providerMessages[provider]}</output>
              {(provider === "missing" || provider === "unavailable") && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setProvider("checking");
                    setProviderCheck((count) => count + 1);
                  }}
                >
                  Check generation setup again
                </button>
              )}
              <fieldset className="style-field" aria-label="Codex CLI files">
                <legend>Codex CLI</legend>
                <p>
                  Use both files with <code>$same-angle-redesign</code>.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canRender || exportingPlan}
                  onClick={() => void saveStylePlan()}
                >
                  Download Codex plan
                </button>
                <a
                  className="secondary-button download-button"
                  href={photo.url}
                  download={`${basename}-prepared.${photo.source ? "png" : "webp"}`}
                >
                  Download prepared photo
                </a>
              </fieldset>
              <label className="style-field">
                Import edited photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={rendering}
                  onChange={(event) => setCandidate(event.currentTarget.files?.[0] ?? null)}
                />
                {candidate && <span>{candidate.name}</span>}
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={!canRender || !candidate}
                onClick={() => void arrange(candidate)}
              >
                Apply masks to imported image
              </button>
              {rendering && (
                <button type="button" className="text-button" onClick={cancelRender}>
                  Stop waiting
                </button>
              )}
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  cancelRender();
                  setProvider("checking");
                  onBack();
                }}
              >
                Back to room editor
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
