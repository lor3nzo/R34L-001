const el = (id) => document.getElementById(id);

const fileInput = el("file");
const validateBtn = el("validate");
const clearBtn = el("clear");
const downloadBtn = el("downloadErrors");
const delimiterSel = el("delimiter");
const hasHeaderChk = el("hasHeader");

const addCheckBtn = el("addCheck");
const checksWrap = el("checks");
const rawLineNote = el("rawLineNote");

const statusEl = el("status");
const summaryEl = el("summary");
const issuesBody = el("issuesBody");
const previewHead = el("previewHead");
const previewBody = el("previewBody");
const buildEl = el("build");

buildEl.textContent = new Date().toISOString().slice(0, 10);

const FREE_MAX_ROWS = 100;   // data rows only
const FREE_MAX_CHECKS = 10;

let current = {
  name: null,
  text: null,
  delimiter: null,
  errors: [],
  parsed: [],
  expectedCols: null,
  header: null
};

let checks = []; // [{id, colIndex, type, dateFormat, required}]
let rawLines = [];

fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  resetUI();
  if (!f) return;

  current.name = f.name;
  current.text = await f.text();

  validateBtn.disabled = false;
  clearBtn.disabled = false;

  statusEl.textContent = `Loaded ${f.name}. Click Validate.`;
});

clearBtn.addEventListener("click", () => {
  fileInput.value = "";
  current = { name: null, text: null, delimiter: null, errors: [], parsed: [], expectedCols: null, header: null };
  checks = [];
  rawLines = [];
  resetUI();
  statusEl.textContent = "Choose a CSV to begin.";
});

addCheckBtn.addEventListener("click", () => {
  if (!current.header?.length) return;
  if (checks.length >= FREE_MAX_CHECKS) {
    alert(`Free tier limit: up to ${FREE_MAX_CHECKS} checks.`);
    return;
  }
  checks.push({
    id: crypto.randomUUID(),
    colIndex: 0,
    type: "text",
    dateFormat: "ISO",
    required: false
  });
  renderChecksUI();
});

validateBtn.addEventListener("click", () => {
  if (!current.text) return;

  rawLines = current.text.split(/\r?\n/);

  const chosen = delimiterSel.value;
  const delimiter = chosen === "auto" ? detectDelimiter(current.text) : (chosen === "\\t" ? "\t" : chosen);

  current.delimiter = delimiter;
  current.errors = [];
  current.parsed = [];
  current.expectedCols = null;
  current.header = null;

  const { rows, errors } = parseCSV(current.text, delimiter);

  // Structural validation: consistent columns based on first row length
  if (rows.length > 0) {
    const expected = rows[0].length;
    current.expectedCols = expected;

    if (hasHeaderChk.checked) current.header = rows[0];

    const startIdx = hasHeaderChk.checked ? 1 : 0;
    for (let i = startIdx; i < rows.length; i++) {
      const cols = rows[i].length;
      if (cols === expected) continue;

      const extra = cols > expected ? (cols - expected) : 0;
      const missing = cols < expected ? (expected - cols) : 0;

      const msg = extra > 0
        ? `Row has ${extra} extra column(s). Extra fields will be ignored for type checks.`
        : `Row is missing ${missing} column(s). Missing values are treated as empty for type checks.`;

      const lineNum = rows[i]._line ?? (i + 1);
      errors.push({
        line: lineNum,
        row: i + 1,
        col: "",
        header: "",
        type: "column_count_mismatch",
        value: "",
        details: msg,
        raw_line: rawLineFor(lineNum)
      });
    }
  }

  // Keep parsed (strip metadata)
  current.parsed = rows.map(r => r.filter((_, idx) => idx >= 0));
  current.errors = errors;

  // Checks UI: only enabled if header row exists
  if (hasHeaderChk.checked && current.header?.length) {
    addCheckBtn.disabled = false;
    checks = checks.map(c => ({ ...c, colIndex: clamp(c.colIndex, 0, current.header.length - 1) }));
    renderChecksUI();
  } else {
    addCheckBtn.disabled = true;
    checks = [];
    checksWrap.innerHTML = `<div class="muted small">Enable "Header row" to add type checks.</div>`;
  }

  // Run checks regardless of structural issues
  runChecksAndAppendErrors();

  if (rawLineNote) rawLineNote.hidden = false;

  renderResults();
});

downloadBtn.addEventListener("click", () => {
  if (!current.errors?.length) return;
  const out = errorsToCSV(current.errors);
  downloadText(out, "errors.csv", "text/csv");
});

function runChecksAndAppendErrors() {
  if (!checks.length) return;

  const rows = current.parsed;
  const startIdx = hasHeaderChk.checked ? 1 : 0;

  let validatedDataRows = 0;

  for (let i = startIdx; i < rows.length; i++) {
    if (validatedDataRows >= FREE_MAX_ROWS) break;
    validatedDataRows++;

    const row = rows[i];
    const line = i + 1;

    for (const rule of checks) {
      const header = current.header?.[rule.colIndex] ?? `col_${rule.colIndex + 1}`;

      // Only validate up to header columns. Extras are ignored by not referencing them.
      const value = ((row.length > rule.colIndex ? row[rule.colIndex] : "") ?? "").trim();

      if (rule.required && value.length === 0) {
        current.errors.push({
          line,
          row: i + 1,
          col: rule.colIndex + 1,
          header,
          type: "required_missing",
          value: "",
          details: `Required value missing.`,
          raw_line: rawLineFor(line)
        });
        continue;
      }

      if (value.length === 0) continue;

      const { ok, message } = validateType(value, rule);
      if (!ok) {
        current.errors.push({
          line,
          row: i + 1,
          col: rule.colIndex + 1,
          header,
          type: `type_${rule.type}`,
          value,
          details: message,
          raw_line: rawLineFor(line)
        });
      }
    }
  }
}

function renderChecksUI() {
  if (!current.header?.length) return;

  checksWrap.innerHTML = checks.map((c) => {
    const dateFmtDisabled = c.type !== "date" ? "disabled" : "";
    return `
      <div class="check" data-id="${c.id}">
        <select class="col">
          ${current.header.map((h, i) => `<option value="${i}" ${i === c.colIndex ? "selected" : ""}>${escapeHtml(String(h))}</option>`).join("")}
        </select>

        <select class="type">
          ${["text","integer","number","date","email","url"].map(t => `<option value="${t}" ${t===c.type?"selected":""}>${t}</option>`).join("")}
        </select>

        <select class="dateFmt" ${dateFmtDisabled}>
          ${["ISO","MM/DD/YYYY","DD/MM/YYYY"].map(f => `<option value="${f}" ${f===c.dateFormat?"selected":""}>${f}</option>`).join("")}
        </select>

        <label class="inline small">
          <input class="required" type="checkbox" ${c.required ? "checked" : ""} />
          <span>required</span>
        </label>

        <button class="btn ghost remove" type="button">Remove</button>
      </div>
    `;
  }).join("");

  checksWrap.querySelectorAll(".check").forEach((rowEl) => {
    const id = rowEl.getAttribute("data-id");
    const colSel = rowEl.querySelector(".col");
    const typeSel = rowEl.querySelector(".type");
    const fmtSel = rowEl.querySelector(".dateFmt");
    const reqChk = rowEl.querySelector(".required");
    const removeBtn = rowEl.querySelector(".remove");

    colSel.addEventListener("change", () => updateCheck(id, { colIndex: Number(colSel.value) }));
    typeSel.addEventListener("change", () => {
      updateCheck(id, { type: typeSel.value });
      renderChecksUI();
    });
    fmtSel.addEventListener("change", () => updateCheck(id, { dateFormat: fmtSel.value }));
    reqChk.addEventListener("change", () => updateCheck(id, { required: reqChk.checked }));
    removeBtn.addEventListener("click", () => {
      checks = checks.filter(x => x.id !== id);
      renderChecksUI();
    });
  });
}

function updateCheck(id, patch) {
  checks = checks.map(c => c.id === id ? ({ ...c, ...patch }) : c);
}

function resetUI() {
  summaryEl.textContent = "No file loaded.";
  issuesBody.innerHTML = `<tr><td colspan="3" class="muted">No issues yet.</td></tr>`;
  previewHead.innerHTML = "";
  previewBody.innerHTML = "";
  downloadBtn.disabled = true;
  validateBtn.disabled = true;
  clearBtn.disabled = true;

  if (addCheckBtn) addCheckBtn.disabled = true;
  if (checksWrap) checksWrap.innerHTML = `<div class="muted small">Upload a CSV and click Validate to enable checks.</div>`;
  if (rawLineNote) rawLineNote.hidden = true;
}

function renderResults() {
  const rows = current.parsed;
  const errs = current.errors;

  const totalLines = countLines(current.text);
  const totalRows = rows.length;

  const ok = errs.length === 0;

  statusEl.innerHTML = ok
    ? `<span class="good">OK</span> No issues found.`
    : `<span class="bad">Issues found</span> ${errs.length} issue(s).`;

  const startIdx = hasHeaderChk.checked ? 1 : 0;
  const dataRows = Math.max(0, totalRows - startIdx);
  const validatedRows = Math.min(dataRows, FREE_MAX_ROWS);
  const skippedRows = Math.max(0, dataRows - validatedRows);

  summaryEl.textContent =
    `File: ${current.name}\n` +
    `Delimiter: ${printDelim(current.delimiter)}\n` +
    `Total lines: ${totalLines}\n` +
    `Parsed rows: ${totalRows}\n` +
    `Expected columns: ${current.expectedCols ?? "n/a"}\n` +
    `Header row: ${hasHeaderChk.checked ? "yes" : "no"}\n` +
    `Checks: ${checks.length} (free cap ${FREE_MAX_CHECKS})\n` +
    `Validated data rows: ${validatedRows} (free cap ${FREE_MAX_ROWS})\n` +
    (skippedRows ? `Skipped rows: ${skippedRows}\n` : "") +
    `Issues: ${errs.length}`;

  if (errs.length === 0) {
    issuesBody.innerHTML = `<tr><td colspan="3" class="good">No issues.</td></tr>`;
    downloadBtn.disabled = true;
  } else {
    issuesBody.innerHTML = errs
      .slice(0, 1000)
      .map(e => {
        const line = escapeHtml(String(e.line ?? ""));
        const type = escapeHtml(String(e.type ?? ""));
        const detail = escapeHtml(String(e.details ?? ""));
        return `<tr><td>${line}</td><td>${type}</td><td>${detail}</td></tr>`;
      })
      .join("");
    downloadBtn.disabled = false;
  }

  const preview = rows.slice(0, 25);
  const headRow = hasHeaderChk.checked && preview.length > 0 ? preview[0] : null;
  const bodyRows = hasHeaderChk.checked ? preview.slice(1) : preview;

  previewHead.innerHTML = "";
  previewBody.innerHTML = "";

  const cols = current.expectedCols ?? (preview[0]?.length ?? 0);
  const headers = headRow ?? Array.from({ length: cols }, (_, i) => `col_${i + 1}`);

  previewHead.innerHTML = `<tr>${headers.map(h => `<th>${escapeHtml(String(h))}</th>`).join("")}</tr>`;
  previewBody.innerHTML = bodyRows
    .map(r => `<tr>${r.map(c => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`)
    .join("") || `<tr><td colspan="${cols}" class="muted">No data.</td></tr>`;
}

function validateType(value, rule) {
  switch (rule.type) {
    case "text":
      return { ok: true, message: "" };

    case "integer":
      return (/^[+-]?\d+$/.test(value))
        ? { ok: true, message: "" }
        : { ok: false, message: "Expected integer." };

    case "number":
      return (Number.isFinite(Number(value)))
        ? { ok: true, message: "" }
        : { ok: false, message: "Expected number." };

    case "email":
      return (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        ? { ok: true, message: "" }
        : { ok: false, message: "Expected email-like value." };

    case "url":
      try { new URL(value); return { ok: true, message: "" }; }
      catch { return { ok: false, message: "Expected URL." }; }

    case "date":
      return validateDate(value, rule.dateFormat);

    default:
      return { ok: false, message: "Unknown rule type." };
  }
}

function validateDate(value, fmt) {
  if (fmt === "ISO") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, message: "Expected YYYY-MM-DD." };
    const [y,m,d] = value.split("-").map(Number);
    return isValidDateParts(y,m,d) ? { ok: true, message: "" } : { ok: false, message: "Invalid date." };
  }

  if (fmt === "MM/DD/YYYY") {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return { ok: false, message: "Expected MM/DD/YYYY." };
    const [mm,dd,yy] = value.split("/").map(Number);
    return isValidDateParts(yy,mm,dd) ? { ok: true, message: "" } : { ok: false, message: "Invalid date." };
  }

  if (fmt === "DD/MM/YYYY") {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return { ok: false, message: "Expected DD/MM/YYYY." };
    const [dd,mm,yy] = value.split("/").map(Number);
    return isValidDateParts(yy,mm,dd) ? { ok: true, message: "" } : { ok: false, message: "Invalid date." };
  }

  return { ok: false, message: "Unknown date format." };
}

function isValidDateParts(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find(l => l.trim().length > 0) ?? "";
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;

  for (const d of candidates) {
    const count = countDelimsOutsideQuotes(line, d);
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

function countDelimsOutsideQuotes(line, delim) {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delim) count++;
  }
  return count;
}

function parseCSV(text, delimiter) {
  const errors = [];
  const rows = [];

  let row = [];
  let field = "";
  let inQuotes = false;

  let line = 1;
  let fieldStartLine = 1;

  const pushField = () => { row.push(field); field = ""; fieldStartLine = line; };
  const pushRow = () => { row._line = line; rows.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "\n") line++;

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      field += ch;
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { pushField(); continue; }
    if (ch === "\r") continue;

    if (ch === "\n") { pushField(); pushRow(); continue; }
    field += ch;
  }

  pushField();
  pushRow();

  if (inQuotes) {
    const ln = fieldStartLine;
    errors.push({
      line: ln,
      row: "",
      col: "",
      header: "",
      type: "unclosed_quote",
      value: "",
      details: "A quoted field was not closed with a matching quote.",
      raw_line: rawLineFor(ln)
    });
  }

  if (rows.length >= 2) {
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if (last.length === 1 && last[0] === "" && prev.length > 1) rows.pop();
  }

  if (rows.length === 1 && rows[0].length === 1 && rows[0][0].trim() === "") {
    errors.push({
      line: 1,
      row: 1,
      col: "",
      header: "",
      type: "empty_file",
      value: "",
      details: "CSV appears empty.",
      raw_line: rawLineFor(1)
    });
  }

  return { rows, errors };
}

function errorsToCSV(errors) {
  const header = ["row","line","column","header","rule","value","message","raw_line"];
  const lines = [header.join(",")];

  for (const e of errors) {
    const row = [
      e.row ?? "",
      e.line ?? "",
      e.col ?? "",
      e.header ?? "",
      e.type ?? "",
      e.value ?? "",
      e.details ?? "",
      e.raw_line ?? ""
    ].map(csvEscape).join(",");
    lines.push(row);
  }
  return lines.join("\n");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function printDelim(d) {
  if (d === "\t") return "Tab";
  if (d === ",") return "Comma";
  if (d === ";") return "Semicolon";
  if (d === "|") return "Pipe";
  return String(d);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function rawLineFor(lineNumber) {
  const idx = Math.max(0, Number(lineNumber || 1) - 1);
  return rawLines[idx] ?? "";
}
