import { useRef, useEffect, useState, useMemo } from "react";
import * as d3 from "d3";

export function NetworkGraph({ topics, matches }) {
  const svgRef = useRef(null);

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

    // Only include links where both endpoints exist in the node set
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = matches
      .filter((m) => nodeIds.has(m.sourceId) && nodeIds.has(m.targetId))
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

    // Confidence-based color gradient (mapped to 0.5–1.0 visible range):
    //   1.0  = neon cyan-blue   (highest)
    //   0.9  = purple
    //   0.8  = red
    //   0.7  = orange
    //   0.6  = yellow
    //   0.5  = green            (lowest shown)
    const colorStops = [
      { t: 0.0, r: 60, g: 210, b: 90  },  // green
      { t: 0.2, r: 230, g: 220, b: 50 },   // yellow
      { t: 0.4, r: 255, g: 150, b: 50 },   // orange
      { t: 0.6, r: 240, g: 60,  b: 70 },   // red
      { t: 0.8, r: 180, g: 80,  b: 240 },  // purple
      { t: 1.0, r: 50,  g: 220, b: 255 },  // neon cyan-blue
    ];

    function linkColor(d) {
      // Map confidence 0.5–1.0 → 0–1 for maximum contrast in the visible range
      const t = Math.max(0, Math.min(1, (d.confidence - 0.5) * 2));
      // Find surrounding stops
      let lo = colorStops[0], hi = colorStops[colorStops.length - 1];
      for (let i = 0; i < colorStops.length - 1; i++) {
        if (t >= colorStops[i].t && t <= colorStops[i + 1].t) {
          lo = colorStops[i];
          hi = colorStops[i + 1];
          break;
        }
      }
      const f = hi.t === lo.t ? 0 : (t - lo.t) / (hi.t - lo.t);
      const r = Math.round(lo.r + (hi.r - lo.r) * f);
      const g = Math.round(lo.g + (hi.g - lo.g) * f);
      const b = Math.round(lo.b + (hi.b - lo.b) * f);
      return `rgb(${r},${g},${b})`;
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
  }, [topics, matches]);

  // Table data
  const [tableSortCol, setTableSortCol] = useState("confidence");
  const [tableSortDir, setTableSortDir] = useState("desc");
  const [filterRel, setFilterRel] = useState("all");

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
      .filter(Boolean);

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
  }, [matches, topicMap, tableSortCol, tableSortDir, filterRel]);

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
      const rel = m.relationship || "unknown";
      counts[rel] = (counts[rel] || 0) + 1;
    }
    return counts;
  }, [matches]);

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
                    <td style={{ padding: "8px", textAlign: "center", fontWeight: 700, color: row.matchPercentage >= 85 ? "#51cf66" : row.matchPercentage >= 70 ? "#ffa94d" : "#ff6b6b" }}>
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
