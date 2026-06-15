'use strict';
// Extracted from hook-handler.cjs — handles 'budget-status' command.

module.exports = {
  handle: function(hCtx) {
    var _getBudgetStatus = hCtx._getBudgetStatus;
    var b = _getBudgetStatus();
    if (!b) { console.log('No budget data yet — token tracking not initialized.'); return; }
    console.log('Today:   $' + b.todayCost.toFixed(2) + ' / $' + b.dailyLimit  + ' (' + b.dailyPct  + '%)' + (b.autoTuned ? ' [auto-tuned]' : ''));
    console.log('Month:   $' + b.monthCost.toFixed(2) + ' / $' + b.monthlyLimit + ' (' + b.monthlyPct + '%)');
    console.log('Status:  ' + (b.breached ? 'BREACHED' : b.spike ? 'SPIKE' : b.alert ? 'ALERT' : 'OK'));
    console.log('Edit .monomind/budget.json to adjust. Delete to re-tune.');
  },
};
