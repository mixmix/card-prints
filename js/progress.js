/* Progress across a run of phases.

   The phases count different things — names, then cards, then sets — so each
   reports its own tally and the bar weights them into one figure.

   Which phases run varies: a plain list runs all four, resolving one cube runs
   the first two, and loading a chosen diff bucket runs the last two, its cards
   having been resolved already. So the plan is handed in per run rather than
   fixed here, and the weights are normalised by the plan's own total — a
   two-phase run still fills the bar to the end. */

export function track(phases, onProgress){
  const whole = phases.reduce((sum, p) => sum + p.weight, 0) || 1;
  const before = [];
  let running = 0;
  for (const p of phases){ before.push(running); running += p.weight; }
  const index = new Map(phases.map((p, i) => [p.id, i]));

  /* A phase in the plan that never reports keeps its weight in the total, so
     the bar jumps forward when work is skipped. Recovering the weight instead
     would mean moving the bar backwards over phases already drawn.

     `note` replaces the count once a phase is finished, to say what it got
     rather than how far along it is. */
  return (id, done = 0, total = 0, note) => {
    const i = index.get(id);
    /* Not in this run's plan: report nothing. That lets one routine always
       call the same phase ids and leaves the plan to decide what shows. */
    if (i === undefined) return;
    onProgress({
      index: i, done, total, note,
      label: phases[i].label, unit: phases[i].unit,
      fraction: (before[i] + phases[i].weight * (total ? Math.min(done / total, 1) : 0)) / whole,
    });
  };
}
