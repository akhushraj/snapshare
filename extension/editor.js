'use strict';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
const S = {
  tool: 'crop',           // 'crop' | 'select' | 'arrow' | 'rect' | 'circle' | 'text'
  color: '#FF3B30',
  strokeWidth: 6,

  image: null,            // HTMLImageElement

  isDrawing: false,
  startX: 0,
  startY: 0,

  cropRegion: null,       // { x, y, w, h } in image coords — null = full image
  cropPreview: null,      // in-progress crop drag

  annotations: [],        // finished shapes
  preview: null,          // in-progress shape (not yet committed)

  textPending: null,      // { x, y } waiting for text input

  // Select / move
  selectedIdx: -1,        // index into annotations[], -1 = none
  isDraggingAnnotation: false,
  dragLastX: 0,
  dragLastY: 0,
};

// ─────────────────────────────────────────────
//  DOM refs
// ─────────────────────────────────────────────
const canvas    = document.getElementById('main-canvas');
const ctx       = canvas.getContext('2d');
const textWrap  = document.getElementById('text-wrap');
const textInput = document.getElementById('text-input');
const hintText  = document.getElementById('hint-text');
const errorBar  = document.getElementById('error-bar');
const statusBg  = document.getElementById('status-backdrop');
const statusMsg = document.getElementById('status-msg');
const urlModal  = document.getElementById('url-modal');
const urlText   = document.getElementById('url-text');
const copyCopied = document.getElementById('copy-copied');

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
(async () => {
  const params    = new URLSearchParams(location.search);
  const captureId = params.get('id');
  if (!captureId) { showError('No capture ID — open this from the SnapShare extension.'); return; }

  const stored = await chrome.storage.local.get(`capture_${captureId}`);
  const base64 = stored[`capture_${captureId}`];
  await chrome.storage.local.remove(`capture_${captureId}`);

  if (!base64) { showError('Screenshot data not found. Please try capturing again.'); return; }

  const img = new Image();
  img.onload = () => {
    S.image = img;
    setupCanvas();
    setupEvents();
    render();
  };
  img.onerror = () => showError('Failed to decode screenshot.');
  img.src = `data:image/png;base64,${base64}`;
})();

// ─────────────────────────────────────────────
//  Canvas setup
// ─────────────────────────────────────────────
function setupCanvas() {
  const { naturalWidth: iw, naturalHeight: ih } = S.image;
  canvas.width  = iw;
  canvas.height = ih;

  // Scale to fit the viewport width (minus toolbar), keep scrollable vertically
  const maxW = window.innerWidth - 56 - 40; // toolbar + padding
  const scale = Math.min(1, maxW / iw);
  canvas.style.width  = `${Math.round(iw * scale)}px`;
  canvas.style.height = `${Math.round(ih * scale)}px`;
}

// Convert a mouse/pointer event to image-space coordinates
function toImg(e) {
  const r  = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  return {
    x: (e.clientX - r.left) * sx,
    y: (e.clientY - r.top)  * sy,
  };
}

// ─────────────────────────────────────────────
//  Event wiring
// ─────────────────────────────────────────────
function setupEvents() {
  // Tool buttons
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      commitText();
      S.tool = btn.dataset.tool;
      S.selectedIdx = -1;  // deselect when switching tools
      canvas.style.cursor = S.tool === 'select' ? 'default' : 'crosshair';
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateHint();
      render();
    });
  });

  // Color dots
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      S.color = dot.dataset.color;
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      // Update text input color live
      textInput.style.color = S.color;
    });
  });

  // Stroke buttons
  document.querySelectorAll('.stroke-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      S.strokeWidth = parseInt(btn.dataset.width, 10);
      document.querySelectorAll('.stroke-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Undo
  document.getElementById('undo-btn').addEventListener('click', undo);

  // Clear crop
  document.getElementById('clear-crop-btn').addEventListener('click', () => {
    S.cropRegion = null;
    S.cropPreview = null;
    render();
  });

  // Share
  document.getElementById('share-btn').addEventListener('click', doShare);

  // URL modal
  document.getElementById('copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(urlText.textContent).then(() => {
      copyCopied.style.display = 'block';
      setTimeout(() => { copyCopied.style.display = 'none'; }, 2000);
    });
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    urlModal.classList.remove('visible');
  });

  // Canvas mouse events
  canvas.addEventListener('mousedown',  onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.target === textInput) return; // let text input handle its own keys
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doShare(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selectedIdx >= 0) {
      e.preventDefault();
      S.annotations.splice(S.selectedIdx, 1);
      S.selectedIdx = -1;
      render();
    }
    if (e.key === 'Escape') {
      commitText();
      S.isDrawing   = false;
      S.preview     = null;
      S.cropPreview = null;
      S.selectedIdx = -1;
      render();
    }
  });

  // Text input
  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') commitText();
    if (e.key === 'Escape') cancelText();
    e.stopPropagation();
  });
  textInput.addEventListener('blur', commitText);
}

// ─────────────────────────────────────────────
//  Mouse handlers
// ─────────────────────────────────────────────
function onMouseDown(e) {
  if (e.button !== 0) return;
  const { x, y } = toImg(e);

  // ── Select tool ──
  if (S.tool === 'select') {
    let hit = -1;
    for (let i = S.annotations.length - 1; i >= 0; i--) {
      if (hitTest(S.annotations[i], x, y)) { hit = i; break; }
    }
    S.selectedIdx = hit;
    if (hit >= 0) {
      S.isDraggingAnnotation = true;
      S.dragLastX = x;
      S.dragLastY = y;
      canvas.style.cursor = 'grabbing';
    }
    render();
    return;
  }

  // ── Drawing tools ──
  if (S.tool === 'text') {
    placeTextInput(x, y, e.clientX, e.clientY);
    return;
  }
  S.isDrawing = true;
  S.startX = x;
  S.startY = y;
}

function onMouseMove(e) {
  const { x, y } = toImg(e);

  // Moving a selected annotation
  if (S.isDraggingAnnotation && S.selectedIdx >= 0) {
    const dx = x - S.dragLastX;
    const dy = y - S.dragLastY;
    moveAnnotation(S.annotations[S.selectedIdx], dx, dy);
    S.dragLastX = x;
    S.dragLastY = y;
    render();
    return;
  }

  if (!S.isDrawing) {
    // Update cursor when hovering in select mode
    if (S.tool === 'select') {
      const hovering = S.annotations.some(a => hitTest(a, x, y));
      canvas.style.cursor = hovering ? 'grab' : 'default';
    }
    return;
  }

  if (S.tool === 'crop') {
    S.cropPreview = normalizeRect(S.startX, S.startY, x, y);
  } else {
    S.preview = buildAnnotation(S.tool, S.startX, S.startY, x, y);
  }
  render();
}

function onMouseUp(e) {
  // Stop annotation drag
  if (S.isDraggingAnnotation) {
    S.isDraggingAnnotation = false;
    canvas.style.cursor = 'grab';
    render();
    return;
  }

  if (!S.isDrawing) return;
  S.isDrawing = false;

  const { x, y } = toImg(e);
  const dx = Math.abs(x - S.startX);
  const dy = Math.abs(y - S.startY);

  if (S.tool === 'crop') {
    if (dx > 4 || dy > 4) S.cropRegion = normalizeRect(S.startX, S.startY, x, y);
    S.cropPreview = null;
  } else if (S.preview) {
    if (dx > 2 || dy > 2 || S.tool === 'arrow') {
      S.annotations.push(S.preview);
      S.selectedIdx = S.annotations.length - 1; // auto-select what was just drawn
    }
    S.preview = null;
  }
  render();
}

// ─────────────────────────────────────────────
//  Build annotation object from drag
// ─────────────────────────────────────────────
function buildAnnotation(tool, x1, y1, x2, y2) {
  const base = { type: tool, color: S.color, width: S.strokeWidth };
  if (tool === 'arrow') return { ...base, x1, y1, x2, y2 };
  if (tool === 'rect')  return { ...base, ...normalizeRect(x1, y1, x2, y2) };
  if (tool === 'circle') {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    return { ...base, cx, cy, rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 };
  }
  return null;
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

// ─────────────────────────────────────────────
//  Hit testing
// ─────────────────────────────────────────────
function hitTest(ann, px, py) {
  const pad = Math.max(12, (ann.width || 6) * 2);
  if (ann.type === 'arrow') {
    // Distance from point to line segment
    const dx = ann.x2 - ann.x1, dy = ann.y2 - ann.y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ann.x1) * dx + (py - ann.y1) * dy) / len2)) : 0;
    const cx = ann.x1 + t * dx, cy = ann.y1 + t * dy;
    return Math.hypot(px - cx, py - cy) <= pad;
  }
  if (ann.type === 'rect') {
    const inOuter = px >= ann.x - pad && px <= ann.x + ann.w + pad && py >= ann.y - pad && py <= ann.y + ann.h + pad;
    const inInner = px > ann.x + pad && px < ann.x + ann.w - pad && py > ann.y + pad && py < ann.y + ann.h - pad;
    return inOuter && !inInner;
  }
  if (ann.type === 'circle') {
    const ddx = (px - ann.cx) / Math.max(1, ann.rx), ddy = (py - ann.cy) / Math.max(1, ann.ry);
    const margin = pad / Math.min(ann.rx, ann.ry);
    return Math.abs(Math.hypot(ddx, ddy) - 1) < margin;
  }
  if (ann.type === 'text') {
    const w = ann.text.length * ann.fontSize * 0.55;
    return px >= ann.x - 4 && px <= ann.x + w && py >= ann.y - ann.fontSize && py <= ann.y + 4;
  }
  return false;
}

// ─────────────────────────────────────────────
//  Move annotation by delta
// ─────────────────────────────────────────────
function moveAnnotation(ann, dx, dy) {
  if (ann.type === 'arrow')  { ann.x1 += dx; ann.y1 += dy; ann.x2 += dx; ann.y2 += dy; }
  if (ann.type === 'rect')   { ann.x  += dx; ann.y  += dy; }
  if (ann.type === 'circle') { ann.cx += dx; ann.cy += dy; }
  if (ann.type === 'text')   { ann.x  += dx; ann.y  += dy; }
}

// ─────────────────────────────────────────────
//  Undo
// ─────────────────────────────────────────────
function undo() {
  if (S.annotations.length > 0) {
    S.annotations.pop();
  } else if (S.cropRegion) {
    S.cropRegion = null;
  }
  render();
}

// ─────────────────────────────────────────────
//  Text tool
// ─────────────────────────────────────────────
function placeTextInput(imgX, imgY, clientX, clientY) {
  S.textPending = { x: imgX, y: imgY };

  const r       = canvas.getBoundingClientRect();
  const cssScale = r.width / canvas.width;
  const fontSize = Math.max(12, 20 * cssScale);

  textInput.style.color    = S.color;
  textInput.style.fontSize = `${fontSize}px`;
  textInput.value          = '';

  // Position: fixed relative to viewport
  textWrap.style.left    = `${clientX}px`;
  textWrap.style.top     = `${clientY - fontSize * 0.85}px`;
  textWrap.style.display = 'block';
  textInput.focus();
}

function commitText() {
  if (!S.textPending) return;
  const val = textInput.value.trim();
  if (val) {
    // Font size stored in image pixels (24px baseline)
    S.annotations.push({
      type: 'text',
      x: S.textPending.x,
      y: S.textPending.y,
      text: val,
      color: S.color,
      fontSize: 24,
    });
    render();
  }
  cancelText();
}

function cancelText() {
  S.textPending     = null;
  textWrap.style.display = 'none';
  textInput.value   = '';
}

// ─────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background image
  ctx.drawImage(S.image, 0, 0);

  // Finished annotations
  for (let i = 0; i < S.annotations.length; i++) {
    drawAnnotation(ctx, S.annotations[i]);
    if (i === S.selectedIdx) drawSelectionHandles(ctx, S.annotations[i]);
  }

  // In-progress shape preview
  if (S.preview) drawAnnotation(ctx, S.preview);

  // Crop selection (committed or in-progress)
  const cropToDraw = S.cropPreview || (S.tool === 'crop' ? S.cropRegion : null) || S.cropRegion;
  if (cropToDraw) drawCropBox(cropToDraw);
}

// ─────────────────────────────────────────────
//  Draw helpers
// ─────────────────────────────────────────────
function drawAnnotation(c, ann) {
  c.save();
  if (ann.type === 'arrow')  drawArrow(c, ann);
  if (ann.type === 'rect')   drawRect(c, ann);
  if (ann.type === 'circle') drawCircle(c, ann);
  if (ann.type === 'text')   drawText(c, ann);
  c.restore();
}

function drawArrow(c, { x1, y1, x2, y2, color, width }) {
  const headLen = Math.max(16, width * 4);
  const angle   = Math.atan2(y2 - y1, x2 - x1);
  // Move line end back slightly so it doesn't poke past arrowhead
  const lx2 = x2 - headLen * 0.65 * Math.cos(angle);
  const ly2 = y2 - headLen * 0.65 * Math.sin(angle);

  c.strokeStyle = color;
  c.fillStyle   = color;
  c.lineWidth   = width;
  c.lineCap     = 'round';

  // Shaft
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(lx2, ly2);
  c.stroke();

  // Arrowhead (filled triangle)
  c.beginPath();
  c.moveTo(x2, y2);
  c.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6),
           y2 - headLen * Math.sin(angle - Math.PI / 6));
  c.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6),
           y2 - headLen * Math.sin(angle + Math.PI / 6));
  c.closePath();
  c.fill();
}

function drawRect(c, { x, y, w, h, color, width }) {
  c.strokeStyle = color;
  c.lineWidth   = width;
  c.lineJoin    = 'round';
  c.strokeRect(x, y, w, h);
}

function drawCircle(c, { cx, cy, rx, ry, color, width }) {
  c.strokeStyle = color;
  c.lineWidth   = width;
  c.beginPath();
  c.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  c.stroke();
}

function drawText(c, { x, y, text, color, fontSize }) {
  c.font         = `bold ${fontSize}px Arial, sans-serif`;
  c.lineWidth    = Math.max(3, fontSize / 6);
  c.lineJoin     = 'round';
  // Contrast outline
  c.strokeStyle  = (color === '#000000' || color === '#000') ? '#fff' : '#111';
  c.strokeText(text, x, y);
  c.fillStyle    = color;
  c.fillText(text, x, y);
}

function drawCropBox(r) {
  // Compute line width in image pixels that equals ~1.5 CSS pixels on screen
  const cssScale = canvas.getBoundingClientRect().width / canvas.width;
  const lw = 1.5 / cssScale;

  ctx.save();
  // Dimmed overlay outside selection
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Punch out (clear) the selected region so original shows through
  ctx.clearRect(r.x, r.y, r.w, r.h);
  // Redraw image in selected region on top of cleared area
  ctx.drawImage(S.image, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  // Re-draw any annotations inside the region
  for (const ann of S.annotations) drawAnnotation(ctx, ann);
  // Dashed border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = lw;
  ctx.setLineDash([6 / cssScale, 3 / cssScale]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([]);
  // Corner handles
  const hs = 6 / cssScale;
  ctx.fillStyle = '#ffffff';
  [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].forEach(([cx, cy]) => {
    ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
  });
  ctx.restore();
}

// ─────────────────────────────────────────────
//  Selection handles
// ─────────────────────────────────────────────
function drawSelectionHandles(c, ann) {
  const cssScale = canvas.getBoundingClientRect().width / canvas.width;
  const lw  = 1.5 / cssScale;
  const hs  = 5  / cssScale;   // handle half-size
  const pad = 8  / cssScale;

  c.save();
  c.strokeStyle = '#1a73e8';
  c.fillStyle   = '#1a73e8';
  c.lineWidth   = lw;
  c.setLineDash([5 / cssScale, 3 / cssScale]);

  if (ann.type === 'arrow') {
    // Draw dots at both endpoints
    c.setLineDash([]);
    [[ann.x1, ann.y1], [ann.x2, ann.y2]].forEach(([hx, hy]) => {
      c.beginPath();
      c.arc(hx, hy, hs * 1.6, 0, Math.PI * 2);
      c.fill();
    });
  } else if (ann.type === 'rect') {
    c.strokeRect(ann.x - pad, ann.y - pad, ann.w + pad * 2, ann.h + pad * 2);
    [[ann.x - pad, ann.y - pad], [ann.x + ann.w + pad, ann.y - pad],
     [ann.x - pad, ann.y + ann.h + pad], [ann.x + ann.w + pad, ann.y + ann.h + pad]].forEach(([hx, hy]) => {
      c.setLineDash([]);
      c.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
      c.setLineDash([5 / cssScale, 3 / cssScale]);
    });
  } else if (ann.type === 'circle') {
    c.beginPath();
    c.ellipse(ann.cx, ann.cy, ann.rx + pad, ann.ry + pad, 0, 0, Math.PI * 2);
    c.stroke();
  } else if (ann.type === 'text') {
    const w = ann.text.length * ann.fontSize * 0.55;
    c.strokeRect(ann.x - pad, ann.y - ann.fontSize - pad, w + pad * 2, ann.fontSize + pad * 2);
  }
  c.restore();
}

// ─────────────────────────────────────────────
//  Hint text
// ─────────────────────────────────────────────
const HINTS = {
  crop:   'Drag to select a region to save. Leave empty to save the full page. Press ⌘↵ to share.',
  select: 'Click an annotation to select it. Drag to move it. Press Delete to remove it.',
  arrow:  'Drag to draw an arrow. Press ⌘↵ to share when done.',
  rect:   'Drag to draw a rectangle. Press ⌘↵ to share when done.',
  circle: 'Drag to draw a circle or oval. Press ⌘↵ to share when done.',
  text:   'Click anywhere to place text. Press Enter to confirm, then ⌘↵ to share.',
};
function updateHint() {
  hintText.textContent = HINTS[S.tool] || '';
}

// ─────────────────────────────────────────────
//  Export (flatten to blob)
// ─────────────────────────────────────────────
async function exportBlob() {
  const { image, annotations, cropRegion } = S;
  let ox = 0, oy = 0;
  let ow = image.naturalWidth;
  let oh = image.naturalHeight;

  if (cropRegion && cropRegion.w > 4 && cropRegion.h > 4) {
    ox = Math.round(cropRegion.x);
    oy = Math.round(cropRegion.y);
    ow = Math.round(cropRegion.w);
    oh = Math.round(cropRegion.h);
  }

  const off = new OffscreenCanvas(ow, oh);
  const c   = off.getContext('2d');

  // Crop of the original image
  c.drawImage(image, ox, oy, ow, oh, 0, 0, ow, oh);

  // Re-draw annotations shifted by crop origin
  for (const ann of annotations) {
    drawAnnotation(c, shiftAnnotation(ann, -ox, -oy));
  }

  return off.convertToBlob({ type: 'image/png' });
}

function shiftAnnotation(ann, dx, dy) {
  const a = { ...ann };
  if (a.type === 'arrow')  { a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; }
  if (a.type === 'rect')   { a.x  += dx; a.y  += dy; }
  if (a.type === 'circle') { a.cx += dx; a.cy += dy; }
  if (a.type === 'text')   { a.x  += dx; a.y  += dy; }
  return a;
}

// ─────────────────────────────────────────────
//  Google Drive upload
// ─────────────────────────────────────────────
async function doShare() {
  commitText();
  const btn = document.getElementById('share-btn');
  btn.disabled = true;

  try {
    showStatus('Preparing screenshot…');
    const blob = await exportBlob();

    showStatus('Connecting to Google Drive…');
    const token = await getAuthToken();

    showStatus('Finding folder…');
    const folderId = await getOrCreateFolder(token);

    showStatus('Uploading…');
    const fileId = await uploadFile(token, blob, folderId);

    showStatus('Setting permissions…');
    await setPublicPermission(token, fileId);

    hideStatus();
    const url = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
    showUrlModal(url);
  } catch (err) {
    hideStatus();
    showError(err.message || 'Upload failed. Check the options page to verify your Google Drive connection.');
  } finally {
    btn.disabled = false;
  }
}

// ── Auth ──
function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message || '';
        if (msg.includes('client_id')) {
          reject(new Error('OAuth not configured — open Screenshot Options to connect your Google Drive.'));
        } else {
          reject(new Error(`Auth failed: ${msg}`));
        }
      } else {
        resolve(token);
      }
    });
  });
}

// ── Get or create "SnapShare" folder ──
async function getOrCreateFolder(token) {
  const stored = await chrome.storage.sync.get('driveFolderId');
  if (stored.driveFolderId) {
    // Verify it still exists and isn't trashed
    try {
      const r = await driveGet(token, `files/${stored.driveFolderId}?fields=id,trashed`);
      if (r.ok) {
        const d = await r.json();
        if (!d.trashed) return stored.driveFolderId;
      }
    } catch { /* folder gone — fall through to create */ }
  }

  // Create folder
  const r = await drivePost(token, 'files', {
    name: 'Screenshot',
    mimeType: 'application/vnd.google-apps.folder',
  });
  if (!r.ok) throw new Error(`Could not create Drive folder (${r.status})`);
  const folder = await r.json();
  await chrome.storage.sync.set({ driveFolderId: folder.id });
  return folder.id;
}

// ── Upload file (multipart) ──
async function uploadFile(token, blob, folderId) {
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `screenshot-${ts}.png`;
  const meta = JSON.stringify({ name, parents: [folderId] });

  const form = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', blob, name);

  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  );
  if (!r.ok) throw new Error(`Upload failed (${r.status})`);
  const d = await r.json();
  return d.id;
}

// ── Set anyone-with-link reader permission ──
async function setPublicPermission(token, fileId) {
  const r = await drivePost(
    token,
    `files/${fileId}/permissions`,
    { role: 'reader', type: 'anyone' }
  );
  if (!r.ok) throw new Error(`Could not set sharing permission (${r.status})`);
}

// ── Drive helpers ──
function driveGet(token, path) {
  return fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function drivePost(token, path, body) {
  return fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────
function showStatus(msg) {
  statusMsg.textContent = msg;
  statusBg.classList.add('visible');
}
function hideStatus() {
  statusBg.classList.remove('visible');
}

function showUrlModal(url) {
  urlText.textContent = url;
  copyCopied.style.display = 'none';
  urlModal.classList.add('visible');
  // Auto-copy
  navigator.clipboard.writeText(url).catch(() => {});
}

function showError(msg) {
  errorBar.innerHTML = `⚠️ ${msg} <span id="err-close" style="float:right;cursor:pointer;margin-left:12px;font-weight:bold;">✕</span>`;
  errorBar.style.display = 'block';
  document.getElementById('err-close').onclick = () => { errorBar.style.display = 'none'; };
  console.error('[Screenshot]', msg);
}
