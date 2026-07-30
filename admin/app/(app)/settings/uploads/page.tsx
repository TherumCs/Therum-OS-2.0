import { apiGet } from '../../../../lib/api';
import { Field, NumberInput, Toggle } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface Uploads {
  autoRename: boolean;
  maxUploadMb: number;
  resizeMaxPx: number;
  stripExif: boolean;
  autoWebp: boolean;
  allowImages: boolean;
  allowVideo: boolean;
  allowAudio: boolean;
  allowDocuments: boolean;
  allowArchives: boolean;
  allowCode: boolean;
}
const DEFAULTS: Uploads = {
  autoRename: false,
  maxUploadMb: 64,
  resizeMaxPx: 2560,
  stripExif: true,
  autoWebp: false,
  allowImages: true,
  allowVideo: true,
  allowAudio: true,
  allowDocuments: true,
  allowArchives: false,
  allowCode: false,
};

function ToggleRow({ label, desc, domain, field, initial }: { label: string; desc: string; domain: string; field: string; initial: boolean }) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
        <span className="settings-toggle-row-desc">{desc}</span>
      </div>
      <Toggle domain={domain} field={field} initial={initial} />
    </div>
  );
}

export default async function UploadsSettingsPage() {
  const up = await apiGet<Uploads>('/api/settings/uploads').catch(() => DEFAULTS);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Uploads</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        File types, max size, processing.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Media file renaming</h3>
        <ToggleRow
          label="Auto-rename on title edit"
          desc="When you change an attachment's title, the file is renamed to match."
          domain="uploads"
          field="autoRename"
          initial={up.autoRename}
        />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Limits</h3>
        <Field label="Max upload size (MB)">
          <NumberInput domain="uploads" field="maxUploadMb" initial={up.maxUploadMb} />
        </Field>
        <Field label="Auto-resize large images (px)" help="0 disables resizing.">
          <NumberInput domain="uploads" field="resizeMaxPx" initial={up.resizeMaxPx} />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Image processing</h3>
        <ToggleRow label="Strip EXIF data" desc="Remove camera/location metadata on upload." domain="uploads" field="stripExif" initial={up.stripExif} />
        <ToggleRow label="Auto-convert to WebP" desc="" domain="uploads" field="autoWebp" initial={up.autoWebp} />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Allowed file types</h3>
        <p className="settings-group-desc">
          Grouped by category rather than 1.9.44&apos;s 40 individual extension checkboxes — this stack&apos;s upload validation checks category,
          not extension, so that&apos;s the real level of control.
        </p>
        <ToggleRow label="Images" desc="JPEG, PNG, GIF, WebP, AVIF, SVG…" domain="uploads" field="allowImages" initial={up.allowImages} />
        <ToggleRow label="Video" desc="MP4, MOV, WebM, MKV…" domain="uploads" field="allowVideo" initial={up.allowVideo} />
        <ToggleRow label="Audio" desc="MP3, WAV, OGG, FLAC…" domain="uploads" field="allowAudio" initial={up.allowAudio} />
        <ToggleRow label="Documents" desc="PDF, TXT, CSV, DOCX, XLSX…" domain="uploads" field="allowDocuments" initial={up.allowDocuments} />
        <ToggleRow label="Archives" desc="ZIP, GZ, TAR, 7Z, RAR" domain="uploads" field="allowArchives" initial={up.allowArchives} />
        <ToggleRow label="Code" desc="JSON, XML, SQL, WOFF, TTF" domain="uploads" field="allowCode" initial={up.allowCode} />
      </div>
    </div>
  );
}
