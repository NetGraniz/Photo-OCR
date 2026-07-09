const fileInput = document.querySelector("#fileInput");
const pasteZone = document.querySelector("#pasteZone");
const emptyState = document.querySelector("#emptyState");
const previewImage = document.querySelector("#previewImage");
const recognizeButton = document.querySelector("#recognizeButton");
const clipboardButton = document.querySelector("#clipboardButton");
const rotateLeftButton = document.querySelector("#rotateLeftButton");
const rotateRightButton = document.querySelector("#rotateRightButton");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const clearButton = document.querySelector("#clearButton");
const clearResultButton = document.querySelector("#clearResultButton");
const fixLineBreaksButton = document.querySelector("#fixLineBreaksButton");
const fixSpacesButton = document.querySelector("#fixSpacesButton");
const languageSelect = document.querySelector("#languageSelect");
const processingMode = document.querySelector("#processingMode");
const textMode = document.querySelector("#textMode");
const autoRecognize = document.querySelector("#autoRecognize");
const resultText = document.querySelector("#resultText");
const progressBar = document.querySelector("#progressBar");
const progressLabel = document.querySelector("#progressLabel");
const progressValue = document.querySelector("#progressValue");
const appStatus = document.querySelector("#appStatus");
const messageBox = document.querySelector("#messageBox");

const MAX_CANVAS_SIDE = 2400;
const MIN_SCREENSHOT_SIDE = 1400;

let currentFile = null;
let currentObjectUrl = null;
let rotation = 0;
let isRecognizing = false;
let copyResetTimer = null;
let worker = null;
let workerLanguage = null;
let messageTimer = null;
let lastPreparedWarning = "";

const statusText = {
  idle: "Готов к вставке",
  image: "Изображение загружено",
  engine: "Загрузка OCR-движка",
  language: "Загрузка языковой модели",
  prepare: "Подготовка изображения",
  recognize: "Распознавание текста",
  done: "Готово",
  empty: "Текст не найден",
  error: "Ошибка распознавания"
};

const psmByMode = {
  text: "3",
  "single-line": "7",
  table: "6",
  digits: "7"
};

function setProgress(percent, label) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  progressBar.value = safePercent;
  progressValue.textContent = `${safePercent}%`;
  progressLabel.textContent = label;
}

function setStatus(type, customText) {
  appStatus.textContent = customText || statusText[type] || statusText.idle;
  appStatus.dataset.type = type;
}

function showMessage(text, type = "info", timeout = 4500) {
  window.clearTimeout(messageTimer);
  messageBox.textContent = text;
  messageBox.hidden = false;
  messageBox.classList.toggle("is-error", type === "error");

  if (timeout) {
    messageTimer = window.setTimeout(() => {
      messageBox.hidden = true;
    }, timeout);
  }
}

function hideMessage() {
  window.clearTimeout(messageTimer);
  messageBox.hidden = true;
  messageBox.textContent = "";
  messageBox.classList.remove("is-error");
}

function hasResult() {
  return Boolean(resultText.value.trim());
}

function updateActionStates() {
  const hasImage = Boolean(currentFile);
  const hasText = hasResult();

  recognizeButton.disabled = isRecognizing || !hasImage;
  rotateLeftButton.disabled = isRecognizing || !hasImage;
  rotateRightButton.disabled = isRecognizing || !hasImage;
  clearButton.disabled = isRecognizing && hasImage;
  clipboardButton.disabled = isRecognizing;
  fileInput.disabled = isRecognizing;
  languageSelect.disabled = isRecognizing;
  processingMode.disabled = isRecognizing;
  textMode.disabled = isRecognizing;
  autoRecognize.disabled = isRecognizing;
  copyButton.disabled = !hasText;
  downloadButton.disabled = !hasText;
  clearResultButton.disabled = isRecognizing || !hasText;
  fixLineBreaksButton.disabled = isRecognizing || !hasText;
  fixSpacesButton.disabled = isRecognizing || !hasText;
  pasteZone.setAttribute("aria-busy", String(isRecognizing));
}

function resetCopyButton() {
  window.clearTimeout(copyResetTimer);
  copyButton.textContent = "Копировать";
  updateActionStates();
}

function clearResult() {
  resultText.value = "";
  resetCopyButton();
}

function resetProgress() {
  setProgress(0, "Ожидание изображения");
}

function updatePreviewRotation() {
  previewImage.style.transform = `rotate(${rotation}deg)`;
}

function clearImage() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentFile = null;
  currentObjectUrl = null;
  rotation = 0;
  previewImage.removeAttribute("src");
  previewImage.hidden = true;
  emptyState.hidden = false;
  pasteZone.classList.remove("is-active", "is-dragover");
  fileInput.value = "";
  updatePreviewRotation();
  updateActionStates();
}

function clearAll() {
  if (isRecognizing) {
    showMessage("Дождитесь завершения распознавания", "error");
    return;
  }

  clearImage();
  clearResult();
  resetProgress();
  hideMessage();
  setStatus("idle");
}

function canAcceptNewImage() {
  if (!isRecognizing) {
    return true;
  }

  showMessage("Дождитесь завершения OCR перед заменой изображения", "error");
  return false;
}

function setImage(file, source = "file") {
  if (!canAcceptNewImage()) {
    return;
  }

  if (!file || !file.type.startsWith("image/")) {
    showMessage("Файл не похож на изображение. Выберите PNG, JPG, WebP или другой графический файл.", "error");
    setStatus("error", "Нужен файл изображения");
    return;
  }

  clearImage();
  clearResult();
  resetProgress();
  hideMessage();

  currentFile = file;
  currentObjectUrl = URL.createObjectURL(file);
  previewImage.src = currentObjectUrl;
  previewImage.hidden = false;
  emptyState.hidden = true;
  pasteZone.classList.add("is-active");
  setStatus("image", source === "drop" ? "Изображение перетащено" : "Изображение загружено");
  setProgress(0, "Изображение готово");
  updateActionStates();

  if (autoRecognize.checked) {
    window.setTimeout(recognizeText, 80);
  }
}

function getImageFromPaste(event) {
  const items = event.clipboardData?.items || [];

  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }

  return null;
}

async function readImageFromClipboard() {
  if (isRecognizing) {
    showMessage("Дождитесь завершения OCR перед вставкой нового изображения", "error");
    return;
  }

  if (!navigator.clipboard?.read) {
    showMessage("Браузер не разрешил чтение буфера. Используйте Ctrl+V или загрузите файл", "error");
    return;
  }

  try {
    const items = await navigator.clipboard.read();

    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));

      if (imageType) {
        const blob = await item.getType(imageType);
        const file = new File([blob], "clipboard-image.png", { type: imageType });
        setImage(file, "clipboard");
        return;
      }
    }

    showMessage("В буфере обмена нет изображения", "error");
  } catch (error) {
    console.error(error);
    showMessage("Браузер не разрешил чтение буфера. Используйте Ctrl+V или загрузите файл", "error");
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };

    image.src = url;
  });
}

function getTargetSize(image) {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const rotated = Math.abs(rotation) % 180 === 90;
  let width = rotated ? naturalHeight : naturalWidth;
  let height = rotated ? naturalWidth : naturalHeight;
  let scale = 1;

  if (processingMode.value === "screenshot") {
    const longestSide = Math.max(width, height);
    if (longestSide < MIN_SCREENSHOT_SIDE) {
      scale = Math.min(2.2, MIN_SCREENSHOT_SIDE / longestSide);
    }
  }

  const scaledLongestSide = Math.max(width, height) * scale;

  if (scaledLongestSide > MAX_CANVAS_SIDE) {
    scale = MAX_CANVAS_SIDE / Math.max(width, height);
    lastPreparedWarning = "Большое изображение было уменьшено для стабильной работы";
  } else {
    lastPreparedWarning = "";
  }

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  };
}

function drawRotatedImage(context, image, width, height) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);

  const drawWidth = normalizedRotation === 90 || normalizedRotation === 270 ? height : width;
  const drawHeight = normalizedRotation === 90 || normalizedRotation === 270 ? width : height;
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

function normalizeBrightness(data) {
  let sum = 0;

  for (let index = 0; index < data.length; index += 4) {
    sum += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }

  const average = sum / (data.length / 4);
  return 128 - average;
}

function applyImageMode(canvas) {
  const mode = processingMode.value;

  if (mode === "original") {
    return;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const brightnessShift = mode === "document" ? normalizeBrightness(data) * 0.35 : 0;
  const contrastByMode = {
    screenshot: 1.18,
    document: 1.38,
    strong: 1.72,
    binary: 1.55,
    invert: 1
  };
  const contrast = contrastByMode[mode] || 1;

  for (let index = 0; index < data.length; index += 4) {
    const originalGray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    let value = (originalGray + brightnessShift - 128) * contrast + 128;

    if (mode === "binary") {
      value = value > 150 ? 255 : 0;
    }

    if (mode === "invert") {
      data[index] = 255 - data[index];
      data[index + 1] = 255 - data[index + 1];
      data[index + 2] = 255 - data[index + 2];
      continue;
    }

    value = Math.max(0, Math.min(255, value));
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  context.putImageData(imageData, 0, 0);
}

async function preprocessImage(file) {
  const image = await loadImage(file);
  const { width, height } = getTargetSize(image);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  drawRotatedImage(context, image, width, height);
  applyImageMode(canvas);

  return canvas;
}

function mapTesseractStatus(message) {
  const status = message.status || "";

  if (status.includes("loading tesseract core") || status.includes("initializing tesseract")) {
    return statusText.engine;
  }

  if (status.includes("loading language") || status.includes("initializing api")) {
    return statusText.language;
  }

  if (status.includes("recognizing text")) {
    return statusText.recognize;
  }

  return status || statusText.engine;
}

function workerLogger(message) {
  const label = mapTesseractStatus(message);

  if (label === statusText.recognize) {
    setProgress(50 + message.progress * 50, label);
    setStatus("recognize");
  } else if (message.progress) {
    setProgress(Math.min(50, message.progress * 50), label);
    setStatus(label === statusText.language ? "language" : "engine");
  } else {
    progressLabel.textContent = label;
  }
}

async function ensureWorker(language) {
  if (!window.Tesseract) {
    throw new Error("Tesseract.js еще загружается. Повторите через несколько секунд.");
  }

  if (worker && workerLanguage === language) {
    return worker;
  }

  if (worker) {
    await worker.terminate();
    worker = null;
    workerLanguage = null;
  }

  setStatus("engine");
  setProgress(5, statusText.engine);
  worker = await Tesseract.createWorker(language, 1, {
    logger: workerLogger
  });
  workerLanguage = language;
  return worker;
}

async function configureWorker(activeWorker) {
  const mode = textMode.value;
  const parameters = {
    tessedit_pageseg_mode: psmByMode[mode] || psmByMode.text,
    preserve_interword_spaces: mode === "table" ? "1" : "0"
  };

  if (mode === "digits") {
    parameters.tessedit_char_whitelist = "0123456789.,:-+/()";
  } else {
    parameters.tessedit_char_whitelist = "";
  }

  await activeWorker.setParameters(parameters);
}

async function recognizeText() {
  if (!currentFile || isRecognizing) {
    return;
  }

  isRecognizing = true;
  pasteZone.classList.add("is-busy");
  updateActionStates();
  clearResult();
  hideMessage();
  setStatus("prepare");
  setProgress(2, statusText.prepare);

  try {
    const processedCanvas = await preprocessImage(currentFile);

    if (lastPreparedWarning) {
      showMessage(lastPreparedWarning, "info", 6000);
    }

    const activeWorker = await ensureWorker(languageSelect.value);
    await configureWorker(activeWorker);
    setStatus("recognize");
    setProgress(50, statusText.recognize);

    const response = await activeWorker.recognize(processedCanvas);
    const text = response.data.text.trim();

    resultText.value = text;
    setProgress(100, text ? statusText.done : statusText.empty);
    setStatus(text ? "done" : "empty");

    if (!text) {
      showMessage("Tesseract.js завершил работу, но текст не найден. Попробуйте другой режим обработки.", "error");
    }
  } catch (error) {
    console.error(error);
    setProgress(0, statusText.error);
    setStatus("error");
    showMessage(error.message || "Не удалось распознать текст. Попробуйте другое изображение или режим обработки.", "error", 0);
  } finally {
    isRecognizing = false;
    pasteZone.classList.remove("is-busy");
    updateActionStates();
  }
}

async function copyText() {
  const text = resultText.value.trim();

  if (!text) {
    showMessage("Нет текста для копирования", "error");
    updateActionStates();
    return;
  }

  try {
    await navigator.clipboard.writeText(resultText.value);
    copyButton.textContent = "Скопировано";
    setStatus("done", "Текст скопирован");
    copyResetTimer = window.setTimeout(resetCopyButton, 1400);
  } catch (error) {
    console.error(error);
    showMessage("Браузер запретил копирование. Выделите текст вручную.", "error");
  }
}

function downloadText() {
  if (!hasResult()) {
    return;
  }

  const blob = new Blob([resultText.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "photo-ocr-result.txt";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function removeExtraLineBreaks() {
  const paragraphs = resultText.value
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean);

  resultText.value = paragraphs.join("\n\n");
  resetCopyButton();
}

function removeDoubleSpaces() {
  resultText.value = resultText.value.replace(/[ \t]{2,}/g, " ");
  resetCopyButton();
}

function clearOnlyResult() {
  if (isRecognizing) {
    showMessage("Дождитесь завершения OCR", "error");
    return;
  }

  clearResult();
  setStatus(currentFile ? "image" : "idle");
}

function rotateImage(direction) {
  if (!currentFile || isRecognizing) {
    return;
  }

  rotation = (rotation + direction + 360) % 360;
  updatePreviewRotation();
  clearResult();
  resetProgress();
  setStatus("image", "Изображение повернуто");

  if (autoRecognize.checked) {
    window.setTimeout(recognizeText, 80);
  }
}

function handleDroppedFiles(files) {
  const file = files?.[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showMessage("Перетащенный файл не является изображением", "error");
    setStatus("error", "Нужен файл изображения");
    return;
  }

  setImage(file, "drop");
}

document.addEventListener("paste", (event) => {
  const file = getImageFromPaste(event);

  if (file) {
    event.preventDefault();
    setImage(file, "paste");
  }
});

pasteZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (!isRecognizing) {
    pasteZone.classList.add("is-dragover");
  }
});

pasteZone.addEventListener("dragover", (event) => {
  event.preventDefault();
});

pasteZone.addEventListener("dragleave", (event) => {
  if (!pasteZone.contains(event.relatedTarget)) {
    pasteZone.classList.remove("is-dragover");
  }
});

pasteZone.addEventListener("drop", (event) => {
  event.preventDefault();
  pasteZone.classList.remove("is-dragover");

  if (!canAcceptNewImage()) {
    return;
  }

  handleDroppedFiles(event.dataTransfer.files);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (file) {
    setImage(file, "file");
  }
});

pasteZone.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && !isRecognizing) {
    event.preventDefault();
    fileInput.click();
  }
});

languageSelect.addEventListener("change", () => {
  if (worker && workerLanguage !== languageSelect.value) {
    setStatus("image", "Язык будет загружен при следующем OCR");
  }
});

processingMode.addEventListener("change", () => {
  clearResult();
  resetProgress();

  if (currentFile && autoRecognize.checked) {
    window.setTimeout(recognizeText, 80);
  }
});

textMode.addEventListener("change", () => {
  clearResult();
  resetProgress();

  if (currentFile && autoRecognize.checked) {
    window.setTimeout(recognizeText, 80);
  }
});

resultText.addEventListener("input", resetCopyButton);
recognizeButton.addEventListener("click", recognizeText);
clipboardButton.addEventListener("click", readImageFromClipboard);
rotateLeftButton.addEventListener("click", () => rotateImage(-90));
rotateRightButton.addEventListener("click", () => rotateImage(90));
copyButton.addEventListener("click", copyText);
downloadButton.addEventListener("click", downloadText);
fixLineBreaksButton.addEventListener("click", removeExtraLineBreaks);
fixSpacesButton.addEventListener("click", removeDoubleSpaces);
clearResultButton.addEventListener("click", clearOnlyResult);
clearButton.addEventListener("click", clearAll);

setStatus("idle");
resetProgress();
updateActionStates();
