import React, { useState, useMemo } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from 'recharts';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/*
 * GHHF — Betashares Wealth Builder Diversified All Growth Geared (30-40% LVR) Complex ETF
 * Fund specs from betashares.com.au + PDS + passiveinvestingaustralia.com:
 *   Underlying: 37% AU (A200), 44% Intl unhedged (BGBL+IEMG), 19% Intl hedged (HGBL)
 *   AUD-based exposure: 56% (37% AU + 19% hedged) | Unhedged: 44%
 *   LVR band: 30-40%, rebalanced to ~35% | Gearing ~1.43x-1.67x | Fee: 0.35% p.a. gross
 *   Borrows at institutional rates | No margin calls | 44% unhedged, 19% hedged intl
 *
 * NEW in this version:
 *   1. Transaction costs on rebalancing (bid-ask spreads widen in crisis)
 *   2. Currency effect (AUD weakens in crash → cushion, strengthens in recovery → drag)
 *   3. Volatility drag (choppy markets → more frequent rebalancing → more sell-low/buy-high)
 */

function simulateGHHF({
  crashDepth,
  crashDuration,
  recoveryPace,
  baseCashRate,
  crisisSpread,
  initialLVR,
  mgtFeeGross,
  volDragEnabled,
  txCostEnabled,
  currencyEnabled,
}) {
  const data = [];
  const maxMonths = 360;
  const crashStart = 6;
  const crashEnd = crashStart + crashDuration;
  const peakDecline = crashDepth / 100;
  const intlUnhedged = 0.44; // 44% international unhedged (BGBL+IEMG) — exposed to AUD moves
  // 19% is currency-hedged (HGBL) — NOT exposed to AUD moves
  // 37% AU (A200) — denominated in AUD
  // Total AUD-based exposure: 37% + 19% = 56%

  const initialEquity = 100000;
  let equity = initialEquity;
  let debt = equity * (initialLVR / (100 - initialLVR));
  let grossAssets = equity + debt;

  let rebalanceEvents = [];
  let sellEvents = [];
  let buyEvents = [];
  let totalAssetsSold = 0;
  let totalAssetsBought = 0;
  let cumulativeInterest = 0;
  let cumulativeMgtFee = 0;
  let cumulativeTxCost = 0;
  let cumulativeVolDrag = 0;
  let totalExtraRebalances = 0;

  let allTimeHighEquity = equity;
  let athRecoveryMonth = null;
  let recoveryMonth = null;

  // AUD index (100 = starting level). AUD typically drops 20-30% in global crisis.
  let audIndex = 100;

  // CALIBRATED: total return (price + dividends included) for DHHF-like all-growth portfolio
  // ~37% AU + ~44% Intl unhedged + ~19% Intl hedged ≈ 8.9% p.a. total return
  // Ungeared DHHF recovers in ~5.3yr from GFC peak (matching historical data)
  // No separate DRIP needed — dividends are already in the total return
  // GHHF's 2.1% distribution yield is just the underlying dividends minus borrowing costs passing through
  const totalReturnMonthly = 0.0074; // ~8.9% p.a. total return (price appreciation + dividends)

  // Track ungeared DHHF recovery separately
  let ungearedATH = 100;
  let ungearedRecoveryMonth = null;

  for (let m = 0; m <= maxMonths; m++) {
    const year = Math.floor(m / 12);
    const month = m % 12;
    const label = `${MONTHS[month]} Y${year}`;

    let localReturn = 0; // return in local currency terms
    let phase = 'Pre-Crash';
    let cashRate = baseCashRate;
    let spread = 0.01;
    let monthlyVolatility = 0.03; // annualised vol proxy for monthly

    if (m < crashStart) {
      localReturn = totalReturnMonthly;
      phase = 'Pre-Crash';
      monthlyVolatility = 0.04;
    } else if (m >= crashStart && m < crashEnd) {
      const progress = (m - crashStart) / crashDuration;
      const intensity = Math.sin(progress * Math.PI * 0.5);
      localReturn = ((-peakDecline * intensity) / crashDuration) * 2.5;
      phase = 'Crash';
      cashRate = baseCashRate * (1 - progress * 0.6);
      spread = 0.01 + (crisisSpread / 100) * Math.sin(progress * Math.PI * 0.8);
      monthlyVolatility = 0.08 + 0.06 * intensity;
    } else {
      const recMonths = m - crashEnd;
      const recFactor = recoveryPace / 50;
      // Calibrated: bounce 0.034 gives ungeared ~5.3yr recovery from GFC peak
      const bounceReturn = 0.034 * recFactor * Math.exp(-recMonths * 0.03);
      localReturn = Math.max(totalReturnMonthly, bounceReturn);
      phase = athRecoveryMonth ? 'New Highs' : 'Recovery';
      const cashNorm = Math.min(1, recMonths / 42);
      cashRate = baseCashRate * (0.4 + 0.6 * cashNorm);
      const spreadNorm = Math.min(1, recMonths / 24);
      spread = 0.01 + (crisisSpread / 100) * 0.3 * (1 - spreadNorm);
      const volNorm = Math.min(1, recMonths / 24);
      monthlyVolatility = 0.04 + 0.06 * (1 - volNorm);
    }

    // ─── CURRENCY EFFECT ───
    // Only 44% of GHHF is unhedged international (BGBL+IEMG) — exposed to AUD moves
    // 19% is currency-hedged (HGBL), 37% is AU — both unaffected by AUD
    // AUD typically drops 20-30% during global crises (risk-off → USD strength)
    // Then recovers over 2-3 years post-trough
    let audChange = 0;
    if (currencyEnabled) {
      if (m < crashStart) {
        audChange = 0; // stable
      } else if (m >= crashStart && m < crashEnd) {
        const progress = (m - crashStart) / crashDuration;
        // AUD drops ~25% over crash duration
        audChange =
          ((-0.25 * Math.sin(progress * Math.PI * 0.5)) / crashDuration) * 2;
      } else {
        const recMonths = m - crashEnd;
        // AUD recovers over ~3 years
        const audRecovery = Math.min(1, recMonths / 36);
        const prevAudTarget = 100 * (0.75 + 0.25 * audRecovery);
        audChange = (prevAudTarget - audIndex) * 0.08; // gradual mean reversion
        audChange = audChange / audIndex; // as percentage
      }
      audIndex = audIndex * (1 + audChange);
    }

    // Market return in AUD terms
    // Only the 44% unhedged intl portion is affected by AUD moves
    // When AUD drops, unhedged intl assets are worth more in AUD (cushion)
    // When AUD rises, unhedged intl assets are worth less in AUD (drag)
    let currencyReturn = 0;
    if (currencyEnabled) {
      currencyReturn = -audChange * intlUnhedged; // only unhedged 44% is affected
    }
    const marketReturn = localReturn + currencyReturn;

    const borrowingRate = cashRate + spread;

    // ─── 1. MARKET RETURN ON GROSS ASSETS ───
    grossAssets = Math.max(1, grossAssets * (1 + marketReturn));

    // ─── 2. MANAGEMENT FEE ───
    const monthlyMgtFee = grossAssets * (mgtFeeGross / 12);
    grossAssets -= monthlyMgtFee;
    cumulativeMgtFee += monthlyMgtFee;

    // ─── 3. INTEREST COST ───
    const interestCost = debt * (borrowingRate / 12);
    cumulativeInterest += interestCost;

    // ─── 4. EQUITY UPDATE ───
    equity = grossAssets - debt - interestCost;
    equity = Math.max(0.01, equity);
    grossAssets = equity + debt;

    // ─── 5. LVR CHECK & REBALANCING ───
    let lvr = grossAssets > 0 ? (debt / grossAssets) * 100 : 0;
    let rebalanced = false;
    let rebalanceType = null;
    let actionAmount = 0;

    // Transaction cost: bid-ask spread on the rebalance trade
    // Normal: ~0.05-0.1% | Crisis: 0.5-2% (liquidity dries up)
    let txCostBps = 0;
    if (txCostEnabled) {
      if (phase === 'Crash') txCostBps = 0.012; // 1.2% during crash
      else if (phase === 'Recovery') {
        const recMonths = m - crashEnd;
        const txNorm = Math.min(1, recMonths / 18);
        txCostBps = 0.001 + 0.008 * (1 - txNorm); // 0.9% → 0.1% over 18mo
      } else txCostBps = 0.0008; // 0.08% normal
    }

    const doRebalance = (targetLVR) => {
      if (lvr > 40) {
        const lvrBefore = lvr;
        const X = (debt - targetLVR * grossAssets) / (1 - targetLVR);
        if (X > 0 && X < grossAssets * 0.9) {
          const txCost = X * txCostBps;
          grossAssets -= X + txCost;
          debt -= X;
          equity = grossAssets - debt;
          cumulativeTxCost += txCost;
          totalAssetsSold += X;
          return { type: 'SELL', amount: X, lvrBefore, txCost };
        }
      } else if (lvr < 30) {
        const lvrBefore = lvr;
        const Y = (targetLVR * grossAssets - debt) / (1 - targetLVR);
        if (Y > 0) {
          const txCost = Y * txCostBps;
          debt += Y;
          grossAssets += Y - txCost;
          equity = grossAssets - debt;
          cumulativeTxCost += txCost;
          totalAssetsBought += Y;
          return { type: 'BUY', amount: Y, lvrBefore, txCost };
        }
      }
      return null;
    };

    // Primary monthly rebalance check
    const result = doRebalance(0.35);
    if (result) {
      rebalanced = true;
      rebalanceType = result.type;
      actionAmount = result.amount;
      rebalanceEvents.push(m);
      if (result.type === 'SELL')
        sellEvents.push({
          month: m,
          amount: result.amount,
          lvr_before: result.lvrBefore,
        });
      else
        buyEvents.push({
          month: m,
          amount: result.amount,
          lvr_before: result.lvrBefore,
        });
      lvr = grossAssets > 0 ? (debt / grossAssets) * 100 : 0;
    }

    // ─── 6. VOLATILITY DRAG ───
    // In reality, daily volatility causes intra-month LVR breaches
    // We simulate this as additional "micro-rebalances" during high-vol periods
    // Each costs transaction fees and crystallises the sell-low/buy-high penalty
    let extraRebalances = 0;
    let volDragCost = 0;
    if (volDragEnabled && monthlyVolatility > 0.05) {
      // Estimate extra rebalancing events from daily vol
      // Higher vol → more LVR band breaches per month
      // Approximation: number of times a random walk crosses a threshold
      const dailyVol = monthlyVolatility / Math.sqrt(21); // ~21 trading days
      // Expected LVR swings from asset vol: delta_LVR ≈ LVR * (1-LVR) * assetVol * gearing
      const gearing = grossAssets / Math.max(1, equity);
      const lvrSwing = (lvr / 100) * (1 - lvr / 100) * dailyVol * gearing * 100;

      // How many daily swings would push LVR beyond 40% from current position?
      const distToBand = Math.abs(40 - lvr);
      if (lvrSwing > 0 && distToBand < lvrSwing * 3) {
        // Probability-weighted expected extra rebalances per month
        const prob = Math.max(0, 1 - distToBand / (lvrSwing * 2));
        extraRebalances = Math.round(prob * 4 * (monthlyVolatility / 0.08)); // up to ~4 extra per month
        extraRebalances = Math.min(extraRebalances, 6);

        if (extraRebalances > 0) {
          // Each extra rebalance: small forced trade with transaction cost + slippage
          const avgTradeSize = grossAssets * 0.02 * (monthlyVolatility / 0.08);
          const perTradeCost = avgTradeSize * txCostBps * 1.5; // worse execution on rushed trades
          volDragCost = extraRebalances * perTradeCost;

          // Volatility drag reduces equity (cost of whipsawing)
          const volPenalty = extraRebalances * avgTradeSize * 0.003; // small crystallisation loss per event
          equity = Math.max(0.01, equity - volDragCost - volPenalty);
          grossAssets = equity + debt;
          cumulativeVolDrag += volDragCost + volPenalty;
          totalExtraRebalances += extraRebalances;
        }
      }
    }

    // Recalculate LVR after all effects
    lvr = grossAssets > 0 ? (debt / grossAssets) * 100 : 0;

    // Index values — all returns are total return (dividends already included)
    const equityIndex = (equity / initialEquity) * 100;
    const prevUngeared = m === 0 ? 100 : data[m - 1]?.ungeared || 100;
    const ungeared = prevUngeared * (1 + marketReturn); // total return, no separate DRIP needed
    const gearingMultiple =
      grossAssets > 0 && equity > 0 ? grossAssets / equity : 0;

    // Track DHHF ungeared ATH & recovery
    if (m <= crashStart && ungeared > ungearedATH) ungearedATH = ungeared;
    if (!ungearedRecoveryMonth && m > crashEnd && ungeared >= ungearedATH)
      ungearedRecoveryMonth = m;

    if (m <= crashStart && equity > allTimeHighEquity)
      allTimeHighEquity = equity;
    const athIndex = (allTimeHighEquity / initialEquity) * 100;

    if (!recoveryMonth && m > crashEnd && equityIndex >= 100) recoveryMonth = m;
    if (!athRecoveryMonth && m > crashEnd && equity >= allTimeHighEquity)
      athRecoveryMonth = m;

    data.push({
      month: m,
      label,
      phase,
      equity: +equityIndex.toFixed(2),
      ungeared: +ungeared.toFixed(2),
      ath: +athIndex.toFixed(2),
      lvr: +lvr.toFixed(2),
      borrowingRate: +(borrowingRate * 100).toFixed(2),
      cashRate: +(cashRate * 100).toFixed(2),
      creditSpread: +(spread * 100).toFixed(2),
      gearingMultiple: +gearingMultiple.toFixed(2),
      audIndex: currencyEnabled ? +audIndex.toFixed(1) : 100,
      rebalanced,
      rebalanceType,
      actionAmount,
      extraRebalances,
      debt: +debt.toFixed(0),
      grossAssets: +grossAssets.toFixed(0),
      equityDollars: +equity.toFixed(0),
      interestCost: +interestCost.toFixed(0),
      mgtFee: +monthlyMgtFee.toFixed(0),
      txCost: +(txCostBps * 10000).toFixed(0),
      marketReturn: +(marketReturn * 100).toFixed(3),
      localReturn: +(localReturn * 100).toFixed(3),
      currencyReturn: +(currencyReturn * 100).toFixed(3),
    });

    if (athRecoveryMonth && m >= athRecoveryMonth + 24) break;
  }

  return {
    data,
    rebalanceEvents,
    sellEvents,
    buyEvents,
    recoveryMonth,
    athRecoveryMonth,
    ungearedRecoveryMonth,
    allTimeHigh: (allTimeHighEquity / initialEquity) * 100,
    crashStart,
    crashEnd,
    totalAssetsSold,
    totalAssetsBought,
    cumulativeInterest,
    cumulativeMgtFee,
    cumulativeTxCost,
    cumulativeVolDrag,
    totalExtraRebalances,
  };
}

const fmt = (n) => {
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const belowATH = d.equity < d.ath;
  const pc =
    d.phase === 'Crash'
      ? '#f87171'
      : d.phase === 'New Highs'
      ? '#38bdf8'
      : d.phase === 'Pre-Crash'
      ? '#9ca3af'
      : '#6ee7b7';
  return (
    <div
      style={{
        background: 'rgba(8,8,18,0.97)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        padding: '14px 18px',
        fontFamily: "'DM Mono', monospace",
        fontSize: 13,
        color: '#d0d0da',
        minWidth: 280,
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          fontWeight: 700,
          color: '#fff',
          marginBottom: 8,
          fontSize: 14,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{d.label}</span>
        <span style={{ color: pc }}>{d.phase}</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          gap: '4px 16px',
        }}
      >
        <span style={{ color: '#6ee7b7' }}>GHHF NAV:</span>
        <span style={{ fontWeight: 600 }}>
          {d.equity.toFixed(1)} ({fmt(d.equityDollars)})
        </span>
        <span style={{ color: '#38bdf8' }}>vs ATH:</span>
        <span style={{ color: belowATH ? '#f87171' : '#6ee7b7' }}>
          {belowATH
            ? `${(((d.ath - d.equity) / d.ath) * 100).toFixed(1)}% below`
            : '✓ New high'}
        </span>
        <span style={{ color: '#93c5fd' }}>DHHF:</span>
        <span>{d.ungeared.toFixed(1)}</span>
        <span style={{ color: '#fbbf24' }}>LVR:</span>
        <span>
          {d.lvr.toFixed(1)}% ({d.gearingMultiple.toFixed(2)}x)
        </span>
        <span style={{ color: '#f87171' }}>Borrow rate:</span>
        <span>{d.borrowingRate.toFixed(2)}%</span>
        <span style={{ color: '#9ca3af' }}> ↳ cash + spread:</span>
        <span>
          {d.cashRate.toFixed(1)}% + {d.creditSpread.toFixed(1)}%
        </span>
        {d.audIndex !== 100 && (
          <>
            <span style={{ color: '#e879f9' }}>AUD index:</span>
            <span>{d.audIndex.toFixed(1)}</span>
          </>
        )}
        {d.extraRebalances > 0 && (
          <>
            <span style={{ color: '#fb923c' }}>Vol rebalances:</span>
            <span>{d.extraRebalances} extra this month</span>
          </>
        )}
        {d.rebalanced && d.rebalanceType === 'SELL' && (
          <>
            <span style={{ color: '#f87171' }}>⚠ FORCED SALE:</span>
            <span>{fmt(d.actionAmount)}</span>
          </>
        )}
        {d.rebalanced && d.rebalanceType === 'BUY' && (
          <>
            <span style={{ color: '#a78bfa' }}>↑ RE-GEARED:</span>
            <span>{fmt(d.actionAmount)}</span>
          </>
        )}
      </div>
    </div>
  );
};

export default function GHHFModel() {
  const [crashDepth, setCrashDepth] = useState(50);
  const [crashDuration, setCrashDuration] = useState(16);
  const [recoveryPace, setRecoveryPace] = useState(45);
  const [baseCashRate, setBaseCashRate] = useState(0.0435);
  const [crisisSpread, setCrisisSpread] = useState(3);
  const [initialLVR, setInitialLVR] = useState(35);
  const [showLVR, setShowLVR] = useState(true);
  const [showRates, setShowRates] = useState(true);
  const [showCurrency, setShowCurrency] = useState(true);
  const [txCostEnabled, setTxCostEnabled] = useState(true);
  const [currencyEnabled, setCurrencyEnabled] = useState(true);
  const [volDragEnabled, setVolDragEnabled] = useState(true);

  const loadPreset = (p) => {
    const presets = {
      gfc_today: {
        crashDepth: 50,
        crashDuration: 16,
        recoveryPace: 45,
        baseCashRate: 0.0435,
        crisisSpread: 3,
        initialLVR: 35,
      },
      gfc_historical: {
        crashDepth: 55,
        crashDuration: 17,
        recoveryPace: 50,
        baseCashRate: 0.0725,
        crisisSpread: 3.5,
        initialLVR: 35,
      },
      covid: {
        crashDepth: 35,
        crashDuration: 2,
        recoveryPace: 75,
        baseCashRate: 0.0075,
        crisisSpread: 2,
        initialLVR: 35,
      },
      severe: {
        crashDepth: 60,
        crashDuration: 24,
        recoveryPace: 30,
        baseCashRate: 0.0435,
        crisisSpread: 5,
        initialLVR: 35,
      },
    };
    const s = presets[p];
    if (!s) return;
    setCrashDepth(s.crashDepth);
    setCrashDuration(s.crashDuration);
    setRecoveryPace(s.recoveryPace);
    setBaseCashRate(s.baseCashRate);
    setCrisisSpread(s.crisisSpread);
    setInitialLVR(s.initialLVR);
  };

  const result = useMemo(
    () =>
      simulateGHHF({
        crashDepth,
        crashDuration,
        recoveryPace,
        baseCashRate,
        crisisSpread,
        initialLVR,
        mgtFeeGross: 0.0035,
        volDragEnabled,
        txCostEnabled,
        currencyEnabled,
      }),
    [
      crashDepth,
      crashDuration,
      recoveryPace,
      baseCashRate,
      crisisSpread,
      initialLVR,
      volDragEnabled,
      txCostEnabled,
      currencyEnabled,
    ]
  );

  const {
    data,
    sellEvents,
    buyEvents,
    recoveryMonth,
    athRecoveryMonth,
    ungearedRecoveryMonth,
    allTimeHigh,
    crashStart,
    crashEnd,
    totalAssetsSold,
    totalAssetsBought,
    cumulativeInterest,
    cumulativeMgtFee,
    cumulativeTxCost,
    cumulativeVolDrag,
  } = result;

  const minEquity = Math.min(...data.map((d) => d.equity));
  const forcedSales = sellEvents.length;
  const totalCrashToATH = athRecoveryMonth
    ? athRecoveryMonth - crashStart
    : null;
  const totalTroughToATH = athRecoveryMonth
    ? athRecoveryMonth - crashEnd
    : null;
  const dhhfRecovery = ungearedRecoveryMonth
    ? ((ungearedRecoveryMonth - crashStart) / 12).toFixed(1)
    : null;
  const tickInterval = Math.max(6, Math.floor(data.length / 14));
  const simYears = (data.length / 12).toFixed(1);
  const hiddenCosts = cumulativeTxCost + cumulativeVolDrag;

  const Slider = ({
    label,
    value,
    onChange,
    min,
    max,
    step,
    unit,
    color,
    displayValue,
  }) => (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 13,
        }}
      >
        <span style={{ color: '#b0b0be' }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>
          {displayValue || value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          height: 5,
          appearance: 'none',
          background: `linear-gradient(90deg, ${color}33, ${color})`,
          borderRadius: 3,
          outline: 'none',
          cursor: 'pointer',
          accentColor: color,
        }}
      />
    </div>
  );

  const Toggle = ({ label, active, toggle, color }) => (
    <div
      onClick={toggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        marginBottom: 3,
        background: active ? 'rgba(255,255,255,0.03)' : 'transparent',
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: active ? color : 'transparent',
          border: `2px solid ${color}`,
          flexShrink: 0,
          transition: 'all 0.15s',
        }}
      />
      <span style={{ fontSize: 13, color: active ? '#e0e0ea' : '#6b7280' }}>
        {label}
      </span>
    </div>
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(170deg, #060610 0%, #0a0b18 35%, #080912 100%)',
        color: '#e0e0ea',
        fontFamily: "'DM Mono', 'JetBrains Mono', 'Menlo', monospace",
        padding: '28px 24px',
        boxSizing: 'border-box',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@400;500;600;700;800&display=swap');
        input[type="range"]::-webkit-slider-thumb {
          appearance: none; width: 16px; height: 16px; border-radius: 50%;
          background: #fff; cursor: pointer; box-shadow: 0 0 8px rgba(255,255,255,0.3);
        }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #6ee7b7, #3b82f6)',
              borderRadius: 8,
              padding: '5px 14px',
            }}
          >
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 16,
                fontWeight: 800,
                color: '#060610',
                letterSpacing: '0.04em',
              }}
            >
              ASX: GHHF
            </span>
          </div>
          <div
            style={{
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 8,
              padding: '5px 14px',
            }}
          >
            <span style={{ fontSize: 13, color: '#9ca3af' }}>
              Geared DHHF • 30-40% LVR
            </span>
          </div>
        </div>
        <h1
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 28,
            fontWeight: 800,
            color: '#f0f0f5',
            margin: '0 0 6px',
            letterSpacing: '-0.02em',
          }}
        >
          Crash & Recovery Simulator
        </h1>
        <p
          style={{
            color: '#6b7280',
            fontSize: 13,
            letterSpacing: '0.03em',
            lineHeight: 1.5,
            maxWidth: 700,
            margin: '0 auto',
          }}
        >
          Total return basis (dividends included) • Calibrated: DHHF recovers
          ~5.3yr from GFC peak
          <br />
          TX costs + Currency effects + Volatility drag • Management fee 0.35%
          p.a. on gross assets
        </p>
      </div>

      {/* ── ALLOCATION BAR ── */}
      <div
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 6,
          gap: 2,
        }}
      >
        <div
          style={{ width: '37%', background: '#6ee7b7', borderRadius: 3 }}
          title="AU Equities (A200)"
        />
        <div
          style={{ width: '44%', background: '#3b82f6', borderRadius: 3 }}
          title="Intl Unhedged (BGBL+IEMG)"
        />
        <div
          style={{ width: '19%', background: '#a78bfa', borderRadius: 3 }}
          title="Intl Hedged (HGBL)"
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 20,
          fontSize: 12,
          color: '#9ca3af',
          marginBottom: 24,
        }}
      >
        <span>
          <span style={{ color: '#6ee7b7' }}>●</span> AU Equities 37% (A200)
        </span>
        <span>
          <span style={{ color: '#3b82f6' }}>●</span> Intl Unhedged 44%
          (BGBL+IEMG)
        </span>
        <span>
          <span style={{ color: '#a78bfa' }}>●</span> Intl Hedged 19% (HGBL)
        </span>
        <span style={{ marginLeft: 'auto', color: '#6b7280' }}>
          56% AUD-based · 44% unhedged
        </span>
      </div>

      {/* ── STAT CARDS ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 10,
          marginBottom: 12,
        }}
      >
        {[
          {
            label: 'PEAK DRAWDOWN',
            value: `${(100 - minEquity).toFixed(1)}%`,
            sub: `Trough: ${minEquity.toFixed(1)}`,
            color: '#f87171',
            icon: '↓',
          },
          {
            label: 'DHHF RECOVERY',
            value: dhhfRecovery ? `${dhhfRecovery} yr` : 'N/R',
            sub: 'Ungeared total return',
            color: '#3b82f6',
            icon: '◆',
          },
          {
            label: 'GHHF TO ATH',
            value: totalCrashToATH
              ? `${(totalCrashToATH / 12).toFixed(1)} yr`
              : 'Never',
            sub: totalCrashToATH
              ? `+${(totalCrashToATH / 12 - (dhhfRecovery || 0)).toFixed(
                  1
                )}yr vs DHHF`
              : `Not in ${simYears}yr`,
            color: totalCrashToATH ? '#38bdf8' : '#ef4444',
            icon: '★',
          },
          {
            label: 'FORCED SALES',
            value: `${forcedSales}`,
            sub:
              totalAssetsSold > 0
                ? `${fmt(totalAssetsSold)} liquidated`
                : 'None triggered',
            color: '#fb923c',
            icon: '⚠',
          },
          {
            label: 'INTEREST + FEES',
            value: fmt(cumulativeInterest + cumulativeMgtFee),
            sub: `Interest: ${fmt(cumulativeInterest)}`,
            color: '#a78bfa',
            icon: '$',
          },
          {
            label: 'HIDDEN COSTS',
            value: fmt(hiddenCosts),
            sub: `TX: ${fmt(cumulativeTxCost)} Vol: ${fmt(cumulativeVolDrag)}`,
            color: '#e879f9',
            icon: '⚡',
          },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12,
              padding: '14px 16px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 12,
                fontSize: 20,
                opacity: 0.1,
                fontFamily: "'DM Sans'",
              }}
            >
              {s.icon}
            </div>
            <div
              style={{
                fontSize: 10,
                color: '#6b7280',
                letterSpacing: '0.1em',
                marginBottom: 4,
                fontWeight: 500,
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: s.color,
                fontFamily: "'DM Sans', sans-serif",
                lineHeight: 1.1,
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── FORCED SALE DETAIL ── */}
      {sellEvents.length > 0 && (
        <div
          style={{
            background: 'rgba(248,113,113,0.05)',
            border: '1px solid rgba(248,113,113,0.12)',
            borderRadius: 10,
            padding: '10px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: '#fca5a5',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 16px',
            alignItems: 'center',
            lineHeight: 1.6,
          }}
        >
          <span style={{ fontWeight: 700, color: '#f87171' }}>
            ⚠ Forced asset sales:
          </span>
          {sellEvents.map((e, i) => (
            <span key={i} style={{ color: '#d4d4d8' }}>
              {data[e.month]?.label}: {fmt(e.amount)} sold (LVR was{' '}
              {e.lvr_before.toFixed(1)}%)
            </span>
          ))}
        </div>
      )}

      {/* ── MAIN LAYOUT ── */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}
      >
        {/* ── CHARTS ── */}
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 14,
            padding: '20px 14px 10px 0',
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: '#9ca3af',
              letterSpacing: '0.04em',
              marginBottom: 10,
              paddingLeft: 18,
              fontWeight: 500,
            }}
          >
            GHHF NAV vs DHHF (Ungeared) — Total Return — Base 100
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 12, left: 8, bottom: 8 }}
            >
              <defs>
                <linearGradient id="gG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#6ee7b7" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity={0.07} />
                  <stop offset="100%" stopColor="#f87171" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.04)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                interval={tickInterval}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceArea
                x1={data[crashStart]?.label}
                x2={data[Math.min(crashEnd, data.length - 1)]?.label}
                fill="url(#gC)"
                strokeOpacity={0}
              />
              <ReferenceLine
                y={100}
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray="6 4"
              />
              <ReferenceLine
                y={allTimeHigh}
                stroke="#38bdf8"
                strokeDasharray="4 2"
                strokeOpacity={0.4}
                label={{
                  value: 'ATH',
                  position: 'right',
                  fill: '#38bdf8',
                  fontSize: 10,
                }}
              />
              {athRecoveryMonth && data[athRecoveryMonth] && (
                <ReferenceLine
                  x={data[athRecoveryMonth].label}
                  stroke="#38bdf8"
                  strokeDasharray="4 2"
                  strokeOpacity={0.4}
                />
              )}
              {recoveryMonth && data[recoveryMonth] && (
                <ReferenceLine
                  x={data[recoveryMonth].label}
                  stroke="#6ee7b7"
                  strokeDasharray="3 3"
                  strokeOpacity={0.25}
                />
              )}
              {ungearedRecoveryMonth && data[ungearedRecoveryMonth] && (
                <ReferenceLine
                  x={data[ungearedRecoveryMonth].label}
                  stroke="#3b82f6"
                  strokeDasharray="3 3"
                  strokeOpacity={0.4}
                />
              )}
              {sellEvents.map((e, i) => (
                <ReferenceLine
                  key={`s${i}`}
                  x={data[e.month]?.label}
                  stroke="#f87171"
                  strokeDasharray="2 2"
                  strokeOpacity={0.4}
                />
              ))}
              <Area
                type="monotone"
                dataKey="equity"
                fill="url(#gG)"
                stroke="none"
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke="#6ee7b7"
                strokeWidth={2.5}
                dot={false}
                name="GHHF"
              />
              <Line
                type="monotone"
                dataKey="ungeared"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                name="DHHF"
                opacity={0.6}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* ── Legend ── */}
          <div
            style={{
              display: 'flex',
              gap: 24,
              paddingLeft: 18,
              marginTop: 6,
              fontSize: 12,
              color: '#9ca3af',
            }}
          >
            <span>
              <span style={{ color: '#6ee7b7' }}>━</span> GHHF (Geared)
            </span>
            <span>
              <span style={{ color: '#3b82f6' }}>╌</span> DHHF (Ungeared)
            </span>
            <span>
              <span style={{ color: '#f87171' }}>┊</span> Forced sale
            </span>
            <span>
              <span style={{ color: '#38bdf8' }}>┊</span> ATH recovery
            </span>
          </div>

          {showLVR && (
            <div style={{ marginTop: 16, paddingLeft: 18 }}>
              <div
                style={{
                  fontSize: 12,
                  color: '#9ca3af',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                LVR (%) — Band: 30-40% · Target: 35% ·{' '}
                <span style={{ color: '#f87171' }}>Sells above 40%</span> ·{' '}
                <span style={{ color: '#a78bfa' }}>Re-gears below 30%</span>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <ComposedChart
                  data={data}
                  margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.03)"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    interval={tickInterval}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    domain={[18, 52]}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceArea y1={30} y2={40} fill="rgba(251,191,36,0.05)" />
                  <ReferenceLine
                    y={35}
                    stroke="#fbbf24"
                    strokeDasharray="4 4"
                    strokeOpacity={0.35}
                  />
                  <ReferenceLine
                    y={40}
                    stroke="#f87171"
                    strokeDasharray="2 2"
                    strokeOpacity={0.25}
                    label={{
                      value: '40%',
                      position: 'right',
                      fill: '#f87171',
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    y={30}
                    stroke="#a78bfa"
                    strokeDasharray="2 2"
                    strokeOpacity={0.25}
                    label={{
                      value: '30%',
                      position: 'right',
                      fill: '#a78bfa',
                      fontSize: 10,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="lvr"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {showRates && (
            <div style={{ marginTop: 14, paddingLeft: 18 }}>
              <div
                style={{
                  fontSize: 12,
                  color: '#9ca3af',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                Borrowing Rate (%) — Institutional rate = RBA cash rate + credit
                spread
              </div>
              <ResponsiveContainer width="100%" height={110}>
                <ComposedChart
                  data={data}
                  margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.03)"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    interval={tickInterval}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <defs>
                    <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#f87171"
                        stopOpacity={0.15}
                      />
                      <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="borrowingRate"
                    fill="url(#gR)"
                    stroke="none"
                  />
                  <Line
                    type="monotone"
                    dataKey="borrowingRate"
                    stroke="#f87171"
                    strokeWidth={2}
                    dot={false}
                    name="Total rate"
                  />
                  <Line
                    type="monotone"
                    dataKey="cashRate"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    name="Cash rate"
                    opacity={0.5}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {showCurrency && currencyEnabled && (
            <div style={{ marginTop: 14, paddingLeft: 18 }}>
              <div
                style={{
                  fontSize: 12,
                  color: '#9ca3af',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                AUD Index (100 = start) — Affects 44% unhedged portion · Falls
                in crash (cushions) · Rises in recovery (drags)
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart
                  data={data}
                  margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.03)"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    interval={tickInterval}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine
                    y={100}
                    stroke="rgba(255,255,255,0.07)"
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey="audIndex"
                    stroke="#e879f9"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── CONTROLS ── */}
        <div
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 14,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {/* Presets */}
          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              letterSpacing: '0.08em',
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            SCENARIOS
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              marginBottom: 14,
            }}
          >
            {[
              {
                key: 'gfc_today',
                label: 'GFC Today',
                sub: '50% crash · 4.35% RBA',
                color: '#f87171',
              },
              {
                key: 'gfc_historical',
                label: 'GFC 2007',
                sub: '55% crash · 7.25% RBA',
                color: '#fb923c',
              },
              {
                key: 'covid',
                label: 'COVID 2020',
                sub: '35% crash · 0.75% RBA',
                color: '#fbbf24',
              },
              {
                key: 'severe',
                label: 'Severe Bear',
                sub: '60% crash · 5% spread',
                color: '#ef4444',
              },
            ].map((p) => (
              <div
                key={p.key}
                onClick={() => loadPreset(p.key)}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = p.color + '55';
                  e.currentTarget.style.background = p.color + '0a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: p.color }}>
                  {p.label}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {p.sub}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              letterSpacing: '0.08em',
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            CRASH PARAMETERS
          </div>
          <Slider
            label="Market crash depth"
            value={crashDepth}
            onChange={setCrashDepth}
            min={20}
            max={70}
            step={1}
            unit="%"
            color="#f87171"
          />
          <Slider
            label="Crash duration"
            value={crashDuration}
            onChange={setCrashDuration}
            min={3}
            max={36}
            step={1}
            unit=" months"
            color="#fb923c"
          />
          <Slider
            label="Recovery pace"
            value={recoveryPace}
            onChange={setRecoveryPace}
            min={15}
            max={80}
            step={1}
            unit=""
            color="#6ee7b7"
          />

          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              letterSpacing: '0.08em',
              marginBottom: 4,
              marginTop: 8,
              fontWeight: 600,
            }}
          >
            BORROWING
          </div>
          <Slider
            label="RBA cash rate"
            value={baseCashRate}
            onChange={setBaseCashRate}
            min={0.005}
            max={0.09}
            step={0.0025}
            unit="%"
            color="#60a5fa"
            displayValue={(baseCashRate * 100).toFixed(2)}
          />
          <Slider
            label="Crisis credit spread"
            value={crisisSpread}
            onChange={setCrisisSpread}
            min={0.5}
            max={8}
            step={0.25}
            unit="%"
            color="#f87171"
          />
          <Slider
            label="Starting LVR"
            value={initialLVR}
            onChange={setInitialLVR}
            min={30}
            max={40}
            step={1}
            unit="%"
            color="#fbbf24"
          />

          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,0.05)',
              paddingTop: 10,
              marginTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#9ca3af',
                letterSpacing: '0.08em',
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              REALISM EFFECTS
            </div>
            <Toggle
              label="Transaction costs (wider spreads in crash)"
              active={txCostEnabled}
              toggle={() => setTxCostEnabled(!txCostEnabled)}
              color="#e879f9"
            />
            <Toggle
              label="Currency effect (AUD/USD)"
              active={currencyEnabled}
              toggle={() => setCurrencyEnabled(!currencyEnabled)}
              color="#e879f9"
            />
            <Toggle
              label="Volatility drag (extra rebalancing)"
              active={volDragEnabled}
              toggle={() => setVolDragEnabled(!volDragEnabled)}
              color="#e879f9"
            />
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,0.05)',
              paddingTop: 10,
              marginTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: '#9ca3af',
                letterSpacing: '0.08em',
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              CHART LAYERS
            </div>
            <Toggle
              label="LVR bands"
              active={showLVR}
              toggle={() => setShowLVR(!showLVR)}
              color="#fbbf24"
            />
            <Toggle
              label="Interest rates"
              active={showRates}
              toggle={() => setShowRates(!showRates)}
              color="#f87171"
            />
            <Toggle
              label="AUD currency index"
              active={showCurrency}
              toggle={() => setShowCurrency(!showCurrency)}
              color="#e879f9"
            />
          </div>

          <div
            style={{
              marginTop: 'auto',
              paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.65 }}>
              <strong style={{ color: '#f87171' }}>GFC Today</strong> — A
              2008-scale crash at today's 4.35% RBA rate. The forward-looking
              stress test.
              <br />
              <strong style={{ color: '#fb923c' }}>GFC 2007</strong> —
              Historical. RBA was 7.25% going in, slashed to 3%. Higher starting
              rates = more interest drag.
              <br />
              <strong style={{ color: '#fbbf24' }}>COVID</strong> — Sharp but
              short. Tests how gearing handles a fast V-recovery.
              <br />
              <strong style={{ color: '#ef4444' }}>Severe</strong> — Worst case:
              60% crash, 2yr duration, slow recovery, wide spreads.
            </div>
          </div>
        </div>
      </div>

      {/* ── TIMELINE ── */}
      <div
        style={{
          marginTop: 16,
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 12,
          padding: '14px 20px',
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: '#9ca3af',
            letterSpacing: '0.06em',
            marginBottom: 12,
            fontWeight: 600,
          }}
        >
          RECOVERY TIMELINE
        </div>
        <div style={{ position: 'relative', height: 50 }}>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: 3,
              background: 'rgba(255,255,255,0.05)',
              transform: 'translateY(-50%)',
              borderRadius: 2,
            }}
          />
          {[
            { m: 0, label: 'Start', color: '#6b7280' },
            { m: crashStart, label: 'Crash begins', color: '#f87171' },
            ...sellEvents
              .slice(0, 3)
              .map((e, i) => ({
                m: e.month,
                label: `Sale ${i + 1}`,
                color: '#fb923c',
              })),
            { m: crashEnd, label: 'Trough', color: '#fbbf24' },
            ...(ungearedRecoveryMonth
              ? [
                  {
                    m: ungearedRecoveryMonth,
                    label: `DHHF ${dhhfRecovery}yr`,
                    color: '#3b82f6',
                  },
                ]
              : []),
            ...(recoveryMonth
              ? [{ m: recoveryMonth, label: `Par`, color: '#6ee7b7' }]
              : []),
            ...(athRecoveryMonth
              ? [
                  {
                    m: athRecoveryMonth,
                    label: `GHHF ATH ${(totalCrashToATH / 12).toFixed(1)}yr`,
                    color: '#38bdf8',
                  },
                ]
              : [
                  {
                    m: data.length - 1,
                    label: `No ATH (${simYears}yr+)`,
                    color: '#ef4444',
                  },
                ]),
          ]
            .filter((e, i, arr) => {
              const pos = e.m / Math.max(1, data.length - 1);
              return !arr
                .slice(0, i)
                .some(
                  (p) =>
                    Math.abs(p.m / Math.max(1, data.length - 1) - pos) < 0.03
                );
            })
            .map((evt, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${Math.min(
                    95,
                    Math.max(2, (evt.m / Math.max(1, data.length - 1)) * 100)
                  )}%`,
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: evt.color,
                    border: '3px solid #060610',
                    zIndex: 1,
                    boxShadow: `0 0 6px ${evt.color}44`,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: evt.color,
                    whiteSpace: 'nowrap',
                    fontWeight: 700,
                  }}
                >
                  {evt.label}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* ── DISCLAIMER ── */}
      <p
        style={{
          textAlign: 'center',
          marginTop: 16,
          fontSize: 12,
          color: '#4b5563',
          lineHeight: 1.6,
          maxWidth: 800,
          margin: '16px auto 0',
        }}
      >
        Simplified simulation for educational purposes only. All returns are
        total return basis (dividends reinvested). Calibrated so ungeared DHHF
        recovers in ~5.3yr from a GFC-scale peak, consistent with historical
        data. Actual GHHF performance depends on daily rebalancing, market
        microstructure, and distribution timing.
        <strong style={{ color: '#6b7280' }}> Not financial advice.</strong>
      </p>
    </div>
  );
}
