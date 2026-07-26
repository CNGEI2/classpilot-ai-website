(function attachClassPilotStudyScheduler(root, factory) {
  const planner = root.ClassPilotPlanner || (
    typeof require === "function" ? require("./planner.js") : {}
  );
  const api = factory(planner);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ClassPilotStudyScheduler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStudyScheduler(planner) {
  "use strict";

  const DEFAULT_BLOCKS = [
    { hour: 10, minute: 0 },
    { hour: 18, minute: 0 }
  ];

  function boundedInteger(value, fallback, min, max) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function normalizedBlocks(blocks) {
    const source = Array.isArray(blocks) && blocks.length ? blocks : DEFAULT_BLOCKS;
    return source.slice(0, 6).map((block) => ({
      hour: boundedInteger(block?.hour, 18, 0, 23),
      minute: boundedInteger(block?.minute, 0, 0, 59)
    })).sort((left, right) => left.hour - right.hour || left.minute - right.minute);
  }

  function createSlots(now, days, blocks) {
    const current = new Date(now);
    const slots = [];
    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      for (const block of blocks) {
        const start = new Date(
          current.getFullYear(),
          current.getMonth(),
          current.getDate() + dayOffset,
          block.hour,
          block.minute,
          0,
          0
        );
        if (start.getTime() > current.getTime()) slots.push(start);
      }
    }
    return slots;
  }

  function buildStudySchedule(workspace, now = new Date(), options = {}) {
    const current = new Date(now);
    const days = boundedInteger(options.days, 7, 1, 21);
    const sessionMinutes = boundedInteger(options.sessionMinutes, 50, 15, 120);
    const queue = planner.buildTodayQueue(workspace, current);
    const remaining = queue.active.map((assignment) => ({
      ...assignment,
      minutes: Math.max(0, Math.round(Number(assignment.estimatedRemainingMinutes) || 0)),
      dueTime: assignment.dueAt ? new Date(assignment.dueAt).getTime() : Infinity
    })).filter((assignment) => assignment.minutes > 0);
    remaining.sort((left, right) => {
      const leftDue = Number.isFinite(left.dueTime) && left.dueTime > current.getTime()
        ? left.dueTime
        : current.getTime();
      const rightDue = Number.isFinite(right.dueTime) && right.dueTime > current.getTime()
        ? right.dueTime
        : current.getTime();
      return leftDue - rightDue || right.priorityScore - left.priorityScore ||
        String(left.title || "").localeCompare(String(right.title || ""));
    });

    const sessions = [];
    const slots = createSlots(current, days, normalizedBlocks(options.blocks));
    for (const start of slots) {
      const assignment = remaining.find((item) => {
        if (item.minutes <= 0) return false;
        return !Number.isFinite(item.dueTime) || item.dueTime <= current.getTime() ||
          start.getTime() < item.dueTime;
      });
      if (!assignment) continue;
      let minutes = Math.min(sessionMinutes, assignment.minutes);
      if (Number.isFinite(assignment.dueTime) && assignment.dueTime > start.getTime()) {
        minutes = Math.min(minutes, Math.floor((assignment.dueTime - start.getTime()) / 60000));
      }
      if (minutes < 1) continue;
      const end = new Date(start.getTime() + minutes * 60000);
      sessions.push({
        id: "study:" + assignment.courseId + ":" + assignment.id + ":" + start.toISOString(),
        type: "study",
        courseId: assignment.courseId,
        courseCode: assignment.courseCode,
        assignmentId: assignment.id,
        title: assignment.title,
        nextAction: assignment.nextAction,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        dueAt: assignment.dueAt || "",
        minutes
      });
      assignment.minutes -= minutes;
    }

    return {
      generatedAt: current.toISOString(),
      sessions,
      unscheduled: remaining.filter((item) => item.minutes > 0).map((item) => ({
        courseId: item.courseId,
        assignmentId: item.id,
        title: item.title,
        minutes: item.minutes
      }))
    };
  }

  return { buildStudySchedule };
});
