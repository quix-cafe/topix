import { useRef, useEffect, useState, useMemo } from "react";
import { useHashParam } from "../hooks/useHashParam";
import * as d3 from "d3";

// Confidence-based color stops — fixed palette from 50% to 100%
const COLOR_STOPS = [
  { pct: 0.50, r: 120, g: 40,  b: 140 },  // 50% — deep purple
  { pct: 0.55, r: 140, g: 50,  b: 170 },  // 55% — purple
  { pct: 0.60, r: 155, g: 55,  b: 195 },  // 60% — bright purple
  { pct: 0.65, r: 160, g: 65,  b: 215 },  // 65% — purple-violet
  { pct: 0.70, r: 160, g: 60,  b: 210 },  // 70% — purple
  { pct: 0.75, r: 140, g: 80,  b: 230 },  // 75% — blue-purple
  { pct: 0.80, r: 100, g: 110, b: 240 },  // 80% — indigo
  { pct: 0.85, r: 70,  g: 140, b: 220 },  // 85% — blue
  { pct: 0.90, r: 50,  g: 180, b: 180 },  // 90% — teal
  { pct: 0.95, r: 50,  g: 200, b: 140 },  // 95% — teal-green
  { pct: 1.00, r: 80,  g: 210, b: 100 },  // 100% — green
];

function confidenceColor(confidence, minPct) {
  const range = 1.0 - minPct;
  const t = range > 0 ? Math.max(0, Math.min(1, (confidence - minPct) / range)) : 1;
  // Map t to the absolute color scale
  const absPct = minPct + t * range;
  let lo = COLOR_STOPS[0], hi = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (absPct >= COLOR_STOPS[i].pct && absPct <= COLOR_STOPS[i + 1].pct) {
      lo = COLOR_STOPS[i];
      hi = COLOR_STOPS[i + 1];
      break;
    }
  }
  const f = hi.pct === lo.pct ? 0 : (absPct - lo.pct) / (hi.pct - lo.pct);
  const r = Math.round(lo.r + (hi.r - lo.r) * f);
  const g = Math.round(lo.g + (hi.g - lo.g) * f);
  const b = Math.round(lo.b + (hi.b - lo.b) * f);
  return `rgb(${r},${g},${b})`;
}

export function NetworkGraph({ topics, matches }) {
  const svgRef = useRef(null);
  const [minConfidence, setMinConfidence] = useState(0.70);

  useEffect(() => {
    if (!svgRef.current || topics.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight || 500;

    const nodes = topics.map((t) => ({
      id: t.id,
      title: t.title,
      source: t.sourceFile,
      tags: t.tags,
    }));

    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = matches
      .filter((m) => nodeIds.has(m.sourceId) && nodeIds.has(m.targetId) && (m.confidence || 0) >= minConfidence)
      .map((m) => ({
        source: m.sourceId,
        target: m.targetId,
        confidence: m.confidence,
        relationship: m.relationship,
      }));

    const colorBySource = d3.scaleOrdinal(d3.schemeSet2);
    const sources = [...new Set(topics.map((t) => t.sourceFile))];

    const sim = d3
      .forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(30));

    const g = svg.append("g");

    // Zoom
    svg.call(
      d3.zoom().scaleExtent([0.2, 4]).on("zoom", (e) => g.attr("transform", e.transform))
    );

    const minPct = minConfidence;
    function linkColor(d) {
      return confidenceColor(d.confidence, minPct);
    }

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", linkColor)
      .attr("stroke-width", (d) => 1 + d.confidence * 3)
      .attr("stroke-opacity", (d) => 0.6 + d.confidence * 0.35)
      .attr("stroke-dasharray", (d) => (d.relationship === "related" ? "4,4" : null));

    const node = g
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .call(d3.drag().on("start", dragStart).on("drag", dragged).on("end", dragEnd));

    node
      .append("circle")
      .attr("r", (d) => 8 + (matches.filter((m) => m.sourceId === d.id || m.targetId === d.id).length) * 2)
      .attr("fill", (d) => colorBySource(d.source))
      .attr("stroke", "#1a1a2e")
      .attr("stroke-width", 2);

    node
      .append("text")
      .text((d) => d.title)
      .attr("dx", 14)
      .attr("dy", 4)
      .attr("fill", "#c8c8d4")
      .attr("font-size", "11px")
      .attr("font-family", "'DM Sans', sans-serif");

    node.append("title").text((d) => `${d.title}\n${d.source}`);

    sim.on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    function dragStart(event, d) {
      if (!event.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragEnd(event, d) {
      if (!event.active) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    return () => sim.stop();
  }, [topics, matches, minConfidence]);

  // Table data
  const [tableSortCol, setTableSortCol] = useHashParam("gsc", "confidence");
  const [tableSortDir, setTableSortDir] = useHashParam("gsd", "desc");
  const [filterRel, setFilterRel] = useHashParam("gr", "all");

  const topicMap = useMemo(() => {
    const m = new Map();
    for (const t of topics) m.set(t.id, t);
    return m;
  }, [topics]);

  const tableRows = useMemo(() => {
    let rows = matches
      .map((m) => {
        const src = topicMap.get(m.sourceId);
        const tgt = topicMap.get(m.targetId);
        if (!src || !tgt) return null;
        return {
          id: m.id,
          sourceTitle: src.title,
          sourceFile: src.sourceFile,
          targetTitle: tgt.title,
          targetFile: tgt.sourceFile,
          relationship: m.relationship || "unknown",
          confidence: m.confidence || 0,
          matchPercentage: m.matchPercentage || Math.round((m.confidence || 0) * 100),
          reason: m.reason || "",
        };
      })
      .filter(Boolean)
      .filter((r) => r.confidence >= minConfidence);

    if (filterRel !== "all") {
      rows = rows.filter((r) => r.relationship === filterRel);
    }

    const dir = tableSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (tableSortCol) {
        case "source": return dir * a.sourceTitle.localeCompare(b.sourceTitle);
        case "target": return dir * a.targetTitle.localeCompare(b.targetTitle);
        case "relationship": return dir * a.relationship.localeCompare(b.relationship);
        case "confidence": return dir * (a.confidence - b.confidence);
        default: return 0;
      }
    });

    return rows;
  }, [matches, topicMap, tableSortCol, tableSortDir, filterRel, minConfidence]);

  const handleTableSort = (col) => {
    if (tableSortCol === col) {
      setTableSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTableSortCol(col);
      setTableSortDir(col === "confidence" ? "desc" : "asc");
    }
  };

  const relColors = {
    same_bit: "#ff6b6b",
    evolved: "#ffa94d",
    callback: "#74c0fc",
    related: "#555",
  };

  const thStyle = (col) => ({
    padding: "10px 8px",
    textAlign: col === "source" || col === "target" ? "left" : "center",
    color: tableSortCol === col ? "#4ecdc4" : "#888",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    fontSize: "10px",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  });

  const sortArrow = (col) => {
    if (tableSortCol !== col) return "";
    return tableSortDir === "asc" ? " ▲" : " ▼";
  };

  const relCounts = useMemo(() => {
    const counts = {};
    for (const m of matches) {
      if ((m.confidence || 0) < minConfidence) continue;
      const rel = m.relationship || "unknown";
      counts[rel] = (counts[rel] || 0) + 1;
    }
    return counts;
  }, [matches, minConfidence]);

  const downloadPng = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    // Get the bounding box of all graph content (the <g> group)
    const gEl = svgEl.querySelector("g");
    if (!gEl) return;
    const bbox = gEl.getBBox();
    if (bbox.width === 0 || bbox.height === 0) return;
    const pad = 60;
    const vbX = bbox.x - pad;
    const vbY = bbox.y - pad;
    const vbW = bbox.width + pad * 2;
    const vbH = bbox.height + pad * 2;
    // Cap canvas at 4096px on longest side, scale accordingly
    const maxDim = 8192;
    const fitScale = Math.min(maxDim / vbW, maxDim / vbH, 3);
    const canvasW = Math.round(vbW * fitScale);
    const canvasH = Math.round(vbH * fitScale);
    const clone = svgEl.cloneNode(true);
    // Reset the inner <g> transform so we see the full untransformed graph
    const cloneG = clone.querySelector("g");
    if (cloneG) cloneG.removeAttribute("transform");
    clone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
    clone.setAttribute("width", canvasW);
    clone.setAttribute("height", canvasH);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // Add background rect inside SVG so it renders in the image
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", vbX);
    bgRect.setAttribute("y", vbY);
    bgRect.setAttribute("width", vbW);
    bgRect.setAttribute("height", vbH);
    bgRect.setAttribute("fill", "#0d0d1a");
    clone.insertBefore(bgRect, clone.firstChild);
    const svgString = new XMLSerializer().serializeToString(clone);
    // Use base64 data URL to avoid blob/encoding issues
    const base64 = btoa(unescape(encodeURIComponent(svgString)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      const a = document.createElement("a");
      a.download = "topix-graph.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.onerror = () => console.error("Failed to render SVG to image for PNG export");
    img.src = `data:image/svg+xml;base64,${base64}`;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          onClick={downloadPng}
          style={{
            padding: "5px 12px", background: "#1e1e30", color: "#4ecdc4",
            border: "1px solid #4ecdc444", borderRadius: 6, fontWeight: 600,
            fontSize: 11, cursor: "pointer",
          }}
        >
          Download PNG
        </button>
      </div>
      <svg
        ref={svgRef}
        style={{ width: "100%", height: "500px", background: "#0d0d1a", borderRadius: "12px" }}
      />

      {/* Confidence slider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, padding: "6px 12px", background: "#0d0d1a", borderRadius: 8, border: "1px solid #1e1e30" }}>
        <span style={{ fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>Min confidence</span>
        <input
          type="range"
          min={50}
          max={95}
          step={5}
          value={Math.round(minConfidence * 100)}
          onChange={(e) => setMinConfidence(Number(e.target.value) / 100)}
          style={{ flex: 1, accentColor: confidenceColor(minConfidence, 0.50) }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, color: confidenceColor(minConfidence, 0.50), minWidth: 36, textAlign: "right" }}>
          {Math.round(minConfidence * 100)}%
        </span>
      </div>

      {/* Match table */}
      {matches.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#ccc" }}>
              Matches ({tableRows.length}{filterRel !== "all" ? ` of ${matches.length}` : ""})
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setFilterRel("all")}
                style={{
                  padding: "4px 10px",
                  background: filterRel === "all" ? "#4ecdc4" : "#1e1e30",
                  color: filterRel === "all" ? "#000" : "#888",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                All
              </button>
              {Object.entries(relCounts).map(([rel, count]) => (
                <button
                  key={rel}
                  onClick={() => setFilterRel(filterRel === rel ? "all" : rel)}
                  style={{
                    padding: "4px 10px",
                    background: filterRel === rel ? (relColors[rel] || "#888") : "#1e1e30",
                    color: filterRel === rel ? "#000" : (relColors[rel] || "#888"),
                    border: `1px solid ${relColors[rel] || "#555"}33`,
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {rel.replace("_", " ")} ({count})
                </button>
              ))}
            </div>
          </div>

          <div style={{ maxHeight: 400, overflowY: "auto", borderRadius: 8, border: "1px solid #1e1e30" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #1e1e30", background: "#0a0a14", position: "sticky", top: 0, zIndex: 1 }}>
                  <th style={thStyle("source")} onClick={() => handleTableSort("source")}>Source{sortArrow("source")}</th>
                  <th style={thStyle("target")} onClick={() => handleTableSort("target")}>Target{sortArrow("target")}</th>
                  <th style={thStyle("relationship")} onClick={() => handleTableSort("relationship")}>Type{sortArrow("relationship")}</th>
                  <th style={thStyle("confidence")} onClick={() => handleTableSort("confidence")}>Match %{sortArrow("confidence")}</th>
                  <th style={{ ...thStyle("reason"), cursor: "default" }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #1a1a2a" }}>
                    <td style={{ padding: "8px", color: "#ddd" }}>
                      <div style={{ fontWeight: 500 }}>{row.sourceTitle}</div>
                      <div style={{ fontSize: 9, color: "#666" }}>{row.sourceFile}</div>
                    </td>
                    <td style={{ padding: "8px", color: "#ddd" }}>
                      <div style={{ fontWeight: 500 }}>{row.targetTitle}</div>
                      <div style={{ fontSize: 9, color: "#666" }}>{row.targetFile}</div>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <span style={{
                        color: relColors[row.relationship] || "#888",
                        fontWeight: 600,
                        fontSize: 11,
                      }}>
                        {row.relationship.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", fontWeight: 700, color: confidenceColor(row.confidence, minConfidence) }}>
                      {row.matchPercentage}%
                    </td>
                    <td style={{ padding: "8px", color: "#888", fontSize: 11, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.reason}>
                      {row.reason || "-"}
                    </td>
                  </tr>
                ))}
                {tableRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#555" }}>
                      No matches{filterRel !== "all" ? ` of type "${filterRel}"` : ""}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
