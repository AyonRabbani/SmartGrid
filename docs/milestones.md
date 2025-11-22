# SmartGrid — Milestones (v1.0)

This document defines every phase of the SmartGrid spreadsheet engine and product ecosystem.  
Milestones are structured for rapid MVP delivery with iterative enhancements.

---

## 🟦 Milestone 1 — Core Spreadsheet Engine
Status: 80% complete

### Goals:
- Interactive grid (inputs, focus, editing)
- Raw vs. value state
- Basic formula evaluation (`=1+2*3`)
- Safe evaluation sandbox
- Ticker detection (`AAPL`, `NVDA`, etc.)
- Ticker function: `=Ticker(AAPL)`

### Deliverables:
- GridView component
- evaluateFormula module
- detectTicker module
- keyboard + mouse editing
- stable controlled inputs

---

## 🟪 Milestone 2 — Dependency Graph Engine
Status: 65% complete

### Goals:
- Extract references (`A1`, `B5`, `AA10`)
- Build dependency graph in memory
- Unregister + re-register dependencies on edit
- Cascade recalculation of dependent cells
- Detect circular dependencies

### Deliverables:
- extractReferences
- makeCellRef / reverseCellRef
- substituteRefs
- updateDependencies
- #CIRCULAR_REF error handling

---

## 🟧 Milestone 3 — Ticker Detection & Validation
Status: 70% complete

### Goals:
- Detect tickers in grid
- Validate via Massive/Polygon API
- Maintain activeTicker list
- Display ticker sidebar

---

## 🟩 Milestone 4 — Data Panels (MVP)
Status: Not started

### Goals:
- Right-side panel opens when selecting a ticker
- Show:
  - price
  - % change
  - volume
  - sector
  - market cap
- Options chain preview

### Deliverables:
- TickerPanel
- OptionChainPanel
- shared/tickerAnalytics module

---

## 🟫 Milestone 5 — Electron Desktop App
Status: Not started

### Goals:
- Wrap React app in Electron
- Create main.js + preload.js
- Desktop window
- Local persistence (JSON or SQLite)
- Auto-update system

---

## 🟥 Milestone 6 — AI Sheet Agent (Long-Term)
Status: Future

### Goals:
- Parse sheet into semantic JSON
- Summaries of formulas, references, tickers
- AI suggestions:
  - formula fixes
  - risk analysis
  - portfolio suggestions
  - automated insights

---

## 🟨 Milestone 7 — Portfolio & Trading Features
Status: Future

### Goals:
- Portfolio sheet templates
- Options P/L calculators
- Volatility surfaces
- Greeks (shared/formulas)
- Macro dashboards

---

# Progress Tracking
Milestones will be managed via GitHub Projects, with issues linked to each milestone.
