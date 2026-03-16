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

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => {
        const rel = d.relationship;
        if (rel === "same_bit") return "#ff6b6b";
        if (rel === "evolved") return "#ffa94d";
        if (rel === "callback") return "#74c0fc";
        return "#555";
      })
      .attr("stroke-width", (d) => 1 + d.confidence * 3)
      .attr("stroke-opacity", 0.6)
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

    // Legend
    const legend = svg.append("g").attr("transform", `translate(16, ${height - 100})`);
    const legendData = [
      { label: "Same bit", color: "#ff6b6b", dash: null },
      { label: "Evolved", color: "#ffa94d", dash: null },
      { label: "Callback", color: "#74c0fc", dash: null },
      { label: "Related", color: "#555", dash: "4,4" },
    ];
    legendData.forEach((d, i) => {
      const row = legend.append("g").attr("transform", `translate(0, ${i * 20})`);
      row.append("line").attr("x1", 0).attr("x2", 24).attr("y", 0)
        .attr("stroke", d.color).attr("stroke-width", 2)
        .attr("stroke-dasharray", d.dash);
      row.append("text").attr("x", 30).attr("y", 4)
        .attr("fill", "#888").attr("font-size", "10px").text(d.label);
    });

    // Source legend
    const srcLeg = svg.append("g").attr("transform", "translate(16, 20)");
    sources.forEach((s, i) => {
      const row = srcLeg.append("g").attr("transform", `translate(0, ${i * 20})`);
      row.append("circle").attr("r", 6).attr("fill", colorBySource(s));
      row.append("text").attr("x", 14).attr("y", 4)
        .attr("fill", "#888").attr("font-size", "10px").text(s);
    });

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

  return (
    <div>
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
