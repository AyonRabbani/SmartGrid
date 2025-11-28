import React, { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries } from "lightweight-charts";

/*************** helpers ****************/

function computeMultiFactorIndex(universeData) {
  const tickers = Object.keys(universeData).filter(
    (t) => Array.isArray(universeData[t]) && universeData[t].length > 0
  );
  if (!tickers.length) return [];

  const refTicker = tickers[0];
  const refSeries = universeData[refTicker];
  const len = refSeries.length;
  const times = refSeries.map((d) => d.t); // ms timestamps

  // pre-slice per ticker
  const seriesMap = {};
  tickers.forEach((sym) => {
    const s = universeData[sym];
    seriesMap[sym] = {
      close: s.map((d) => d.c),
      low: s.map((d) => d.l),
      volume: s.map((d) => d.v),
      time: s.map((d) => d.t),
    };
  });

  const indexSeries = [];

  for (let k = 0; k < len; k++) {
    const cross = [];

    tickers.forEach((sym) => {
      const s = seriesMap[sym];
      if (k >= s.close.length) return;

      const closes = s.close.slice(0, k + 1);
      const lows = s.low.slice(0, k + 1);
      const vols = s.volume.slice(0, k + 1);

      const P = closes[closes.length - 1];
      const V = vols[vols.length - 1];
      if (!P || P <= 0) return;

      // --- Valuation Factor ---
      const window200 = closes.slice(-200);
      const ma200 =
        window200.reduce((a, b) => a + b, 0) / window200.length || null;
      const PAP = ma200 ? P / ma200 : null;

      const window252 = closes.slice(-252);
      const min252 = window252.length ? Math.min(...window252) : null;
      const max252 = window252.length ? Math.max(...window252) : null;
      let DDpos = null;
      if (
        min252 !== null &&
        max252 !== null &&
        max252 > min252 &&
        window252.length > 1
      ) {
        DDpos = (P - min252) / (max252 - min252);
      }

      let Val = null;
      if (PAP !== null && DDpos !== null) {
        Val = 0.6 * PAP + 0.4 * DDpos;
      }

      // --- Volatility Factor ---
      const rets = [];
      for (let j = 1; j < closes.length; j++) {
        if (closes[j - 1] > 0 && closes[j] > 0) {
          rets.push(Math.log(closes[j] / closes[j - 1]));
        }
      }

      let RV30 = null;
      if (rets.length >= 2) {
        const window30 = rets.slice(-30);
        const mean = window30.reduce((a, b) => a + b, 0) / window30.length || 0;
        const variance =
          window30.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
          (window30.length - 1 || 1);
        RV30 = Math.sqrt(variance) * Math.sqrt(252);
      }

      const adv20Arr = vols.slice(-20);
      const adv60Arr = vols.slice(-60);
      const adv20 =
        adv20Arr.length > 0
          ? adv20Arr.reduce((a, b) => a + b, 0) / adv20Arr.length
          : null;
      const adv60 =
        adv60Arr.length > 0
          ? adv60Arr.reduce((a, b) => a + b, 0) / adv60Arr.length
          : null;

      let VWV = null;
      if (RV30 !== null && adv20 !== null && adv60 !== null && adv60 > 0) {
        VWV = RV30 * Math.sqrt(adv20 / adv60);
      }

      let Vol = null;
      if (RV30 !== null && VWV !== null) {
        Vol = 0.7 * RV30 + 0.3 * VWV;
      }

      // --- Momentum Factor ---
      const last = closes.length - 1;
      const r1m = last - 21 >= 0 ? closes[last] / closes[last - 21] - 1 : null;
      const r3m = last - 63 >= 0 ? closes[last] / closes[last - 63] - 1 : null;
      const r6m =
        last - 126 >= 0 ? closes[last] / closes[last - 126] - 1 : null;

      let Mom = null;
      if (r1m !== null && r3m !== null && r6m !== null) {
        Mom = 0.5 * r1m + 0.3 * r3m + 0.2 * r6m;
      }

      cross.push({
        sym,
        P,
        V,
        Val,
        Vol,
        Mom,
        adv20,
        adv60,
      });
    });

    if (!cross.length) continue;

    // --- Liquidity Factor (cross-sectional) ---
    const adv20Logs = cross
      .filter((c) => c.adv20 !== null && c.adv20 > 0)
      .map((c) => Math.log(c.adv20));

    let muADV = null;
    let sdADV = null;

    if (adv20Logs.length >= 2) {
      muADV = adv20Logs.reduce((a, b) => a + b, 0) / adv20Logs.length;
      const varADV =
        adv20Logs.reduce((s, x) => s + (x - muADV) ** 2, 0) /
        (adv20Logs.length - 1);
      sdADV = Math.sqrt(varADV);
    }

    cross.forEach((c) => {
      let VolZS = null;
      if (muADV !== null && sdADV && sdADV > 0 && c.adv20) {
        VolZS = (Math.log(c.adv20) - muADV) / sdADV;
      }

      let VT = null;
      if (c.adv20 && c.adv60 && c.adv60 > 0) {
        VT = c.adv20 / c.adv60 - 1;
      }

      let Volm = null;
      if (VolZS !== null && VT !== null) {
        Volm = 0.6 * VolZS + 0.4 * VT;
      }

      c.Volm = Volm;
    });

    // helper: cross-sectional z-score per factor
    function crossZ(getter) {
      const vals = cross
        .map(getter)
        .filter((v) => v !== null && !Number.isNaN(v));
      if (vals.length < 2) return new Map();
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance =
        vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (vals.length - 1);
      const sd = Math.sqrt(variance);
      if (!sd) return new Map();
      const map = new Map();
      cross.forEach((c) => {
        const v = getter(c);
        if (v !== null && !Number.isNaN(v)) {
          map.set(c.sym, (v - mean) / sd);
        }
      });
      return map;
    }

    const ZVal = crossZ((c) => c.Val);
    const ZVol = crossZ((c) => c.Vol);
    const ZMom = crossZ((c) => c.Mom);
    const ZVolm = crossZ((c) => c.Volm);

    const wVal = 0.35;
    const wVol = 0.2;
    const wMom = 0.3;
    const wVolm = 0.15;

    // weights: liquidity (ADV20) if possible, else equal
    const totalADV = cross.reduce((sum, c) => sum + (c.adv20 || 0), 0);
    const weights = new Map();

    if (totalADV > 0) {
      cross.forEach((c) => {
        const w = (c.adv20 || 0) / totalADV;
        weights.set(c.sym, w);
      });
    } else {
      const w = 1 / cross.length;
      cross.forEach((c) => weights.set(c.sym, w));
    }

    let IS_t = 0;
    cross.forEach((c) => {
      const sym = c.sym;
      const sval = ZVal.get(sym) || 0;
      const svol = ZVol.get(sym) || 0;
      const smom = ZMom.get(sym) || 0;
      const svolm = ZVolm.get(sym) || 0;
      const score = wVal * sval + wVol * svol + wMom * smom + wVolm * svolm;
      const w = weights.get(sym) || 0;
      IS_t += w * score;
    });

    const indexLevel = 100 * Math.exp(IS_t);

    indexSeries.push({
      time: times[k] / 1000, // seconds for lightweight-charts
      value: indexLevel,
    });
  }

  return indexSeries;
}

function computeStdDev(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Simple normal CDF approximation
function normalCdf(x) {
  // Abramowitz-Stegun approximation
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function computeMetricsFromSeries(series) {
  if (!series || series.length < 2) {
    return {
      momentum: "Unavailable",
      recentFloor: "Unavailable",
      volatilityStructure: "Unavailable",
      volatilityRegime: "Unavailable",
      rvVsIv: "Unavailable",
      putCallSkew: "Unavailable",
      optionsBarriers: "Unavailable",
    };
  }

  const closes = series.map((d) => d.c);
  const lows = series.map((d) => d.l);

  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];

  // Momentum: performance over full window
  const momentumPct = ((lastClose / firstClose - 1) * 100).toFixed(2);
  const momentum = `${momentumPct}% over selected range`;

  // Recent floor: last 20 bars (or fewer if not enough)
  const floorWindow = Math.min(20, series.length);
  const recentSlice = series.slice(-floorWindow);
  const recentLows = recentSlice.map((d) => d.l);
  const recentLow = Math.min(...recentLows);
  const touchThreshold = recentLow * 1.01; // within +1% of the floor counts as a "test"
  const tests = recentSlice.filter((d) => d.l <= touchThreshold).length;
  const recentFloor = `${recentLow.toFixed(2)} (${tests} test${
    tests === 1 ? "" : "s"
  } in last ${floorWindow} bars)`;

  // Realized volatility structure: 5d vs 20d log returns
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }

  let volShort = null;
  let volLong = null;
  let volatilityStructure = "Unavailable";
  let volatilityRegime = "Unavailable";

  if (returns.length >= 5) {
    const shortWindow = returns.slice(-5);
    const stdShort = computeStdDev(shortWindow); // daily log-return stdev
    if (stdShort !== null) {
      volShort = stdShort * Math.sqrt(252) * 100; // annualized %, approx
    }
  }

  if (returns.length >= 20) {
    const longWindow = returns.slice(-20);
    const stdLong = computeStdDev(longWindow);
    if (stdLong !== null) {
      volLong = stdLong * Math.sqrt(252) * 100;
    }
  }

  if (volShort !== null && volLong !== null) {
    volatilityStructure = `5d RV: ${volShort.toFixed(
      1
    )}%  |  20d RV: ${volLong.toFixed(1)}%`;

    const ratio = volShort / volLong;
    if (ratio < 0.7) {
      volatilityRegime = `Cooling (short vol ~${(ratio * 100).toFixed(
        0
      )}% of 20d)`;
    } else if (ratio > 1.3) {
      volatilityRegime = `Heating up (short vol ~${(ratio * 100).toFixed(
        0
      )}% of 20d)`;
    } else {
      volatilityRegime = `Normal (short vol ~${(ratio * 100).toFixed(
        0
      )}% of 20d)`;
    }
  }

  // These require options / orderflow data -> unavailable
  const rvVsIv = "Unavailable (needs IV / options data)";
  const putCallSkew = "Unavailable (needs options surface)";
  const optionsBarriers = "Unavailable (needs options / order book)";

  return {
    momentum,
    recentFloor,
    volatilityStructure,
    volatilityRegime,
    rvVsIv,
    putCallSkew,
    optionsBarriers,
  };
}

// Approximate probability of touching a price using realized vol
function computeTouchProbability(series, targetPrice, horizonDays) {
  if (!series || series.length < 2) return "Unavailable";
  const K = parseFloat(targetPrice);
  const Tdays = parseInt(horizonDays, 10);

  if (!K || !Tdays || Tdays <= 0) return "Unavailable";

  const closes = series.map((d) => d.c);
  const S0 = closes[closes.length - 1];
  if (!S0 || S0 <= 0) return "Unavailable";

  // 20d realized vol as volatility proxy
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (returns.length < 20) return "Unavailable";

  const longWindow = returns.slice(-20);
  const stdLong = computeStdDev(longWindow);
  if (stdLong === null) return "Unavailable";

  const sigmaAnn = stdLong * Math.sqrt(252); // annualized
  const Tyears = Tdays / 252;
  if (sigmaAnn <= 0 || Tyears <= 0) return "Unavailable";

  const sigmaT = sigmaAnn * Math.sqrt(Tyears); // stdev of log-price over horizon

  // Downside vs upside target
  let z;
  let probEnd;
  if (K < S0) {
    z = Math.log(K / S0) / sigmaT;
    probEnd = normalCdf(z); // prob end <= K
  } else {
    z = Math.log(K / S0) / sigmaT;
    probEnd = 1 - normalCdf(z); // prob end >= K
  }

  // Touch probability is higher than end-at level. Crude uplift factor.
  let probTouch = probEnd * 1.3;
  if (probTouch > 0.999) probTouch = 0.999;
  if (probTouch < 0) probTouch = 0;

  return `${(probTouch * 100).toFixed(1)}% (realized-vol based)`;
}

/********************************/
/*         Ticker Panel         */
/********************************/
function TickerPanel({ tickers }) {
  const chartContainerRef = useRef(null);
  const secondChartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const secondChartRef = useRef(null);
  const candleRef = useRef(null);
  const secondCandleRef = useRef();
  const volumeRef = useRef(null);
  const secondVolumeRef = useRef(null);

  const [activeTicker, setActiveTicker] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [benchmarkData, setBenchmarkData] = useState(null);
  // all tickers we know about (initial + related, no duplicates)
  const [universeTickers, setUniverseTickers] = useState(tickers || []);

  // map of ticker -> Massive OHLCV array
  const [universeData, setUniverseData] = useState({});

  // composite index time series (per-bar)
  const [indexData, setIndexData] = useState(null);

  // optional: store related tickers just for UI
  const [relatedForActive, setRelatedForActive] = useState([]);

  // bar interval (aggregation)
  const [interval, setInterval] = useState("1/day");
  // date window
  const [rangeKey, setRangeKey] = useState("6M");

  // set the first ticker as the default active ticker
  useEffect(() => {
    if (!activeTicker && universeTickers.length > 0) {
      setActiveTicker(universeTickers[0]);
    }
  }, [universeTickers, activeTicker]);

  // derived metrics
  const [metrics, setMetrics] = useState({
    momentum: "Unavailable",
    recentFloor: "Unavailable",
    volatilityStructure: "Unavailable",
    volatilityRegime: "Unavailable",
    rvVsIv: "Unavailable",
    putCallSkew: "Unavailable",
    optionsBarriers: "Unavailable",
  });

  // dynamic probability-of-touch UI
  const [targetPrice, setTargetPrice] = useState("");
  const [horizonDays, setHorizonDays] = useState(30);
  const [touchEstimate, setTouchEstimate] = useState("Unavailable");

  function getBenchmark(ticker) {
    const benchmarks = [
      { ticker: "OKLO", benchmark: "SPY" },
      { ticker: "AAPL", benchmark: "QQQ" },
    ];
    const match = benchmarks.find((b) => b.ticker === ticker);
    return match ? match.benchmark : null;
  }

  function getDateRange(rangeKey) {
    const end = new Date();
    const start = new Date();

    switch (rangeKey) {
      case "1D":
        start.setDate(start.getDate() - 1);
        break;
      case "3D":
        start.setDate(start.getDate() - 3);
        break;
      case "1W":
        start.setDate(start.getDate() - 7);
        break;
      case "1M":
        start.setMonth(start.getMonth() - 1);
        break;
      case "3M":
        start.setMonth(start.getMonth() - 3);
        break;
      case "6M":
        start.setMonth(start.getMonth() - 6);
        break;
      case "YTD":
        start.setMonth(0);
        start.setDate(1);
        break;
      case "1Y":
        start.setFullYear(start.getFullYear() - 1);
        break;
      case "MAX":
        start.setFullYear(2000);
        break;
      default:
        start.setMonth(start.getMonth() - 6);
    }

    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
    };
  }

  // For display in start/end inputs
  const { start: displayStart, end: displayEnd } = getDateRange(rangeKey);

  /*********************/
  /*   DATA FETCHING   */
  /*********************/
  useEffect(() => {
    if (!activeTicker) return;

    async function fetchRelated() {
      try {
        const url = `https://api.massive.com/v1/related-companies/${activeTicker}?apiKey=ANeN7iKkqpD0bW2RcI_2xWVbNljnDCZ5`;
        const res = await fetch(url);
        const json = await res.json();

        const related = Array.isArray(json.results)
          ? json.results.map((r) => r.ticker).filter(Boolean)
          : [];

        setRelatedForActive(related);

        // expand universe (B: growing universe)
        setUniverseTickers((prev) => {
          const set = new Set(prev);
          set.add(activeTicker);
          related.forEach((t) => set.add(t));
          return Array.from(set);
        });
      } catch (err) {
        console.error("Error fetching related tickers:", err);
      }
    }

    fetchRelated();
  }, [activeTicker]);

  useEffect(() => {
    if (!universeTickers.length) return;

    async function fetchUniverseData() {
      try {
        const { start, end } = getDateRange(rangeKey);

        const promises = universeTickers.map(async (symbol) => {
          const url = `https://api.massive.com/v2/aggs/ticker/${symbol}/range/${interval}/${start}/${end}?adjusted=true&sort=asc&apiKey=ANeN7iKkqpD0bW2RcI_2xWVbNljnDCZ5`;

          const res = await fetch(url);
          const json = await res.json();
          const arr = Array.isArray(json.results) ? json.results : [];
          return [symbol, arr];
        });

        const entries = await Promise.all(promises);
        const dataMap = {};
        entries.forEach(([sym, arr]) => {
          dataMap[sym] = arr;
        });

        setUniverseData(dataMap);

        // keep your main chart bound to the active ticker
        if (dataMap[activeTicker]) {
          setChartData(dataMap[activeTicker]);
        }

        // compute composite index for second chart
        const idxSeries = computeMultiFactorIndex(dataMap);
        setIndexData(idxSeries);
      } catch (err) {
        console.error("Error fetching universe data:", err);
      }
    }

    fetchUniverseData();
  }, [universeTickers, interval, rangeKey, activeTicker]);

  useEffect(() => {
    if (!activeTicker) return;

    async function fetchData() {
      try {
        console.log(
          "Fetching:",
          activeTicker,
          "interval:",
          interval,
          "range:",
          rangeKey
        );
        const { start, end } = getDateRange(rangeKey);

        const url = `https://api.massive.com/v2/aggs/ticker/${activeTicker}/range/${interval}/${start}/${end}?adjusted=true&sort=asc&apiKey=ANeN7iKkqpD0bW2RcI_2xWVbNljnDCZ5`;

        const res = await fetch(url);
        const json = await res.json();

        if (json.resultsCount === 0) {
          setChartData([]);
        } else if (Array.isArray(json.results)) {
          setChartData(json.results);
        }
      } catch (err) {
        console.error("Error fetching main ticker data:", err);
        setChartData([]);
      }
    }

    async function fetchBenchmarkData() {
      try {
        const benchmark = getBenchmark(activeTicker);
        if (!benchmark) {
          setBenchmarkData([]);
          return;
        }

        const { start, end } = getDateRange(rangeKey);

        const url = `https://api.massive.com/v2/aggs/ticker/${benchmark}/range/${interval}/${start}/${end}?adjusted=true&sort=asc&apiKey=ANeN7iKkqpD0bW2RcI_2xWVbNljnDCZ5`;

        const res = await fetch(url);
        const json = await res.json();

        if (json.resultsCount === 0) {
          setBenchmarkData([]);
        } else if (Array.isArray(json.results)) {
          setBenchmarkData(json.results);
        }
      } catch (err) {
        console.error("Error fetching benchmark data:", err);
        setBenchmarkData([]);
      }
    }

    fetchData();
    fetchBenchmarkData();
  }, [activeTicker, interval, rangeKey]);

  /*********************/
  /*   METRICS COMPUTE */
  /*********************/
  useEffect(() => {
    const m = computeMetricsFromSeries(chartData);
    setMetrics(m);
  }, [chartData]);

  /*********************/
  /*  TOUCH PROBABILITY */
  /*********************/
  useEffect(() => {
    if (!targetPrice) {
      setTouchEstimate("Unavailable");
      return;
    }
    const estimate = computeTouchProbability(
      chartData,
      targetPrice,
      horizonDays
    );
    setTouchEstimate(estimate);
  }, [targetPrice, horizonDays, chartData]);

  /*********************/
  /*  APPLY SERIES DATA */
  /*********************/
  useEffect(() => {
    if (!chartRef.current || !secondChartRef.current) return;
    if (!candleRef.current || !secondCandleRef.current) return;
    if (!volumeRef.current || !secondVolumeRef.current) return;
    if (!chartData || !indexData) return;

    const formatted = chartData.map((d) => ({
      time: d.t / 1000,
      open: d.o,
      high: d.h,
      low: d.l,
      close: d.c,
    }));

    // index as flat OHLC (all four = index value)
    const formattedIndex = indexData.map((d) => ({
      time: d.time,
      open: d.value,
      high: d.value,
      low: d.value,
      close: d.value,
    }));

    candleRef.current.setData(formatted);
    secondCandleRef.current.setData(formattedIndex);

    // volumes for active ticker only (index has no “volume”)
    const volume = chartData.map((d) => ({
      time: d.t / 1000,
      value: d.v,
      color: d.c >= d.o ? "#26a69aAA" : "#ef5350AA",
    }));

    volumeRef.current.setData(volume);

    chartRef.current.timeScale().fitContent();
    secondChartRef.current.timeScale().fitContent();
  }, [chartData, benchmarkData]);

  /*********************/
  /*   CHART CREATION  */
  /*********************/
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (!secondChartContainerRef.current) return;

    // Create chart once
    if (!chartRef.current && !secondChartRef.current) {
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

      const secondChart = createChart(secondChartContainerRef.current, {
        width: secondChartContainerRef.current.clientWidth,
        height: secondChartContainerRef.current.clientHeight,
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

      // enable zoom/scroll
      chart.applyOptions({
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
        },
      });

      secondChart.applyOptions({
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
        },
      });

      chartRef.current = chart;
      secondChartRef.current = secondChart;

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

      secondCandleRef.current = secondChart.addSeries(CandlestickSeries, {
        priceScaleId: "right",
        upColor: "#3dd68c",
        downColor: "#ff4d4d",
        borderUpColor: "#3dd68c",
        borderDownColor: "#ff4d4d",
        wickUpColor: "#3dd68c",
        wickDownColor: "#ff4d4d",
        borderVisible: true,
      });

      // Volumes
      volumeRef.current = chart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        scaleMargins: { top: 0.72, bottom: 0 },
      });

      secondVolumeRef.current = secondChart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        scaleMargins: { top: 0.72, bottom: 0 },
      });
    }

    function handleResize() {
      if (chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
        chartRef.current.timeScale().fitContent();
      }
      if (secondChartContainerRef.current) {
        secondChartRef.current.applyOptions({
          width: secondChartContainerRef.current.clientWidth,
          height: secondChartContainerRef.current.clientHeight,
        });
        secondChartRef.current.timeScale().fitContent();
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="ticker-panel-wrapper">
      <div className="nav">
        <h4>Active Tickers</h4>
        {universeTickers.map((t) => (
          <div key={t}>
            <h3 className="ticker" onClick={() => setActiveTicker(t)}>
              {t}
            </h3>
          </div>
        ))}
        <div className="related-tickers">
          <span>Peers:</span>
          {relatedForActive.map((t) => (
            <button
              key={t}
              className="peer-btn"
              onClick={() => setActiveTicker(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="summary">
        <div className="chart-settings">
          <div className="chart-inputs">
            <p>start</p>
            <input value={displayStart} readOnly />
            <p>end</p>
            <input value={displayEnd} readOnly />
          </div>

          <div className="chart-interval-controls">
            {["1/hour", "4/hour", "1/day", "1/week"].map((i) => (
              <button
                key={i}
                className={interval === i ? "active-btn" : ""}
                onClick={() => setInterval(i)}
              >
                {i}
              </button>
            ))}
          </div>

          <div className="chart-range-controls">
            {["1D", "3D", "1W", "1M", "3M", "6M", "YTD", "1Y", "MAX"].map(
              (r) => (
                <button
                  key={r}
                  className={rangeKey === r ? "active-btn" : ""}
                  onClick={() => setRangeKey(r)}
                >
                  {r}
                </button>
              )
            )}
          </div>
        </div>

        <div className="chart-container" style={{ height: "300px" }}>
          <div
            className="chart"
            ref={chartContainerRef}
            style={{ width: "100%", height: "100%" }}
          />
          <div
            className="chart"
            ref={secondChartContainerRef}
            style={{ width: "100%", height: "100%" }}
          />
        </div>

        {/* Dynamic probability of touch */}
        <div className="touch-panel">
          <div className="touch-inputs">
            <span>Target price</span>
            <input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="e.g. 80"
            />
            <span>Horizon (days)</span>
            <input
              type="number"
              value={horizonDays}
              onChange={(e) => setHorizonDays(e.target.value)}
              min={1}
            />
          </div>
          <div className="touch-output">
            <span>Prob. of touch (realized vol only):</span>
            <strong>{touchEstimate}</strong>
          </div>
        </div>

        <div className="position-summary">
          <div>Position P/L</div>
          <div>Probability of Strike</div>
          <div>DTE</div>
          <div>ROIC</div>
          <div>Greeks</div>
          <div>Early Warning Price</div>
          <div>Current Strategy</div>
        </div>
        <div className="metrics">
          {[
            {
              label: "Momentum",
              value: metrics.momentum,
              expl: "Momentum is (Last Close / First Close - 1). Calculated over the selected date range.",
            },
            {
              label: "Recent Floor",
              value: metrics.recentFloor,
              expl: "Recent Floor = lowest low in the last 20 bars. Tests = number of bars where low touched within ~1% of floor.",
            },
            {
              label: "Realized Vol Structure",
              value: metrics.volatilityStructure,
              expl: "5d RV and 20d RV computed as standard deviation of log returns, annualized via *sqrt(252)*.",
            },
            {
              label: "Volatility Regime",
              value: metrics.volatilityRegime,
              expl: "Short-term vol / long-term vol ratio determines regime: heating, cooling, or normal.",
            },
            {
              label: "RV vs IV",
              value: metrics.rvVsIv,
              expl: "Unavailable because IV data requires options chain / implied vol surface.",
            },
            {
              label: "Put/Call Skew",
              value: metrics.putCallSkew,
              expl: "Unavailable because skew requires option strike-level IV data.",
            },
            {
              label: "Options Barriers",
              value: metrics.optionsBarriers,
              expl: "Unavailable because barrier levels need OI walls, options data, or dark-pool levels.",
            },
          ].map((m, idx) => (
            <details className="metric-item" key={idx}>
              <summary>
                <span className="metric-label">{m.label}</span>
                <span className="metric-value">{m.value}</span>
              </summary>
              <div className="metric-expl">{m.expl}</div>
            </details>
          ))}
        </div>

        <div className="macro-news">
          <div>Upcoming Economic Activity</div>
          <div>News</div>
          <div>Sentiment</div>
        </div>
      </div>
    </div>
  );
}

export default TickerPanel;
