# GHHF vs DHHF Sim

## This simulation provides insight into how the following funds react during major financial events. 

4 Default Scenario's are baked in, and feel free to change the crash parameters, realism effects and chart layers to test any drawdown scenario you want. 

## Here's everything modelled in the simulator:

# Fund Structure (from Betashares product page + PDS)
Underlying portfolio mirrors DHHF: 37% AU equities, 41% US equities, 16% Developed ex-US, 6% Emerging Markets
4,000+ securities globally diversified, 63% international and unhedged
LVR band of 30-40%, actively monitored, rebalances to 35% target when breached
Gearing multiple varies between ~1.43x and ~1.67x of NAV
Management fee of 0.35% p.a. charged on gross assets (not just equity)
Institutional borrowing rate = RBA cash rate + credit spread

# Crash & Recovery Dynamics
Adjustable crash depth (20-70%), duration (3-36 months), and recovery pace
Post-crash V-shaped bounce that decays to long-term returns (~8.9% p.a. total return)
Calibrated so ungeared DHHF recovers in ~5.3 years from peak, matching actual GFC historical data
All returns are total return basis — dividends already included, no separate DRIP

# LVR Rebalancing Mechanics
When LVR breaches 40%: forced selling of assets at depressed prices to repay debt back to 35%
When LVR drops below 30%: re-gearing by borrowing more to buy assets at higher prices back to 35%
Solves the exact rebalance amount algebraically rather than approximating
Tracks every forced sale event with dollar amount and LVR at the time

# Interest Rate Model
RBA cash rate gets slashed during a crisis (mimicking central bank response)
Institutional credit spreads blow out simultaneously (banks charge more to lend during panic)
Net effect: total borrowing cost rises even as the cash rate falls
Cash rate normalises over ~3.5 years, credit spreads over ~2 years
Both components shown separately in the tooltip and rate chart

# Transaction Costs
Bid-ask spreads on every rebalancing trade
Normal conditions: ~0.1% per trade
During crash: widens to ~1.2% as liquidity dries up
Normalises over ~18 months post-trough
Cumulative cost tracked and shown in the "Hidden Costs" stat card

# Currency Effect (AUD/USD)
AUD drops ~25% during a global crisis (risk-off, USD strength)
This cushions the fall for the 63% international portion (assets worth more in AUD)
AUD then recovers over ~3 years, which drags on recovery (international gains translate to fewer AUD)
Dedicated AUD index chart showing the full cycle

# Volatility Drag
High daily volatility causes extra intra-month LVR band breaches
Each breach triggers a small forced trade with worse execution (1.5x normal transaction cost)
Also incurs a small crystallisation loss per event from the sell-low/buy-high whipsaw
More pronounced during crash and early recovery when vol is highest
Number of extra rebalances shown in tooltip

# Preset Scenarios
GFC Today: 50% crash at current 4.35% RBA rate (forward-looking stress test)
GFC 2007: 55% crash at historical 7.25% RBA rate (what actually happened)
COVID 2020: 35% crash over 2 months, 0.75% RBA, fast V-recovery
Severe Bear: 60% crash, 2-year duration, slow recovery, 5% crisis spread

# Outputs & Visualisation
Main chart: GHHF NAV vs DHHF (ungeared) on a base-100 index
LVR chart with 30-40% band, 35% target, and rebalance markers
Interest rate chart showing total borrowing rate and cash rate separately
AUD currency index chart
Event timeline with crash, forced sales, DHHF recovery, GHHF par, and GHHF ATH milestones
Six stat cards: drawdown, DHHF recovery, GHHF to ATH, forced sales, interest + fees, hidden costs
Forced sale detail strip showing each event with dollar amount and LVR
All three realism effects individually toggleable to isolate their impact

