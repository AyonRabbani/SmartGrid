import React, { useState, useRef, useEffect } from "react";
import "./GridView.css";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";

export default function GridView() {
  /********************************/
  /*   VIEWPORT-BASED GRID SIZE   */
  /********************************/
  const BUFFER = 3;
  const CELL_HEIGHT = 28; // keep in sync with CSS
  const CELL_WIDTH = 120; // keep in sync with CSS

  // How many rows/cols roughly fit on screen
  const visibleRows = Math.ceil(window.innerHeight / CELL_HEIGHT);
  const visibleCols = Math.ceil(window.innerWidth / CELL_WIDTH);

  const initialRows = visibleRows + BUFFER;
  const initialCols = visibleCols + BUFFER;

  // Dynamic row/column counts (grow on scroll)
  const [rows, setRows] = useState(initialRows);
  const [cols, setCols] = useState(initialCols);

  /********************************/
  /*          CORE STATE          */
  /********************************/
  const [grid, setGrid] = useState(
    Array.from({ length: initialRows }, () =>
      Array.from({ length: initialCols }, () => ({ raw: "", value: "" }))
    )
  );

  const [clipboard, setClipboard] = useState(null);

  const dependencies = useRef({});
  const cellRefs = useRef({});
  const gridRef = useRef(null);

  const [editing, setEditing] = useState(null);

  // Selection state
  const [selection, setSelection] = useState(null);
  const [startSelectionCell, setStartSelectionCell] = useState(null);
  const [endSelectionCell, setEndSelectionCell] = useState(null);
  const [selectionArea, setSelectionArea] = useState(null);

  const [selectedCSS, setSelectedCSS] = useState(
    Array.from({ length: initialRows }, () =>
      Array.from({ length: initialCols }, () => null)
    )
  );

  const [outlineBox, setOutlineBox] = useState(null);
  const [hover, setHover] = useState(null);

  const [formulaMode, setFormulaMode] = useState(false);
  const [pickMode, setPickMode] = useState(false);

  const [activeTickers, setActiveTickers] = useState([]);

  const [panels, setPanels] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  // Example: [{ id: "TICKERS", title: "Tickers", component: <TickerPanel /> }]
  const [activePanel, setActivePanel] = useState(null);
  // Resizable panel height
  const [panelHeight, setPanelHeight] = useState(320); // default height
  const resizing = useRef(false);

  /********************************/
  /*        TICKER FUNCTIONS      */
  /********************************/
  function detectTicker(cellRaw) {
    const direct = /^[A-Z]{1,5}$/;
    const func = /^=Ticker\(([A-Z]{1,5})\)$/;
    if (direct.test(cellRaw)) return cellRaw;
    const match = cellRaw.match(func);
    if (match) return match[1];
    return null;
  }

  /********************************/
  /*     FORMULA EVALUATION       */
  /********************************/
  function evaluateFormula(text) {
    if (!text.startsWith("=")) return "#ERROR";

    if (text.startsWith("=TICKER")) {
      const tickerFormulaExpr = text
        .replace("=TICKER", "")
        .replace("(", "")
        .replace(")", "");
      return tickerFormulaExpr;
    }

    const expr = text.slice(1).trim();
    if (expr === "") return "";

    try {
      const result = new Function(`return (${expr})`)();
      return typeof result === "number" && !isNaN(result)
        ? `${result}`
        : "#ERROR";
    } catch (err) {
      console.log("Formula eval error:", err);
      return "#ERROR";
    }
  }

  function revaluate(rowIndex, cellIndex) {
    setGrid((prevGrid) => {
      const gridCopy = prevGrid.map((row) => [...row]);
      const cellCopy = { ...gridCopy[rowIndex][cellIndex] };

      const depFormulaRaw = gridCopy[rowIndex][cellIndex].raw;
      const depFormula = substituteRefs(depFormulaRaw, gridCopy);
      const newResult = evaluateFormula(depFormula);

      cellCopy.value = newResult;
      gridCopy[rowIndex][cellIndex] = cellCopy;
      return gridCopy;
    });
  }

  /********************************/
  /*  CELL REFS & DEPENDENCIES    */
  /********************************/
  function extractReferences(expr) {
    const refPattern = /([A-Z]+)(\d+)/g;
    let match;
    const refs = [];
    while ((match = refPattern.exec(expr)) !== null) refs.push(match[0]);
    return refs;
  }

  function makeCellRef(r, c) {
    let col = "";
    let n = c + 1;
    while (n > 0) {
      const rem = (n - 1) % 26;
      col = String.fromCharCode(65 + rem) + col;
      n = Math.floor((n - 1) / 26);
    }
    return col + (r + 1);
  }

  function reverseCellRef(ref) {
    const match = ref.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    const [, colLetters, rowNumber] = match;

    let colIndex = 0;
    for (let i = 0; i < colLetters.length; i++)
      colIndex = colIndex * 26 + (colLetters.charCodeAt(i) - 64);
    colIndex -= 1;

    const rowIndex = parseInt(rowNumber, 10) - 1;
    return { r: rowIndex, c: colIndex };
  }

  function insertCellReference(rowIndex, cellIndex) {
    if (!editing) return;
    const ref = makeCellRef(rowIndex, cellIndex);

    setGrid((prevGrid) => {
      const gridCopy = prevGrid.map((row) => [...row]);
      const cellCopy = { ...gridCopy[editing.rowIndex][editing.cellIndex] };
      cellCopy.raw = (cellCopy.raw || "") + ref;
      gridCopy[editing.rowIndex][editing.cellIndex] = cellCopy;
      return gridCopy;
    });
  }

  function registerDependencies(expr) {
    const refs = extractReferences(expr);
    const cellOwnRef = makeCellRef(editing.rowIndex, editing.cellIndex);
    refs.forEach((ref) => {
      if (!dependencies.current[ref]) dependencies.current[ref] = [];
      dependencies.current[ref].push(cellOwnRef);
    });
  }

  function unRegisterDependencies(rowIndex, cellIndex) {
    const currRef = makeCellRef(rowIndex, cellIndex);
    Object.keys(dependencies.current).forEach((ref) => {
      dependencies.current[ref] = dependencies.current[ref].filter(
        (dep) => dep !== currRef
      );
      if (dependencies.current[ref].length === 0)
        delete dependencies.current[ref];
    });
  }

  function updateDependencies(rowIndex, cellIndex, visited = new Set()) {
    const cellRef = makeCellRef(rowIndex, cellIndex);

    if (visited.has(cellRef)) {
      setGrid((prevGrid) => {
        const gridCopy = prevGrid.map((row) => [...row]);
        const cellCopy = { ...gridCopy[rowIndex][cellIndex] };
        cellCopy.value = "#CIRCULAR_REF";
        gridCopy[rowIndex][cellIndex] = cellCopy;
        return gridCopy;
      });
      return;
    }

    visited.add(cellRef);

    if (!dependencies.current[cellRef]) return;

    dependencies.current[cellRef].forEach((depRef) => {
      const { r, c } = reverseCellRef(depRef);
      revaluate(r, c);
      if (dependencies.current[depRef]) updateDependencies(r, c, visited);
    });
  }

  function substituteRefs(expr, gridSnapshot) {
    const refs = extractReferences(expr);
    let substituted = expr;

    refs.forEach((ref) => {
      const pos = reverseCellRef(ref);
      let value;
      if (!pos) {
        value = "#INVALID_REF";
      } else {
        const { r, c } = pos;
        try {
          value =
            parseFloat(gridSnapshot[r][c].value) || gridSnapshot[r][c].value;
        } catch (err) {
          value = "#INVALID_GRID_LOCATION";
        }
      }
      substituted = substituted.replace(ref, value);
    });

    return substituted;
  }

  /********************************/
  /*      EDIT / CHANGE FLOW      */
  /********************************/
  function commitFormulaEdits() {
    if (!editing) return;

    if (!formulaMode) {
      updateDependencies(editing.rowIndex, editing.cellIndex);
      setPickMode(false);
      return;
    }

    const expr = grid[editing.rowIndex][editing.cellIndex].raw;
    const formula = substituteRefs(expr, grid);

    if (typeof formula === "string" && formula.length !== 0) {
      unRegisterDependencies(editing.rowIndex, editing.cellIndex);
      registerDependencies(expr);

      setGrid((prevGrid) => {
        const gridCopy = prevGrid.map((row) => [...row]);
        const cellCopy = { ...gridCopy[editing.rowIndex][editing.cellIndex] };

        let result;
        try {
          result = evaluateFormula(formula);
        } catch (err) {
          console.log("Evaluation error", err);
          result = "INVALID FORMULA ERROR";
        }

        cellCopy.value = result;
        gridCopy[editing.rowIndex][editing.cellIndex] = cellCopy;
        return gridCopy;
      });
    }

    setFormulaMode(false);
    setPickMode(false);
    setEditing(null);
  }

  function handleOnChange(event, rowIndex, cellIndex) {
    const newText = event.target.value;
    unRegisterDependencies(rowIndex, cellIndex);

    setGrid((prevGrid) => {
      const gridCopy = prevGrid.map((row) => [...row]);
      const cellCopy = { ...gridCopy[rowIndex][cellIndex] };

      const isFormula = newText.startsWith("=");
      cellCopy.raw = newText;

      if (isFormula) {
        setFormulaMode(true);
      } else {
        setFormulaMode(false);
        cellCopy.value = newText;
      }

      gridCopy[rowIndex][cellIndex] = cellCopy;
      return gridCopy;
    });
  }

  /********************************/
  /*     SELECTION / HIGHLIGHT    */
  /********************************/
  function storeSelectionArea() {
    if (!startSelectionCell || !endSelectionCell) return;

    const minRow = Math.min(
      startSelectionCell.rowIndex,
      endSelectionCell.rowIndex
    );
    const maxRow = Math.max(
      startSelectionCell.rowIndex,
      endSelectionCell.rowIndex
    );
    const minCell = Math.min(
      startSelectionCell.cellIndex,
      endSelectionCell.cellIndex
    );
    const maxCell = Math.max(
      startSelectionCell.cellIndex,
      endSelectionCell.cellIndex
    );

    setSelectionArea({ minRow, maxRow, minCell, maxCell });
  }

  useEffect(() => {
    console.log("Selection Area triggered: ", selectionArea);
    if (selectionArea) {
      const startEl =
        cellRefs.current[`${selectionArea.minRow}-${selectionArea.minCell}`];
      const endEl =
        cellRefs.current[`${selectionArea.maxRow}-${selectionArea.maxCell}`];
      if (!startEl || !endEl || !gridRef.current) return;

      const startRect = startEl.getBoundingClientRect();
      const endRect = endEl.getBoundingClientRect();

      const gridRect = gridRef.current.getBoundingClientRect();
      const { scrollTop, scrollLeft } = gridRef.current;

      setSelectedCSS((prevGridCSS) => {
        const updatedGridCSS = prevGridCSS.map((row, rowIndex) =>
          row.map((_, cellIndex) =>
            rowIndex >= selectionArea.minRow &&
            rowIndex <= selectionArea.maxRow &&
            cellIndex >= selectionArea.minCell &&
            cellIndex <= selectionArea.maxCell
              ? true
              : null
          )
        );

        setOutlineBox({
          top: startRect.top - gridRect.top + scrollTop,
          left: startRect.left - gridRect.left + scrollLeft,
          width: endRect.right - startRect.left - 3,
          height: endRect.bottom - startRect.top - 3,
        });

        return updatedGridCSS;
      });
    } else {
      setOutlineBox(null);
      setSelectedCSS((prevGridCSS) =>
        prevGridCSS.map((row) => row.map(() => null))
      );
    }
  }, [selectionArea]);

  /********************************/
  /*        TICKER SCANNING       */
  /********************************/
  useEffect(() => {
    async function checkTickers() {
      const tickersSet = new Set();
      const potentialTickers = [];

      grid.forEach((row) => {
        row.forEach((col) => {
          const tickerInCell = detectTicker(col.value);
          if (tickerInCell) potentialTickers.push(tickerInCell);
        });
      });

      if (potentialTickers.length === 0) {
        setActiveTickers([]);
        return;
      }

      const results = await Promise.all(
        potentialTickers.map(async (t) => {
          try {
            const res = await fetch(
              `https://api.massive.com/v3/reference/tickers/${t}?apiKey=ANeN7iKkqpD0bW2RcI_2xWVbNljnDCZ5`
            );
            return res.ok ? t : null;
          } catch (err) {
            return null;
          }
        })
      );

      results.forEach((t) => {
        if (t) tickersSet.add(t);
      });

      setActiveTickers([...tickersSet]);
    }

    checkTickers();
  }, [grid]);

  /********************************/
  /*        SCROLL HANDLING       */
  /********************************/
  useEffect(() => {
    const el = gridRef.current;
    console.log("Scroll Element: ", el);
    if (!el) return;

    function handleScroll() {
      const {
        scrollTop,
        scrollLeft,
        scrollHeight,
        scrollWidth,
        clientHeight,
        clientWidth,
      } = el;

      if (scrollHeight - (scrollTop + clientHeight) < 100)
        setRows((r) => r + 5);
      if (scrollWidth - (scrollLeft + clientWidth) < 200) setCols((c) => c + 3);
    }

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  /********************************/
  /*  EXTEND GRID WHEN SIZE GROWS */
  /********************************/
  useEffect(() => {
    // Expand CSS selection mask
    setSelectedCSS((prev) => {
      const newCSS = prev.map((row) => [...row]);
      while (newCSS.length < rows)
        newCSS.push(Array.from({ length: cols }, () => null));

      for (let r = 0; r < newCSS.length; r++) {
        while (newCSS[r].length < cols) newCSS[r].push(null);
      }

      return newCSS;
    });

    // Expand grid when rows/cols increase
    setGrid((prev) => {
      const newGrid = prev.map((row) => [...row]);

      // Add rows
      while (newGrid.length < rows)
        newGrid.push(
          Array.from({ length: cols }, () => ({ raw: "", value: "" }))
        );

      // Extend columns
      for (let r = 0; r < newGrid.length; r++) {
        while (newGrid[r].length < cols)
          newGrid[r].push({ raw: "", value: "" });
      }

      return newGrid;
    });
  }, [rows, cols]);

  /********************************/
  /*        COPY + PASTE          */
  /********************************/
  function handleKeyCommands(e) {
    const isCtrlC = e.ctrlKey && e.key === "c";
    const isMetaC = e.metaKey && e.key == "c";

    const isCtrlV = e.ctrlKey && e.key === "v";
    const isMetaV = e.metaKey && e.key == "v";

    if (isCtrlC || isMetaC) {
      e.preventDefault();
      console.log("Copied selection area: ", selectionArea);
      setClipboard(selectionArea);
    }

    if (isCtrlV || isMetaV) {
      e.preventDefault();
      console.log("Paste selection from cell area: ", clipboard);
      // console.log("Starting at cell: ", editing.rowIndex, editing.cellIndex); // if selected and pasted onto same cell, this fails because editing is null
      setGrid((prevGrid) => {
        const gridCopy = prevGrid.map((row) => [...row]);
        const xDist = clipboard.maxCell - clipboard.minCell;
        const yDist = clipboard.maxRow - clipboard.minRow;
        const rowOffset = editing.rowIndex - clipboard.minRow;
        const cellOffset = editing.cellIndex - clipboard.minCell;

        let copyCell;

        for (
          let r = 0, rC = clipboard.minRow;
          r <= xDist, rC <= clipboard.maxRow;
          r++, rC++
        ) {
          for (
            let c = 0, cC = clipboard.minCell;
            c <= yDist, cC <= clipboard.maxCell;
            c++, cC++
          ) {
            copyCell = { ...gridCopy[rC][cC] }; // direct paste of cell values
            const isFormula = copyCell.raw.startsWith("=") ? true : null;
            if (copyCell.raw.startsWith("=")) {
              copyCell.raw = copyCell.raw.replace(
                /([A-Z]+)(\d+)/g,
                (match, colLetters, rowDigits) => {
                  const pos = reverseCellRef(match);
                  if (!pos) return match;

                  const newR = pos.r + rowOffset;
                  const newC = pos.c + cellOffset;

                  if (newR < 0 || newC < 0) return "#REF!";

                  return makeCellRef(newR, newC);
                }
              );
            }
            gridCopy[editing.rowIndex + r][editing.cellIndex + c] = copyCell;
          }
        }
        return gridCopy;
      });
    }
  }

  /********************************/
  // PANEL FUNCTIONS
  /********************************/
  function openPanel(id, title) {
    setPanels((prev) => {
      if (prev.some((p) => p.id === id)) {
        setActivePanel(id);
        return prev;
      }
      return [...prev, { id, title }];
    });
    setActivePanel(id);
  }

  function closePanel(id) {
    setPanels((prev) => prev.filter((p) => p.id !== id));
    setActivePanel((prev) => (prev === id ? null : prev));
  }

  useEffect(() => {
    if (activeTickers.length > 0) {
      openPanel("TICKER_PANEL", "Tickers");
    }
  }, [activeTickers]);

  /********************************/
  /*       PANEL RESIZE LOGIC     */
  /********************************/
  function startResize(e) {
    e.preventDefault();
    resizing.current = true;
  }

  useEffect(() => {
    function onMouseMove(e) {
      if (!resizing.current) return;

      const newHeight = window.innerHeight - e.clientY;
      if (newHeight > 80 && newHeight < window.innerHeight - 100) {
        setPanelHeight(newHeight);
      }
    }

    function onMouseUp() {
      resizing.current = false;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  /********************************/
  /*            RENDER            */
  /********************************/
  return (
    <div className="grid-container">
      {/* <TickerGrid tickers={activeTickers} /> */}
      <div className="grid-wrapper" ref={gridRef}>
        <div
          className="grid-spreadsheet"
          style={{
            display: "grid",
            gridTemplateColumns: `60px repeat(${cols}, ${CELL_WIDTH}px)`,
            gridTemplateRows: `32px repeat(${rows}, ${CELL_HEIGHT}px)`,
          }}
          onKeyDown={(e) => {
            handleKeyCommands(e);
          }}
        >
          {/* Top header row: corner + column headers */}
          {Array.from({ length: cols + 1 }, (_, col) => (
            <div key={`col-header-${col}`} className="grid-col-header">
              {/* blank top-left cell */}
              {col === 0 ? "" : col - 1}
            </div>
          ))}

          {/* Data rows: row header + cells */}
          {Array.from({ length: rows }, (_, rowIndex) => (
            <React.Fragment key={`row-${rowIndex}`}>
              <div className="grid-row-header">{rowIndex + 1}</div>
              {Array.from({ length: cols }, (_, cellIndex) => {
                const isDraggingOver =
                  selection &&
                  startSelectionCell &&
                  endSelectionCell &&
                  rowIndex >=
                    Math.min(
                      startSelectionCell.rowIndex,
                      endSelectionCell.rowIndex
                    ) &&
                  rowIndex <=
                    Math.max(
                      startSelectionCell.rowIndex,
                      endSelectionCell.rowIndex
                    ) &&
                  cellIndex >=
                    Math.min(
                      startSelectionCell.cellIndex,
                      endSelectionCell.cellIndex
                    ) &&
                  cellIndex <=
                    Math.max(
                      startSelectionCell.cellIndex,
                      endSelectionCell.cellIndex
                    );

                const safeRow = grid[rowIndex] || [];
                const cell = safeRow[cellIndex] || { raw: "", value: "" };

                return (
                  <div
                    key={`${rowIndex}-${cellIndex}`}
                    ref={(el) =>
                      (cellRefs.current[`${rowIndex}-${cellIndex}`] = el)
                    }
                    className={
                      "grid-cell " +
                      (hover?.row === rowIndex ? "cross-row " : "") +
                      (hover?.col === cellIndex ? "cross-col " : "") +
                      (hover?.row === rowIndex && hover?.col === cellIndex
                        ? "cross-focus "
                        : "") +
                      (selectedCSS[rowIndex] && selectedCSS[rowIndex][cellIndex]
                        ? "selected-cell "
                        : "") +
                      (pickMode &&
                      editing &&
                      editing.rowIndex === rowIndex &&
                      editing.cellIndex === cellIndex
                        ? "formula-pick-active "
                        : "")
                    }
                    style={{
                      backgroundColor: isDraggingOver
                        ? "rgba(40,63,43,1)"
                        : undefined,
                    }}
                    onMouseDown={(e) => {
                      // 1) Dedicated pick mode (F2)
                      if (pickMode && editing) {
                        e.preventDefault();
                        insertCellReference(rowIndex, cellIndex);
                        return;
                      }

                      // 2) Hybrid behavior: if currently editing a formula,
                      //    clicking another cell inserts its reference
                      if (editing && formulaMode) {
                        e.preventDefault(); // keep focus in the formula cell
                        insertCellReference(rowIndex, cellIndex);
                        return;
                      }

                      // 3) Normal selection behavior
                      setSelection(true);
                      if (selectionArea) setSelectionArea(null);
                      setStartSelectionCell({ rowIndex, cellIndex });
                    }}
                    onMouseUp={() => {
                      console.log("Selection on mouse up: ", selection);
                      if (selection && endSelectionCell) storeSelectionArea();
                      if (selection && !endSelectionCell) {
                        setEndSelectionCell({ rowIndex, cellIndex });
                        setSelectionArea({
                          minRow: startSelectionCell.rowIndex,
                          maxRow: endSelectionCell?.rowIndex || rowIndex,
                          minCell: startSelectionCell.cellIndex,
                          maxCell: endSelectionCell?.cellIndex || cellIndex,
                        });
                      }
                      setSelection(null);
                      setStartSelectionCell(null);
                      setEndSelectionCell(null);
                    }}
                    onMouseEnter={() => {
                      if (selection) {
                        setEditing(null);
                        setEndSelectionCell({ rowIndex, cellIndex });
                      }
                      setHover({ row: rowIndex, col: cellIndex });
                    }}
                    onMouseLeave={() => setHover(null)}
                  >
                    <input
                      value={
                        editing &&
                        editing.rowIndex === rowIndex &&
                        editing.cellIndex === cellIndex
                          ? cell.raw
                          : cell.value
                      }
                      onFocus={() => {
                        setEditing({ rowIndex, cellIndex });
                        const raw = grid[rowIndex][cellIndex].raw || "";
                        setFormulaMode(raw.startsWith("="));
                        setPickMode(false);
                      }}
                      onBlur={() => {
                        if (editing) updateDependencies(rowIndex, cellIndex);
                        setEditing(null);
                        setPickMode(false);
                      }}
                      onChange={(e) => handleOnChange(e, rowIndex, cellIndex)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitFormulaEdits();
                        }
                        if (e.key === "F2") {
                          const raw = grid[rowIndex][cellIndex].raw || "";
                          if (raw.startsWith("=")) {
                            setPickMode((prev) => !prev);
                            setFormulaMode(true);
                          }
                        }
                      }}
                    />
                  </div>
                );
              })}
            </React.Fragment>
          ))}

          {/* Selection outline */}
          {outlineBox && (
            <div
              className="selection-outline"
              style={{
                top: outlineBox.top,
                left: outlineBox.left,
                width: outlineBox.width,
                height: outlineBox.height,
              }}
            />
          )}
        </div>
      </div>

      <div
        className="floating-panels"
        style={{
          height: collapsed ? "42px" : `${panelHeight}px`,
        }}
      >
        {!collapsed && (
          <div className="panel-resize-handle" onMouseDown={startResize} />
        )}

        <div className="panel-tabs">
          <button
            className="panel-collapse-btn"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? "▲" : "▼"}
          </button>
          {panels.map((p) => (
            <div
              key={p.id}
              className={`panel-tab ${activePanel === p.id ? "active" : ""}`}
              onClick={() => setActivePanel(p.id)}
            >
              {p.title}
              <span
                className="panel-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closePanel(p.id);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>

        {activePanel && !collapsed && (
          <div className="panel-content">
            {activePanel === "TICKER_PANEL" && (
              <TickerPanel tickers={activeTickers} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/********************************/
/*         Ticker Panel         */
/********************************/
function TickerPanel({ tickers }) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);

  const [activeTicker, setActiveTicker] = useState(null);
  const [chartData, setChartData] = useState(null);

  useEffect(() => {
    if (!activeTicker) return; // <-- fix

    async function fetchData() {
      console.log("Fetching:", activeTicker);

      const url = `https://api.massive.com/v2/aggs/ticker/${activeTicker}/range/1/day/2025-01-09/2025-11-25?adjusted=true&sort=asc&apiKey=ANeN7iKkqpD0bW2RcI_2xWVbNljnDCZ5`;

      const res = await fetch(url);
      const json = await res.json();

      if (json.resultsCount === 0) {
        setChartData([]); // <-- stores empty array
      } else if (Array.isArray(json.results)) {
        setChartData(json.results);
      }
    }

    fetchData();
  }, [activeTicker]);

  useEffect(() => {
    if (chartData) {
      const formatted = chartData.map((d) => ({
        time: d.t / 1000, // convert ms → seconds
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c,
      }));

      candleRef.current.setData(formatted);

      const volume = chartData.map((d) => ({
        time: d.t / 1000,
        value: d.v,
        color: d.c >= d.o ? "#26a69aAA" : "#ef5350AA",
      }));

      volumeRef.current.setData(volume);

      chartRef.current.timeScale().fitContent();
    }
  }, [chartData]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart once
    if (!chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
        layout: {
          background: { type: "solid", color: "#0f0f0f" },
          textColor: "#e6e6e6",
        },

        grid: {
          vertLines: { color: "rgba(255,255,255,0.05)" },
          horzLines: { color: "rgba(255,255,255,0.05)" },
        },

        crosshair: {
          mode: 1,
          vertLine: { color: "rgba(255,255,255,0.3)", width: 1 },
          horzLine: { color: "rgba(255,255,255,0.3)", width: 1 },
        },

        rightPriceScale: {
          borderColor: "rgba(255,255,255,0.15)",
        },

        timeScale: {
          borderColor: "rgba(255,255,255,0.15)",
        },
      });

      chartRef.current = chart;

      // Candles
      candleRef.current = chart.addSeries(CandlestickSeries, {
        priceScaleId: "right",

        upColor: "#3dd68c",
        downColor: "#ff4d4d",

        borderUpColor: "#3dd68c",
        borderDownColor: "#ff4d4d",

        wickUpColor: "#3dd68c",
        wickDownColor: "#ff4d4d",

        borderVisible: true,
      });

      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        scaleMargins: { top: 0.72, bottom: 0 },
      });
    }

    // -------------- 🔥 Add Resize Listener ----------------
    function handleResize() {
      if (chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });

        chartRef.current.timeScale().fitContent();
      }
    }

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="ticker-panel-wrapper">
      <div className="nav">
        {tickers.map((t) => (
          <div key={t}>
            <h3 className="ticker" onClick={() => setActiveTicker(t)}>
              {t}
            </h3>
          </div>
        ))}
      </div>
      <div
        className="chart"
        ref={chartContainerRef}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
