import p5 from "p5";
import { state, screenToWorld } from "./state.js";
import { drawGate, drawWaypoint, drawWire, drawPortTooltip, setFont, drawDynamicGrid, drawGhostPath, drawBus, drawGhostBus } from "./render/draw.js";
import { registerMouseHandlers, isNearWaypoint, isNearPort, busMap, nodeMap } from "./input/mouseHandlers.js";
import { initToolbar } from "./ui/toolbar.js";
import { getActiveTheme, applyTheme } from "./render/theme.js";
import { CircuitBuilder } from "./logic/CircuitBuilder.js";
import { snapPointToGrid, wouldBusOverlap, wouldOverlap } from "./render/RenderPoint.js";
import { registerKeyboardHandlers } from "./input/keyboardHandlers.js";
import { drawMinimap } from "./render/minimap.js";
import { getOctilinearSnap } from "./render/wireGeometry.js";

applyTheme(getActiveTheme());

// hii kuchu puchu

let mouse = { x: 0, y: 0 };

const canvasHost = document.querySelector(".canvas-host");
const WIDTH = canvasHost.clientWidth;
const HEIGHT = canvasHost.clientHeight;

let renderNodes = [];
let wires = [];
let busNodes = [];
let circuit = new CircuitBuilder();

// ── Port tooltip hover state ──────────────────────────────────
// Tracks the currently hovered port for smooth fade-in/out animation
let tooltipState = {
  active: false,        // is a port currently hovered?
  label: "",            // gate.label || gate.type
  port: { x: 0, y: 0 }, // port position
  opacity: 0,           // animation progress 0 → 1
  portType: "",         // input port || output port
};
const TOOLTIP_FADE_SPEED = 6; // units per second (reaches 1.0 in ~167ms)

const sketch = (p) => {
  p.setup = function () {
    const cnv = p.createCanvas(WIDTH, HEIGHT);
    cnv.parent(canvasHost);
    const toolbarActions = initToolbar(p, circuit, renderNodes, wires, busNodes);

    registerMouseHandlers(p, circuit, renderNodes, wires, busNodes);
    registerKeyboardHandlers(p, circuit, renderNodes, wires, toolbarActions);

    const theme = getActiveTheme();    
  }

  p.draw = function () {
    const world = screenToWorld(p.mouseX, p.mouseY);
    mouse.x = world.x;
    mouse.y = world.y;
    const theme = getActiveTheme();
    p.background(theme.canvas.bg.hex);

    drawDynamicGrid(p, theme, state.cameraX, state.cameraY, state.zoom);
    p.translate(state.cameraX, state.cameraY);
    p.scale(state.zoom);

    setFont(theme, p);
    for (let i = 0; i < renderNodes.length; i++) {
      let nodeStatus = null;
      if (state.dragging && renderNodes[i] === state.dragging) {
        // Actively dragging — show overlap feedback
        nodeStatus = wouldOverlap(state.dragging, renderNodes, busNodes, state.dragging.gate.id)
          ? "invalid"
          : "selected";
      } else if (state.selectedNode && renderNodes[i] === state.selectedNode) {
        // Persistently selected (not being dragged)
        nodeStatus = "selected";
      }
      drawGate(renderNodes[i], p, nodeStatus);
    }

    for (let i = 0; i < busNodes.length; i++) {
      drawBus(busNodes[i], p);
    }

    // ── Detect hovered port for tooltip ──────────────────────
    let hoveredPort = null;
    let hoveredLabel = "";
    let portType = "";
    for (let i = 0; i < renderNodes.length; i++) {
      const gate = renderNodes[i].gate;
      const totalInputs = gate.inputCount;
      const totalOutputs = gate.outputCount;

      if (totalInputs !== 0) {
        for (let j = 0; j < totalInputs; j++) {
          const port = renderNodes[i].getInputPortByIndex(j, totalInputs);
          if (isNearPort(mouse.x, mouse.y, port)) {
            hoveredPort = port;
            if (
              gate.type === "composite" &&
              gate.internalInputs &&
              gate.internalInputs[j] &&
              gate.internalInputs[j].label
            ) {
              hoveredLabel = gate.internalInputs[j].label;
            } else if ( gate.type === "Tri-state Buffer" ) {
              if (j === 0) hoveredLabel = "enable";
              else if (j === 1) hoveredLabel = "data";
              else hoveredLabel = "in";
            } else {
              hoveredLabel = "in";
            }
            portType = "input";
          }
        }
      }

      if (totalOutputs !== 0) {
        for (let j = 0; j < totalOutputs; j++) {
          const port = renderNodes[i].getOutputPortByIndex(j, totalOutputs);
          if (isNearPort(mouse.x, mouse.y, port)) {
            hoveredPort = port;
            if (
              gate.type === "composite" &&
              gate.internalOutputs &&
              gate.internalOutputs[j] &&
              gate.internalOutputs[j].label
            ) {
              hoveredLabel = gate.internalOutputs[j].label;
            } else {
              hoveredLabel = "out";
            }
            portType = "output";
          }
        }
      }
    }

    // Update tooltip animation state
    const dt = p.deltaTime / 1000; // seconds
    if (hoveredPort) {
      tooltipState.active = true;
      tooltipState.label = hoveredLabel;
      tooltipState.port = hoveredPort;
      tooltipState.portType = portType;
      tooltipState.opacity = Math.min(1, tooltipState.opacity + TOOLTIP_FADE_SPEED * dt);
    } else {
      tooltipState.opacity = Math.max(0, tooltipState.opacity - TOOLTIP_FADE_SPEED * dt);
      if (tooltipState.opacity <= 0) {
        tooltipState.active = false;
      }
    }

    for (let i = 0; i < wires.length; i++) {
      drawWire(wires[i], nodeMap, busMap, p);
      if (state.mode === "edit") {
        for (const waypoint of wires[i].waypoints) {
          if (isNearWaypoint(mouse.x, mouse.y, waypoint)) {
            drawWaypoint(wires[i], waypoint, p);
          }
        }
      }
    }
    if (state.ghostNode) {
      let status = wouldOverlap(state.ghostNode, renderNodes, busNodes, null) ? "invalid" : "valid";
      drawGate(state.ghostNode, p, status);
      if (state.mode === "placing") {
        const { x: worldMouseX, y: worldMouseY } = screenToWorld(p.mouseX, p.mouseY);
        const { x, y } = snapPointToGrid(worldMouseX, worldMouseY);
        state.ghostNode.x = x;
        state.ghostNode.y = y;
      }
    }
    if (state.ghostBus) {
      let status = wouldBusOverlap(state.ghostBus, renderNodes, busNodes) ? "invalid" : "valid";
      drawGhostBus(state.ghostBus, p, status);
      if (state.mode === "placing") {
        const { x, y } = screenToWorld(p.mouseX, p.mouseY);
        if (!state.ghostBus.startPointPlaced && !state.ghostBus.endPointPlaced) {
          state.ghostBus.startPoint.x = state.ghostBus.endPoint.x = x;
          state.ghostBus.startPoint.y = state.ghostBus.endPoint.y = y;
        } else if (state.ghostBus.startPointPlaced && !state.ghostBus.endPointPlaced) {
          const useSnap = p.keyIsDown(p.SHIFT);
          
          const x1 = state.ghostBus.waypoints && state.ghostBus.waypoints.length !== 0
            ? state.ghostBus.waypoints[state.ghostBus.waypoints.length - 1].x
            : state.ghostBus.startPoint.x;
          
          const y1 = state.ghostBus.waypoints && state.ghostBus.waypoints.length !== 0
            ? state.ghostBus.waypoints[state.ghostBus.waypoints.length - 1].y
            : state.ghostBus.startPoint.y;

          state.ghostBus.endPoint.x = useSnap ? getOctilinearSnap(x1, y1, x, y).x : x;
          state.ghostBus.endPoint.y = useSnap ? getOctilinearSnap(x1, y1, x, y).y : y;
        }
      }
    }
    if (state.drawingWire) {
      const connection = state.drawingWire.connection;
      if (state.drawingWire.originType === "gate") {

        const outputIndex = connection.fromOutputIndex;
        const totalOutputs = connection.fromNode.gate.outputCount;

        const startPort = outputIndex !== null
          ? connection.fromNode.getOutputPortByIndex(outputIndex, totalOutputs)
          : connection.fromNode.getOutputPort();
        
        if (state.ghostWire?.length) {
          drawGhostPath(startPort, state.ghostWire, mouse, p);
        } else {
          drawGhostPath(startPort, null, mouse, p);
        }
      } else if (state.drawingWire.originType === "bus") {
        const startPoint = connection.busNode.getTapPoint(connection.tapRef);
        
        if (state.ghostWire?.length) {
          drawGhostPath(startPoint, state.ghostWire, mouse, p);
        } else {
          drawGhostPath(startPoint, null, mouse, p);
        }
      }
    }

    // ── Draw tooltip last so it renders on top of everything ──
    if (tooltipState.active && tooltipState.opacity > 0) {
      drawPortTooltip(tooltipState.label, tooltipState.port, tooltipState.opacity, tooltipState.portType, p);
    }

    // TODO: Render buses in the minimap
    drawMinimap(p, renderNodes, busNodes, state);
  }
}

new p5(sketch);
