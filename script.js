const SHEET_SIZES = {
  A4: { width: 1123, height: 794 },
  A3: { width: 1587, height: 1123 },
  A2: { width: 2245, height: 1587 },
};

const GRID_SIZE = 25;
const ROTATION_STEP = 15;
const TOOLS = {
  SELECT: "select",
  MOVE: "move",
  PAN: "pan",
  WIRE: "wire",
  DELETE: "delete",
};

const COMPONENT_COLORS = {
  resistor: "#ff9d66",
  capacitor: "#72d1ff",
  led: "#a9ff7c",
  ground: "#b6cbff",
  battery: "#ffd56d",
  ic: "#c69cff",
};

const ui = {
  modeLabel: document.getElementById("modeLabel"),
  statusLabel: document.getElementById("statusLabel"),
  sheetSize: document.getElementById("sheetSize"),
  fitBtn: document.getElementById("fitBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),
  rotateBtn: document.getElementById("rotateBtn"),
  gridToggleBtn: document.getElementById("gridToggleBtn"),
  saveJsonBtn: document.getElementById("saveJsonBtn"),
  loadJsonBtn: document.getElementById("loadJsonBtn"),
  loadJsonInput: document.getElementById("loadJsonInput"),
  exportPngBtn: document.getElementById("exportPngBtn"),
  gridState: document.getElementById("gridState"),
  zoomState: document.getElementById("zoomState"),
  canvasHost: document.getElementById("canvasHost"),
  toolButtons: Array.from(document.querySelectorAll(".icon-btn[data-tool]")),
  componentButtons: Array.from(document.querySelectorAll(".left-tool[data-component]")),
};

const canvas = new fabric.Canvas("pcbCanvas", {
  backgroundColor: "#0f1821",
  preserveObjectStacking: true,
  selection: true,
});

let activeTool = TOOLS.SELECT;
let activeSheet = "A4";
let gridVisible = true;
let spacePressed = false;
let isPanning = false;
let panLast = { x: 0, y: 0 };
let wireStartPoint = null;
let wirePreview = null;

function setStatus(text) {
  ui.statusLabel.textContent = text;
}

function setModeLabel() {
  ui.modeLabel.textContent = `Tool: ${activeTool.charAt(0).toUpperCase()}${activeTool.slice(1)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function toCanvasPoint(clientX, clientY) {
  const rect = canvas.upperCanvasEl.getBoundingClientRect();
  const zoom = canvas.getZoom();
  const vpt = canvas.viewportTransform;
  return {
    x: (clientX - rect.left - vpt[4]) / zoom,
    y: (clientY - rect.top - vpt[5]) / zoom,
  };
}

function updateZoomState() {
  ui.zoomState.textContent = `${Math.round(canvas.getZoom() * 100)}%`;
}

function applyGridBackground() {
  if (!gridVisible) {
    canvas.setBackgroundColor("#0f1821", canvas.renderAll.bind(canvas));
    ui.gridState.textContent = "Off";
    return;
  }

  const tile = document.createElement("canvas");
  tile.width = GRID_SIZE;
  tile.height = GRID_SIZE;
  const ctx = tile.getContext("2d");

  ctx.fillStyle = "#0f1821";
  ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);

  ctx.strokeStyle = "#263a4f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(GRID_SIZE, 0);
  ctx.lineTo(GRID_SIZE, GRID_SIZE);
  ctx.moveTo(0, GRID_SIZE);
  ctx.lineTo(GRID_SIZE, GRID_SIZE);
  ctx.stroke();

  canvas.setBackgroundColor({ source: tile, repeat: "repeat" }, canvas.renderAll.bind(canvas));
  ui.gridState.textContent = "On";
}

function keepObjectInsideCanvas(obj) {
  obj.setCoords();
  const bounds = obj.getBoundingRect(true, true);

  let dx = 0;
  let dy = 0;

  if (bounds.left < 0) {
    dx = -bounds.left;
  } else if (bounds.left + bounds.width > canvas.getWidth()) {
    dx = canvas.getWidth() - (bounds.left + bounds.width);
  }

  if (bounds.top < 0) {
    dy = -bounds.top;
  } else if (bounds.top + bounds.height > canvas.getHeight()) {
    dy = canvas.getHeight() - (bounds.top + bounds.height);
  }

  if (dx || dy) {
    obj.set({ left: obj.left + dx, top: obj.top + dy });
    obj.setCoords();
  }
}

function keepAllInsideCanvas() {
  canvas.getObjects().forEach((obj) => {
    if (obj.customType === "component") {
      keepObjectInsideCanvas(obj);
    }
  });
}

function applySheetSize(sheetName) {
  activeSheet = sheetName;
  const sheet = SHEET_SIZES[sheetName];
  canvas.setWidth(sheet.width);
  canvas.setHeight(sheet.height);
  applyGridBackground();
  keepAllInsideCanvas();
  fitToViewport();
  canvas.requestRenderAll();
  setStatus(`${sheetName} sheet loaded`);
}

function fitToViewport() {
  const hostRect = ui.canvasHost.getBoundingClientRect();
  const maxWidth = hostRect.width - 48;
  const maxHeight = hostRect.height - 48;
  const widthScale = maxWidth / canvas.getWidth();
  const heightScale = maxHeight / canvas.getHeight();
  const zoom = clamp(Math.min(widthScale, heightScale), 0.2, 1.5);

  const offsetX = Math.max(0, (hostRect.width - canvas.getWidth() * zoom) / 2);
  const offsetY = Math.max(0, (hostRect.height - canvas.getHeight() * zoom) / 2);

  canvas.setViewportTransform([zoom, 0, 0, zoom, offsetX, offsetY]);
  updateZoomState();
  canvas.requestRenderAll();
}

function zoomBy(factor) {
  const next = clamp(canvas.getZoom() * factor, 0.2, 3.5);
  const center = new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
  canvas.zoomToPoint(center, next);
  updateZoomState();
  canvas.requestRenderAll();
}

function activateTool(tool) {
  activeTool = tool;
  ui.toolButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tool === tool);
  });

  const selectable = tool !== TOOLS.WIRE && tool !== TOOLS.PAN && tool !== TOOLS.DELETE;
  canvas.selection = selectable;
  canvas.defaultCursor = tool === TOOLS.PAN ? "grab" : "default";

  canvas.forEachObject((obj) => {
    if (obj.customType === "component") {
      obj.selectable = selectable;
      obj.evented = true;
      obj.hoverCursor = selectable ? "move" : "crosshair";
    }

    if (obj.customType === "wire") {
      obj.selectable = selectable;
      obj.evented = selectable;
    }
  });

  cancelWirePreview();
  setModeLabel();
  setStatus(`${tool} mode active`);
  canvas.requestRenderAll();
}

function createLine(coords, color, width = 3) {
  return new fabric.Line(coords, {
    stroke: color,
    strokeWidth: width,
    strokeLineCap: "round",
    strokeLineJoin: "round",
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
  });
}

function buildGroup(name, objects, point) {
  const color = COMPONENT_COLORS[name.toLowerCase()] || "#8fd9ff";
  const group = new fabric.Group(objects, {
    left: snap(point.x),
    top: snap(point.y),
    originX: "center",
    originY: "center",
    customType: "component",
    componentName: name,
    symbolType: name.toLowerCase(),
    cornerColor: "#00c2ff",
    borderColor: "#00c2ff",
    transparentCorners: false,
    lockUniScaling: true,
    minScaleLimit: 0.35,
    shadow: new fabric.Shadow({ color: `${color}66`, blur: 8, offsetX: 0, offsetY: 0 }),
  });

  keepObjectInsideCanvas(group);
  return group;
}

function createResistor(point) {
  const color = COMPONENT_COLORS.resistor;
  const zigzag = new fabric.Polyline(
    [
      { x: -22, y: 0 },
      { x: -16, y: -10 },
      { x: -10, y: 10 },
      { x: -4, y: -10 },
      { x: 2, y: 10 },
      { x: 8, y: -10 },
      { x: 14, y: 10 },
      { x: 20, y: 0 },
    ],
    {
      fill: "",
      stroke: color,
      strokeWidth: 3,
      strokeLineJoin: "round",
      strokeLineCap: "round",
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    }
  );

  return buildGroup("Resistor", [
    createLine([-50, 0, -24, 0], color),
    zigzag,
    createLine([22, 0, 50, 0], color),
  ], point);
}

function createCapacitor(point) {
  const color = COMPONENT_COLORS.capacitor;
  return buildGroup("Capacitor", [
    createLine([-50, 0, -12, 0], color),
    createLine([-12, -18, -12, 18], color),
    createLine([12, -18, 12, 18], color),
    createLine([12, 0, 50, 0], color),
  ], point);
}

function createLed(point) {
  const color = COMPONENT_COLORS.led;
  const diode = new fabric.Polygon(
    [
      { x: -16, y: -16 },
      { x: -16, y: 16 },
      { x: 10, y: 0 },
    ],
    {
      fill: `${color}33`,
      stroke: color,
      strokeWidth: 2,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    }
  );

  const a1 = new fabric.Polyline(
    [
      { x: 16, y: -10 },
      { x: 30, y: -22 },
      { x: 24, y: -22 },
      { x: 32, y: -28 },
      { x: 30, y: -20 },
    ],
    {
      fill: "",
      stroke: color,
      strokeWidth: 2,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    }
  );

  const a2 = new fabric.Polyline(
    [
      { x: 10, y: -2 },
      { x: 24, y: -14 },
      { x: 18, y: -14 },
      { x: 26, y: -20 },
      { x: 24, y: -12 },
    ],
    {
      fill: "",
      stroke: color,
      strokeWidth: 2,
      originX: "center",
      originY: "center",
      selectable: false,
      evented: false,
    }
  );

  return buildGroup("LED", [
    createLine([-50, 0, -18, 0], color),
    diode,
    createLine([14, -18, 14, 18], color),
    createLine([14, 0, 50, 0], color),
    a1,
    a2,
  ], point);
}

function createGround(point) {
  const color = COMPONENT_COLORS.ground;
  return buildGroup("Ground", [
    createLine([0, -30, 0, -10], color),
    createLine([-20, -10, 20, -10], color),
    createLine([-14, -2, 14, -2], color),
    createLine([-8, 6, 8, 6], color),
  ], point);
}

function createBattery(point) {
  const color = COMPONENT_COLORS.battery;
  const plus = new fabric.Text("+", {
    left: -20,
    top: -26,
    fontSize: 12,
    fontFamily: "JetBrains Mono",
    fill: color,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
  });

  const minus = new fabric.Text("-", {
    left: 32,
    top: -17,
    fontSize: 14,
    fontFamily: "JetBrains Mono",
    fill: color,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
  });

  return buildGroup("Battery", [
    createLine([-50, 0, -22, 0], color),
    createLine([-22, -20, -22, 20], color, 3.5),
    createLine([-6, -12, -6, 12], color, 2.5),
    createLine([8, -20, 8, 20], color, 3.5),
    createLine([24, -12, 24, 12], color, 2.5),
    createLine([24, 0, 50, 0], color),
    plus,
    minus,
  ], point);
}

function createIc(point) {
  const color = COMPONENT_COLORS.ic;
  const body = new fabric.Rect({
    left: 0,
    top: 0,
    width: 62,
    height: 74,
    rx: 6,
    ry: 6,
    fill: `${color}2e`,
    stroke: color,
    strokeWidth: 2,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
  });

  const notch = new fabric.Circle({
    left: -18,
    top: -28,
    radius: 3,
    fill: color,
    originX: "center",
    originY: "center",
    selectable: false,
    evented: false,
  });

  const pins = [];
  const ys = [-26, -10, 10, 26];
  ys.forEach((y) => {
    pins.push(createLine([-46, y, -31, y], color, 2.4));
    pins.push(createLine([31, y, 46, y], color, 2.4));
  });

  return buildGroup("IC", [body, notch, ...pins], point);
}

const COMPONENT_BUILDERS = {
  resistor: createResistor,
  capacitor: createCapacitor,
  led: createLed,
  ground: createGround,
  battery: createBattery,
  ic: createIc,
};

function addComponent(name, point) {
  const key = name.toLowerCase();
  const builder = COMPONENT_BUILDERS[key];
  if (!builder) {
    setStatus(`${name} is not available`);
    return;
  }

  const centerPoint = point || { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 };
  const object = builder(centerPoint);
  canvas.add(object);
  canvas.setActiveObject(object);
  canvas.requestRenderAll();
  setStatus(`${name} added`);
}

function rotateSelection() {
  const active = canvas.getActiveObject();
  if (!active || active.customType !== "component") {
    setStatus("Select a component to rotate");
    return;
  }

  active.rotate((active.angle || 0) + ROTATION_STEP);
  keepObjectInsideCanvas(active);
  active.setCoords();
  canvas.requestRenderAll();
  setStatus("Component rotated");
}

function deleteSelection() {
  const selected = canvas.getActiveObjects();
  if (!selected.length) {
    setStatus("No object selected");
    return;
  }

  selected.forEach((obj) => canvas.remove(obj));
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  setStatus("Selection deleted");
}

function getObjectEdgePoint(target, towardPoint) {
  const bounds = target.getBoundingRect(true, true);
  const points = [
    { x: bounds.left + bounds.width / 2, y: bounds.top },
    { x: bounds.left + bounds.width, y: bounds.top + bounds.height / 2 },
    { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height },
    { x: bounds.left, y: bounds.top + bounds.height / 2 },
  ];

  let nearest = points[0];
  let best = Number.POSITIVE_INFINITY;

  points.forEach((p) => {
    const dx = p.x - towardPoint.x;
    const dy = p.y - towardPoint.y;
    const dist = dx * dx + dy * dy;
    if (dist < best) {
      best = dist;
      nearest = p;
    }
  });

  return { x: snap(nearest.x), y: snap(nearest.y) };
}

function resolveWirePoint(opt) {
  const pointer = canvas.getPointer(opt.e);
  if (opt.target && opt.target.customType === "component") {
    return getObjectEdgePoint(opt.target, pointer);
  }
  return { x: snap(pointer.x), y: snap(pointer.y) };
}

function cancelWirePreview() {
  wireStartPoint = null;
  if (wirePreview) {
    canvas.remove(wirePreview);
    wirePreview = null;
    canvas.requestRenderAll();
  }
}

function beginWire(point) {
  wireStartPoint = point;
  wirePreview = new fabric.Line([point.x, point.y, point.x, point.y], {
    stroke: "#80d5ff",
    strokeWidth: 3,
    strokeLineCap: "round",
    strokeDashArray: [6, 5],
    selectable: false,
    evented: false,
    customType: "wirePreview",
  });
  canvas.add(wirePreview);
}

function finishWire(endPoint) {
  if (!wireStartPoint || !wirePreview) {
    return;
  }

  const dx = endPoint.x - wireStartPoint.x;
  const dy = endPoint.y - wireStartPoint.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 10) {
    cancelWirePreview();
    setStatus("Wire cancelled");
    return;
  }

  wirePreview.set({
    x2: endPoint.x,
    y2: endPoint.y,
    stroke: "#55b2ff",
    strokeDashArray: null,
    selectable: true,
    evented: true,
    hasControls: false,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true,
    customType: "wire",
  });

  wirePreview.setCoords();
  wirePreview = null;
  wireStartPoint = null;
  canvas.requestRenderAll();
  setStatus("Wire created");
}

function saveJson() {
  const payload = {
    sheet: activeSheet,
    zoom: canvas.getZoom(),
    viewportTransform: canvas.viewportTransform,
    gridVisible,
    design: canvas.toDatalessJSON(["customType", "componentName", "symbolType"]),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pcb-schematic.json";
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Design saved");
}

function loadJson(content) {
  activeSheet = content.sheet || "A4";
  ui.sheetSize.value = activeSheet;
  gridVisible = content.gridVisible !== false;

  applySheetSize(activeSheet);

  canvas.loadFromJSON(content.design, () => {
    canvas.setZoom(content.zoom || 1);
    if (Array.isArray(content.viewportTransform)) {
      canvas.setViewportTransform(content.viewportTransform);
    }
    applyGridBackground();
    updateZoomState();
    canvas.requestRenderAll();
    activateTool(TOOLS.SELECT);
    setStatus("Design loaded");
  });
}

function exportPng() {
  const data = canvas.toDataURL({ format: "png", quality: 1, multiplier: 2 });
  const anchor = document.createElement("a");
  anchor.href = data;
  anchor.download = "pcb-schematic.png";
  anchor.click();
  setStatus("PNG exported");
}

function bindUI() {
  ui.toolButtons.forEach((btn) => {
    btn.addEventListener("click", () => activateTool(btn.dataset.tool));
  });

  ui.componentButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      addComponent(btn.dataset.component);
      activateTool(TOOLS.MOVE);
    });
  });

  ui.rotateBtn.addEventListener("click", rotateSelection);
  ui.gridToggleBtn.addEventListener("click", () => {
    gridVisible = !gridVisible;
    applyGridBackground();
    canvas.requestRenderAll();
    setStatus(`Grid ${gridVisible ? "enabled" : "disabled"}`);
  });

  ui.zoomInBtn.addEventListener("click", () => zoomBy(1.15));
  ui.zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.15));
  ui.fitBtn.addEventListener("click", fitToViewport);

  ui.sheetSize.addEventListener("change", () => applySheetSize(ui.sheetSize.value));

  ui.saveJsonBtn.addEventListener("click", saveJson);
  ui.loadJsonBtn.addEventListener("click", () => ui.loadJsonInput.click());
  ui.loadJsonInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const content = JSON.parse(text);
      loadJson(content);
    } catch (error) {
      console.error("Load JSON failed", error);
      setStatus("Failed to load JSON");
    }
  });

  ui.exportPngBtn.addEventListener("click", exportPng);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      spacePressed = true;
      canvas.defaultCursor = "grab";
      event.preventDefault();
    }

    if (event.key === "Delete") {
      deleteSelection();
    }

    if (event.key.toLowerCase() === "r") {
      rotateSelection();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spacePressed = false;
      isPanning = false;
      canvas.defaultCursor = activeTool === TOOLS.PAN ? "grab" : "default";
    }
  });

  window.addEventListener("resize", () => {
    keepAllInsideCanvas();
    fitToViewport();
  });
}

function bindCanvasEvents() {
  canvas.on("mouse:down", (opt) => {
    if (spacePressed || activeTool === TOOLS.PAN) {
      isPanning = true;
      panLast = { x: opt.e.clientX, y: opt.e.clientY };
      canvas.defaultCursor = "grabbing";
      return;
    }

    if (activeTool === TOOLS.DELETE) {
      if (opt.target) {
        canvas.remove(opt.target);
        canvas.requestRenderAll();
        setStatus("Object deleted");
      }
      return;
    }

    if (activeTool !== TOOLS.WIRE) {
      return;
    }

    const point = resolveWirePoint(opt);
    if (!wireStartPoint) {
      beginWire(point);
      setStatus("Wire start placed");
    } else {
      finishWire(point);
    }
  });

  canvas.on("mouse:move", (opt) => {
    if (isPanning) {
      const vpt = canvas.viewportTransform;
      vpt[4] += opt.e.clientX - panLast.x;
      vpt[5] += opt.e.clientY - panLast.y;
      panLast = { x: opt.e.clientX, y: opt.e.clientY };
      canvas.requestRenderAll();
      return;
    }

    if (activeTool === TOOLS.WIRE && wirePreview) {
      const point = resolveWirePoint(opt);
      wirePreview.set({ x2: point.x, y2: point.y });
      canvas.requestRenderAll();
    }
  });

  canvas.on("mouse:up", () => {
    if (isPanning) {
      isPanning = false;
      canvas.defaultCursor = activeTool === TOOLS.PAN || spacePressed ? "grab" : "default";
    }
  });

  canvas.on("object:moving", (opt) => {
    if (!opt.target || opt.target.customType !== "component") {
      return;
    }

    opt.target.set({
      left: snap(opt.target.left),
      top: snap(opt.target.top),
    });
    keepObjectInsideCanvas(opt.target);
  });

  canvas.on("object:scaling", (opt) => {
    if (!opt.target || opt.target.customType !== "component") {
      return;
    }
    keepObjectInsideCanvas(opt.target);
  });

  canvas.on("object:rotating", (opt) => {
    if (!opt.target || opt.target.customType !== "component") {
      return;
    }
    keepObjectInsideCanvas(opt.target);
  });

  canvas.on("object:modified", (opt) => {
    if (!opt.target || opt.target.customType !== "component") {
      return;
    }

    opt.target.set({
      left: snap(opt.target.left),
      top: snap(opt.target.top),
    });
    keepObjectInsideCanvas(opt.target);
    opt.target.setCoords();
    canvas.requestRenderAll();
  });
}

function init() {
  bindUI();
  bindCanvasEvents();
  applySheetSize(activeSheet);
  activateTool(TOOLS.SELECT);
  updateZoomState();
  setStatus("Ready");
}

init();
