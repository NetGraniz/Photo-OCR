const fileInput = document.querySelector("#fileInput");
const pasteZone = document.querySelector("#pasteZone");
const emptyState = document.querySelector("#emptyState");
const previewImage = document.querySelector("#previewImage");
const recognizeButton = document.querySelector("#recognizeButton");
const copyButton = document.querySelector("#copyButton");
const clearButton = document.querySelector("#clearButton");
const languageSelect = document.querySelector("#languageSelect");
const resultText = document.querySelector("#resultText");
const progressBar = document.querySelector("#progressBar");
const progressLabel = document.querySelector("#progressLabel");
const progressValue = document.querySelector("#progressValue");
const appStatus = document.querySelector("#appStatus");

let currentFile = null;
let currentObjectUrl = null;
let isRecognizing = false;
let copyResetTimer = null;

const statusText = {
  idle: "Готов к вставке",
  image: "Изображение загружено",
  ocr: "Идет распознавание",
  done: "Текст распознан",
  empty: "Нет текста для копирования",
  error: "Ошибка распознавания"
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

function resetCopyButton() {
  window.clearTimeout(copyResetTimer);
  copyButton.textContent = "Копировать текст";
  copyButton.disabled = !resultText.value.trim();
}

function clearResult() {
  resultText.value = "";
  resetCopyButton();
}

function resetProgress() {
  setProgress(0, "Ожидание изображения");
}

function clearImage() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentFile = null;
  currentObjectUrl = null;
  previewImage.removeAttribute("src");
  previewImage.hidden = true;
  emptyState.hidden = false;
  recognizeButton.disabled = true;
  pasteZone.classList.remove("is-active");
  fileInput.value = "";
}

function clearAll() {
  if (isRecognizing) {
    return;
  }

  clearImage();
  clearResult();
  resetProgress();
  setStatus("idle");
}

function setImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    setStatus("error", "Файл не похож на изображение");
    return;
  }

  clearImage();
  clearResult();
  resetProgress();

  currentFile = file;
  currentObjectUrl = URL.createObjectURL(file);
  previewImage.src = currentObjectUrl;
  previewImage.hidden = false;
  emptyState.hidden = true;
  pasteZone.classList.add("is-active");
  recognizeButton.disabled = false;
  setStatus("image");
  setProgress(0, "Изображение готово");
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

async function preprocessImage(file) {
  const image = await loadImage(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestSide < 1400 ? Math.min(2.4, 1400 / longestSide) : 1;
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const contrast = 1.18;
  const midpoint = 128;

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const adjusted = Math.max(0, Math.min(255, (gray - midpoint) * contrast + midpoint));
    data[index] = adjusted;
    data[index + 1] = adjusted;
    data[index + 2] = adjusted;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function recognizeText() {
  if (!currentFile || isRecognizing) {
    return;
  }

  if (!window.Tesseract) {
    setStatus("error", "Tesseract.js еще загружается");
    return;
  }

  isRecognizing = true;
  pasteZone.classList.add("is-busy");
  recognizeButton.disabled = true;
  clearResult();
  setStatus("ocr");
  setProgress(2, "Подготовка изображения");

  try {
    const processedCanvas = await preprocessImage(currentFile);
    const language = languageSelect.value;

    const response = await Tesseract.recognize(processedCanvas, language, {
      logger(message) {
        if (message.status === "recognizing text") {
          setProgress(message.progress * 100, "Распознавание текста");
        } else if (message.progress) {
          setProgress(message.progress * 45, message.status || "Загрузка OCR");
        } else if (message.status) {
          progressLabel.textContent = message.status;
        }
      }
    });

    const text = response.data.text.trim();
    resultText.value = text;
    copyButton.disabled = !text;
    setProgress(100, text ? "Готово" : "Текст не найден");
    setStatus(text ? "done" : "empty", text ? undefined : "Текст не найден");
  } catch (error) {
    console.error(error);
    setProgress(0, "Ошибка");
    setStatus("error", "Не удалось распознать текст");
  } finally {
    isRecognizing = false;
    pasteZone.classList.remove("is-busy");
    recognizeButton.disabled = !currentFile;
  }
}

async function copyText() {
  const text = resultText.value.trim();

  if (!text) {
    copyButton.textContent = "Нет текста для копирования";
    copyButton.disabled = true;
    setStatus("empty");
    copyResetTimer = window.setTimeout(resetCopyButton, 1400);
    return;
  }

  try {
    await navigator.clipboard.writeText(resultText.value);
    copyButton.textContent = "Скопировано";
    setStatus("done", "Текст скопирован");
    copyResetTimer = window.setTimeout(resetCopyButton, 1400);
  } catch (error) {
    console.error(error);
    setStatus("error", "Браузер запретил копирование");
  }
}

document.addEventListener("paste", (event) => {
  const file = getImageFromPaste(event);

  if (file) {
    event.preventDefault();
    setImage(file);
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];

  if (file) {
    setImage(file);
  }
});

pasteZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

resultText.addEventListener("input", resetCopyButton);
recognizeButton.addEventListener("click", recognizeText);
copyButton.addEventListener("click", copyText);
clearButton.addEventListener("click", clearAll);

setStatus("idle");
resetProgress();
