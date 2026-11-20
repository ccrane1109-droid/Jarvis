/* ==========================================================================
   JARVIS — Tasks: which tasks can be overdue (pure rules: no page, storage or network, so they can be tested outside
   the browser).

   A task is one of two kinds:

     "scheduled"  an activity you planned for a day: made in the Day Planner, on the Calendar, on Home's hour-by-hour
                  schedule or by "Add to day" on a goal. It belongs to its day. It is never overdue: if it did not
                  get done it simply stays on that day, not done, so you can look back at what you did and missed.
     "deadline"   a task with a date you have to meet: made in the Tasks section (the To-Do list) or in Strategy.
                  Only these are overdue once their day has passed.

   The kind is saved on the task as `kind`. Tasks saved before this existed have no `kind`: they are read as scheduled,
   except one that is linked to a Strategy item, which stays a deadline (Strategy dates are real due dates). Nothing is
   rewritten to get this: the rule reads the task as it is. Any task can be changed to a deadline (or back) in the
   Tasks section.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JarvisTaskKind = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = ["scheduled", "deadline"];

  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // The saved kind of a task, or "" when it has none (an older task).
  function saved(task) { return task && KINDS.indexOf(task.kind) !== -1 ? task.kind : ""; }

  // links: the Strategy task links ([{ id: taskId, nodeId, deletedAt? }]). -> a function: is this task id tied to a Strategy item?
  function linkedTo(links) {
    const set = {};
    (Array.isArray(links) ? links : []).forEach(function (l) { if (l && typeof l.id === "string" && l.nodeId && !l.deletedAt) set[l.id] = true; });
    return function (id) { return !!set[id]; };
  }

  // opts: { linked(id) } optional. -> "scheduled" | "deadline"
  function kindOf(task, opts) {
    const k = saved(task);
    if (k) return k;
    const linked = opts && typeof opts.linked === "function" ? opts.linked : null;
    return task && linked && linked(task.id) ? "deadline" : "scheduled";
  }
  function isDeadline(task, opts) { return kindOf(task, opts) === "deadline"; }

  // A deadline task that nobody ticked and whose day has passed. Scheduled tasks are never overdue.
  function isOverdue(task, today, opts) {
    return !!task && !task.completed && isDate(task.date) && isDate(today) && task.date < today && isDeadline(task, opts);
  }

  return { KINDS: KINDS, saved: saved, linkedTo: linkedTo, kindOf: kindOf, isDeadline: isDeadline, isOverdue: isOverdue };
});
