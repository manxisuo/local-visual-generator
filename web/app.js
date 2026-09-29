(() => {
  const promptEl = document.getElementById("prompt");
  const stepsEl = document.getElementById("steps");
  const stepsHintEl = document.getElementById("steps-hint");
  const sizeHintEl = document.getElementById("size-hint");
  const styleHintEl = document.getElementById("style-hint");
  const seedEl = document.getElementById("seed");
  const generateBtn = document.getElementById("generate");
  const cancelBtn = document.getElementById("cancel-generate");
  const randomBtn = document.getElementById("random-seed");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const reuseNoticeEl = document.getElementById("reuse-notice");
  const resultEl = document.getElementById("result");
  const resultProgressEl = document.getElementById("result-progress");
  const resultGridEl = document.getElementById("result-grid");
  const metaEl = document.getElementById("meta");
  const actionsEl = document.getElementById("actions");
  const openLink = document.getElementById("open-image");
  const downloadLink = document.getElementById("download-image");
  const advancedEl = document.querySelector(".advanced");
  const modeFieldset = document.getElementById("preset-options").closest("fieldset");
  const controlsEl = document.querySelector(".controls");
  const generateView = document.getElementById("generate-view");
  const galleryView = document.getElementById("gallery-view");
  const galleryStatusEl = document.getElementById("gallery-status");
  const galleryGridEl = document.getElementById("gallery-grid");
  const galleryMoreBtn = document.getElementById("gallery-more");
  const detailDialog = document.getElementById("gallery-detail");
  const detailImage = document.getElementById("detail-image");
  const detailFields = document.getElementById("detail-fields");
  const detailReuseBtn = document.getElementById("detail-reuse");
  const detailDeleteBtn = document.getElementById("detail-delete");
  const detailOpen = document.getElementById("detail-open");
  const detailCopyInput = document.getElementById("detail-copy-input");
  const detailCopyFinal = document.getElementById("detail-copy-final");
  const detailClose = document.getElementById("detail-close");
  const detailReuseNote = document.getElementById("detail-reuse-note");

  let selectedType = "illustration";
  let selectedPreset = "balanced";
  let selectedModel = "lcm";
  let selectedSize = "256x256";
  let selectedCount = 1;
  let stepsMin = 1;
  let stepsMax = 50;
  const stepsByPreset = { instant: 2, balanced: 4, quality: 2, render: 4 };
  const sizeByPreset = {
    instant: "128x128",
    balanced: "256x256",
    quality: "384x384",
    render: "1024x1024",
  };
  const knownTypes = new Set([
    "illustration",
    "anime",
    "icon",
    "logo",
    "landscape",
    "free",
  ]);
  const knownPresets = new Set(["instant", "balanced", "quality", "render"]);
  const knownCounts = new Set([1, 2, 4, 8]);
  const knownSizes = new Set([
    "128x128",
    "192x192",
    "256x256",
    "384x384",
    "512x512",
    "768x768",
    "1024x1024",
    "384x256",
    "256x384",
    "512x384",
    "384x512",
    "1024x768",
    "768x1024",
  ]);
  const SEED_MAX = 2147483647;

  const PAGE_SIZE = 24;
  let galleryOffset = 0;
  let galleryHasMore = false;
  let galleryLoaded = false;
  let galleryItems = [];
  let activeDetailItem = null;
  let reuseNoticeTimer = null;
  let cancelRequested = false;
  let selectedResult = null;

  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function showReuseNotice(message) {
    reuseNoticeEl.hidden = !message;
    reuseNoticeEl.textContent = message || "";
    controlsEl.classList.toggle("is-reused", Boolean(message));
    if (reuseNoticeTimer) clearTimeout(reuseNoticeTimer);
    if (message) {
      reuseNoticeTimer = setTimeout(() => {
        reuseNoticeEl.hidden = true;
        controlsEl.classList.remove("is-reused");
      }, 4000);
    }
  }

  function isAdvancedOpen() {
    return Boolean(advancedEl.open);
  }

  function defaultSteps() {
    const steps = stepsByPreset[selectedPreset];
    return Number.isInteger(steps) ? steps : 4;
  }

  function defaultSize() {
    return sizeByPreset[selectedPreset] || "256x256";
  }

  function formatSizeLabel(sizeId) {
    return sizeId.replace("x", "×");
  }

  function parseSize(sizeId) {
    const match = /^(\d+)x(\d+)$/.exec(sizeId || "");
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  function selectGroup(containerSelector, attr, value) {
    document.querySelectorAll(`${containerSelector} .option`).forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset[attr] === value);
    });
  }

  function applyModeDefaults() {
    const nextSize = defaultSize();
    const nextSteps = defaultSteps();
    selectedSize = nextSize;
    selectGroup("#size-options", "size", selectedSize);
    stepsEl.value = String(nextSteps);
    sizeHintEl.textContent = `Mode default: ${formatSizeLabel(nextSize)}`;
    stepsHintEl.textContent = `Mode default: ${nextSteps}`;
  }

  function setModeEnabled(enabled) {
    modeFieldset.classList.toggle("is-disabled", !enabled);
    document.querySelectorAll("#preset-options .option").forEach((btn) => {
      btn.disabled = !enabled;
    });
  }

  function setBusy(busy) {
    generateBtn.disabled = busy;
    randomBtn.disabled = busy;
    promptEl.disabled = busy;
    stepsEl.disabled = busy;
    seedEl.disabled = busy;
    cancelBtn.hidden = !busy;
    cancelBtn.disabled = !busy;
    advancedEl.querySelector("summary").style.pointerEvents = busy ? "none" : "";
    document
      .querySelectorAll("#type-options .option, #size-options .option, #count-options .option")
      .forEach((btn) => {
        btn.disabled = busy;
      });
    document.querySelectorAll("#preset-options .option").forEach((btn) => {
      btn.disabled = busy || isAdvancedOpen();
    });
    if (busy) {
      generateBtn.textContent =
        selectedCount > 1 ? `Generating… 0/${selectedCount}` : "Generating…";
    } else {
      generateBtn.textContent = "Generate";
    }
  }

  function makeBatchId() {
    return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function allocateSeeds(baseSeed, count) {
    const seeds = [];
    for (let i = 0; i < count; i += 1) {
      seeds.push((baseSeed + i) % (SEED_MAX + 1));
    }
    return seeds;
  }

  function clearResultPanel() {
    resultGridEl.replaceChildren();
    selectedResult = null;
    resultProgressEl.hidden = true;
    resultProgressEl.textContent = "";
    metaEl.hidden = true;
    metaEl.textContent = "";
    actionsEl.hidden = true;
  }

  function showSelectedResult(item) {
    selectedResult = item;
    resultGridEl.querySelectorAll(".result-thumb").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.image === item.image);
    });
    seedEl.value = String(item.seed);
    metaEl.hidden = false;
    const batchLine =
      item.batch_count > 1
        ? `\nBatch ${item.batch_index}/${item.batch_count}`
        : "";
    metaEl.textContent =
      `${item.model || selectedModel}\n` +
      `${item.width} × ${item.height}\n` +
      `${item.steps} steps\n` +
      `${item.elapsed} s\n` +
      `Seed ${item.seed}` +
      batchLine;
    actionsEl.hidden = false;
    openLink.href = item.image;
    downloadLink.href = item.image;
    downloadLink.download = item.image.split("/").pop() || "generated.png";
  }

  function appendResultThumb(item) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "result-thumb";
    btn.dataset.image = item.image;

    const img = document.createElement("img");
    img.src = `${item.image}?t=${Date.now()}`;
    img.alt = `Generated ${item.batch_index}/${item.batch_count}`;

    const label = document.createElement("span");
    label.className = "result-thumb-label";
    label.textContent =
      item.batch_count > 1
        ? `${item.batch_index}/${item.batch_count} · seed ${item.seed}`
        : `seed ${item.seed}`;

    btn.appendChild(img);
    btn.appendChild(label);
    btn.addEventListener("click", () => showSelectedResult(item));
    resultGridEl.appendChild(btn);
    showSelectedResult(item);
  }

  function updateBatchProgress(done, total, { cancelled = false } = {}) {
    resultProgressEl.hidden = false;
    if (cancelled) {
      resultProgressEl.textContent = `Cancelled after ${done}/${total}. Completed images were kept.`;
    } else if (done < total) {
      const label =
        total > 1 ? `Generating ${done + 1}/${total}…` : "Generating…";
      resultProgressEl.hidden = total <= 1;
      resultProgressEl.textContent = label;
      generateBtn.textContent = label;
    } else {
      resultProgressEl.textContent =
        total > 1 ? `Done ${done}/${total}` : "";
      if (total <= 1) resultProgressEl.hidden = true;
    }
  }

  function syncStyleHint() {
    styleHintEl.hidden = selectedType !== "logo";
  }

  function setView(view) {
    const isGallery = view === "gallery";
    generateView.hidden = isGallery;
    galleryView.hidden = !isGallery;
    document.querySelectorAll(".view-tab").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.view === view);
    });
    if (isGallery) {
      loadGallery({ reset: !galleryLoaded });
    }
  }

  function formatTime(iso) {
    if (!iso) return "Unknown";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString();
  }

  function displayValue(value) {
    if (value === null || value === undefined || value === "") return "Unknown";
    return String(value);
  }

  function appendField(dl, label, value, { multiline = false } = {}) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (multiline) dd.classList.add("multiline");
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  document.querySelector(".view-nav").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-view]");
    if (!btn) return;
    setView(btn.dataset.view);
  });

  document.getElementById("type-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-type]");
    if (!btn || btn.disabled) return;
    selectedType = btn.dataset.type;
    selectGroup("#type-options", "type", selectedType);
    syncStyleHint();
  });

  document.getElementById("preset-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-preset]");
    if (!btn || btn.disabled) return;
    selectedPreset = btn.dataset.preset;
    selectGroup("#preset-options", "preset", selectedPreset);
    applyModeDefaults();
  });

  document.getElementById("size-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-size]");
    if (!btn || btn.disabled) return;
    selectedSize = btn.dataset.size;
    selectGroup("#size-options", "size", selectedSize);
  });

  document.getElementById("count-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-count]");
    if (!btn || btn.disabled) return;
    const next = Number(btn.dataset.count);
    if (!knownCounts.has(next)) return;
    selectedCount = next;
    selectGroup("#count-options", "count", String(selectedCount));
  });

  cancelBtn.addEventListener("click", () => {
    cancelRequested = true;
    cancelBtn.disabled = true;
    cancelBtn.textContent = "Cancelling…";
  });

  advancedEl.addEventListener("toggle", () => {
    if (isAdvancedOpen()) {
      setModeEnabled(false);
    } else {
      applyModeDefaults();
      setModeEnabled(true);
    }
  });

  randomBtn.addEventListener("click", () => {
    seedEl.value = String(Math.floor(Math.random() * (SEED_MAX + 1)));
  });

  async function refreshStatus() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data.ready) {
        statusEl.textContent = `Ready · ${data.model} · ${data.device}`;
      } else {
        statusEl.textContent = "Model not ready";
      }

      if (Number.isInteger(data.steps_min) && Number.isInteger(data.steps_max)) {
        stepsMin = data.steps_min;
        stepsMax = data.steps_max;
        stepsEl.min = String(stepsMin);
        stepsEl.max = String(stepsMax);
      }

      if (data.preset_sizes && typeof data.preset_sizes === "object") {
        Object.entries(data.preset_sizes).forEach(([name, size]) => {
          if (size && Number.isInteger(size.width) && Number.isInteger(size.height)) {
            sizeByPreset[name] = `${size.width}x${size.height}`;
          }
        });
      }

      if (Array.isArray(data.models)) {
        data.models.forEach((model) => {
          if (model.id === selectedModel && model.steps && typeof model.steps === "object") {
            Object.assign(stepsByPreset, model.steps);
          }
        });
      }

      if (data.model_id) {
        selectedModel = data.model_id;
      }

      if (!isAdvancedOpen()) {
        applyModeDefaults();
      } else {
        sizeHintEl.textContent = `Mode default: ${formatSizeLabel(defaultSize())}`;
        stepsHintEl.textContent = `Mode default: ${defaultSteps()}`;
      }
    } catch (err) {
      statusEl.textContent = "Unable to reach server";
    }
  }

  function createGalleryCard(item) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";
    card.dataset.id = item.id;

    const img = document.createElement("img");
    img.src = item.image;
    img.alt = item.prompt_summary || item.id;
    img.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "gallery-card-meta";

    const promptLine = document.createElement("strong");
    promptLine.textContent = item.prompt_summary || "(no prompt recorded)";

    const info = document.createElement("div");
    const bits = [formatTime(item.created_at)];
    if (item.type) bits.push(item.type);
    if (item.preset) bits.push(item.preset);
    if (item.seed !== null && item.seed !== undefined) bits.push(`seed ${item.seed}`);
    if (item.steps !== null && item.steps !== undefined) bits.push(`${item.steps} steps`);
    if (
      item.batch_id &&
      Number.isInteger(item.batch_index) &&
      Number.isInteger(item.batch_count) &&
      item.batch_count > 1
    ) {
      bits.push(`${item.batch_index}/${item.batch_count}`);
    }
    info.textContent = bits.join(" · ");

    meta.appendChild(promptLine);
    meta.appendChild(info);
    card.appendChild(img);
    card.appendChild(meta);
    card.addEventListener("click", () => openDetail(item));
    return card;
  }

  function groupGalleryItems(items) {
    const groups = [];
    const batchIndex = new Map();

    items.forEach((item) => {
      const bid = item.batch_id;
      const count = item.batch_count;
      if (bid && Number.isInteger(count) && count > 1) {
        if (batchIndex.has(bid)) {
          groups[batchIndex.get(bid)].items.push(item);
        } else {
          batchIndex.set(bid, groups.length);
          groups.push({ kind: "batch", batch_id: bid, batch_count: count, items: [item] });
        }
        return;
      }
      const last = groups[groups.length - 1];
      if (last && last.kind === "single") {
        last.items.push(item);
      } else {
        groups.push({ kind: "single", items: [item] });
      }
    });

    groups.forEach((group) => {
      if (group.kind !== "batch") return;
      group.items.sort((a, b) => {
        const ai = Number.isInteger(a.batch_index) ? a.batch_index : 0;
        const bi = Number.isInteger(b.batch_index) ? b.batch_index : 0;
        return ai - bi;
      });
    });
    return groups;
  }

  function renderGalleryCards(items) {
    galleryGridEl.replaceChildren();
    const groups = groupGalleryItems(items);
    groups.forEach((group) => {
      if (group.kind === "batch") {
        const wrap = document.createElement("div");
        wrap.className = "gallery-batch";

        const header = document.createElement("p");
        header.className = "gallery-batch-header";
        header.textContent = `Batch · ${group.items.length}/${group.batch_count} images`;

        const grid = document.createElement("div");
        grid.className = "gallery-batch-grid";
        group.items.forEach((item) => grid.appendChild(createGalleryCard(item)));

        wrap.appendChild(header);
        wrap.appendChild(grid);
        galleryGridEl.appendChild(wrap);
        return;
      }

      const singles = document.createElement("div");
      singles.className = "gallery-singles";
      group.items.forEach((item) => singles.appendChild(createGalleryCard(item)));
      galleryGridEl.appendChild(singles);
    });
  }

  async function loadGallery({ reset = false } = {}) {
    if (reset) {
      galleryOffset = 0;
      galleryHasMore = false;
      galleryLoaded = false;
      galleryItems = [];
      galleryGridEl.hidden = true;
      galleryMoreBtn.hidden = true;
      galleryStatusEl.hidden = false;
      galleryStatusEl.classList.remove("is-error");
      galleryStatusEl.textContent = "Loading gallery…";
    } else {
      galleryMoreBtn.disabled = true;
      galleryMoreBtn.textContent = "Loading…";
    }

    try {
      const res = await fetch(`/api/gallery?offset=${galleryOffset}&limit=${PAGE_SIZE}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const items = Array.isArray(data.items) ? data.items : [];
      if (reset) {
        galleryItems = items;
      } else {
        galleryItems = galleryItems.concat(items);
      }
      renderGalleryCards(galleryItems);
      galleryOffset = (data.offset || 0) + items.length;
      galleryHasMore = Boolean(data.has_more);
      galleryLoaded = true;

      if (galleryItems.length === 0) {
        galleryGridEl.hidden = true;
        galleryStatusEl.hidden = false;
        galleryStatusEl.classList.remove("is-error");
        galleryStatusEl.textContent = "No images in outputs/ yet.";
      } else {
        galleryStatusEl.hidden = true;
        galleryGridEl.hidden = false;
      }

      galleryMoreBtn.hidden = !galleryHasMore;
      galleryMoreBtn.disabled = false;
      galleryMoreBtn.textContent = "Load more";
    } catch (err) {
      galleryStatusEl.hidden = false;
      galleryStatusEl.classList.add("is-error");
      galleryStatusEl.textContent = err.message || String(err);
      galleryMoreBtn.hidden = true;
      galleryMoreBtn.disabled = false;
      galleryMoreBtn.textContent = "Load more";
    }
  }

  function openDetail(item) {
    activeDetailItem = item;
    detailImage.src = item.image;
    detailOpen.href = item.image;
    detailFields.replaceChildren();

    appendField(detailFields, "Created", formatTime(item.created_at));
    appendField(detailFields, "Input prompt", displayValue(item.input_prompt), {
      multiline: true,
    });
    appendField(detailFields, "Final prompt", displayValue(item.final_prompt), {
      multiline: true,
    });
    appendField(detailFields, "Style (type)", displayValue(item.type));
    appendField(detailFields, "Mode (preset)", displayValue(item.preset));
    appendField(detailFields, "Seed", displayValue(item.seed));
    appendField(detailFields, "Steps", displayValue(item.steps));
    appendField(
      detailFields,
      "Size",
      item.width && item.height ? `${item.width} × ${item.height}` : "Unknown",
    );
    appendField(detailFields, "Model", displayValue(item.model));
    appendField(detailFields, "Device", displayValue(item.device));
    appendField(
      detailFields,
      "Elapsed",
      item.elapsed_seconds === null || item.elapsed_seconds === undefined
        ? "Unknown"
        : `${item.elapsed_seconds} s`,
    );
    if (
      item.batch_id &&
      Number.isInteger(item.batch_index) &&
      Number.isInteger(item.batch_count) &&
      item.batch_count > 1
    ) {
      appendField(
        detailFields,
        "Batch",
        `${item.batch_index}/${item.batch_count} (${item.batch_id})`,
      );
    }
    appendField(detailFields, "File", item.id);

    const canReuse = Boolean(item.has_metadata && item.input_prompt);
    detailReuseBtn.hidden = !canReuse;
    detailReuseNote.hidden = canReuse;
    detailReuseNote.textContent = canReuse
      ? ""
      : "No reusable metadata for this image (older file without sidecar JSON).";

    detailCopyInput.disabled = !item.input_prompt;
    detailCopyFinal.disabled = !item.final_prompt;

    if (typeof detailDialog.showModal === "function") {
      detailDialog.showModal();
    } else {
      detailDialog.setAttribute("open", "");
    }
  }

  function closeDetail() {
    if (typeof detailDialog.close === "function") {
      detailDialog.close();
    } else {
      detailDialog.removeAttribute("open");
    }
  }

  async function copyText(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // Fallback for older/locked clipboard contexts.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  }

  function reuseParameters(item) {
    if (!item || !item.has_metadata || !item.input_prompt) return;

    const notes = [];
    promptEl.value = item.input_prompt;

    if (item.type && knownTypes.has(item.type)) {
      selectedType = item.type;
      selectGroup("#type-options", "type", selectedType);
      syncStyleHint();
    } else if (item.type) {
      notes.push(`Style "${item.type}" is no longer available; kept current style.`);
    }

    if (item.preset && knownPresets.has(item.preset)) {
      selectedPreset = item.preset;
      selectGroup("#preset-options", "preset", selectedPreset);
    } else if (item.preset) {
      notes.push(`Mode "${item.preset}" is no longer available; kept current mode.`);
    }

    const sizeId =
      Number.isInteger(item.width) && Number.isInteger(item.height)
        ? `${item.width}x${item.height}`
        : null;
    const hasKnownSize = Boolean(sizeId && knownSizes.has(sizeId));
    const hasSteps = Number.isInteger(item.steps);
    const modeDefaultSize = sizeByPreset[selectedPreset] || defaultSize();
    const modeDefaultSteps = stepsByPreset[selectedPreset] || defaultSteps();
    const needsAdvanced =
      (hasKnownSize && sizeId !== modeDefaultSize) ||
      (hasSteps && item.steps !== modeDefaultSteps);

    if (needsAdvanced) {
      advancedEl.open = true;
      setModeEnabled(false);
    } else {
      advancedEl.open = false;
      applyModeDefaults();
      setModeEnabled(true);
    }

    if (hasKnownSize) {
      selectedSize = sizeId;
      selectGroup("#size-options", "size", selectedSize);
    } else if (sizeId) {
      notes.push(`Size ${formatSizeLabel(sizeId)} is not in the whitelist; kept current size.`);
    }

    if (hasSteps) {
      stepsEl.value = String(item.steps);
    }

    if (Number.isInteger(item.seed)) {
      seedEl.value = String(item.seed);
    }

    sizeHintEl.textContent = `Mode default: ${formatSizeLabel(defaultSize())}`;
    stepsHintEl.textContent = `Mode default: ${defaultSteps()}`;

    closeDetail();
    setView("generate");
    promptEl.focus();
    const notice =
      notes.length > 0
        ? `Parameters restored. ${notes.join(" ")}`
        : "Parameters restored — review and generate when ready.";
    showReuseNotice(notice);
  }

  async function deleteGalleryItem(item) {
    if (!item || !item.id) return;
    const confirmed = window.confirm(
      `Delete this image and its metadata?\n\n${item.id}`,
    );
    if (!confirmed) return;

    detailDeleteBtn.disabled = true;
    try {
      const res = await fetch("/api/gallery/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ id: item.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      closeDetail();
      await loadGallery({ reset: true });
    } catch (err) {
      window.alert(err.message || String(err));
    } finally {
      detailDeleteBtn.disabled = false;
    }
  }

  galleryMoreBtn.addEventListener("click", () => {
    loadGallery({ reset: false });
  });

  detailClose.addEventListener("click", closeDetail);
  detailReuseBtn.addEventListener("click", () => reuseParameters(activeDetailItem));
  detailDeleteBtn.addEventListener("click", () => deleteGalleryItem(activeDetailItem));
  detailCopyInput.addEventListener("click", () => {
    if (activeDetailItem) copyText(activeDetailItem.input_prompt);
  });
  detailCopyFinal.addEventListener("click", () => {
    if (activeDetailItem) copyText(activeDetailItem.final_prompt);
  });
  detailDialog.addEventListener("click", (event) => {
    if (event.target === detailDialog) closeDetail();
  });

  generateBtn.addEventListener("click", async () => {
    showError("");
    showReuseNotice("");
    const prompt = promptEl.value.trim();
    if (!prompt) {
      showError("Please enter a prompt.");
      return;
    }

    let seedValue = seedEl.value.trim();
    if (!seedValue) {
      seedValue = String(Math.floor(Math.random() * (SEED_MAX + 1)));
      seedEl.value = seedValue;
    }

    const baseSeed = Number(seedValue);
    if (!Number.isInteger(baseSeed) || baseSeed < 0 || baseSeed > SEED_MAX) {
      showError(`Seed must be an integer between 0 and ${SEED_MAX}.`);
      return;
    }

    let size;
    let steps;
    if (isAdvancedOpen()) {
      let stepsValue = stepsEl.value.trim();
      if (!stepsValue) {
        stepsValue = String(defaultSteps());
        stepsEl.value = stepsValue;
      }
      steps = Number(stepsValue);
      if (!Number.isInteger(steps) || steps < stepsMin || steps > stepsMax) {
        showError(`Steps must be an integer between ${stepsMin} and ${stepsMax}.`);
        return;
      }
      size = parseSize(selectedSize);
      if (!size) {
        showError("Please choose a valid size.");
        return;
      }
    } else {
      applyModeDefaults();
      size = parseSize(defaultSize());
      steps = defaultSteps();
    }

    const count = selectedCount;
    const seeds = allocateSeeds(baseSeed, count);
    const batchId = makeBatchId();

    cancelRequested = false;
    cancelBtn.textContent = "Cancel";
    clearResultPanel();
    resultEl.hidden = false;
    setBusy(true);
    updateBatchProgress(0, count);

    let completed = 0;
    let lastElapsed = null;
    let stoppedEarly = false;

    try {
      for (let i = 0; i < count; i += 1) {
        if (cancelRequested) {
          stoppedEarly = true;
          break;
        }

        updateBatchProgress(completed, count);
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            prompt,
            type: selectedType,
            preset: selectedPreset,
            model: selectedModel,
            width: size.width,
            height: size.height,
            steps,
            seed: seeds[i],
            batch_id: batchId,
            batch_index: i + 1,
            batch_count: count,
          }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        completed += 1;
        lastElapsed = data.elapsed;
        appendResultThumb({
          image: data.image,
          width: data.width,
          height: data.height,
          steps: data.steps,
          seed: data.seed,
          elapsed: data.elapsed,
          model: data.model,
          batch_id: data.batch_id || batchId,
          batch_index: data.batch_index || i + 1,
          batch_count: data.batch_count || count,
        });

        if (cancelRequested && i + 1 < count) {
          stoppedEarly = true;
          break;
        }
      }

      if (stoppedEarly) {
        updateBatchProgress(completed, count, { cancelled: true });
      } else {
        updateBatchProgress(completed, count);
      }

      if (lastElapsed !== null) {
        statusEl.textContent = `Ready · ${selectedModel} · last ${lastElapsed}s`;
      }

      galleryLoaded = false;
      if (!galleryView.hidden) {
        loadGallery({ reset: true });
      }
    } catch (err) {
      showError(err.message || String(err));
      if (completed > 0) {
        updateBatchProgress(completed, count, { cancelled: cancelRequested });
      }
    } finally {
      cancelRequested = false;
      cancelBtn.textContent = "Cancel";
      setBusy(false);
    }
  });

  applyModeDefaults();
  setModeEnabled(true);
  refreshStatus();
})();
