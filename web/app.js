(() => {
  const promptEl = document.getElementById("prompt");
  const stepsEl = document.getElementById("steps");
  const stepsHintEl = document.getElementById("steps-hint");
  const sizeHintEl = document.getElementById("size-hint");
  const seedEl = document.getElementById("seed");
  const generateBtn = document.getElementById("generate");
  const randomBtn = document.getElementById("random-seed");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const resultEl = document.getElementById("result");
  const imageEl = document.getElementById("result-image");
  const metaEl = document.getElementById("meta");
  const actionsEl = document.getElementById("actions");
  const openLink = document.getElementById("open-image");
  const downloadLink = document.getElementById("download-image");

  let selectedType = "illustration";
  let selectedPreset = "balanced";
  let selectedModel = "lcm";
  let selectedSize = "256x256";
  let stepsMin = 1;
  let stepsMax = 500;
  let appliedDefaultSteps = 4;
  let appliedDefaultSize = "256x256";
  const stepsByPreset = { instant: 2, balanced: 4, quality: 2 };
  const sizeByPreset = {
    instant: "128x128",
    balanced: "256x256",
    quality: "384x384",
  };

  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function setBusy(busy) {
    generateBtn.disabled = busy;
    randomBtn.disabled = busy;
    promptEl.disabled = busy;
    stepsEl.disabled = busy;
    seedEl.disabled = busy;
    document.querySelectorAll(".option").forEach((btn) => {
      btn.disabled = busy;
    });
    generateBtn.textContent = busy ? "Generating…" : "Generate";
  }

  function defaultSteps() {
    const steps = stepsByPreset[selectedPreset];
    return Number.isInteger(steps) ? steps : appliedDefaultSteps;
  }

  function defaultSize() {
    return sizeByPreset[selectedPreset] || appliedDefaultSize;
  }

  function formatSizeLabel(sizeId) {
    return sizeId.replace("x", "×");
  }

  function parseSize(sizeId) {
    const match = /^(\d+)x(\d+)$/.exec(sizeId || "");
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  function syncStepsToPreset() {
    const next = defaultSteps();
    const current = stepsEl.value.trim();
    if (current === "" || Number(current) === appliedDefaultSteps) {
      stepsEl.value = String(next);
    }
    appliedDefaultSteps = next;
    stepsHintEl.textContent = `Preset default: ${next}`;
  }

  function syncSizeToPreset() {
    const next = defaultSize();
    if (selectedSize === appliedDefaultSize) {
      selectedSize = next;
      selectGroup("#size-options", "size", selectedSize);
    }
    appliedDefaultSize = next;
    sizeHintEl.textContent = `Preset default: ${formatSizeLabel(next)}`;
  }

  function selectGroup(containerSelector, attr, value) {
    document.querySelectorAll(`${containerSelector} .option`).forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset[attr] === value);
    });
  }

  document.getElementById("type-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-type]");
    if (!btn || btn.disabled) return;
    selectedType = btn.dataset.type;
    selectGroup("#type-options", "type", selectedType);
  });

  document.getElementById("preset-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-preset]");
    if (!btn || btn.disabled) return;
    selectedPreset = btn.dataset.preset;
    selectGroup("#preset-options", "preset", selectedPreset);
    syncSizeToPreset();
    syncStepsToPreset();
  });

  document.getElementById("size-options").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-size]");
    if (!btn || btn.disabled) return;
    selectedSize = btn.dataset.size;
    selectGroup("#size-options", "size", selectedSize);
  });

  randomBtn.addEventListener("click", () => {
    seedEl.value = String(Math.floor(Math.random() * 2147483647));
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
      syncSizeToPreset();
      syncStepsToPreset();
    } catch (err) {
      statusEl.textContent = "Unable to reach server";
    }
  }

  generateBtn.addEventListener("click", async () => {
    showError("");
    const prompt = promptEl.value.trim();
    if (!prompt) {
      showError("Please enter a prompt.");
      return;
    }

    let seedValue = seedEl.value.trim();
    if (!seedValue) {
      seedValue = String(Math.floor(Math.random() * 2147483647));
      seedEl.value = seedValue;
    }

    const seed = Number(seedValue);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
      showError("Seed must be an integer between 0 and 2147483647.");
      return;
    }

    let stepsValue = stepsEl.value.trim();
    if (!stepsValue) {
      stepsValue = String(defaultSteps());
      stepsEl.value = stepsValue;
    }
    const steps = Number(stepsValue);
    if (!Number.isInteger(steps) || steps < stepsMin || steps > stepsMax) {
      showError(`Steps must be an integer between ${stepsMin} and ${stepsMax}.`);
      return;
    }

    const size = parseSize(selectedSize);
    if (!size) {
      showError("Please choose a valid size.");
      return;
    }

    setBusy(true);
    try {
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
          seed,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      seedEl.value = String(data.seed);
      resultEl.hidden = false;
      imageEl.hidden = false;
      imageEl.src = `${data.image}?t=${Date.now()}`;
      metaEl.hidden = false;
      metaEl.textContent =
        `${data.model || selectedModel}\n` +
        `${data.width} × ${data.height}\n` +
        `${data.steps} steps\n` +
        `${data.elapsed} s\n` +
        `Seed ${data.seed}`;
      actionsEl.hidden = false;
      openLink.href = data.image;
      downloadLink.href = data.image;
      downloadLink.download = data.image.split("/").pop() || "generated.png";
      statusEl.textContent = `Ready · ${data.model || selectedModel} · last ${data.elapsed}s`;
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  });

  refreshStatus();
})();
