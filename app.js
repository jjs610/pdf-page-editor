const pdfjsLib = window.pdfjsLib;
const { PDFDocument, degrees } = window.PDFLib ?? {};

if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

const elements = {
  openPdfInput: document.querySelector("#openPdfInput"),
  mergePdfInput: document.querySelector("#mergePdfInput"),
  insertPdfInput: document.querySelector("#insertPdfInput"),
  mergeDropTarget: document.querySelector("#mergeDropTarget"),
  insertDropTarget: document.querySelector("#insertDropTarget"),
  downloadButton: document.querySelector("#downloadButton"),
  closePreviewButton: document.querySelector("#closePreviewButton"),
  rotateButton: document.querySelector("#rotateButton"),
  zoomInput: document.querySelector("#zoomInput"),
  zoomLabel: document.querySelector("#zoomLabel"),
  thumbnailList: document.querySelector("#thumbnailList"),
  pageCountBadge: document.querySelector("#pageCountBadge"),
  workspace: document.querySelector(".workspace"),
  dropZone: document.querySelector("#dropZone"),
  emptyState: document.querySelector("#emptyState"),
  pageCanvas: document.querySelector("#pageCanvas"),
  selectionBox: document.querySelector("#selectionBox"),
  statusText: document.querySelector("#statusText"),
  currentPageText: document.querySelector("#currentPageText"),
};

let editorPdf = null;
let selectedPageIndex = 0;
let currentFileName = "edited.pdf";
let zoom = 1;
let renderToken = 0;
let draggedPageIndex = null;
let selectionAnchorPageIndex = null;
let dragSelection = null;
const selectedExtractionPageIndexes = new Set();

function setStatus(message) {
  elements.statusText.textContent = message;
}

function librariesAvailable() {
  const ready = Boolean(pdfjsLib && PDFDocument && degrees);
  if (!ready) {
    setStatus("PDF 도구를 불러오지 못했습니다. 인터넷 연결 후 페이지를 새로고침해 주세요.");
  }

  return ready;
}

function pageCount() {
  return editorPdf ? editorPdf.getPageCount() : 0;
}

function hasDocument() {
  return pageCount() > 0;
}

function normalizePageSelection() {
  const count = pageCount();
  if (count === 0) {
    selectedPageIndex = 0;
    selectionAnchorPageIndex = null;
    selectedExtractionPageIndexes.clear();
    return;
  }

  selectedPageIndex = Math.min(Math.max(selectedPageIndex, 0), count - 1);
  if (selectionAnchorPageIndex !== null) {
    selectionAnchorPageIndex = Math.min(Math.max(selectionAnchorPageIndex, 0), count - 1);
  }
  for (const index of selectedExtractionPageIndexes) {
    if (index < 0 || index >= count) {
      selectedExtractionPageIndexes.delete(index);
    }
  }
}

function updateControls() {
  const count = pageCount();
  const enabled = count > 0;
  const librariesReady = Boolean(pdfjsLib && PDFDocument && degrees);

  elements.openPdfInput.disabled = !librariesReady;
  elements.mergePdfInput.disabled = !librariesReady;
  elements.insertPdfInput.disabled = !librariesReady || !enabled;
  elements.downloadButton.disabled = !librariesReady || !enabled;
  elements.rotateButton.disabled = !librariesReady || !enabled;
  elements.pageCountBadge.textContent = String(count);
  elements.currentPageText.textContent = enabled
    ? `${selectedPageIndex + 1} / ${count} 페이지`
    : "";

  if (!librariesReady) {
    setStatus("PDF 도구를 불러오지 못했습니다. 인터넷 연결 후 페이지를 새로고침해 주세요.");
  }
}

async function readFileAsBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function getCurrentPdfBytes() {
  if (!editorPdf) {
    return null;
  }

  return await editorPdf.save();
}

async function loadPdfFromFile(file) {
  if (!librariesAvailable()) {
    return;
  }

  try {
    setStatus("PDF를 여는 중...");
    const bytes = await readFileAsBytes(file);
    editorPdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    selectedPageIndex = 0;
    selectedExtractionPageIndexes.clear();
    currentFileName = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
    await refreshView("PDF를 열었습니다.");
  } catch (error) {
    console.error(error);
    setStatus("PDF를 열 수 없습니다. 암호화되었거나 손상된 파일일 수 있습니다.");
  }
}

async function loadPdfJsDocument() {
  const bytes = await getCurrentPdfBytes();
  if (!bytes) {
    return null;
  }

  return await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
}

async function renderSelectedPage() {
  const token = ++renderToken;

  if (!hasDocument()) {
    elements.pageCanvas.hidden = true;
    elements.emptyState.hidden = false;
    return;
  }

  elements.emptyState.hidden = true;
  elements.pageCanvas.hidden = false;

  const pdf = await loadPdfJsDocument();
  if (!pdf || token !== renderToken) {
    return;
  }

  const page = await pdf.getPage(selectedPageIndex + 1);
  if (token !== renderToken) {
    return;
  }

  const viewport = page.getViewport({ scale: 1.4 * zoom });
  const context = elements.pageCanvas.getContext("2d");

  elements.pageCanvas.width = Math.floor(viewport.width);
  elements.pageCanvas.height = Math.floor(viewport.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;
}

async function renderThumbnails() {
  const count = pageCount();
  elements.thumbnailList.innerHTML = "";

  if (count === 0) {
    elements.thumbnailList.innerHTML =
      '<div class="empty-state small">PDF를 열면 페이지 목록이 표시됩니다.</div>';
    return;
  }

  const pdf = await loadPdfJsDocument();
  if (!pdf) {
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const thumbnail = document.createElement("div");
    thumbnail.className = [
      "thumbnail",
      index === selectedPageIndex ? "active" : "",
      selectedExtractionPageIndexes.has(index) ? "extract-selected" : "",
    ]
      .filter(Boolean)
      .join(" ");
    thumbnail.role = "button";
    thumbnail.tabIndex = 0;
    thumbnail.draggable = true;
    thumbnail.dataset.pageIndex = String(index);

    const canvas = document.createElement("canvas");
    const footer = document.createElement("div");
    footer.className = "thumbnail-footer";

    const label = document.createElement("span");
    label.textContent = `${index + 1} 페이지`;

    footer.append(label);
    thumbnail.append(canvas, footer);

    const selectThumbnail = async ({ keepSelection = false } = {}) => {
      const currentIndex = getThumbnailIndex(thumbnail);

      if (!keepSelection && selectedExtractionPageIndexes.size > 0) {
        selectedExtractionPageIndexes.clear();
      }

      selectedPageIndex = currentIndex;
      if (!keepSelection) {
        selectionAnchorPageIndex = currentIndex;
      }
      updateControls();
      await renderSelectedPage();
      highlightSelectedThumbnail();
    };

    thumbnail.addEventListener("click", async (event) => {
      const currentIndex = getThumbnailIndex(thumbnail);

      if (event.shiftKey) {
        selectExtractionRange(currentIndex);
        await selectThumbnail({ keepSelection: true });
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        if (selectedExtractionPageIndexes.size === 0 && selectedPageIndex !== currentIndex) {
          selectedExtractionPageIndexes.add(selectedPageIndex);
        }
        toggleExtractionPage(currentIndex);
        selectionAnchorPageIndex = currentIndex;
        await selectThumbnail({ keepSelection: true });
        return;
      }

      await selectThumbnail();
    });
    thumbnail.addEventListener("dblclick", async () => {
      await openPreview(getThumbnailIndex(thumbnail));
    });
    thumbnail.addEventListener("keydown", async (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        await selectThumbnail();
      }
    });
    thumbnail.addEventListener("dragstart", (event) => {
      if (event.ctrlKey || event.metaKey || dragSelection) {
        event.preventDefault();
        return;
      }

      event.stopPropagation();
      draggedPageIndex = getThumbnailIndex(thumbnail);
      thumbnail.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(draggedPageIndex));
    });
    thumbnail.addEventListener("dragend", () => {
      draggedPageIndex = null;
      thumbnail.classList.remove("dragging");
      thumbnail.classList.remove("drag-over");
    });
    thumbnail.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      thumbnail.classList.add("drag-over");
    });
    thumbnail.addEventListener("dragleave", (event) => {
      event.stopPropagation();
      thumbnail.classList.remove("drag-over");
    });
    thumbnail.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      thumbnail.classList.remove("drag-over");

      const fromIndex = draggedPageIndex ?? Number(event.dataTransfer.getData("text/plain"));
      await reorderPage(fromIndex, getThumbnailIndex(thumbnail));
    });

    elements.thumbnailList.append(thumbnail);

    const page = await pdf.getPage(index + 1);
    const viewport = page.getViewport({ scale: 0.22 });
    const context = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;
  }
}

function highlightSelectedThumbnail() {
  const thumbnails = elements.thumbnailList.querySelectorAll(".thumbnail");
  thumbnails.forEach((thumbnail, index) => {
    thumbnail.classList.toggle("active", index === selectedPageIndex);
    thumbnail.classList.toggle(
      "extract-selected",
      selectedExtractionPageIndexes.has(index),
    );
  });
}

function getThumbnailIndex(thumbnail) {
  return Number(thumbnail.dataset.pageIndex);
}

function updateThumbnailDomIndexes() {
  elements.thumbnailList.querySelectorAll(".thumbnail").forEach((thumbnail, index) => {
    thumbnail.dataset.pageIndex = String(index);
    const label = thumbnail.querySelector(".thumbnail-footer span");
    if (label) {
      label.textContent = `${index + 1} 페이지`;
    }
  });
}

function moveThumbnailDom(fromIndex, toIndex) {
  const thumbnails = Array.from(elements.thumbnailList.querySelectorAll(".thumbnail"));
  const movedThumbnail = thumbnails[fromIndex];
  const targetThumbnail = thumbnails[toIndex];

  if (!movedThumbnail || !targetThumbnail || movedThumbnail === targetThumbnail) {
    return;
  }

  movedThumbnail.classList.add("moving");
  if (fromIndex < toIndex) {
    targetThumbnail.after(movedThumbnail);
  } else {
    targetThumbnail.before(movedThumbnail);
  }

  updateThumbnailDomIndexes();
  highlightSelectedThumbnail();
  window.setTimeout(() => movedThumbnail.classList.remove("moving"), 180);
}

function setExtractionPageSelected(index, selected) {
  if (selected) {
    selectedExtractionPageIndexes.add(index);
  } else {
    selectedExtractionPageIndexes.delete(index);
  }

  const thumbnail = elements.thumbnailList.querySelectorAll(".thumbnail")[index];
  thumbnail?.classList.toggle("extract-selected", selected);
  highlightSelectedThumbnail();
  updateControls();
}

function toggleExtractionPage(index) {
  const nextSelected = !selectedExtractionPageIndexes.has(index);
  setExtractionPageSelected(index, nextSelected);
}

function selectExtractionRange(index) {
  const anchor = selectionAnchorPageIndex ?? selectedPageIndex ?? index;
  const start = Math.min(anchor, index);
  const end = Math.max(anchor, index);

  for (let pageIndex = start; pageIndex <= end; pageIndex += 1) {
    selectedExtractionPageIndexes.add(pageIndex);
  }

  selectionAnchorPageIndex = anchor;
  highlightSelectedThumbnail();
  updateControls();
}

function getRectFromPoints(startX, startY, currentX, currentY) {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    right: Math.max(startX, currentX),
    bottom: Math.max(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  };
}

function rectsIntersect(first, second) {
  return !(
    first.right < second.left ||
    first.left > second.right ||
    first.bottom < second.top ||
    first.top > second.bottom
  );
}

function renderSelectionBox(rect) {
  elements.selectionBox.hidden = false;
  elements.selectionBox.style.left = `${rect.left}px`;
  elements.selectionBox.style.top = `${rect.top}px`;
  elements.selectionBox.style.width = `${rect.width}px`;
  elements.selectionBox.style.height = `${rect.height}px`;
}

function updateDragSelection(currentX, currentY) {
  if (!dragSelection) {
    return;
  }

  const selectionRect = getRectFromPoints(
    dragSelection.startX,
    dragSelection.startY,
    currentX,
    currentY,
  );

  renderSelectionBox(selectionRect);

  const nextSelection = new Set(dragSelection.initialSelection);
  elements.thumbnailList.querySelectorAll(".thumbnail").forEach((thumbnail, index) => {
    if (rectsIntersect(selectionRect, thumbnail.getBoundingClientRect())) {
      nextSelection.add(index);
    }
  });

  selectedExtractionPageIndexes.clear();
  nextSelection.forEach((index) => selectedExtractionPageIndexes.add(index));
  highlightSelectedThumbnail();
  updateControls();
}

function stopDragSelection() {
  if (!dragSelection) {
    return;
  }

  elements.selectionBox.hidden = true;
  document.body.classList.remove("drag-selecting");
  selectionAnchorPageIndex =
    selectedExtractionPageIndexes.size > 0 ? selectedPageIndex : selectionAnchorPageIndex;
  dragSelection = null;
  window.removeEventListener("pointermove", handleDragSelectionMove);
  window.removeEventListener("pointerup", stopDragSelection);
}

function handleDragSelectionMove(event) {
  event.preventDefault();
  updateDragSelection(event.clientX, event.clientY);
}

function startDragSelection(event) {
  if (event.button !== 0 || !hasDocument()) {
    return;
  }

  const startedOnThumbnail = Boolean(event.target.closest(".thumbnail"));
  if (startedOnThumbnail) {
    return;
  }

  event.preventDefault();
  const initialSelection =
    event.ctrlKey || event.metaKey
      ? new Set(selectedExtractionPageIndexes)
      : new Set([selectedPageIndex]);

  dragSelection = {
    startX: event.clientX,
    startY: event.clientY,
    initialSelection,
  };

  document.body.classList.add("drag-selecting");
  renderSelectionBox(getRectFromPoints(event.clientX, event.clientY, event.clientX, event.clientY));
  window.addEventListener("pointermove", handleDragSelectionMove);
  window.addEventListener("pointerup", stopDragSelection);
}

async function openPreview(index = selectedPageIndex) {
  if (!hasDocument()) {
    return;
  }

  selectedPageIndex = Math.min(Math.max(index, 0), pageCount() - 1);
  elements.workspace.classList.add("preview-open");
  updateControls();
  await renderSelectedPage();
  highlightSelectedThumbnail();
}

function closePreview() {
  elements.workspace.classList.remove("preview-open");
}

function remapExtractionSelections(pageOrder) {
  const selected = new Set();

  pageOrder.forEach((oldIndex, newIndex) => {
    if (selectedExtractionPageIndexes.has(oldIndex)) {
      selected.add(newIndex);
    }
  });

  selectedExtractionPageIndexes.clear();
  selected.forEach((index) => selectedExtractionPageIndexes.add(index));
}

function shiftExtractionSelections(startIndex, offset) {
  const shifted = new Set();

  selectedExtractionPageIndexes.forEach((index) => {
    shifted.add(index >= startIndex ? index + offset : index);
  });

  selectedExtractionPageIndexes.clear();
  shifted.forEach((index) => selectedExtractionPageIndexes.add(index));
}

async function refreshView(message) {
  normalizePageSelection();
  updateControls();
  setStatus(message);
  await renderSelectedPage();
  await renderThumbnails();
  updateControls();
}

async function rebuildDocument(pageOrder) {
  const sourceBytes = await getCurrentPdfBytes();
  const sourceDoc = await PDFDocument.load(sourceBytes);
  const rebuiltDoc = await PDFDocument.create();
  const copiedPages = await rebuiltDoc.copyPages(sourceDoc, pageOrder);

  copiedPages.forEach((page) => rebuiltDoc.addPage(page));
  editorPdf = rebuiltDoc;
}

async function reorderPage(fromIndex, toIndex) {
  const count = pageCount();
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= count ||
    toIndex >= count ||
    fromIndex === toIndex
  ) {
    return;
  }

  const previousSelectedPageIndex = selectedPageIndex;
  const order = Array.from({ length: count }, (_, index) => index);
  const [movedPage] = order.splice(fromIndex, 1);
  order.splice(toIndex, 0, movedPage);

  moveThumbnailDom(fromIndex, toIndex);
  await rebuildDocument(order);
  remapExtractionSelections(order);
  selectedPageIndex = order.indexOf(previousSelectedPageIndex);
  updateThumbnailDomIndexes();
  highlightSelectedThumbnail();
  updateControls();
  setStatus("페이지 순서를 변경했습니다.");

  if (elements.workspace.classList.contains("preview-open")) {
    await renderSelectedPage();
  }
}

async function moveSelectedPage(direction) {
  const count = pageCount();
  const targetIndex = selectedPageIndex + direction;

  if (targetIndex < 0 || targetIndex >= count) {
    return;
  }

  const order = Array.from({ length: count }, (_, index) => index);
  [order[selectedPageIndex], order[targetIndex]] = [
    order[targetIndex],
    order[selectedPageIndex],
  ];

  await rebuildDocument(order);
  remapExtractionSelections(order);
  selectedPageIndex = targetIndex;
  await refreshView("페이지 순서를 변경했습니다.");
}

async function deleteSelectedPage() {
  const count = pageCount();
  if (count === 0) {
    return;
  }

  if (count === 1) {
    editorPdf = await PDFDocument.create();
    selectedPageIndex = 0;
    await refreshView("마지막 페이지를 삭제했습니다. 새 PDF를 열거나 병합하세요.");
    return;
  }

  const order = Array.from({ length: count }, (_, index) => index).filter(
    (index) => index !== selectedPageIndex,
  );

  await rebuildDocument(order);
  remapExtractionSelections(order);
  selectedPageIndex = Math.min(selectedPageIndex, pageCount() - 1);
  await refreshView("페이지를 삭제했습니다.");
}

async function deletePageIndexes(indexes) {
  const count = pageCount();
  const indexesToDelete = new Set(
    indexes.filter((index) => index >= 0 && index < count),
  );

  if (indexesToDelete.size === 0) {
    return;
  }

  if (indexesToDelete.size >= count) {
    editorPdf = await PDFDocument.create();
    selectedPageIndex = 0;
    selectedExtractionPageIndexes.clear();
    closePreview();
    await refreshView("선택한 모든 페이지를 삭제했습니다. 새 PDF를 열거나 병합하세요.");
    return;
  }

  const previousSelectedPageIndex = selectedPageIndex;
  const order = Array.from({ length: count }, (_, index) => index).filter(
    (index) => !indexesToDelete.has(index),
  );

  await rebuildDocument(order);
  remapExtractionSelections(order);
  selectedPageIndex =
    order.indexOf(previousSelectedPageIndex) >= 0
      ? order.indexOf(previousSelectedPageIndex)
      : Math.min(previousSelectedPageIndex, order.length - 1);

  await refreshView(
    indexesToDelete.size > 1
      ? `${indexesToDelete.size}개 페이지를 삭제했습니다.`
      : "페이지를 삭제했습니다.",
  );
}

async function deleteActiveOrSelectedPages() {
  if (!hasDocument()) {
    return;
  }

  const selectedIndexes = getSelectedExtractionIndexes();
  await deletePageIndexes(selectedIndexes.length > 0 ? selectedIndexes : [selectedPageIndex]);
}

async function rotateSelectedPage() {
  if (!hasDocument()) {
    return;
  }

  const page = editorPdf.getPage(selectedPageIndex);
  const currentAngle = page.getRotation().angle;
  page.setRotation(degrees((currentAngle + 90) % 360));
  await refreshView("페이지를 90도 회전했습니다.");
}

async function addBlankPage() {
  if (!hasDocument()) {
    editorPdf = await PDFDocument.create();
    editorPdf.addPage();
    selectedPageIndex = 0;
    await refreshView("빈 페이지를 추가했습니다.");
    return;
  }

  const currentPage = editorPdf.getPage(selectedPageIndex);
  const { width, height } = currentPage.getSize();
  editorPdf.insertPage(selectedPageIndex + 1, [width, height]);
  shiftExtractionSelections(selectedPageIndex + 1, 1);
  selectedPageIndex += 1;
  await refreshView("빈 페이지를 추가했습니다.");
}

async function mergePdfFiles(files) {
  if (!librariesAvailable()) {
    return;
  }

  if (!files.length) {
    return;
  }

  const startsNewDocument = !hasDocument();
  if (!editorPdf) {
    editorPdf = await PDFDocument.create();
  }

  try {
    setStatus("PDF를 병합하는 중...");
    const firstMergedPageIndex = pageCount();

    for (const file of files) {
      const bytes = await readFileAsBytes(file);
      const sourceDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageIndexes = sourceDoc.getPageIndices();
      const copiedPages = await editorPdf.copyPages(sourceDoc, pageIndexes);
      copiedPages.forEach((page) => editorPdf.addPage(page));
    }

    if (pageCount() > 0) {
      if (startsNewDocument) {
        currentFileName = "merged-edited.pdf";
      }
      selectedPageIndex = Math.min(firstMergedPageIndex, pageCount() - 1);
    }

    await refreshView("PDF 병합을 완료했습니다.");
  } catch (error) {
    console.error(error);
    setStatus("PDF 병합에 실패했습니다. 암호화되었거나 손상된 파일이 있는지 확인하세요.");
  }
}

async function insertPdfFiles(files) {
  if (!librariesAvailable()) {
    return;
  }

  if (!files.length) {
    return;
  }

  if (!hasDocument()) {
    await mergePdfFiles(files);
    return;
  }

  try {
    setStatus("선택한 페이지 뒤에 PDF를 추가하는 중...");
    let insertIndex = selectedPageIndex + 1;
    const firstInsertedPageIndex = insertIndex;
    let insertedPageCount = 0;

    for (const file of files) {
      const bytes = await readFileAsBytes(file);
      const sourceDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copiedPages = await editorPdf.copyPages(sourceDoc, sourceDoc.getPageIndices());

      copiedPages.forEach((page) => {
        editorPdf.insertPage(insertIndex, page);
        insertIndex += 1;
        insertedPageCount += 1;
      });
    }

    if (insertedPageCount > 0) {
      shiftExtractionSelections(firstInsertedPageIndex, insertedPageCount);
      selectedPageIndex = firstInsertedPageIndex;
    }

    await refreshView("파일을 선택한 페이지 뒤에 추가했습니다.");
  } catch (error) {
    console.error(error);
    setStatus("파일 추가에 실패했습니다. 암호화되었거나 손상된 PDF가 있는지 확인하세요.");
  }
}

function getSelectedExtractionIndexes() {
  return Array.from(selectedExtractionPageIndexes)
    .filter((index) => index >= 0 && index < pageCount())
    .sort((a, b) => a - b);
}

function fallbackDownloadBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function openSaveHandleDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pdf-editor-save-handles", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("handles");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredSaveHandle() {
  try {
    const database = await openSaveHandleDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("handles", "readonly");
      const request = transaction.objectStore("handles").get("last-save-handle");

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
    });
  } catch (error) {
    console.warn("저장 위치 기록을 불러오지 못했습니다.", error);
    return null;
  }
}

async function storeSaveHandle(handle) {
  try {
    const database = await openSaveHandleDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("handles", "readwrite");
      transaction.objectStore("handles").put(handle, "last-save-handle");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.warn("저장 위치 기록을 저장하지 못했습니다.", error);
  }
}

async function pickSaveFile(fileName, startIn) {
  const options = {
    id: "pdf-editor-save",
    suggestedName: fileName,
    types: [
      {
        description: "PDF 파일",
        accept: { "application/pdf": [".pdf"] },
      },
    ],
  };

  if (startIn) {
    options.startIn = startIn;
  }

  return await window.showSaveFilePicker(options);
}

async function savePdfBytes(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });

  if (window.showSaveFilePicker) {
    try {
      const storedHandle = await getStoredSaveHandle();
      let handle;

      try {
        handle = await pickSaveFile(fileName, storedHandle);
      } catch (error) {
        if (error?.name === "AbortError") {
          throw error;
        }

        handle = await pickSaveFile(fileName);
      }

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      await storeSaveHandle(handle);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus("저장을 취소했습니다.");
        return false;
      }

      console.error(error);
      setStatus("저장 위치 선택을 사용할 수 없어 다운로드로 저장합니다.");
    }
  }

  fallbackDownloadBytes(bytes, fileName);
  return true;
}

function setSidebarWidth(width) {
  const clampedWidth = Math.min(Math.max(width, 180), 560);
  document.documentElement.style.setProperty("--sidebar-width", `${clampedWidth}px`);
  localStorage.setItem("pdf-editor-sidebar-width", String(clampedWidth));
}

function restoreSidebarWidth() {
  const savedWidth = Number(localStorage.getItem("pdf-editor-sidebar-width"));
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    setSidebarWidth(savedWidth);
  }
}

function startSidebarResize(event) {
  if (!elements.workspace) {
    return;
  }

  event.preventDefault();
  document.body.classList.add("resizing-sidebar");

  const resize = (moveEvent) => {
    const workspaceRect = elements.workspace.getBoundingClientRect();
    const availableWidth = workspaceRect.width;
    const proposedWidth = moveEvent.clientX - workspaceRect.left;
    const maxWidth = Math.max(220, Math.min(560, availableWidth - 380));

    setSidebarWidth(Math.min(proposedWidth, maxWidth));
  };

  const stopResize = () => {
    document.body.classList.remove("resizing-sidebar");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", stopResize);
  };

  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", stopResize);
}

async function extractSelectedPages() {
  if (!hasDocument()) {
    return;
  }

  const selectedIndexes = getSelectedExtractionIndexes();
  if (selectedIndexes.length === 0) {
    setStatus("Ctrl을 누른 채 저장할 페이지를 선택해 주세요.");
    return;
  }

  const extractedDoc = await PDFDocument.create();
  const copiedPages = await extractedDoc.copyPages(editorPdf, selectedIndexes);
  copiedPages.forEach((page) => extractedDoc.addPage(page));

  const bytes = await extractedDoc.save();
  const baseName = currentFileName.replace(/\.pdf$/i, "");
  const saved = await savePdfBytes(bytes, `${baseName}-extracted.pdf`);
  if (saved) {
    setStatus(`${selectedIndexes.length}개 페이지를 추출해 저장했습니다.`);
  }
}

async function downloadPdf() {
  if (!hasDocument()) {
    return;
  }

  const selectedIndexes = getSelectedExtractionIndexes();
  if (selectedIndexes.length > 0) {
    await extractSelectedPages();
    return;
  }

  const bytes = await getCurrentPdfBytes();
  const saved = await savePdfBytes(bytes, currentFileName);
  if (saved) {
    setStatus("편집한 PDF를 저장했습니다.");
  }
}

function getDroppedPdfFiles(event) {
  const dataTransfer = event.dataTransfer;
  const files = Array.from(dataTransfer?.files ?? []);
  const itemFiles = Array.from(dataTransfer?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);

  return [...files, ...itemFiles].filter((file, index, allFiles) => {
    const isPdf =
      file.type === "application/pdf" ||
      file.type === "application/x-pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    const firstMatchIndex = allFiles.findIndex(
      (candidate) =>
        candidate.name === file.name &&
        candidate.size === file.size &&
        candidate.lastModified === file.lastModified,
    );

    return isPdf && firstMatchIndex === index;
  });
}

async function handlePdfFiles(files, { replaceCurrent = false } = {}) {
  if (!files.length) {
    setStatus("PDF 파일을 찾지 못했습니다. .pdf 파일을 직접 드래그해 주세요.");
    return;
  }

  if (replaceCurrent || !hasDocument()) {
    await loadPdfFromFile(files[0]);
    if (files.length > 1) {
      await mergePdfFiles(files.slice(1));
    }
    return;
  }

  await mergePdfFiles(files);
}

function bindPdfDropTarget(target, onDropFiles) {
  target.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    target.classList.add("drop-ready");
    elements.dropZone.classList.remove("dragging");
  });

  target.addEventListener("dragleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.classList.remove("drop-ready");
  });

  target.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    target.classList.remove("drop-ready");
    elements.dropZone.classList.remove("dragging");

    const files = getDroppedPdfFiles(event);
    if (!files.length) {
      setStatus("PDF 파일만 추가할 수 있습니다.");
      return;
    }

    await onDropFiles(files);
  });
}

elements.openPdfInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (file) {
    await loadPdfFromFile(file);
  }
  event.target.value = "";
});

elements.mergePdfInput.addEventListener("change", async (event) => {
  await mergePdfFiles(Array.from(event.target.files ?? []));
  event.target.value = "";
});

elements.insertPdfInput.addEventListener("change", async (event) => {
  await insertPdfFiles(Array.from(event.target.files ?? []));
  event.target.value = "";
});

elements.downloadButton.addEventListener("click", downloadPdf);
elements.closePreviewButton.addEventListener("click", closePreview);
elements.rotateButton.addEventListener("click", rotateSelectedPage);
elements.thumbnailList.addEventListener("pointerdown", startDragSelection);
bindPdfDropTarget(elements.mergeDropTarget, mergePdfFiles);
bindPdfDropTarget(elements.insertDropTarget, insertPdfFiles);

elements.zoomInput.addEventListener("input", async (event) => {
  zoom = Number(event.target.value) / 100;
  elements.zoomLabel.textContent = `${event.target.value}%`;
  await renderSelectedPage();
});

elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
  elements.dropZone.classList.add("dragging");
});

elements.dropZone.addEventListener("dragleave", (event) => {
  event.stopPropagation();
  elements.dropZone.classList.remove("dragging");
});

elements.dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  elements.dropZone.classList.remove("dragging");

  await handlePdfFiles(getDroppedPdfFiles(event), { replaceCurrent: true });
});

document.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  elements.dropZone.classList.add("dragging");
});

document.addEventListener("dragleave", (event) => {
  if (event.clientX === 0 && event.clientY === 0) {
    elements.dropZone.classList.remove("dragging");
  }
});

document.addEventListener("drop", async (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("dragging");

  await handlePdfFiles(getDroppedPdfFiles(event), { replaceCurrent: true });
});

document.addEventListener("keydown", async (event) => {
  if (event.key !== "Delete" || event.target.matches("input, textarea, select")) {
    return;
  }

  event.preventDefault();
  await deleteActiveOrSelectedPages();
});

updateControls();
