document.addEventListener("DOMContentLoaded", () => {
  const notesContainer = document.getElementById("notesContainer");
  const addNoteBtn = document.getElementById("addNoteBtn");
  const noteEditorPage = document.getElementById("noteEditorPage");
  const backBtn = document.getElementById("backBtn");
  const saveNoteBtn = document.getElementById("saveNoteBtn");
  const modeToggleBtn = document.getElementById("modeToggleBtn");
  const drawToolbarFloating = document.getElementById("drawToolbarFloating");
  const noteTitleInput = document.getElementById("noteTitle");
  const pageCanvasWrapper = document.getElementById("pageCanvasWrapper");
  const editorContainerEl = document.getElementById("editorContainer");
  const drawingCanvas = document.getElementById("drawingCanvas");
  const penColorInput = document.getElementById("penColor");
  const penSizeInput = document.getElementById("penSize");
  const undoDrawBtn = document.getElementById("undoDrawBtn");
  const clearDrawBtn = document.getElementById("clearDrawBtn");
  const drawToolButtons = document.querySelectorAll(".draw-tool");
  const fileInput = document.getElementById("fileInput");
  const attachmentList = document.getElementById("attachmentList");
  const categoryChips = document.getElementById("categoryChips");
  const addCategoryForm = document.getElementById("addCategoryForm");
  const newCategoryInput = document.getElementById("newCategoryInput");
  const searchInput = document.getElementById("searchInput");
  const filterSelect = document.getElementById("filterSelect");
  const emptyState = document.getElementById("emptyState");
  const confirmModal = document.getElementById("confirmModal");
  const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
  const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
  const resetDatabaseBtn = document.getElementById("resetDatabaseBtn");
  const pageStyleButtons = document.querySelectorAll(".page-style-btn");
  const pageLineColorInput = document.getElementById("pageLineColor");
  const pageBgColorInput = document.getElementById("pageBgColor");
  const pageBgSizeSelect = document.getElementById("pageBgSizeMode");
  const pageBgUploadWrapper = document.getElementById("pageBgUploadWrapper");
  const pageBgUploadInput = document.getElementById("pageBgUploadInput");

  const colorPalette = ["#181C63", "#4F9D69", "#8ACDEA", "#63181D", "#41393E", "#3a7a50", "#2f8faf"];
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file

  // Register 12 real fonts and a granular size scale before creating Quill
  const FontStyle = Quill.import("attributors/style/font");
  FontStyle.whitelist = [
    "Montserrat", "Inter", "Poppins", "Nunito", "Quicksand", "Comic Neue",
    "Caveat", "Pacifico", "Playfair Display", "Lora", "Merriweather", "Roboto Mono"
  ];
  Quill.register(FontStyle, true);

  const SizeStyle = Quill.import("attributors/style/size");
  SizeStyle.whitelist = ["10px", "12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "40px", "48px"];
  Quill.register(SizeStyle, true);

  // Quill blocks blob: image links by default (it swaps them for a broken link).
  // Allow them so inline images show up.
  const ImageFormat = Quill.import("formats/image");
  if (ImageFormat) {
    ImageFormat.sanitize = (url) => (/^(https?|data|blob):/i.test(url) ? url : "//:0");
  }

  const quill = new Quill("#editorContainer", {
    theme: "snow",
    modules: { toolbar: "#toolbar" },
    placeholder: "Start writing..."
  });

  const ctx = drawingCanvas.getContext("2d");
  const PIXEL_RATIO = window.devicePixelRatio || 1;

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ---------- IndexedDB layer ----------

  const DB_NAME = "beemarksDB";
  const DB_VERSION = 1;
  let dbInstance = null;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("notes")) {
          db.createObjectStore("notes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("categories")) {
          db.createObjectStore("categories", { keyPath: "name" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function putRecord(storeName, record) {
    return new Promise((resolve, reject) => {
      if (!dbInstance) {
        reject(new Error("Database has not finished opening yet."));
        return;
      }

      let transaction;

      try {
        transaction = dbInstance.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        store.put(record);
      } catch (error) {
        reject(error);
        return;
      }

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        reject(transaction.error || new Error("Database save failed."));
      };
      transaction.onabort = () => {
        reject(transaction.error || new Error("Database save was aborted."));
      };
    });
  }

  function deleteRecord(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(",");
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function migrateOldNote(note) {
    const migrated = {
      attachments: [],
      inlineImages: [],
      pageStyle: { type: "plain", lineColor: "#c7d2e0", bgColor: "#ffffff", bgSizeMode: "cover" },
      pageBgImage: null,
      ...note
    };
    if (typeof migrated.drawing === "string" && migrated.drawing.startsWith("data:")) {
      migrated.drawing = dataUrlToBlob(migrated.drawing);
    } else if (!migrated.drawing) {
      migrated.drawing = null;
    }
    migrated.attachments = (migrated.attachments || []).map((a) => {
      if (a.dataUrl) {
        const { dataUrl, ...rest } = a;
        return { ...rest, blob: dataUrlToBlob(dataUrl) };
      }
      return a;
    });
    if (!migrated.inlineImages) migrated.inlineImages = [];
    if (!migrated.pageStyle) migrated.pageStyle = { type: "plain", lineColor: "#c7d2e0", bgColor: "#ffffff", bgSizeMode: "cover" };
    return migrated;
  }

  resetDatabaseBtn.addEventListener("click", async () => {
    const confirmed = confirm(
      "This will permanently delete all notes and categories saved in Beemarks. Continue?"
    );

    if (!confirmed) return;

    // Close the current IndexedDB connection first.
    if (dbInstance) {
      dbInstance.close();
    }

    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);

    deleteRequest.onsuccess = () => {
      localStorage.removeItem("migratedToIndexedDB");

      alert("Saved notes were reset. The page will now reload.");
      window.location.reload();
    };

    deleteRequest.onerror = () => {
      alert("Could not reset the database. Close other Beemarks tabs, then try again.");
    };

    deleteRequest.onblocked = () => {
      alert(
        "Database reset is waiting for another Beemarks tab to close. Close all other tabs of this app and try again."
      );
    };
  });

  async function migrateFromLocalStorageIfNeeded() {
    if (localStorage.getItem("migratedToIndexedDB")) return;

    const oldNotes = JSON.parse(localStorage.getItem("notes") || "[]");
    const oldCategories = JSON.parse(localStorage.getItem("categories") || "[]");

    for (const note of oldNotes) {
      await putRecord("notes", migrateOldNote(note));
    }
    for (const cat of oldCategories) {
      await putRecord("categories", { usageCount: 0, lastUsed: 0, ...cat });
    }

    localStorage.setItem("migratedToIndexedDB", "true");
  }

  // ---------- App state ----------

  let notes = [];
  let categories = [];

  let noteToDeleteId = null;
  let noteEditingId = null;
  let selectedTag = null;

  // Drawing/ink overlay state
  let drawModeOn = false;
  let currentTool = "pen";
  let isDrawing = false;
  let hasDrawnSomething = false;
  let pendingDrawingBlob = null;
  let lastX = 0;
  let lastY = 0;
  let undoStack = [];
  let canvasCssWidth = 0;
  let canvasCssHeight = 0;
  let canvasResizeObserver = null;
  let resizeDebounceTimer = null;

  // Attachment state (separate files, shown below the text)
  let currentAttachments = [];
  const modelViewers = new Map();

  // Inline images embedded directly in the Quill content
  let currentInlineImages = new Map();

  // Page style (background pattern/color behind the writing surface)
  let currentPageStyle = { type: "plain", lineColor: "#c7d2e0", bgColor: "#ffffff", bgSizeMode: "cover" };
  let currentPageBgBlob = null;

  // Object URLs currently in use
  let cardObjectUrls = [];
  let editorObjectUrls = [];

  function revokeUrls(list) {
    list.forEach((u) => URL.revokeObjectURL(u));
    list.length = 0;
  }

  addNoteBtn.addEventListener("click", () => openNoteEditor());
  backBtn.addEventListener("click", closeNoteEditor);
  saveNoteBtn.addEventListener("click", handleSaveNote);
  addCategoryForm.addEventListener("submit", handleAddCategory);
  searchInput.addEventListener("input", filterNotes);
  filterSelect.addEventListener("change", filterNotes);
  confirmDeleteBtn.addEventListener("click", confirmDeleteNote);
  cancelDeleteBtn.addEventListener("click", closeConfirmDeleteModal);
  fileInput.addEventListener("change", handleFileSelect);

  quill.getModule("toolbar").addHandler("image", handleInlineImageInsert);

  // ---------- Draw toggle: text and ink live on the same page ----------

  modeToggleBtn.addEventListener("click", () => {
    drawModeOn = !drawModeOn;
    drawingCanvas.classList.toggle("draw-active", drawModeOn);
    drawToolbarFloating.classList.toggle("hidden", !drawModeOn);
    modeToggleBtn.classList.toggle("active", drawModeOn);
  });

  drawToolButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      drawToolButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTool = btn.dataset.tool;
    });
  });

  drawingCanvas.addEventListener("pointerdown", startDraw);
  drawingCanvas.addEventListener("pointermove", draw);
  window.addEventListener("pointerup", stopDraw);
  drawingCanvas.addEventListener("pointerleave", stopDraw);

  undoDrawBtn.addEventListener("click", () => {
    if (undoStack.length === 0) return;
    const prev = undoStack.pop();
    ctx.putImageData(prev, 0, 0);
    hasDrawnSomething = undoStack.length > 0;
  });

  clearDrawBtn.addEventListener("click", () => {
    saveUndoState();
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  });

  // ---------- Canvas sizing: grows to match the page, without lagging typing ----------
  // Fix for the typing lag: resizing/redrawing the ink canvas is real work, and the
  // editor's height can shift on nearly every keystroke as lines wrap. We debounce
  // the resize so it only runs once typing pauses, and skip the expensive
  // snapshot-and-redraw step entirely when there's no ink yet to preserve.

  function syncCanvasSize() {
    const width = pageCanvasWrapper.clientWidth;
    const height = pageCanvasWrapper.clientHeight;
    if (width === 0 || height === 0) return;
    if (width === canvasCssWidth && height === canvasCssHeight) return;

    let snapshot = null;
    if (hasDrawnSomething && canvasCssWidth && canvasCssHeight) {
      snapshot = document.createElement("canvas");
      snapshot.width = drawingCanvas.width;
      snapshot.height = drawingCanvas.height;
      snapshot.getContext("2d").drawImage(drawingCanvas, 0, 0);
    }

    canvasCssWidth = width;
    canvasCssHeight = height;

    drawingCanvas.width = width * PIXEL_RATIO;
    drawingCanvas.height = height * PIXEL_RATIO;
    drawingCanvas.style.width = width + "px";
    drawingCanvas.style.height = height + "px";

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (snapshot) {
      ctx.drawImage(snapshot, 0, 0, snapshot.width / PIXEL_RATIO, snapshot.height / PIXEL_RATIO);
    }
  }

  function scheduleCanvasResize() {
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(syncCanvasSize, 180);
  }

  function startCanvasResizeWatcher() {
    stopCanvasResizeWatcher();
    canvasResizeObserver = new ResizeObserver(() => scheduleCanvasResize());
    canvasResizeObserver.observe(editorContainerEl);
  }

  function stopCanvasResizeWatcher() {
    if (canvasResizeObserver) {
      canvasResizeObserver.disconnect();
      canvasResizeObserver = null;
    }
    if (resizeDebounceTimer) {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = null;
    }
  }

  function getPointerPos(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure || 0.5 };
  }

  function saveUndoState() {
    undoStack.push(ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height));
    if (undoStack.length > 20) undoStack.shift();
  }

  function startDraw(e) {
    if (!drawModeOn) return;
    e.preventDefault();
    isDrawing = true;
    hasDrawnSomething = true;
    saveUndoState();
    const pos = getPointerPos(e);
    lastX = pos.x;
    lastY = pos.y;
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    ctx.globalCompositeOperation = currentTool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = penColorInput.value;
    const pressureFactor = e.pointerType === "pen" ? Math.max(0.4, pos.pressure) : 1;
    ctx.lineWidth = Number(penSizeInput.value) * pressureFactor;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
  }

  function stopDraw() {
    isDrawing = false;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not convert the drawing canvas into an image."));
        }
      }, "image/png");
    });
  }

  function loadPendingDrawing() {
    if (!pendingDrawingBlob) return;
    const url = URL.createObjectURL(pendingDrawingBlob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvasCssWidth, canvasCssHeight);
      hasDrawnSomething = true;
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // ---------- Page style (paper pattern behind the writing surface) ----------

  function buildKawaiiPattern(color) {
    const encodedColor = encodeURIComponent(color);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><text x='4' y='26' font-size='16' fill='${encodedColor}' opacity='0.6'>&#9733;</text></svg>`;
    return `url("data:image/svg+xml,${svg}")`;
  }

  function applyPageStyle() {
    const editorEl = quill.root;
    editorEl.classList.remove("paper-lined", "paper-grid", "paper-dot", "paper-kawaii", "paper-custom");
    editorEl.style.backgroundColor = currentPageStyle.bgColor;
    editorEl.style.setProperty("--page-line", currentPageStyle.lineColor);
    editorEl.style.backgroundImage = "";
    editorEl.style.backgroundSize = "";
    editorEl.style.backgroundRepeat = "";

    if (currentPageStyle.type === "lined") {
      editorEl.classList.add("paper-lined");
    } else if (currentPageStyle.type === "grid") {
      editorEl.classList.add("paper-grid");
    } else if (currentPageStyle.type === "dot") {
      editorEl.classList.add("paper-dot");
    } else if (currentPageStyle.type === "kawaii") {
      editorEl.classList.add("paper-kawaii");
      editorEl.style.backgroundImage = buildKawaiiPattern(currentPageStyle.lineColor);
      editorEl.style.backgroundSize = "36px 36px";
      editorEl.style.backgroundRepeat = "repeat";
    } else if (currentPageStyle.type === "custom" && currentPageBgBlob) {
      editorEl.classList.add("paper-custom");
      const url = URL.createObjectURL(currentPageBgBlob);
      editorObjectUrls.push(url);
      editorEl.style.backgroundImage = `url(${url})`;
      if (currentPageStyle.bgSizeMode === "contain") {
        editorEl.style.backgroundSize = "contain";
        editorEl.style.backgroundRepeat = "no-repeat";
      } else if (currentPageStyle.bgSizeMode === "tile") {
        editorEl.style.backgroundSize = "220px auto";
        editorEl.style.backgroundRepeat = "repeat";
      } else {
        editorEl.style.backgroundSize = "cover";
        editorEl.style.backgroundRepeat = "no-repeat";
      }
    }
  }

  pageStyleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      pageStyleButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPageStyle.type = btn.dataset.style;
      pageBgUploadWrapper.style.display = currentPageStyle.type === "custom" ? "inline-flex" : "none";
      pageBgSizeSelect.style.display = currentPageStyle.type === "custom" ? "inline-block" : "none";
      applyPageStyle();
    });
  });

  pageLineColorInput.addEventListener("input", () => {
    currentPageStyle.lineColor = pageLineColorInput.value;
    applyPageStyle();
  });

  pageBgColorInput.addEventListener("input", () => {
    currentPageStyle.bgColor = pageBgColorInput.value;
    applyPageStyle();
  });

  pageBgSizeSelect.addEventListener("change", () => {
    currentPageStyle.bgSizeMode = pageBgSizeSelect.value;
    applyPageStyle();
  });

  pageBgUploadInput.addEventListener("change", () => {
    const file = pageBgUploadInput.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert(`"${file.name}" is over the ${MAX_FILE_SIZE / (1024 * 1024)}MB safety limit for this app.`);
      return;
    }
    currentPageBgBlob = file;
    applyPageStyle();
  });

  // ---------- Inline images (embedded in the writing area) ----------

  function handleInlineImageInsert() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE) {
        alert(`"${file.name}" is over the ${MAX_FILE_SIZE / (1024 * 1024)}MB safety limit for this app.`);
        return;
      }

      const id = generateId();
      currentInlineImages.set(id, file);

      const url = URL.createObjectURL(file);
      editorObjectUrls.push(url);

      const range = quill.getSelection(true);
      quill.insertEmbed(range.index, "image", url, "user");
      const [leaf] = quill.getLeaf(range.index);
      if (leaf && leaf.domNode) leaf.domNode.setAttribute("data-media-id", id);
      quill.setSelection(range.index + 1);
    };
    input.click();
  }

  function hydrateContentForEditing(html, inlineImages) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    temp.querySelectorAll("img[data-media-id]").forEach((img) => {
      const id = img.getAttribute("data-media-id");
      const entry = inlineImages.find((i) => i.id === id);
      if (entry) {
        const url = URL.createObjectURL(entry.blob);
        editorObjectUrls.push(url);
        img.src = url;
      }
    });
    return temp.innerHTML;
  }

  function pruneOrphanedInlineImages() {
    const usedIds = new Set();
    quill.root.querySelectorAll("img[data-media-id]").forEach((img) => {
      usedIds.add(img.getAttribute("data-media-id"));
    });
    for (const id of [...currentInlineImages.keys()]) {
      if (!usedIds.has(id)) currentInlineImages.delete(id);
    }
  }

  // ---------- Attachments: file handling ----------

  function classifyFile(file) {
    const name = file.name.toLowerCase();
    if (file.type.startsWith("image/")) return "image";
    if (name.endsWith(".glb") || name.endsWith(".gltf")) return "model-glb";
    if (name.endsWith(".obj")) return "model-obj";
    if (name.endsWith(".stl")) return "model-stl";
    return "file";
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`"${file.name}" is over the ${MAX_FILE_SIZE / (1024 * 1024)}MB safety limit for this app. Try a smaller file.`);
        continue;
      }
      currentAttachments.push({
        id: generateId(),
        name: file.name,
        kind: classifyFile(file),
        mimeType: file.type,
        blob: file
      });
    }
    fileInput.value = "";
    renderAttachmentList();
  }

  function fileIconFor(name) {
    const ext = name.split(".").pop().toLowerCase();
    if (ext === "pdf") return "fa-file-pdf";
    if (["doc", "docx"].includes(ext)) return "fa-file-word";
    if (["xls", "xlsx", "csv"].includes(ext)) return "fa-file-excel";
    if (["ppt", "pptx"].includes(ext)) return "fa-file-powerpoint";
    if (["zip", "rar", "7z"].includes(ext)) return "fa-file-zipper";
    return "fa-file";
  }

  function renderAttachmentList() {
    attachmentList.innerHTML = "";
    disposeAllModelViewers();

    currentAttachments.forEach((att) => {
      const item = document.createElement("div");

      if (att.kind === "image") {
        const url = URL.createObjectURL(att.blob);
        editorObjectUrls.push(url);
        item.className = "attachment-item";
        item.innerHTML = `
          <img src="${url}" class="attachment-thumb" alt="${att.name}" />
          <button type="button" class="remove-attachment" data-id="${att.id}"><i class="fas fa-xmark"></i></button>
        `;
      } else if (att.kind.startsWith("model-")) {
        item.className = "attachment-item";
        item.innerHTML = `
          <div class="model-canvas-container" id="model-${att.id}"></div>
          <button type="button" class="remove-attachment" data-id="${att.id}"><i class="fas fa-xmark"></i></button>
        `;
      } else {
        const url = URL.createObjectURL(att.blob);
        editorObjectUrls.push(url);
        item.className = "attachment-item file-chip";
        item.innerHTML = `
          <i class="fas ${fileIconFor(att.name)} file-icon"></i>
          <span>${att.name}</span>
          <a class="download-link" href="${url}" download="${att.name}"><i class="fas fa-download"></i></a>
          <button type="button" class="remove-attachment" data-id="${att.id}"><i class="fas fa-xmark"></i></button>
        `;
      }

      attachmentList.appendChild(item);

      if (att.kind.startsWith("model-")) {
        initModelViewer(att);
      }
    });

    attachmentList.querySelectorAll(".remove-attachment").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        disposeModelViewer(id);
        currentAttachments = currentAttachments.filter((a) => a.id !== id);
        renderAttachmentList();
      });
    });
  }

  function initModelViewer(attachment) {
    const container = document.getElementById(`model-${attachment.id}`);
    if (!container || typeof THREE === "undefined") return;

    const width = container.clientWidth || 140;
    const height = container.clientHeight || 140;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f1f1);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 4, 3);
    scene.add(dirLight);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableZoom = true;

    const blobUrl = URL.createObjectURL(attachment.blob);

    function fitModelToView(object) {
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 1.5 / maxDim;
      object.scale.setScalar(scale);
      scene.add(object);
    }

    function onLoadError(err) {
      console.error("Model failed to load:", err);
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:0.75rem;text-align:center;padding:6px;">Couldn\'t preview this model</div>';
    }

    if (attachment.kind === "model-glb") {
      const loader = new THREE.GLTFLoader();
      loader.load(blobUrl, (gltf) => fitModelToView(gltf.scene), undefined, onLoadError);
    } else if (attachment.kind === "model-obj") {
      const loader = new THREE.OBJLoader();
      loader.load(blobUrl, (obj) => {
        obj.traverse((child) => {
          if (child.isMesh) child.material = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });
        });
        fitModelToView(obj);
      }, undefined, onLoadError);
    } else if (attachment.kind === "model-stl") {
      const loader = new THREE.STLLoader();
      loader.load(blobUrl, (geometry) => {
        const material = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });
        const mesh = new THREE.Mesh(geometry, material);
        fitModelToView(mesh);
      }, undefined, onLoadError);
    }

    let animationId;
    function animate() {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    modelViewers.set(attachment.id, { renderer, animationId, blobUrl });
  }

  function disposeModelViewer(id) {
    const viewer = modelViewers.get(id);
    if (!viewer) return;
    cancelAnimationFrame(viewer.animationId);
    viewer.renderer.dispose();
    URL.revokeObjectURL(viewer.blobUrl);
    modelViewers.delete(id);
  }

  function disposeAllModelViewers() {
    [...modelViewers.keys()].forEach(disposeModelViewer);
  }

  function getAttachmentSummary(note) {
    const attachments = note.attachments || [];
    if (attachments.length === 0) return "";
    const models = attachments.filter((a) => a.kind.startsWith("model-")).length;
    const files = attachments.filter((a) => a.kind === "file").length;
    const parts = [];
    if (models) parts.push(`<span><i class="fas fa-cube"></i> ${models}</span>`);
    if (files) parts.push(`<span><i class="fas fa-paperclip"></i> ${files}</span>`);
    return parts.length ? `<div class="attachment-summary">${parts.join("")}</div>` : "";
  }

  // ---------- Notes / categories ----------

  function getPlainText(html) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    return temp.textContent || "";
  }

  function getFirstInlineImage(note) {
    const temp = document.createElement("div");
    temp.innerHTML = note.content || "";
    const img = temp.querySelector("img[data-media-id]");
    if (!img) return null;
    const id = img.getAttribute("data-media-id");
    return (note.inlineImages || []).find((i) => i.id === id) || null;
  }

  function getSortedCategories() {
    return [...categories].sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return b.lastUsed - a.lastUsed;
    });
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  async function markCategoryUsed(tagName) {
    const cat = categories.find((c) => c.name === tagName);
    if (cat) {
      cat.usageCount += 1;
      cat.lastUsed = Date.now();
      await putRecord("categories", cat);
    }
  }

  function renderNotes(notesToRender = notes) {
    revokeUrls(cardObjectUrls);
    notesContainer.innerHTML = "";

    notesToRender.forEach((note) => {
      const noteElement = document.createElement("div");
      noteElement.className = "note-card fade-in";

      let previewHTML = "";
      const firstImage = (note.attachments || []).find((a) => a.kind === "image");
      const firstInlineImage = getFirstInlineImage(note);

      if (note.drawing) {
        const url = URL.createObjectURL(note.drawing);
        cardObjectUrls.push(url);
        previewHTML += `<img src="${url}" class="note-drawing-preview" alt="Drawing preview" />`;
      } else if (firstInlineImage) {
        const url = URL.createObjectURL(firstInlineImage.blob);
        cardObjectUrls.push(url);
        previewHTML += `<img src="${url}" class="note-drawing-preview" alt="Note image" />`;
      } else if (firstImage) {
        const url = URL.createObjectURL(firstImage.blob);
        cardObjectUrls.push(url);
        previewHTML += `<img src="${url}" class="note-drawing-preview" alt="${firstImage.name}" />`;
      }

      const plain = getPlainText(note.content);
      if (plain) {
        const previewText = plain.length > 80 ? plain.slice(0, 80) + "..." : plain;
        previewHTML += `<p class="note-text">${previewText}</p>`;
      }

      noteElement.innerHTML = `
        <div class="note-header"><h3 class="note-title">${note.title}</h3></div>
        ${previewHTML}
        ${getAttachmentSummary(note)}
        <div class="note-footer">
          <span class="note-tag" style="background:${getTagColor(note.tag)}33; color:${getTagColor(note.tag)}">${getTagName(note.tag)}</span>
          <span class="note-date">${new Date(note.date).toLocaleDateString()}</span>
          <button class="delete-btn" data-id="${note.id}" type="button">Delete</button>
        </div>`;

      noteElement.addEventListener("click", (e) => {
        if (e.target.closest(".delete-btn")) return;
        openNoteEditor(note.id);
      });

      notesContainer.appendChild(noteElement);
    });

    notesContainer.querySelectorAll(".delete-btn").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        noteToDeleteId = button.dataset.id;
        openConfirmDeleteModal();
      });
    });
  }

  function getTagColor(tagName) {
    const cat = categories.find((c) => c.name === tagName);
    return cat ? cat.color : "#999";
  }

  function getTagName(tagName) {
    return tagName ? capitalize(tagName) : "Other";
  }

  function renderCategoryChips() {
    categoryChips.innerHTML = "";
    getSortedCategories().forEach((cat) => {
      const chip = document.createElement("span");
      chip.className = "category-chip" + (selectedTag === cat.name ? " selected" : "");
      chip.style.backgroundColor = cat.color + "33";
      chip.style.color = cat.color;
      chip.textContent = capitalize(cat.name);
      chip.addEventListener("click", () => {
        selectedTag = cat.name;
        renderCategoryChips();
      });
      categoryChips.appendChild(chip);
    });
  }

  function renderFilterOptions() {
    const currentValue = filterSelect.value || "all";
    filterSelect.innerHTML = '<option value="all">All notes</option>';
    getSortedCategories().forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat.name;
      option.textContent = capitalize(cat.name);
      filterSelect.appendChild(option);
    });
    if ([...filterSelect.options].some((o) => o.value === currentValue)) {
      filterSelect.value = currentValue;
    }
  }

  async function handleAddCategory(e) {
    e.preventDefault();
    const name = newCategoryInput.value.trim();
    if (!name) return;
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      const color = colorPalette[categories.length % colorPalette.length];
      const newCat = { name, color, usageCount: 0, lastUsed: 0 };
      categories.push(newCat);
      await putRecord("categories", newCat);
    }
    selectedTag = existing ? existing.name : name;
    newCategoryInput.value = "";
    renderCategoryChips();
  }

  function resetPageStylePicker() {
    pageStyleButtons.forEach((b) => b.classList.toggle("active", b.dataset.style === currentPageStyle.type));
    pageLineColorInput.value = currentPageStyle.lineColor;
    pageBgColorInput.value = currentPageStyle.bgColor;
    pageBgSizeSelect.value = currentPageStyle.bgSizeMode;
    const isCustom = currentPageStyle.type === "custom";
    pageBgUploadWrapper.style.display = isCustom ? "inline-flex" : "none";
    pageBgSizeSelect.style.display = isCustom ? "inline-block" : "none";
  }

  function openNoteEditor(existingNoteId = null) {
    noteEditingId = existingNoteId;
    noteEditorPage.classList.add("active");
    undoStack = [];
    hasDrawnSomething = false;
    pendingDrawingBlob = null;
    currentAttachments = [];
    currentInlineImages = new Map();
    currentPageBgBlob = null;
    canvasCssWidth = 0;
    canvasCssHeight = 0;

    drawModeOn = false;
    drawingCanvas.classList.remove("draw-active");
    drawToolbarFloating.classList.add("hidden");
    modeToggleBtn.classList.remove("active");

    if (existingNoteId !== null) {
      const note = notes.find((n) => n.id === existingNoteId);
      noteTitleInput.value = note.title;
      selectedTag = note.tag;

      (note.inlineImages || []).forEach((entry) => currentInlineImages.set(entry.id, entry.blob));
      quill.root.innerHTML = hydrateContentForEditing(note.content || "", note.inlineImages || []);

      pendingDrawingBlob = note.drawing || null;
      currentAttachments = (note.attachments || []).map((a) => ({ ...a }));

      currentPageStyle = note.pageStyle
        ? { ...note.pageStyle }
        : { type: "plain", lineColor: "#c7d2e0", bgColor: "#ffffff", bgSizeMode: "cover" };
      currentPageBgBlob = note.pageBgImage || null;
    } else {
      noteTitleInput.value = "";
      quill.setContents([]);
      selectedTag = getSortedCategories()[0]?.name || null;
      currentPageStyle = { type: "plain", lineColor: "#c7d2e0", bgColor: "#ffffff", bgSizeMode: "cover" };
    }

    resetPageStylePicker();
    applyPageStyle();
    renderCategoryChips();
    renderAttachmentList();

    requestAnimationFrame(() => {
      syncCanvasSize();
      loadPendingDrawing();
      startCanvasResizeWatcher();
    });
  }

  function closeNoteEditor() {
    noteEditorPage.classList.remove("active");
    noteTitleInput.value = "";
    quill.setContents([]);
    stopCanvasResizeWatcher();
    if (canvasCssWidth && canvasCssHeight) ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    disposeAllModelViewers();
    revokeUrls(editorObjectUrls);
    noteEditingId = null;
    hasDrawnSomething = false;
    pendingDrawingBlob = null;
    currentAttachments = [];
    currentInlineImages = new Map();
    currentPageBgBlob = null;
    undoStack = [];
    drawModeOn = false;
    drawingCanvas.classList.remove("draw-active");
    drawToolbarFloating.classList.add("hidden");
    modeToggleBtn.classList.remove("active");
  }

  async function handleSaveNote() {
    const title = noteTitleInput.value.trim();

    // These must be outside try so the catch block can use them.
    let noteRecord = null;
    let newNoteId = null;

    if (!title) {
      alert("Please enter a title before saving.");
      noteTitleInput.focus();
      return;
    }

    try {
      pruneOrphanedInlineImages();

      const textContent = quill.root.innerHTML;
      const hasText = quill.getText().trim().length > 0;
      const hasInlineImages = currentInlineImages.size > 0;
      const hasAttachments = currentAttachments.length > 0;

      // Keep an already-saved drawing when editing an existing note.
      let drawingBlob = pendingDrawingBlob || null;

      // Convert the canvas into an image only after actual drawing.
      // A drawing export error must not prevent a normal text note from saving.
      if (
        hasDrawnSomething &&
        drawingCanvas.width > 0 &&
        drawingCanvas.height > 0
      ) {
        try {
          const newDrawingBlob = await canvasToBlob(drawingCanvas);

          if (newDrawingBlob instanceof Blob && newDrawingBlob.size > 0) {
            drawingBlob = newDrawingBlob;
          }
        } catch (canvasError) {
          console.warn(
            "Could not save the new drawing. The note will be saved without it.",
            canvasError
          );
        }
      }

      // Do not save a completely empty note.
      if (!hasText && !hasInlineImages && !drawingBlob && !hasAttachments) {
        alert("Add text, a drawing, an image, or an attachment before saving.");
        return;
      }

      // Save only valid Blob-based inline images.
      const inlineImagesArray = [...currentInlineImages.entries()]
        .filter(([, blob]) => blob instanceof Blob)
        .map(([id, blob]) => ({
          id: id,
          blob: blob
        }));

      // Save only serializable attachment information.
      const safeAttachments = currentAttachments
        .filter((attachment) => {
          return attachment && attachment.blob instanceof Blob;
        })
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          kind: attachment.kind,
          mimeType: attachment.mimeType || attachment.blob.type || "",
          blob: attachment.blob
        }));

      const noteData = {
        title: title,
        content: hasText || hasInlineImages ? textContent : "",
        inlineImages: inlineImagesArray,
        drawing: drawingBlob instanceof Blob ? drawingBlob : null,
        attachments: safeAttachments,
        pageStyle: {
          type: currentPageStyle.type,
          lineColor: currentPageStyle.lineColor,
          bgColor: currentPageStyle.bgColor,
          bgSizeMode: currentPageStyle.bgSizeMode
        },
        pageBgImage:
          currentPageStyle.type === "custom" &&
          currentPageBgBlob instanceof Blob
            ? currentPageBgBlob
            : null,
        tag: selectedTag,
        date: new Date().toISOString()
      };

      // Update an existing note.
      if (noteEditingId !== null) {
        const existingNote = notes.find(
          (note) => note.id === noteEditingId
        );

        if (!existingNote) {
          throw new Error("The note you are trying to edit could not be found.");
        }

        Object.assign(existingNote, noteData);
        noteRecord = existingNote;
      } else {
        // Create a new note.
        newNoteId = generateId();

        noteRecord = {
          id: newNoteId,
          ...noteData
        };

        notes.unshift(noteRecord);
      }

      // Save the record in IndexedDB.
      await putRecord("notes", noteRecord);

      // Update the home-page cards and close editor only after success.
      renderNotes();
      renderFilterOptions();
      updateEmptyState();
      closeNoteEditor();

    } catch (error) {
      console.error("Failed to save note:", error);

      // Remove a newly-added note from memory if IndexedDB saving failed.
      if (newNoteId) {
        notes = notes.filter((note) => note.id !== newNoteId);
      }

      alert(
        "The note could not be saved.\n\n" +
        "Error: " + (error.name || "Unknown error") + "\n" +
        "Details: " + (error.message || String(error))
      );
    }
  }

  function openConfirmDeleteModal() {
    confirmModal.classList.add("active");
  }

  function closeConfirmDeleteModal() {
    confirmModal.classList.remove("active");
    noteToDeleteId = null;
  }

  async function confirmDeleteNote() {
    if (noteToDeleteId !== null) {
      notes = notes.filter((n) => n.id !== noteToDeleteId);
      await deleteRecord("notes", noteToDeleteId);
      renderNotes();
      updateEmptyState();
      closeConfirmDeleteModal();
    }
  }

  function filterNotes() {
    const query = searchInput.value.toLowerCase();
    const tag = filterSelect.value;
    const filtered = notes.filter((note) =>
      (!query ||
        note.title.toLowerCase().includes(query) ||
        getPlainText(note.content).toLowerCase().includes(query) ||
        (note.tag || "").toLowerCase().includes(query)) &&
      (tag === "all" || note.tag === tag)
    );
    renderNotes(filtered);
    updateEmptyState(filtered);
  }

  function updateEmptyState(notesToCheck = notes) {
    emptyState.classList.toggle("active", notesToCheck.length === 0);
  }

  // ---------- App startup ----------

  async function initApp() {
    dbInstance = await openDatabase();
    await migrateFromLocalStorageIfNeeded();

    notes = await getAllRecords("notes");
    notes.sort((a, b) => new Date(b.date) - new Date(a.date));

    categories = await getAllRecords("categories");
    if (categories.length === 0) {
      // Default subjects geared toward actual schoolwork, plus two general-purpose ones
      categories = [
        { name: "math", color: "#181C63", usageCount: 0, lastUsed: 0 },
        { name: "science", color: "#4F9D69", usageCount: 0, lastUsed: 0 },
        { name: "english", color: "#63181D", usageCount: 0, lastUsed: 0 },
        { name: "history", color: "#8ACDEA", usageCount: 0, lastUsed: 0 },
        { name: "computer science", color: "#2f8faf", usageCount: 0, lastUsed: 0 },
        { name: "art", color: "#41393E", usageCount: 0, lastUsed: 0 },
        { name: "personal", color: "#3a7a50", usageCount: 0, lastUsed: 0 },
        { name: "reminders", color: "#ef4444", usageCount: 0, lastUsed: 0 }
      ];
      for (const cat of categories) {
        await putRecord("categories", cat);
      }
    }

    renderNotes();
    renderFilterOptions();
    updateEmptyState();
  }

  initApp();
});
